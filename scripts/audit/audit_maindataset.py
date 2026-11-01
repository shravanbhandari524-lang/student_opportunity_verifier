#!/usr/bin/env python3
"""scripts/audit/audit_maindataset.py

Comprehensive dataset auditor for Student Opportunity Verifier.
Reads services/classifier/data/maindataset.csv and performs all 11 audit steps.
Uses fixed random seed 42. Reports real, unrounded numbers and details.
"""

import os
import sys
import csv
import re
import json
import numpy as np
from collections import Counter, defaultdict

from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    precision_recall_fscore_support,
    accuracy_score,
)
from sklearn.metrics.pairwise import cosine_similarity

RANDOM_SEED = 42

def check_encoding(csv_path):
    issues = []
    with open(csv_path, "rb") as f:
        raw_bytes = f.read()
    try:
        raw_bytes.decode("utf-8")
        encoding_valid = True
    except UnicodeDecodeError as e:
        encoding_valid = False
        issues.append(str(e))
    return encoding_valid, issues

def load_dataset(csv_path):
    rows = []
    with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for line_num, r in enumerate(reader, start=2):
            r["_line"] = line_num
            rows.append(r)
    return fieldnames, rows

def audit():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    csv_path = os.path.join(repo_root, "services", "classifier", "data", "maindataset.csv")
    
    print(f"Auditing main dataset: {csv_path}")
    if not os.path.exists(csv_path):
        print(f"ERROR: Dataset not found at {csv_path}")
        sys.exit(1)
        
    encoding_valid, encoding_issues = check_encoding(csv_path)
    fieldnames, rows = load_dataset(csv_path)
    
    total_rows = len(rows)
    print("\n--- STEP 1: Structure ---")
    print(f"Columns: {fieldnames}")
    print(f"Encoding valid UTF-8: {encoding_valid} (issues: {encoding_issues})")
    
    # Missing values per column
    col_missing = Counter()
    for r in rows:
        for k in fieldnames:
            val = r.get(k, "")
            if val is None or val.strip() == "":
                col_missing[k] += 1
    print("Missing values per column:")
    for k in fieldnames:
        print(f"  - {k}: {col_missing[k]} ({col_missing[k]/total_rows*100:.1f}%)")
        
    # Text lengths
    char_lens = [len(r["text"].strip()) for r in rows]
    word_lens = [len(r["text"].strip().split()) for r in rows]
    print(f"Char length - min: {min(char_lens)}, max: {max(char_lens)}, mean: {np.mean(char_lens):.2f}, median: {np.median(char_lens):.2f}")
    print(f"Word count - min: {min(word_lens)}, max: {max(word_lens)}, mean: {np.mean(word_lens):.2f}, median: {np.median(word_lens):.2f}")
    
    short_texts = [r for r in rows if len(r["text"].strip()) < 20 or len(r["text"].strip().split()) < 5]
    long_texts = [r for r in rows if len(r["text"].strip()) > 1000]
    print(f"Very short texts (<20 chars or <5 words): {len(short_texts)}")
    print(f"Very long texts (>1000 chars): {len(long_texts)}")
    
    # Label validation
    labels = [r["label"].strip() for r in rows]
    label_counts = Counter(labels)
    print(f"Label column values: {dict(label_counts)}")
    invalid_labels = [l for l in label_counts if l not in ("suspicious", "benign")]
    print(f"Invalid labels count: {len(invalid_labels)} ({invalid_labels})")

    print("\n--- STEP 2: Size and Balance ---")
    scam_count = label_counts.get("suspicious", 0)
    genuine_count = label_counts.get("benign", 0)
    ratio = scam_count / genuine_count if genuine_count > 0 else 0
    print(f"Total rows: {total_rows} (Requirement: 500+ -> PASS: {total_rows >= 500})")
    print(f"Suspicious: {scam_count}, Benign: {genuine_count}, Ratio: {ratio:.4f}")
    
    # Scam type column
    scam_types = [r["scam_type"].strip() for r in rows if r["label"] == "suspicious"]
    scam_type_counts = Counter(scam_types)
    print("Scam type distribution (Suspicious class):")
    under_50_scam_types = []
    for st, count in scam_type_counts.most_common():
        flag = ""
        if count < 50:
            flag = " [FLAG: < 50 examples]"
            under_50_scam_types.append((st, count))
        print(f"  - {st}: {count}{flag}")
        
    benign_types = [r["scam_type"].strip() for r in rows if r["label"] == "benign"]
    print(f"Scam type for Benign class: {Counter(benign_types)}")
    
    # Channel distribution
    channel_counts = Counter([r.get("channel", "").strip() for r in rows])
    print(f"Channel distribution: {dict(channel_counts)}")

    print("\n--- STEP 3: Duplicates and Leakage ---")
    texts = [r["text"].strip() for r in rows]
    exact_duplicates = len(texts) - len(set(texts))
    print(f"Exact string duplicates: {exact_duplicates}")
    
    normalized_texts = [re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', '', t.lower())).strip() for t in texts]
    norm_duplicates = len(normalized_texts) - len(set(normalized_texts))
    print(f"Normalized duplicates (lowercase, punctuation-stripped): {norm_duplicates}")
    
    # Cosine similarity
    tfidf_vec = TfidfVectorizer(ngram_range=(1, 2), min_df=1).fit_transform(texts)
    sim_matrix = cosine_similarity(tfidf_vec)
    np.fill_diagonal(sim_matrix, 0.0)
    
    near_dupe_pairs = []
    n = len(texts)
    for i in range(n):
        for j in range(i + 1, n):
            if sim_matrix[i, j] > 0.90:
                near_dupe_pairs.append((i, j, float(sim_matrix[i, j])))
    print(f"Near-duplicate pairs (cosine > 0.90): {len(near_dupe_pairs)}")
    for i, j, s_score in near_dupe_pairs[:5]:
        print(f"  Pair (ID: {rows[i]['id']}, ID: {rows[j]['id']}) sim={s_score:.4f}:")
        print(f"    1: {texts[i][:75]}...")
        print(f"    2: {texts[j][:75]}...")

    # Stratified 80/20 train/test split leakage
    indices = np.arange(len(rows))
    train_idx, test_idx = train_test_split(
        indices, test_size=0.2, random_state=RANDOM_SEED, stratify=labels
    )
    train_set = set(train_idx)
    test_set = set(test_idx)
    
    leaked_near_dupes = []
    for i, j, s_score in near_dupe_pairs:
        if (i in train_set and j in test_set) or (j in train_set and i in test_set):
            leaked_near_dupes.append((rows[i]["id"], rows[j]["id"], s_score))
    print(f"Near-duplicate pairs spanning train/test split: {len(leaked_near_dupes)}")
    
    # Group leakage (group_id and pair_id in notes)
    # Check if group_id spans train and test
    group_ids = [r.get("group_id", "").strip() for r in rows]
    train_groups = set(group_ids[i] for i in train_idx if group_ids[i])
    test_groups = set(group_ids[i] for i in test_idx if group_ids[i])
    overlap_groups = train_groups.intersection(test_groups)
    print(f"Total unique group_ids: {len(set(g for g in group_ids if g))}")
    print(f"group_ids spanning both train and test sets: {len(overlap_groups)}")
    
    # Check pair_id in notes
    pair_ids = []
    for r in rows:
        notes = r.get("notes", "")
        m = re.search(r'pair_id=([A-Za-z0-9_-]+)', notes)
        pair_ids.append(m.group(1) if m else None)
    train_pairs = set(pair_ids[i] for i in train_idx if pair_ids[i])
    test_pairs = set(pair_ids[i] for i in test_idx if pair_ids[i])
    overlap_pairs = train_pairs.intersection(test_pairs)
    print(f"Total pair_ids found: {len(set(p for p in pair_ids if p))}")
    print(f"pair_ids spanning both train and test sets: {len(overlap_pairs)}")

    print("\n--- STEP 4: Language Distribution ---")
    lang_col = Counter([r.get("language", "").strip() for r in rows])
    print(f"Language column distribution: {dict(lang_col)}")
    
    # Empirical script verification
    devanagari_count = 0
    hinglish_count = 0
    english_count = 0
    hinglish_markers = {
        "aap", "aapko", "karo", "karein", "karna", "paisa", "paise", "milega", "apna", "apne",
        "dijiye", "bhejo", "sarkari", "yojana", "chahiye", "hai", "hain", "ke", "liye", "bhi",
        "naukri", "kaam", "ghar", "baithe", "khatam", "turant", "sampark", "kare", "jeet",
        "shamil", "muft", "padhe", "bina", "sirf", "lene", "par", "se"
    }
    
    for r in rows:
        t = r["text"]
        devanagari_chars = len(re.findall(r'[\u0900-\u097F]', t))
        if devanagari_chars / max(len(t), 1) > 0.15:
            devanagari_count += 1
        else:
            words = set(re.findall(r'[a-zA-Z]+', t.lower()))
            matched = words.intersection(hinglish_markers)
            if len(matched) >= 2 or r.get("language") == "hinglish":
                hinglish_count += 1
            else:
                english_count += 1
                
    print(f"Script verification - Hindi (Devanagari): {devanagari_count} ({devanagari_count/total_rows*100:.1f}%), Hinglish: {hinglish_count} ({hinglish_count/total_rows*100:.1f}%), English: {english_count} ({english_count/total_rows*100:.1f}%)")

    print("\n--- STEP 5: Genuine Class Quality & Hard Negatives ---")
    benign_rows = [r for r in rows if r["label"] == "benign"]
    print(f"Total benign rows: {len(benign_rows)}")
    
    # Check hard negatives
    fee_regex = re.compile(r'\b(fee|fees|cost|charge|charges|rs\.?|inr|₹|\$|deposit|tuition|stipend)\b', re.I)
    deadline_regex = re.compile(r'\b(deadline|last date|due date|before midnight|urgent|apply before|by 5 pm|immediately)\b', re.I)
    whatsapp_regex = re.compile(r'\b(whatsapp|telegram)\b', re.I)
    official_domain_regex = re.compile(r'(\.gov\.in|\.edu|\.ac\.in|\.org|\.nic\.in|nsp\.gov\.in|aicte)', re.I)
    
    benign_fee = [r for r in benign_rows if fee_regex.search(r["text"])]
    benign_deadline = [r for r in benign_rows if deadline_regex.search(r["text"])]
    benign_whatsapp = [r for r in benign_rows if whatsapp_regex.search(r["text"])]
    benign_official_urls = [r for r in benign_rows if official_domain_regex.search(r["text"])]
    
    print(f"Benign with fee/charge mentions: {len(benign_fee)} ({len(benign_fee)/len(benign_rows)*100:.1f}%)")
    print(f"Benign with deadline/urgency: {len(benign_deadline)} ({len(benign_deadline)/len(benign_rows)*100:.1f}%)")
    print(f"Benign with WhatsApp/Telegram: {len(benign_whatsapp)} ({len(benign_whatsapp)/len(benign_rows)*100:.1f}%)")
    print(f"Benign with official domains (.gov.in/.ac.in): {len(benign_official_urls)} ({len(benign_official_urls)/len(benign_rows)*100:.1f}%)")
    
    print("\nSample Benign texts:")
    for r in benign_rows[:3]:
        print(f"  [{r['id']}] ({r['channel']}/{r['language']}): {r['text']}")

    print("\n--- STEP 6: Scam Class Quality & Patterns ---")
    scam_rows = [r for r in rows if r["label"] == "suspicious"]
    print(f"Total scam rows: {len(scam_rows)}")
    
    pattern_checks = {
        "registration_fee": r'\b(registration fee|processing fee|file fee|verification charge|admission fee|security deposit|laptop security)\b',
        "deposit_for_task": r'\b(deposit|recharge|security deposit to start|wallet recharge)\b',
        "rent_your_account": r'\b(rent your|rent account|atm card|current account|mule|receive commission)\b',
        "apk_link": r'\b(\.apk|install app|download apk)\b',
        "selected_without_interview": r'\b(congratulations|selected|shortlisted|approved|profile matched|direct selection)\b',
        "otp_or_bank_details": r'\b(otp|credentials|password|bank login|atm pin)\b',
        "impersonated_placement_or_brand": r'\b(infosys|tcs|wipro|google|amazon|ministry|sbi|flipkart)\b',
        "overseas_study_visa": r'\b(visa|embassy|overseas|study permit|abroad|admissions offer)\b'
    }
    for pname, pat in pattern_checks.items():
        matches = [r for r in scam_rows if re.search(pat, r["text"], re.I)]
        print(f"  Pattern '{pname}': {len(matches)} / {len(scam_rows)} ({len(matches)/len(scam_rows)*100:.1f}%)")

    print("\n--- STEP 7: Shortcut and Bias Risks ---")
    scam_char_lens = [len(r["text"]) for r in scam_rows]
    benign_char_lens = [len(r["text"]) for r in benign_rows]
    print(f"Mean char length - Suspicious: {np.mean(scam_char_lens):.2f}, Benign: {np.mean(benign_char_lens):.2f}")
    
    # Synthetic placeholder domain shortcuts
    placeholder_domains = [r for r in rows if re.search(r'\.(example|invalid|test|fakebank)\b', r["text"], re.I)]
    scam_placeholders = [r for r in scam_rows if re.search(r'\.(example|invalid|test|fakebank)\b', r["text"], re.I)]
    benign_placeholders = [r for r in benign_rows if re.search(r'\.(example|invalid|test|fakebank)\b', r["text"], re.I)]
    print(f"Placeholder domains (.example/.invalid/.test/@fakebank): Total {len(placeholder_domains)} | Scam: {len(scam_placeholders)} | Benign: {len(benign_placeholders)}")
    
    # Exclamation marks
    scam_excl = sum(1 for r in scam_rows if "!" in r["text"])
    benign_excl = sum(1 for r in benign_rows if "!" in r["text"])
    print(f"Exclamation marks - Suspicious: {scam_excl} ({scam_excl/len(scam_rows)*100:.1f}%), Benign: {benign_excl} ({benign_excl/len(benign_rows)*100:.1f}%)")
    
    # Emojis
    emoji_pattern = re.compile(r'[\U00010000-\U0010ffff]', flags=re.UNICODE)
    scam_emojis = sum(1 for r in scam_rows if emoji_pattern.search(r["text"]))
    benign_emojis = sum(1 for r in benign_rows if emoji_pattern.search(r["text"]))
    print(f"Emojis - Suspicious: {scam_emojis}, Benign: {benign_emojis}")

    # Top 20 predictive features from Logistic Regression
    vec_words = TfidfVectorizer(ngram_range=(1, 2), min_df=2, lowercase=True)
    X_w = vec_words.fit_transform(texts)
    y_bin = [1 if r["label"] == "suspicious" else 0 for r in rows]
    clf_feat = LogisticRegression(random_state=RANDOM_SEED, C=1.0, max_iter=500)
    clf_feat.fit(X_w, y_bin)
    
    feat_names = vec_words.get_feature_names_out()
    coefs = clf_feat.coef_[0]
    top_susp_idx = np.argsort(coefs)[-20:][::-1]
    top_benign_idx = np.argsort(coefs)[:20]
    
    print("\nTop 20 words predictive of SUSPICIOUS (scam):")
    top_susp_features = []
    for i in top_susp_idx:
        feat = feat_names[i]
        c = coefs[i]
        top_susp_features.append((feat, float(c)))
        print(f"  +{c:.3f} : '{feat}'")
        
    print("\nTop 20 words predictive of BENIGN (genuine):")
    top_benign_features = []
    for i in top_benign_idx:
        feat = feat_names[i]
        c = coefs[i]
        top_benign_features.append((feat, float(c)))
        print(f"  {c:.3f} : '{feat}'")

    print("\n--- STEP 8: Synthetic vs Real Evaluation ---")
    source_types = Counter([r.get("source_type", "").strip() for r in rows])
    source_urls = Counter([bool(r.get("source_url", "").strip()) for r in rows])
    license_notes = Counter([r.get("license_note", "").strip() for r in rows])
    labeler_1_counts = Counter([r.get("labeler_1", "").strip() for r in rows])
    labeler_2_counts = Counter([r.get("labeler_2", "").strip() for r in rows])
    
    print(f"source_type breakdown: {dict(source_types)}")
    print(f"source_url present: {source_urls.get(True, 0)}, empty: {source_urls.get(False, 0)}")
    print(f"license_note breakdown: {dict(license_notes)}")
    print(f"labeler_1 breakdown: {dict(labeler_1_counts)}")
    print(f"labeler_2 breakdown: {dict(labeler_2_counts)}")
    
    # Check notes metadata
    campaigns = Counter()
    batches = Counter()
    for r in rows:
        notes = r.get("notes", "")
        m_c = re.search(r'campaign=([^;]+)', notes)
        m_b = re.search(r'batch=([^;]+)', notes)
        if m_c:
            campaigns[m_c.group(1)] += 1
        if m_b:
            batches[m_b.group(1)] += 1
    print(f"Batches in notes: {dict(batches)}")
    print(f"Campaign types count in notes: {len(campaigns)}")

    print("\n--- STEP 9: Privacy and Safety ---")
    phone_regex = re.compile(r'(?:\+91|91|0)?[6-9]\d{9}\b')
    upi_regex = re.compile(r'\b[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}\b')
    email_regex = re.compile(r'\b[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+\b')
    pan_regex = re.compile(r'\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b')
    aadhaar_regex = re.compile(r'\b\d{4}\s?\d{4}\s?\d{4}\b')
    
    found_phones = []
    found_upis = []
    found_emails = []
    found_pans = []
    found_aadhaar = []
    
    for r in rows:
        t = r["text"]
        for p in phone_regex.findall(t):
            found_phones.append((r["id"], p))
        for u in upi_regex.findall(t):
            if not re.search(r'\.(com|org|net|in|gov|edu)$', u.split('@')[1], re.I):
                found_upis.append((r["id"], u))
            else:
                found_emails.append((r["id"], u))
        for pan in pan_regex.findall(t):
            found_pans.append((r["id"], pan))
        for a in aadhaar_regex.findall(t):
            found_aadhaar.append((r["id"], a))
            
    print(f"Phone numbers detected: {len(found_phones)}")
    for rid, p in found_phones[:5]:
        masked = p[:2] + "XXXXXX" + p[-2:]
        print(f"  [{rid}]: {masked}")
    print(f"UPI IDs detected: {len(found_upis)}")
    for rid, u in found_upis[:5]:
        parts = u.split('@')
        masked = parts[0][:2] + "***@" + parts[1]
        print(f"  [{rid}]: {masked}")
    print(f"Emails detected: {len(found_emails)}")
    for rid, em in found_emails[:5]:
        parts = em.split('@')
        masked = parts[0][:2] + "***@" + parts[1]
        print(f"  [{rid}]: {masked}")
    print(f"PAN numbers detected: {len(found_pans)}")
    print(f"Aadhaar numbers detected: {len(found_aadhaar)}")

    print("\n--- STEP 10: Baseline Experiment (Word 1-2 + Char 2-5 grams, 80/20 stratified split, seed 42) ---")
    union_features = FeatureUnion([
        ("word", TfidfVectorizer(ngram_range=(1, 2), analyzer="word", sublinear_tf=True, min_df=1, lowercase=True)),
        ("char", TfidfVectorizer(ngram_range=(2, 5), analyzer="char", sublinear_tf=True, min_df=1, lowercase=True))
    ])
    
    pipeline = Pipeline([
        ("features", union_features),
        ("clf", LogisticRegression(random_state=RANDOM_SEED, C=1.0, max_iter=500))
    ])
    
    X_train = [texts[i] for i in train_idx]
    y_train = [labels[i] for i in train_idx]
    X_test = [texts[i] for i in test_idx]
    y_test = [labels[i] for i in test_idx]
    
    pipeline.fit(X_train, y_train)
    y_pred = pipeline.predict(X_test)
    y_proba = pipeline.predict_proba(X_test)
    
    print(f"Train samples: {len(X_train)}, Test samples: {len(X_test)}")
    target_names = ["benign", "suspicious"]
    clf_report = classification_report(y_test, y_pred, target_names=target_names, output_dict=True)
    print("\nTest Classification Report:")
    print(classification_report(y_test, y_pred, target_names=target_names))
    
    cm = confusion_matrix(y_test, y_pred, labels=target_names)
    print("Confusion Matrix (rows=actual [benign, suspicious], cols=predicted [benign, suspicious]):")
    print(cm)
    
    # 5-fold cross validation
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED)
    cv_macro_f1 = []
    cv_acc = []
    cv_misclassified = []
    
    oof_preds = {}
    oof_probas = {}
    
    for fold, (f_train_idx, f_val_idx) in enumerate(skf.split(texts, labels), start=1):
        f_X_train = [texts[i] for i in f_train_idx]
        f_y_train = [labels[i] for i in f_train_idx]
        f_X_val = [texts[i] for i in f_val_idx]
        f_y_val = [labels[i] for i in f_val_idx]
        
        f_pipe = Pipeline([
            ("features", FeatureUnion([
                ("word", TfidfVectorizer(ngram_range=(1, 2), analyzer="word", sublinear_tf=True, min_df=1, lowercase=True)),
                ("char", TfidfVectorizer(ngram_range=(2, 5), analyzer="char", sublinear_tf=True, min_df=1, lowercase=True))
            ])),
            ("clf", LogisticRegression(random_state=RANDOM_SEED, C=1.0, max_iter=500))
        ])
        f_pipe.fit(f_X_train, f_y_train)
        f_pred = f_pipe.predict(f_X_val)
        f_proba = f_pipe.predict_proba(f_X_val)
        
        _, _, macro_f1, _ = precision_recall_fscore_support(f_y_val, f_pred, average="macro")
        acc = accuracy_score(f_y_val, f_pred)
        cv_macro_f1.append(macro_f1)
        cv_acc.append(acc)
        
        for idx, true_l, pred_l, prob in zip(f_val_idx, f_y_val, f_pred, f_proba):
            oof_preds[idx] = pred_l
            oof_probas[idx] = prob
            if true_l != pred_l:
                cv_misclassified.append({
                    "fold": fold,
                    "index": int(idx),
                    "id": rows[idx]["id"],
                    "line": int(rows[idx]["_line"]),
                    "text": texts[idx],
                    "true_label": true_l,
                    "pred_label": pred_l,
                    "prob": prob.tolist(),
                    "scam_type": rows[idx].get("scam_type", "none"),
                    "language": rows[idx].get("language", "none")
                })
                
    print(f"\n5-Fold Stratified CV Macro F1: mean={np.mean(cv_macro_f1):.4f}, std={np.std(cv_macro_f1):.4f}")
    print(f"5-Fold Stratified CV Accuracy: mean={np.mean(cv_acc):.4f}, std={np.std(cv_acc):.4f}")
    print(f"Total CV misclassified samples across all 5 folds: {len(cv_misclassified)}")
    
    # Check test set misclassified
    test_misclassified = []
    for idx_in_test, i in enumerate(test_idx):
        if y_test[idx_in_test] != y_pred[idx_in_test]:
            test_misclassified.append({
                "index": int(i),
                "id": rows[i]["id"],
                "line": int(rows[i]["_line"]),
                "text": texts[i],
                "true_label": y_test[idx_in_test],
                "pred_label": y_pred[idx_in_test],
                "proba": y_proba[idx_in_test].tolist()
            })
    print(f"Test split misclassified count: {len(test_misclassified)}")

    # OOF Performance per scam type
    print("\n--- OOF Performance per Scam Type ---")
    scam_type_perf = {}
    for stype in sorted(set(r.get("scam_type", "none") for r in rows)):
        st_indices = [i for i in range(len(rows)) if rows[i].get("scam_type") == stype]
        st_true = [labels[i] for i in st_indices]
        st_pred = [oof_preds[i] for i in st_indices]
        acc = accuracy_score(st_true, st_pred) if st_true else 0.0
        prec, rec, f1, _ = precision_recall_fscore_support(st_true, st_pred, average="weighted", zero_division=0)
        scam_type_perf[stype] = {
            "count": len(st_indices),
            "accuracy": float(acc),
            "f1": float(f1)
        }
        print(f"  {stype} (n={len(st_indices)}): accuracy={acc:.4f}, f1={f1:.4f}")

    # OOF Performance per language
    print("\n--- OOF Performance per Language ---")
    lang_perf = {}
    for lang in sorted(set(r.get("language", "none") for r in rows)):
        l_indices = [i for i in range(len(rows)) if rows[i].get("language") == lang]
        l_true = [labels[i] for i in l_indices]
        l_pred = [oof_preds[i] for i in l_indices]
        acc = accuracy_score(l_true, l_pred) if l_true else 0.0
        prec, rec, f1, _ = precision_recall_fscore_support(l_true, l_pred, average="weighted", zero_division=0)
        lang_perf[lang] = {
            "count": len(l_indices),
            "accuracy": float(acc),
            "f1": float(f1)
        }
        print(f"  {lang} (n={len(l_indices)}): accuracy={acc:.4f}, f1={f1:.4f}")

    # Top 15 misclassified / borderline cases
    classes_list = list(pipeline.named_steps["clf"].classes_)
    susp_class_idx = classes_list.index("suspicious")
    
    all_examples_ranked = []
    for i in range(len(rows)):
        prob_susp = oof_probas[i][susp_class_idx]
        is_error = (oof_preds[i] != labels[i])
        uncertainty = abs(prob_susp - 0.5)
        all_examples_ranked.append({
            "index": int(i),
            "id": rows[i]["id"],
            "line": int(rows[i]["_line"]),
            "text": texts[i],
            "true_label": labels[i],
            "pred_label": oof_preds[i],
            "prob_suspicious": float(prob_susp),
            "prob_benign": float(1.0 - prob_susp),
            "is_error": bool(is_error),
            "uncertainty": float(uncertainty),
            "scam_type": rows[i].get("scam_type", "none"),
            "language": rows[i].get("language", "none")
        })
        
    all_examples_ranked.sort(key=lambda x: (not x["is_error"], x["uncertainty"]))
    top_15_examples = all_examples_ranked[:15]
    
    print("\n--- Top 15 Misclassified and Borderline Examples (OOF CV) ---")
    for rank, ex in enumerate(top_15_examples, start=1):
        status = "MISCLASSIFIED" if ex["is_error"] else "BORDERLINE"
        print(f"[{rank}] {ex['id']} (Line {ex['line']}) [{status}] - True: {ex['true_label']}, Pred: {ex['pred_label']}, P(susp): {ex['prob_suspicious']:.4f}")
        print(f"    Text: {ex['text']}")

    # STEP 11: Robustness check
    test_macro_f1 = clf_report["macro avg"]["f1-score"]
    print(f"\n--- STEP 11: Robustness Check ---")
    print(f"Test Set Macro F1: {test_macro_f1:.4f}")
    if test_macro_f1 > 0.97:
        print("WARNING: Macro F1 is > 0.97! Investigating shortcuts, leakage, and artificial separability.")

    # Save JSON results
    def json_serializer(obj):
        if isinstance(obj, (np.integer, int)):
            return int(obj)
        elif isinstance(obj, (np.floating, float)):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        return str(obj)

    audit_data = {
        "dataset_path": csv_path,
        "total_rows": total_rows,
        "fieldnames": fieldnames,
        "col_missing": dict(col_missing),
        "label_counts": dict(label_counts),
        "scam_type_counts": dict(scam_type_counts),
        "under_50_scam_types": under_50_scam_types,
        "channel_counts": dict(channel_counts),
        "language_col_counts": dict(lang_col),
        "char_len_stats": {
            "min": int(min(char_lens)),
            "max": int(max(char_lens)),
            "mean": float(np.mean(char_lens)),
            "median": float(np.median(char_lens))
        },
        "word_len_stats": {
            "min": int(min(word_lens)),
            "max": int(max(word_lens)),
            "mean": float(np.mean(word_lens)),
            "median": float(np.median(word_lens))
        },
        "exact_duplicates": int(exact_duplicates),
        "normalized_duplicates": int(norm_duplicates),
        "near_duplicate_pairs_count": int(len(near_dupe_pairs)),
        "near_duplicate_leaks_count": int(len(leaked_near_dupes)),
        "total_groups": len(set(g for g in group_ids if g)),
        "leaked_groups_count": len(overlap_groups),
        "total_pairs": len(set(p for p in pair_ids if p)),
        "leaked_pairs_count": len(overlap_pairs),
        "test_metrics": clf_report,
        "confusion_matrix": cm.tolist(),
        "cv_5fold_macro_f1_mean": float(np.mean(cv_macro_f1)),
        "cv_5fold_macro_f1_std": float(np.std(cv_macro_f1)),
        "cv_5fold_acc_mean": float(np.mean(cv_acc)),
        "cv_5fold_acc_std": float(np.std(cv_acc)),
        "scam_type_perf": scam_type_perf,
        "lang_perf": lang_perf,
        "top_suspicious_features": top_susp_features,
        "top_benign_features": top_benign_features,
        "privacy": {
            "phone_count": int(len(found_phones)),
            "upi_count": int(len(found_upis)),
            "email_count": int(len(found_emails)),
            "pan_count": int(len(found_pans)),
            "aadhaar_count": int(len(found_aadhaar))
        },
        "cv_misclassified": cv_misclassified,
        "test_misclassified": test_misclassified,
        "top_15_examples": top_15_examples
    }
    
    out_json = os.path.join(repo_root, "scripts", "audit", "maindataset_audit_results.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(audit_data, f, indent=2, default=json_serializer)
    print(f"\nAudit results successfully saved to {out_json}")

if __name__ == "__main__":
    audit()
