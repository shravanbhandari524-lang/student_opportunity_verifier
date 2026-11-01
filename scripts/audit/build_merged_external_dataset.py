#!/usr/bin/env python3
"""scripts/audit/build_merged_external_dataset.py

Curates external datasets into clean, leakage-free candidate training and holdout files.
Strictly respects seed 42. Does NOT touch maindataset.csv, real_test.csv, or train.py.

Outputs:
- services/classifier/data/external_train_candidates.csv
- services/classifier/data/external_real_holdout_candidates.csv
- services/classifier/data/external_audit_manifest.json
"""

import os
import sys
import csv
import re
import random
import hashlib
import json
from collections import Counter, defaultdict
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

RANDOM_SEED = 42

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA_DIR = os.path.join(REPO_ROOT, "services", "classifier", "data")

sys.path.append(os.path.join(REPO_ROOT, "services", "classifier"))
from normalize import normalize_text, EMAIL_REGEX, UPI_REGEX

# PII Regexes
PHONE_GLOBAL_REGEX = re.compile(
    r'(?:\+?91[\-\s]?)?[6-9]\d{4}[\-\s]?\d{5}\b|'
    r'\b0[6-9]\d{4}[\-\s]?\d{5}\b|'
    r'\b[6-9]\d{9}\b|'
    r'\b(?:\+?1[\-\s]?)?\(?\d{3}\)?[\-\s]?\d{3}[\-\s]?\d{4}\b|'
    r'\b(?:\+?44[\-\s]?)?07\d{3}[\-\s]?\d{6}\b|'
    r'\b0[1-9]\d{2,4}[\-\s]?\d{4,7}\b'
)
PAN_REGEX = re.compile(r'\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b')
AADHAAR_REGEX = re.compile(r'\b\d{4}\s?\d{4}\s?\d{4}\b')
ACC_REGEX = re.compile(
    r'\b(?:Account|Acc|A/c|acct|acc\.?|card|card ending in|number|A/C)\s*[:#\s]?\s*(\d{9,18}|X{4,}\d{4}|\*{4,}\d{4})\b|'
    r'\b(?=[0-9xX\*]*[0-9])[0-9xX\*]{11,18}\b',
    re.IGNORECASE
)

KNOWN_NAMES = {
    'Sneha', 'Diego', 'Ben', 'Chris', 'Clara', 'Lucas', 'Ivan', 'Nadia',
    'Alex', 'Omar', 'Noah', 'Liam', 'Elena', 'Maria', 'Ana', 'Hana',
    'Karim', 'Grace', 'Zara', 'Wei', 'Fatima', 'Jordan', 'Priya',
    'Miguel', 'Sam', 'Yusuf', 'Tom', 'Mei', 'Taylor', 'Aisha', 'Sofia'
}
NAME_GREETING_REGEX = re.compile(r'\b(Dear|Hello|Hi|Greetings)\s+(' + '|'.join(KNOWN_NAMES) + r')\b', re.IGNORECASE)

pii_counts = Counter()

def mask_pii(text: str) -> str:
    global pii_counts
    t = text
    # 1. Known names in greetings
    names = NAME_GREETING_REGEX.findall(t)
    if names:
        pii_counts['names'] += len(names)
        t = NAME_GREETING_REGEX.sub(r'\1 [NAME]', t)
    # 2. Emails
    emails = EMAIL_REGEX.findall(t)
    if emails:
        pii_counts['emails'] += len(emails)
        t = EMAIL_REGEX.sub('[EMAIL]', t)
    # 3. UPIs
    upis = UPI_REGEX.findall(t)
    if upis:
        pii_counts['upis'] += len(upis)
        t = UPI_REGEX.sub('[UPI]', t)
    # 4. PAN
    pans = PAN_REGEX.findall(t)
    if pans:
        pii_counts['pans'] += len(pans)
        t = PAN_REGEX.sub('[PAN]', t)
    # 5. Aadhaar
    aadhaars = AADHAAR_REGEX.findall(t)
    if aadhaars:
        pii_counts['aadhaars'] += len(aadhaars)
        t = AADHAAR_REGEX.sub('[AADHAAR]', t)
    # 6. Accounts / Cards
    accs = ACC_REGEX.findall(t)
    if accs:
        pii_counts['accounts'] += len(accs)
        t = ACC_REGEX.sub(lambda m: m.group(0).replace(m.group(1), '[ACCOUNT_NUMBER]') if m.group(1) else '[ACCOUNT_NUMBER]', t)
    # 7. Phones
    phones = PHONE_GLOBAL_REGEX.findall(t)
    if phones:
        pii_counts['phones'] += len(phones)
        t = PHONE_GLOBAL_REGEX.sub('[PHONE]', t)
    return t

