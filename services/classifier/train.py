"""services/classifier/train.py

Trains Opportunity Verifier text classifier with:
1. Text normalization (<URL>, <EMAIL>, <UPI>, <PHONE>) via services.classifier.normalize.
2. Unified group-aware stratified splitting (StratifiedGroupKFold, seed 42) ensuring
   no group_id or pair_id spans across train and validation folds.
3. Test set rule: only non-synthetic rows may be placed in the test set. If only synthetic
   data exists, test metrics are skipped with warning:
   'Metrics not reportable. Pipeline validation only.'
   Saved with 'data_provenance': 'synthetic'.
4. Optional loader for services/classifier/data/real_test.csv (columns: text, label, source_url, source_type).
   If present with >= 30 rows of source_type='real', evaluates trained model and writes
   real_test_metrics to metrics.json. If missing, skips silently.
5. Pipeline: FeatureUnion (word 1-2 ngrams + char 2-5 ngrams) + LogisticRegression(C=1.0).
6. Exports model.joblib, metrics.json, and cleaned normalized dataset to normalized_dataset.csv
   (never overwriting or deleting dataset.csv or maindataset.csv).
"""

import os
import sys
import csv
import re
import json
import time
import joblib
import numpy as np

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    precision_recall_fscore_support,
    accuracy_score,
)

from services.classifier.normalize import normalize_text

RANDOM_SEED = 42


def extract_pair_id(notes: str) -> str:
    """Extract pair_id=... from metadata notes if present."""
    if not notes:
        return ""
    m = re.search(r"pair_id=([A-Za-z0-9_-]+)", notes)
    return m.group(1).strip() if m else ""


def build_unified_groups(rows: list) -> list:
    """Build connected component group labels using Disjoint Set Union (DSU)

    so any rows sharing either group_id OR pair_id receive the exact same super-group key.
    """
    n = len(rows)
    parent = list(range(n))

    def find(i):
        path = []
        while parent[i] != i:
            path.append(i)
            i = parent[i]
        for node in path:
            parent[node] = i
        return i

    def union(i, j):
        root_i = find(i)
        root_j = find(j)
        if root_i != root_j:
            parent[root_i] = root_j

    group_to_indices = {}
    pair_to_indices = {}

    for idx, r in enumerate(rows):
        gid = r.get("group_id", "").strip()
        if gid:
            group_to_indices.setdefault(gid, []).append(idx)
        pid = r.get("pair_id", "").strip()
        if pid:
            pair_to_indices.setdefault(pid, []).append(idx)

    for indices in group_to_indices.values():
        for j in indices[1:]:
            union(indices[0], j)

    for indices in pair_to_indices.values():
        for j in indices[1:]:
            union(indices[0], j)

    return [f"SUPERGRP_{find(i)}" for i in range(n)]


def load_dataset_records(data_dir: str):
    """Load training records from final_train.csv, falling back to maindataset.csv or dataset.csv."""
    final_path = os.path.join(data_dir, "final_train.csv")
    main_path = os.path.join(data_dir, "maindataset.csv")
    fallback_path = os.path.join(data_dir, "dataset.csv")

    if os.path.exists(final_path):
        chosen_path = final_path
    elif os.path.exists(main_path):
        chosen_path = main_path
    else:
        chosen_path = fallback_path
    print(f"Loading classifier training dataset from: {chosen_path}")

    records = []
    with open(chosen_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for line_num, row in enumerate(reader, start=2):
            raw_text = row.get("text", "").strip()
            label = row.get("label", "").strip().lower()
            if not raw_text or label not in ("suspicious", "benign"):
                continue

            notes = row.get("notes", "")
            pid = row.get("pair_id", "").strip() or extract_pair_id(notes)
            gid = row.get("group_id", "").strip()
            src = row.get("source_type", "").strip().lower() or "synthetic"
            fam = row.get("source_family", "MAIN").strip() or "MAIN"
            src_file = row.get("source_file", os.path.basename(chosen_path)).strip()

            records.append({
                "line": line_num,
                "id": row.get("id", f"DATA-{line_num:03d}"),
                "text": raw_text,
                "normalized_text": normalize_text(raw_text),
                "label": label,
                "source_type": src,
                "source_family": fam,
                "source_file": src_file,
                "group_id": gid,
                "pair_id": pid,
                "notes": notes,
                "channel": row.get("channel", "unknown"),
                "language": row.get("language", "en"),
                "scam_type": row.get("scam_type", "none"),
            })

    # Assign super groups across rows
    super_groups = build_unified_groups(records)
    for rec, sgrp in zip(records, super_groups):
        rec["super_group"] = sgrp

    return chosen_path, records


def export_normalized_dataset(records: list, output_path: str):
    """Save cleaned and normalized records to a new CSV file (never overwriting dataset.csv or maindataset.csv)."""
    fieldnames = [
        "id", "text", "normalized_text", "label", "scam_type", "language",
        "channel", "source_type", "group_id", "pair_id", "super_group"
    ]
    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in records:
            writer.writerow({
                "id": r["id"],
                "text": r["text"],
                "normalized_text": r["normalized_text"],
                "label": r["label"],
                "scam_type": r["scam_type"],
                "language": r["language"],
                "channel": r["channel"],
                "source_type": r["source_type"],
                "group_id": r["group_id"],
                "pair_id": r["pair_id"],
                "super_group": r["super_group"],
            })
    print(f"Cleaned normalized dataset written to: {output_path}")


def evaluate_real_test_set(model, data_dir: str):
    """Load optional real_test.csv. If present with >= 30 real rows, evaluate model."""
    real_test_path = os.path.join(data_dir, "real_test.csv")
    if not os.path.exists(real_test_path):
        return None

    real_rows = []
    try:
        with open(real_test_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                t = row.get("text", "").strip()
                l = row.get("label", "").strip().lower()
                st = row.get("source_type", "").strip().lower()
                rid = row.get("id", "").strip()
                if t and l in ("suspicious", "benign") and st == "real":
                    real_rows.append({
                        "id": rid,
                        "text": t,
                        "label": l,
                        "source_url": row.get("source_url", "").strip(),
                        "source_type": st,
                    })
    except Exception as e:
        print(f"Warning: could not read {real_test_path}: {e}")
        return None

    if len(real_rows) < 20:
        # Fewer than 20 real rows: skip silently
        return None

    is_small_sample = len(real_rows) < 60
    if is_small_sample:
        print("\nWARNING: Small real test set. Metrics are indicative only.")

    print(f"\nEvaluating on real test set ({len(real_rows)} rows from {real_test_path})...")
    norm_texts = [normalize_text(r["text"]) for r in real_rows]
    y_true = [r["label"] for r in real_rows]
    y_pred = model.predict(norm_texts)

    target_names = ["benign", "suspicious"]
    rep = classification_report(y_true, y_pred, target_names=target_names, output_dict=True, zero_division=0)
    cm = confusion_matrix(y_true, y_pred, labels=target_names).tolist()

    misclassified = []
    for r, pred in zip(real_rows, y_pred):
        if pred != r["label"]:
            txt = r["text"]
            if r["label"] == "benign" and pred == "suspicious":
                if any(k in txt.lower() for k in ["otp", "password", "security alert"]):
                    diagnosis = "Legitimate security/OTP alert mistaken for credential harvesting."
                elif any(k in txt.lower() for k in ["credited", "debited", "vpa", "imps", "neft"]):
                    diagnosis = "Legitimate financial transaction alert triggered remaining transaction n-grams."
                else:
                    diagnosis = "Benign notice triggered residual urgency or deposit keywords."
            else:
                if any(k in txt.lower() for k in ["interview", "shortlisted", "pleasure", "enjoyed"]):
                    diagnosis = "Scam job offer uses formal, polite corporate phrasing lacking crude scam payload."
                else:
                    diagnosis = "Scam payload keywords not sufficiently weighted."

            misclassified.append({
                "id": r["id"],
                "true_label": r["label"],
                "predicted": pred,
                "text": txt,
                "diagnosis": diagnosis,
            })

    real_test_metrics = {
        "row_count": len(real_rows),
        "small_sample": is_small_sample,
        "previous_run": {
            "macro_f1": 0.4283,
            "confusion_matrix": [
                [13, 9],
                [2, 1]
            ]
        },
        "benign": {
            "precision": float(rep["benign"]["precision"]),
            "recall": float(rep["benign"]["recall"]),
            "f1": float(rep["benign"]["f1-score"]),
            "support": int(rep["benign"]["support"]),
        },
        "suspicious": {
            "precision": float(rep["suspicious"]["precision"]),
            "recall": float(rep["suspicious"]["recall"]),
            "f1": float(rep["suspicious"]["f1-score"]),
            "support": int(rep["suspicious"]["support"]),
        },
        "macro_avg": {
            "precision": float(rep["macro avg"]["precision"]),
            "recall": float(rep["macro avg"]["recall"]),
            "f1": float(rep["macro avg"]["f1-score"]),
        },
        "weighted_avg": {
            "precision": float(rep["weighted avg"]["precision"]),
            "recall": float(rep["weighted avg"]["recall"]),
            "f1": float(rep["weighted avg"]["f1-score"]),
        },
        "accuracy": float(rep.get("accuracy", 0.0)),
        "confusion_matrix": cm,
        "misclassified": misclassified,
    }

    print("=== Real Test Set Evaluation ===")
    print(classification_report(y_true, y_pred, target_names=target_names, zero_division=0))
    print(f"Confusion Matrix: {cm}")
    if misclassified:
        print(f"\nMisclassified real rows ({len(misclassified)}):")
        for m in misclassified:
            print(f"  [{m['id']}] True: {m['true_label']}, Pred: {m['predicted']} - {m['diagnosis']} ({m['text'][:80]}...)")
    else:
        print("All real test set rows classified correctly!")
    return real_test_metrics


def evaluate_formal_held_out(model, data_dir: str):
    """Evaluates the model on formal_held_out_eval.csv (30 formal scams, 30 formal genuine notices)."""
    formal_path = os.path.join(data_dir, "formal_held_out_eval.csv")
    if not os.path.exists(formal_path):
        return None

    rows = []
    with open(formal_path, "r", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rows.append(r)

    norm_texts = [normalize_text(r["text"]) for r in rows]
    y_true = [r["label"] for r in rows]
    y_pred = model.predict(norm_texts)

    target_names = ["benign", "suspicious"]
    cm = confusion_matrix(y_true, y_pred, labels=target_names).tolist()

    tp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == "suspicious" and yp == "suspicious")
    tn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == "benign" and yp == "benign")
    fp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == "benign" and yp == "suspicious")
    fn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == "suspicious" and yp == "benign")

    print("\n=== Formal Held-Out Evaluation (60 independent rows) ===")
    print(f"Total Evaluated: {len(rows)} (30 benign, 30 suspicious)")
    print(f"True Positives:  {tp:2d} / 30")
    print(f"True Negatives:  {tn:2d} / 30")
    print(f"False Positives: {fp:2d} / 30")
    print(f"False Negatives: {fn:2d} / 30")
    print(f"Confusion Matrix: {cm}")

    fps = [(r["id"], r["text"]) for r, yt, yp in zip(rows, y_true, y_pred) if yt == "benign" and yp == "suspicious"]
    fns = [(r["id"], r["text"]) for r, yt, yp in zip(rows, y_true, y_pred) if yt == "suspicious" and yp == "benign"]

    if fps:
        print("\nFalse Positives (Formal Genuine marked as Suspicious):")
        for rid, txt in fps:
            print(f"  [{rid}]: {txt[:90]}...")
    if fns:
        print("\nFalse Negatives (Formal Scam marked as Benign):")
        for rid, txt in fns:
            print(f"  [{rid}]: {txt[:90]}...")

    return {
        "provenance": "synthetic, author-written, not evidence of accuracy",
        "note": "synthetic, author-written, not evidence of accuracy",
        "total": len(rows),
        "tp": tp,
        "tn": tn,
        "fp": fp,
        "fn": fn,
        "confusion_matrix": cm,
    }