def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()

def classify_dataset_scam_type(text: str, label: str) -> str:
    if label == "benign":
        return "none"
    t = text.lower()
    if any(w in t for w in ["scholarship", "grant", "fellowship", "merit"]):
        return "scholarship"
    if "intern" in t:
        return "internship"
    if any(w in t for w in ["contest", "win", "prize", "coding"]):
        return "competition"
    if any(w in t for w in ["per day", "rating", "task", "review"]):
        return "task_job"
    if any(w in t for w in ["visa", "abroad", "embassy", "overseas"]):
        return "overseas_agent"
    if any(w in t for w in ["rent", "mule", "commission"]):
        return "mule_offer"
    return "job"

def main():
    print(f"Building curated external candidate datasets with seed {RANDOM_SEED}...")
    random.seed(RANDOM_SEED)
    np.random.seed(RANDOM_SEED)

    manifest = {
        "random_seed": RANDOM_SEED,
        "input_files": {
            "dataset.csv": {
                "path": os.path.join(DATA_DIR, "dataset.csv"),
                "sha256": sha256_file(os.path.join(DATA_DIR, "dataset.csv"))
            },
            "india_fraud_detection_FINAL.csv": {
                "path": os.path.join(DATA_DIR, "india_fraud_detection_FINAL.csv"),
                "sha256": sha256_file(os.path.join(DATA_DIR, "india_fraud_detection_FINAL.csv"))
            },
            "internet_scams_archive.csv": {
                "path": os.path.join(DATA_DIR, "internet_scams_archive.csv"),
                "sha256": sha256_file(os.path.join(DATA_DIR, "internet_scams_archive.csv"))
            },
            "spam.csv": {
                "path": os.path.join(DATA_DIR, "spam.csv"),
                "sha256": sha256_file(os.path.join(DATA_DIR, "spam.csv"))
            },
            "maindataset.csv": {
                "path": os.path.join(DATA_DIR, "maindataset.csv"),
                "sha256": sha256_file(os.path.join(DATA_DIR, "maindataset.csv")),
                "note": "Untouched reference"
            },
            "real_test.csv": {
                "path": os.path.join(DATA_DIR, "real_test.csv"),
                "sha256": sha256_file(os.path.join(DATA_DIR, "real_test.csv")),
                "note": "Untouched reference"
            }
        },
        "drop_counts_by_rule": defaultdict(int),
        "source_row_counts": {}
    }

    # Load reference test set for leakage assertions
    with open(os.path.join(DATA_DIR, "real_test.csv"), "r", encoding="utf-8") as f:
        real_test_rows = list(csv.DictReader(f))
    real_test_texts = [r["text"].strip() for r in real_test_rows]

    train_candidates = []
    holdout_candidates = []

    # ==========================================
    # 1. dataset.csv
    # ==========================================
    with open(os.path.join(DATA_DIR, "dataset.csv"), "r", encoding="utf-8") as f:
        ds_raw = list(csv.DictReader(f))
    manifest["source_row_counts"]["dataset.csv"] = len(ds_raw)

    for idx, r in enumerate(ds_raw, 1):
        cleaned_text = mask_pii(r["text"].strip())
        st = classify_dataset_scam_type(r["text"], r["label"].strip())
        train_candidates.append({
            "text": cleaned_text,
            "label": r["label"].strip(),
            "scam_type": st,
            "language": "en",
            "source_file": "dataset.csv",
            "source_type": "synthetic",
            "license_note": "unknown, check Kaggle page",
            "group_id": f"GRP-STUDENT-START-{idx:03d}"
        })
    print(f"Added {len(ds_raw)} rows from dataset.csv.")

    # ==========================================
    # 2. india_fraud_detection_FINAL.csv
    # ==========================================
    with open(os.path.join(DATA_DIR, "india_fraud_detection_FINAL.csv"), "r", encoding="utf-8") as f:
        india_raw = list(csv.DictReader(f))
    manifest["source_row_counts"]["india_fraud_detection_FINAL.csv"] = len(india_raw)

    target_cats = [
        "Electricity_Legitimate", "Electricity_Scam",
        "Lottery_Legitimate", "Lottery_Scam",
        "KYC_Legitimate", "KYC_Suspension",
        "Job_Legitimate", "Job_Scam"
    ]
    dropped_non_target = len(india_raw) - sum(1 for r in india_raw if r["category"] in target_cats)
    manifest["drop_counts_by_rule"]["india_fraud_non_target_category"] = dropped_non_target

    filtered_india = [r for r in india_raw if r["category"] in target_cats]

    # Typo fix: Yoyour -> Your/your
    typo_fixed_count = 0
    for r in filtered_india:
        orig = r["message_text"]
        fixed = re.sub(r'\b[Yy]oyour\b', lambda m: 'Your' if m.group(0)[0].isupper() else 'your', orig)
        if fixed != orig:
            typo_fixed_count += 1
        r["text_clean"] = fixed
    manifest["drop_counts_by_rule"]["india_fraud_yoyour_typo_fixed"] = typo_fixed_count
    print(f"Fixed {typo_fixed_count} Yoyour typos in india_fraud_detection_FINAL.csv.")

    # Split into real vs synthetic
    real_rows = [r for r in filtered_india if r["source_url"] != "synthetic"]
    synth_rows = [r for r in filtered_india if r["source_url"] == "synthetic"]

    # Real advisory split by URL (seed 42)
    url_map = defaultdict(list)
    for r in real_rows:
        url_map[r["source_url"]].append(r)

    urls = sorted(list(url_map.keys()))
    random.shuffle(urls)

    train_real_rows = []
    holdout_real_rows = []

    for u_idx, u in enumerate(urls, 1):
        u_rows = url_map[u]
        gid = f"GRP-INDFRAUD-REAL-U{u_idx:03d}"
        for r in u_rows:
            r["group_id"] = gid
            r["source_url_clean"] = u
        if len(train_real_rows) <= len(holdout_real_rows):
            train_real_rows.extend(u_rows)
        else:
            holdout_real_rows.extend(u_rows)

    def map_india_scam_type(cat: str, lbl: str) -> str:
        if lbl == "0":
            return "none"
        if "Job" in cat:
            return "job"
        if "KYC" in cat or "Electricity" in cat:
            return "bank_alert"
        if "Lottery" in cat:
            return "competition"
        return "generic_suspicious"

    for r in train_real_rows:
        cleaned_text = mask_pii(r["text_clean"].strip())
        lbl = "suspicious" if r["label"] == "1" else "benign"
        st = map_india_scam_type(r["category"], r["label"])
        train_candidates.append({
            "text": cleaned_text,
            "label": lbl,
            "scam_type": st,
            "language": "en",
            "source_file": "india_fraud_detection_FINAL.csv",
            "source_type": "real_advisory",
            "license_note": "unknown, check Kaggle page",
            "group_id": r["group_id"],
            "_raw_category": r["category"],
            "_source_url": r["source_url_clean"]
        })

    for r in holdout_real_rows:
        cleaned_text = mask_pii(r["text_clean"].strip())
        lbl = "suspicious" if r["label"] == "1" else "benign"
        st = map_india_scam_type(r["category"], r["label"])
        holdout_candidates.append({
            "text": cleaned_text,
            "label": lbl,
            "scam_type": st,
            "language": "en",
            "source_file": "india_fraud_detection_FINAL.csv",
            "source_type": "real_advisory",
            "license_note": "unknown, check Kaggle page",
            "group_id": r["group_id"],
            "_raw_category": r["category"],
            "_source_url": r["source_url_clean"]
        })

    print(f"Real advisories split: {len(train_real_rows)} to train, {len(holdout_real_rows)} to holdout.")

    # Deduplicate synthetic on normalize_text
    synth_by_norm = {}
    for r in synth_rows:
        nt = normalize_text(r["text_clean"])
        r["norm_text"] = nt
        if nt not in synth_by_norm:
            synth_by_norm[nt] = r
    deduped_synth = list(synth_by_norm.values())
    manifest["drop_counts_by_rule"]["india_fraud_synth_exact_dedup"] = len(synth_rows) - len(deduped_synth)

    # Near duplicate clustering (cosine > 0.90) max 3 per cluster
    kept_synth = []
    cluster_counter = 0
    near_dupe_synth_drops = 0
    for cat in target_cats:
        cat_rows = [r for r in deduped_synth if r["category"] == cat]
        texts = [r["norm_text"] for r in cat_rows]
        vec = TfidfVectorizer(ngram_range=(1, 2), min_df=1)
        X = vec.fit_transform(texts)
        sims = X.dot(X.T).toarray()
        n = len(cat_rows)
        visited = [False] * n
        for i in range(n):
            if visited[i]:
                continue
            cluster_counter += 1
            gid = f"GRP-INDFRAUD-SYNTH-{cat[:8]}-C{cluster_counter:04d}"
            cluster = [i]
            visited[i] = True
            for j in range(i + 1, n):
                if not visited[j] and sims[i, j] > 0.90:
                    cluster.append(j)
                    visited[j] = True
            for idx in cluster[:3]:
                cat_rows[idx]["group_id"] = gid
                kept_synth.append(cat_rows[idx])
            if len(cluster) > 3:
                near_dupe_synth_drops += (len(cluster) - 3)

    manifest["drop_counts_by_rule"]["india_fraud_synth_near_dupe_clustering"] = near_dupe_synth_drops

    for r in kept_synth:
        cleaned_text = mask_pii(r["text_clean"].strip())
        lbl = "suspicious" if r["label"] == "1" else "benign"
        st = map_india_scam_type(r["category"], r["label"])
        train_candidates.append({
            "text": cleaned_text,
            "label": lbl,
            "scam_type": st,
            "language": "en",
            "source_file": "india_fraud_detection_FINAL.csv",
            "source_type": "public_synthetic",
            "license_note": "unknown, check Kaggle page",
            "group_id": r["group_id"],
            "_raw_category": r["category"]
        })
    print(f"Added {len(kept_synth)} deduplicated synthetic rows from india_fraud_detection_FINAL.csv.")

    # ==========================================
    # 3. internet_scams_archive.csv
    # ==========================================
    with open(os.path.join(DATA_DIR, "internet_scams_archive.csv"), "r", encoding="utf-8") as f:
        archive_raw = list(csv.DictReader(f))
    manifest["source_row_counts"]["internet_scams_archive.csv"] = len(archive_raw)

    job_archive = [
        r for r in archive_raw
        if r["language"] == "English" and r["category"] in ("Fake Job Offer", "Legitimate - Job Posting")
    ]
    manifest["drop_counts_by_rule"]["archive_non_english_or_non_job"] = len(archive_raw) - len(job_archive)

    archive_by_norm = {}
    for r in job_archive:
        nt = normalize_text(r["message_text"])
        r["norm_text"] = nt
        if nt not in archive_by_norm:
            archive_by_norm[nt] = r
    deduped_archive = list(archive_by_norm.values())
    manifest["drop_counts_by_rule"]["archive_exact_dedup"] = len(job_archive) - len(deduped_archive)

    templates = defaultdict(list)
    for r in deduped_archive:
        templates[r["generation_template_id"]].append(r)

    archive_max3 = []
    dropped_archive_template_cap = 0
    for tid, trows in templates.items():
        random.shuffle(trows)
        archive_max3.extend(trows[:3])
        if len(trows) > 3:
            dropped_archive_template_cap += (len(trows) - 3)
    manifest["drop_counts_by_rule"]["archive_template_cap_exceeded"] = dropped_archive_template_cap

    scam_arch = [r for r in archive_max3 if r["label"] == "Scam"]
    benign_arch = [r for r in archive_max3 if r["label"] == "Benign"]
    random.shuffle(scam_arch)
    random.shuffle(benign_arch)

    # Cap at exactly 400 total
    kept_archive = benign_arch[:108] + scam_arch[:292]
    manifest["drop_counts_by_rule"]["archive_sampling_cap_drop"] = len(archive_max3) - len(kept_archive)

    for r in kept_archive:
        cleaned_text = mask_pii(r["message_text"].strip())
        lbl = "suspicious" if r["label"] == "Scam" else "benign"
        st = "job" if lbl == "suspicious" else "none"
        train_candidates.append({
            "text": cleaned_text,
            "label": lbl,
            "scam_type": st,
            "language": "en",
            "source_file": "internet_scams_archive.csv",
            "source_type": "public_synthetic",
            "license_note": "CC-BY-4.0 (proposed)",
            "group_id": f"GRP-ARCHIVE-{r['generation_template_id'].replace('::', '-')}",
            "_raw_category": r["category"],
            "_template_id": r["generation_template_id"]
        })
    print(f"Added {len(kept_archive)} rows from internet_scams_archive.csv (cap 400).")

    # ==========================================
    # 4. spam.csv
    # ==========================================
    with open(os.path.join(DATA_DIR, "spam.csv"), "r", encoding="latin-1") as f:
        spam_raw = list(csv.reader(f))[1:]
    manifest["source_row_counts"]["spam.csv"] = len(spam_raw)

    spam_class_drops = sum(1 for r in spam_raw if r[0] != "ham")
    manifest["drop_counts_by_rule"]["spam_class_discarded"] = spam_class_drops

    ham_texts = []
    for r in spam_raw:
        if r[0] == "ham":
            parts = [p for p in r[1:] if p.strip() != ""]
            t = ",".join(parts).strip() if len(parts) > 1 else r[1].strip()
            ham_texts.append(t)

    unique_ham = sorted(list(set(ham_texts)))
    manifest["drop_counts_by_rule"]["spam_ham_exact_dedup"] = len(ham_texts) - len(unique_ham)

    random.shuffle(unique_ham)
    kept_ham = unique_ham[:300]
    manifest["drop_counts_by_rule"]["spam_ham_sampling_cap_drop"] = len(unique_ham) - len(kept_ham)

    for idx, t in enumerate(kept_ham, 1):
        cleaned_text = mask_pii(t)
        train_candidates.append({
            "text": cleaned_text,
            "label": "benign",
            "scam_type": "none",
            "language": "en",
            "source_file": "spam.csv",
            "source_type": "public_real_sms",
            "license_note": "Public domain / research",
            "group_id": f"GRP-SPAM-HAM-{idx:03d}"
        })
    print(f"Added {len(kept_ham)} unique ham rows from spam.csv (cap 300).")

    # ==========================================
    # 5. Iterative Leakage Pruning against Holdout Candidates
    # ==========================================
    holdout_texts = [c["text"] for c in holdout_candidates]
    print(f"\nInitial train candidates: {len(train_candidates)}. Checking holdout leakage...")

    dropped_leak_total = 0
    while True:
        cand_texts = [c["text"] for c in train_candidates]
        vec = TfidfVectorizer(ngram_range=(1, 2), min_df=1)
        X = vec.fit_transform(cand_texts + holdout_texts)
        X_cand = X[:len(cand_texts)]
        X_ho = X[len(cand_texts):]
        sims = X_cand.dot(X_ho.T).toarray()
        max_sim = np.max(sims, axis=1)
        to_drop = [i for i, s in enumerate(max_sim) if s > 0.90]
        if not to_drop:
            break
        dropped_leak_total += len(to_drop)
        train_candidates = [c for i, c in enumerate(train_candidates) if i not in set(to_drop)]

    manifest["drop_counts_by_rule"]["train_pruned_holdout_near_dupes"] = dropped_leak_total
    print(f"Pruned {dropped_leak_total} train candidates leaking into holdout (cosine > 0.90).")
    print(f"Final train candidates count: {len(train_candidates)}.")

    # ==========================================
    # 6. Artifact Scan (Single-class & single-template/source tokens)
    # ==========================================
    def tokenize(text: str):
        return re.findall(r'[a-zA-Z]{3,}', text.lower())

    token_classes = defaultdict(set)
    token_sources = defaultdict(set)
    token_counts = Counter()

    for c in train_candidates:
        lbl = c["label"]
        src = c.get("_template_id", c.get("_raw_category", c["source_file"]))
        t_tokens = set(tokenize(c["text"]))
        for tok in t_tokens:
            token_classes[tok].add(lbl)
            token_sources[tok].add(src)
            token_counts[tok] += 1

    single_class_single_source = []
    for tok, count in token_counts.items():
        if len(token_classes[tok]) == 1 and len(token_sources[tok]) == 1:
            single_class_single_source.append({
                "token": tok,
                "count": count,
                "class": list(token_classes[tok])[0],
                "source": list(token_sources[tok])[0]
            })

    single_class_single_source.sort(key=lambda x: x["count"], reverse=True)
    manifest["top_30_artifacts"] = single_class_single_source[:30]

    # Clean internal temporary keys before saving
    schema_fields = ["text", "label", "scam_type", "language", "source_file", "source_type", "license_note", "group_id"]
    
    clean_train_rows = []
    for c in train_candidates:
        clean_train_rows.append({k: c[k] for k in schema_fields})

    clean_holdout_rows = []
    for c in holdout_candidates:
        clean_holdout_rows.append({k: c[k] for k in schema_fields})

    # ==========================================
    # 7. Write Output Files
    # ==========================================
    train_out_path = os.path.join(DATA_DIR, "external_train_candidates.csv")
    holdout_out_path = os.path.join(DATA_DIR, "external_real_holdout_candidates.csv")
    manifest_out_path = os.path.join(DATA_DIR, "external_audit_manifest.json")

    with open(train_out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=schema_fields, quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        writer.writerows(clean_train_rows)

    with open(holdout_out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=schema_fields, quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        writer.writerows(clean_holdout_rows)

    manifest["output_files"] = {
        "external_train_candidates.csv": {
            "path": train_out_path,
            "sha256": sha256_file(train_out_path),
            "rows": len(clean_train_rows),
            "label_counts": dict(Counter(r["label"] for r in clean_train_rows)),
            "source_counts": dict(Counter(r["source_file"] for r in clean_train_rows)),
            "source_type_counts": dict(Counter(r["source_type"] for r in clean_train_rows)),
            "language_counts": dict(Counter(r["language"] for r in clean_train_rows)),
            "scam_type_counts": dict(Counter(r["scam_type"] for r in clean_train_rows))
        },
        "external_real_holdout_candidates.csv": {
            "path": holdout_out_path,
            "sha256": sha256_file(holdout_out_path),
            "rows": len(clean_holdout_rows),
            "label_counts": dict(Counter(r["label"] for r in clean_holdout_rows)),
            "source_counts": dict(Counter(r["source_file"] for r in clean_holdout_rows)),
            "source_type_counts": dict(Counter(r["source_type"] for r in clean_holdout_rows)),
            "unique_source_urls": len(set(r.get("_source_url", "") for r in holdout_real_rows))
        }
    }

    manifest["pii_counts"] = dict(pii_counts)

    # Final Strict Leakage Assertions
    clean_train_texts = [r["text"] for r in clean_train_rows]
    clean_ho_texts = [r["text"] for r in clean_holdout_rows]

    assert len(set(clean_train_texts).intersection(set(real_test_texts))) == 0, "Leakage into real_test!"
    assert len(set(clean_ho_texts).intersection(set(real_test_texts))) == 0, "Holdout leakage into real_test!"
    assert len(set(clean_train_texts).intersection(set(clean_ho_texts))) == 0, "Train leakage into holdout!"

    vec_verif = TfidfVectorizer(ngram_range=(1, 2), min_df=1)
    X_verif = vec_verif.fit_transform(clean_train_texts + clean_ho_texts + real_test_texts)
    n_tr = len(clean_train_texts)
    n_ho = len(clean_ho_texts)

    X_tr = X_verif[:n_tr]
    X_ho = X_verif[n_tr:n_tr + n_ho]
    X_rt = X_verif[n_tr + n_ho:]

    assert np.sum(X_tr.dot(X_rt.T) > 0.90) == 0, "Near-dupe leakage: train <-> real_test!"
    assert np.sum(X_ho.dot(X_rt.T) > 0.90) == 0, "Near-dupe leakage: holdout <-> real_test!"
    assert np.sum(X_tr.dot(X_ho.T) > 0.90) == 0, "Near-dupe leakage: train <-> holdout!"

    manifest["leakage_assertions"] = {
        "exact_train_vs_real_test": 0,
        "exact_holdout_vs_real_test": 0,
        "exact_train_vs_holdout": 0,
        "near_dupes_train_vs_real_test": 0,
        "near_dupes_holdout_vs_real_test": 0,
        "near_dupes_train_vs_holdout": 0
    }

    with open(manifest_out_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print("\nSuccessfully built curated datasets and manifest:")
    print(f"  - {train_out_path}: {len(clean_train_rows)} rows")
    print(f"  - {holdout_out_path}: {len(clean_holdout_rows)} rows")
    print(f"  - {manifest_out_path}")

if __name__ == "__main__":
    main()