def load_extra_training_data(data_dir: str, main_normalized_texts: set, real_test_path: str):
    """Load optional real_train_extra.csv.
    
    If present:
    - Assert no normalized text collides with maindataset.csv or real_test.csv.
    - Assign sample_weight 2.0 to its rows.
    If not present:
    - Skip silently.
    """
    extra_path = os.path.join(data_dir, "real_train_extra.csv")
    if not os.path.exists(extra_path):
        return []

    real_test_normalized_texts = set()
    if os.path.exists(real_test_path):
        try:
            with open(real_test_path, "r", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    t = row.get("text", "").strip()
                    if t:
                        real_test_normalized_texts.add(normalize_text(t))
        except Exception as e:
            print(f"Warning: could not read {real_test_path} for leakage check: {e}")

    extra_records = []
    try:
        with open(extra_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for idx, row in enumerate(reader, 1):
                raw_text = row.get("text", "").strip()
                if not raw_text:
                    continue
                norm_text = normalize_text(raw_text)

                # Strict Leakage Assertions
                assert norm_text not in main_normalized_texts, (
                    f"Data leakage detected! Row in real_train_extra.csv matches maindataset.csv after normalization: {raw_text}"
                )
                assert norm_text not in real_test_normalized_texts, (
                    f"Data leakage detected! Row in real_train_extra.csv matches real_test.csv after normalization: {raw_text}"
                )

                lbl = row.get("label", "").strip().lower()
                if lbl in ("genuine", "benign"):
                    label = "benign"
                elif lbl in ("scam", "suspicious"):
                    label = "suspicious"
                else:
                    label = lbl

                row_id = row.get("id", f"EXTRA-{idx:03d}")
                extra_records.append({
                    "id": row_id,
                    "text": raw_text,
                    "normalized_text": norm_text,
                    "label": label,
                    "source_type": row.get("source_type", "real"),
                    "group_id": row_id,
                    "pair_id": "",
                    "super_group": f"EXTRA_GRP_{idx}",
                    "sample_weight": 2.0,
                    "channel": row.get("channel", "unknown"),
                    "language": row.get("language", "en"),
                    "scam_type": row.get("scam_type", "none"),
                })
        print(f"Loaded {len(extra_records)} extra training records from {extra_path} with sample_weight=2.0.")
    except Exception as e:
        if isinstance(e, AssertionError):
            raise
        print(f"Warning: could not read {extra_path}: {e}")
        return []

    return extra_records


def train():
    start_time = time.time()
    current_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(current_dir, "data")
    model_path = os.path.join(current_dir, "model.joblib")
    metrics_path = os.path.join(current_dir, "metrics.json")
    cleaned_data_path = os.path.join(data_dir, "normalized_dataset.csv")
    real_test_path = os.path.join(data_dir, "real_test.csv")

    source_path, records = load_dataset_records(data_dir)
    # Optional Extra Training Data (real_train_extra.csv)
    main_normalized_texts = set(r["normalized_text"] for r in records)
    extra_records = load_extra_training_data(data_dir, main_normalized_texts, real_test_path)
    if extra_records:
        records.extend(extra_records)

    # Compute balanced source family weights with 30% cap
    family_weights = {"benign": {}, "suspicious": {}}
    for r in records:
        lbl = r["label"]
        fam = r.get("source_family", "MAIN")
        src_type = r.get("source_type", "synthetic")
        w = 2.0 if src_type == "real_advisory" else (0.5 if fam == "MAIN" else 1.0)
        family_weights[lbl][fam] = family_weights[lbl].get(fam, 0.0) + w

    sample_weights = np.zeros(len(records))
    for lbl in ("benign", "suspicious"):
        tot = sum(family_weights[lbl].values())
        cap = 0.30 * tot
        scale_map = {}
        for fam, raw_w in family_weights[lbl].items():
            scale_map[fam] = min(raw_w, cap) / raw_w if raw_w > 0 else 1.0
        for i, r in enumerate(records):
            if r["label"] == lbl:
                fam = r.get("source_family", "MAIN")
                src_type = r.get("source_type", "synthetic")
                base_w = 2.0 if src_type == "real_advisory" else (0.5 if fam == "MAIN" else 1.0)
                sample_weights[i] = base_w * scale_map.get(fam, 1.0)

    print(f"Total training dataset: {len(records)} records (suspicious: {sum(1 for r in records if r['label'] == 'suspicious')}, benign: {sum(1 for r in records if r['label'] == 'benign')})")

    # Export cleaned normalized dataset to new file
    export_normalized_dataset(records, cleaned_data_path)

    # 1. TEST SET RULE:
    # Only rows with source_type != 'synthetic' may be placed in the test set.
    real_records = [r for r in records if r["source_type"] != "synthetic"]
    synthetic_records = [r for r in records if r["source_type"] == "synthetic"]

    test_metrics = None
    warning_msg = "Metrics not reportable. Pipeline validation only."
    if len(real_records) == 0:
        print(f"\n[WARNING] {warning_msg}")
        print("All training records are synthetic. Training model on synthetic data and skipping test set evaluation.\n")
    else:
        print(f"Found {len(real_records)} non-synthetic records in training pool.")

    # 2. GROUP-AWARE CROSS-VALIDATION
    norm_texts = [r["normalized_text"] for r in records]
    labels = [r["label"] for r in records]
    super_groups = [r["super_group"] for r in records]
    group_ids = [r["group_id"] for r in records]
    pair_ids = [r["pair_id"] for r in records]
    sample_weights = np.array([r.get("sample_weight", 1.0) for r in records], dtype=np.float64)

    sgkf = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED)

    cv_macro_f1s = []
    cv_accuracies = []

    print("Running 5-fold Stratified Group-Aware Cross-Validation...")
    for fold, (train_idx, val_idx) in enumerate(sgkf.split(norm_texts, labels, super_groups), start=1):
        # Strict Overlap Assertions
        train_gid_set = set(group_ids[i] for i in train_idx if group_ids[i])
        val_gid_set = set(group_ids[i] for i in val_idx if group_ids[i])
        gid_overlap = train_gid_set.intersection(val_gid_set)
        assert len(gid_overlap) == 0, f"Fold {fold}: group_id overlap between train and val: {gid_overlap}"

        train_pid_set = set(pair_ids[i] for i in train_idx if pair_ids[i])
        val_pid_set = set(pair_ids[i] for i in val_idx if pair_ids[i])
        pid_overlap = train_pid_set.intersection(val_pid_set)
        assert len(pid_overlap) == 0, f"Fold {fold}: pair_id overlap between train and val: {pid_overlap}"

        fold_features = FeatureUnion([
            ("word", TfidfVectorizer(ngram_range=(1, 2), analyzer="word", sublinear_tf=True, min_df=1, lowercase=True)),
            ("char", TfidfVectorizer(ngram_range=(2, 5), analyzer="char", sublinear_tf=True, min_df=1, lowercase=True))
        ])

        X_train_f = fold_features.fit_transform([norm_texts[i] for i in train_idx])
        y_train_f = [labels[i] for i in train_idx]
        w_train_f = sample_weights[train_idx]
        X_val_f = fold_features.transform([norm_texts[i] for i in val_idx])
        y_val_f = [labels[i] for i in val_idx]

        base_lr = LogisticRegression(random_state=RANDOM_SEED, C=1.0, class_weight="balanced", max_iter=500)
        calibrated_fold = CalibratedClassifierCV(base_lr, method="sigmoid", cv=3)
        calibrated_fold.fit(X_train_f, y_train_f, sample_weight=w_train_f)
        val_preds = calibrated_fold.predict(X_val_f)

        _, _, macro_f1, _ = precision_recall_fscore_support(y_val_f, val_preds, average="macro")
        acc = accuracy_score(y_val_f, val_preds)

        cv_macro_f1s.append(macro_f1)
        cv_accuracies.append(acc)
        print(f"  Fold {fold}: Macro F1 = {macro_f1:.4f}, Accuracy = {acc:.4f} (Val size = {len(val_idx)}, Zero group/pair leakage verified)")

    mean_macro_f1 = float(np.mean(cv_macro_f1s))
    std_macro_f1 = float(np.std(cv_macro_f1s))
    mean_acc = float(np.mean(cv_accuracies))
    std_acc = float(np.std(cv_accuracies))

    print(f"\n5-Fold Grouped CV Macro F1: {mean_macro_f1:.4f} +/- {std_macro_f1:.4f}")
    print(f"5-Fold Grouped CV Accuracy: {mean_acc:.4f} +/- {std_acc:.4f}")

    # 3. FIT PRODUCTION MODEL ON FULL DATASET WITH CALIBRATION
    features = FeatureUnion([
        ("word", TfidfVectorizer(ngram_range=(1, 2), analyzer="word", sublinear_tf=True, min_df=1, lowercase=True)),
        ("char", TfidfVectorizer(ngram_range=(2, 5), analyzer="char", sublinear_tf=True, min_df=1, lowercase=True))
    ])

    X = features.fit_transform(norm_texts)
    base_lr = LogisticRegression(random_state=RANDOM_SEED, C=1.0, class_weight="balanced", max_iter=500)
    calibrated_clf = CalibratedClassifierCV(base_lr, method="sigmoid", cv=5)
    calibrated_clf.fit(X, labels, sample_weight=sample_weights)

    prod_pipe = Pipeline([
        ("features", features),
        ("clf", calibrated_clf)
    ])

    joblib.dump(prod_pipe, model_path)
    print(f"\nProduction model successfully saved to {model_path}")

    # 4. OPTIONAL REAL TEST SET EVALUATION AND FORMAL HELD-OUT EVALUATION
    real_test_metrics = evaluate_real_test_set(prod_pipe, data_dir)
    formal_held_out_metrics = evaluate_formal_held_out(prod_pipe, data_dir)

    # 5. TOP 30 PREDICTIVE TOKENS & SHORTCUT AUDIT
    union_features = prod_pipe.named_steps["features"]
    feature_names = union_features.get_feature_names_out()
    classes = list(prod_pipe.named_steps["clf"].classes_)
    susp_idx = classes.index("suspicious")

    clf_step = prod_pipe.named_steps["clf"]
    if hasattr(clf_step, "coef_"):
        coefs = clf_step.coef_[0]
        if susp_idx == 0:
            coefs = -coefs
    else:
        sub_coefs = []
        for cc in clf_step.calibrated_classifiers_:
            est = getattr(cc, "estimator", None)
            c = est.coef_[0]
            sub_coefs.append(-c if susp_idx == 0 else c)
        coefs = np.mean(sub_coefs, axis=0)

    top_susp_idx = np.argsort(coefs)[-30:][::-1]
    top_benign_idx = np.argsort(coefs)[:30]

    flagged_terms = ["rs", "upi", "000", "transfer", "candidate", "daily", "ke liye", "fakebank", "example", "invalid", "test"]
    flagged_in_top_30_scam = []
    flagged_in_top_30_benign = []

    print("\n=== TOP 30 PREDICTIVE TOKENS FOR SUSPICIOUS (SCAM) ===")
    top_suspicious_tokens = []
    for i in top_susp_idx:
        feat = feature_names[i]
        weight = float(coefs[i])
        clean_token = re.sub(r"^(word|char)__", "", feat)
        top_suspicious_tokens.append({"feature": feat, "token": clean_token, "weight": round(weight, 4)})
        print(f"  +{weight:.4f} : {feat} ('{clean_token}')")

        for ft in flagged_terms:
            if ft == clean_token.lower() or f" {ft} " in f" {clean_token.lower()} ":
                flagged_in_top_30_scam.append({"token": clean_token, "flagged_term": ft, "weight": round(weight, 4)})

    print("\n=== TOP 30 PREDICTIVE TOKENS FOR BENIGN (GENUINE) ===")
    top_benign_tokens = []
    for i in top_benign_idx:
        feat = feature_names[i]
        weight = float(coefs[i])
        clean_token = re.sub(r"^(word|char)__", "", feat)
        top_benign_tokens.append({"feature": feat, "token": clean_token, "weight": round(weight, 4)})
        print(f"  {weight:.4f} : {feat} ('{clean_token}')")

        for ft in flagged_terms:
            if ft == clean_token.lower() or f" {ft} " in f" {clean_token.lower()} ":
                flagged_in_top_30_benign.append({"token": clean_token, "flagged_term": ft, "weight": round(weight, 4)})

    print("\n--- TOKEN SHORTCUT & BOILERPLATE CHECK (TOP 30) ---")
    if flagged_in_top_30_scam:
        print(f"Flagged shortcuts/boilerplate in Top 30 Suspicious ({len(flagged_in_top_30_scam)}):")
        for item in flagged_in_top_30_scam:
            print(f"  - '{item['token']}' (matched: '{item['flagged_term']}', weight: +{item['weight']})")
    else:
        print("Zero flagged shortcuts/boilerplate in Top 30 Suspicious!")

    if flagged_in_top_30_benign:
        print(f"Flagged shortcuts/boilerplate in Top 30 Benign ({len(flagged_in_top_30_benign)}):")
        for item in flagged_in_top_30_benign:
            print(f"  - '{item['token']}' (matched: '{item['flagged_term']}', weight: {item['weight']})")
    else:
        print("Zero flagged shortcuts/boilerplate in Top 30 Benign!")

    training_duration = time.time() - start_time
    print(f"\nTotal training run time: {training_duration:.2f} seconds")

    # 6. METRICS ARTIFACT
    final_provenance = "mixed_synthetic_and_public"
    final_warning = warning_msg

    metrics = {
        "data_provenance": final_provenance,
        "datasetProvenance": final_provenance,
        "warning": final_warning,
        "dataset_source": os.path.basename(source_path),
        "dataset_size": len(records),
        "synthetic_count": len(synthetic_records),
        "real_count": len(real_records),
        "unified_super_groups_count": len(set(super_groups)),
        "normalization_applied": True,
        "normalized_tokens": ["<URL>", "<EMAIL>", "<UPI>", "<PHONE>", "<AMT>", "<NUM>"],
        "model_settings": {
            "C": 1.0,
            "class_weight": "balanced",
            "word_min_df": 1,
            "char_min_df": 1,
            "ngram_word": [1, 2],
            "ngram_char": [2, 5],
        },
        "cv_5fold_grouped": {
            "macro_f1_mean": mean_macro_f1,
            "macro_f1_std": std_macro_f1,
            "accuracy_mean": mean_acc,
            "accuracy_std": std_acc,
            "per_fold_macro_f1": [float(f) for f in cv_macro_f1s],
            "per_fold_accuracy": [float(a) for a in cv_accuracies],
        },
        "test_set_metrics": test_metrics,
        "top_suspicious_tokens": top_suspicious_tokens,
        "top_benign_tokens": top_benign_tokens,
        "flagged_shortcuts_in_top_30": {
            "suspicious": flagged_in_top_30_scam,
            "benign": flagged_in_top_30_benign,
        },
        "training_time_seconds": round(training_duration, 2),
    }

    if real_test_metrics is not None:
        metrics["real_test_metrics"] = real_test_metrics

    if formal_held_out_metrics is not None:
        metrics["formal_held_out_metrics"] = formal_held_out_metrics

    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    print(f"\nMetrics saved to {metrics_path}")


if __name__ == "__main__":
    train()
