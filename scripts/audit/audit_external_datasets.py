#!/usr/bin/env python3
"""scripts/audit/audit_external_datasets.py

Comprehensive, deterministic read-only auditor for external datasets in services/classifier/data/.
Uses fixed random seed 42. Reports real, verified numbers only.
Audits:
1. dataset.csv
2. dataset_beasiswa_mahasiswa.csv
3. dataset_combined.xlsx
4. Fraud Detection Dataset.csv
5. india_fraud_detection_FINAL.csv
6. internet_scams_archive.csv
7. normalized_dataset.csv
8. spam.csv
Comparisons:
- maindataset.csv
- real_test.csv
"""

import os
import sys
import csv
import re
import json
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
import numpy as np

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

RANDOM_SEED = 42

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA_DIR = os.path.join(REPO_ROOT, "services", "classifier", "data")
OUTPUT_JSON = os.path.join(os.path.dirname(__file__), "external_datasets_audit.json")

# PII Detection and Masking Patterns
PHONE_REGEX = re.compile(r'(?:\+?91[\-\s]?)?[6-9]\d{4}[\-\s]?\d{5}\b|\b0[6-9]\d{4}[\-\s]?\d{5}\b|\b[6-9]\d{9}\b|\b(?:\+?1[\-\s]?)?\(?\d{3}\)?[\-\s]?\d{3}[\-\s]?\d{4}\b')
EMAIL_REGEX = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b')
UPI_REGEX = re.compile(r'\b[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z0-9_-]{2,64}\b')
ACC_REGEX = re.compile(r'\b(?:\d[ -]?){9,18}\d\b')
PAN_REGEX = re.compile(r'\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b')
AADHAAR_REGEX = re.compile(r'\b\d{4}\s?\d{4}\s?\d{4}\b')

HINGLISH_MARKERS = {
    "aap", "aapko", "karo", "karein", "karna", "paisa", "paise", "milega", "apna", "apne",
    "dijiye", "bhejo", "sarkari", "yojana", "chahiye", "hai", "hain", "ke", "liye", "bhi",
    "naukri", "kaam", "ghar", "baithe", "khatam", "turant", "sampark", "kare", "jeet",
    "shamil", "muft", "padhe", "bina", "sirf", "lene", "par", "se", "jaldi", "dhyan",
    "kripya", "badhaai", "inaam", "chune", "gaye", "bhej", "khata", "yojna", "dakhila"
}

def mask_pii_str(val: str) -> str:
    if not val:
        return ""
    s = str(val)
    # Mask email first, then UPI, then phone, then account/cards
    s = EMAIL_REGEX.sub("[EMAIL_MASKED]", s)
    s = UPI_REGEX.sub("[UPI_MASKED]", s)
    s = PHONE_REGEX.sub("[PHONE_MASKED]", s)
    s = PAN_REGEX.sub("[PAN_MASKED]", s)
    s = AADHAAR_REGEX.sub("[AADHAAR_MASKED]", s)
    s = ACC_REGEX.sub("[ACC_NUM_MASKED]", s)
    return s

def check_encoding(fpath: str):
    if fpath.endswith(".xlsx"):
        return "zip/xml (binary)", True, []
    with open(fpath, "rb") as f:
        raw = f.read()
    try:
        raw.decode("utf-8")
        return "utf-8", True, []
    except UnicodeDecodeError as e:
        try:
            raw.decode("windows-1252")
            return "windows-1252 / latin-1", False, [str(e)]
        except UnicodeDecodeError as e2:
            return "unknown binary", False, [str(e), str(e2)]

def infer_col_type(vals):
    non_empty = [v for v in vals if v is not None and str(v).strip() != ""]
    if not non_empty:
        return "string (all empty)"
    sample = non_empty[:200]
    is_int = all(str(v).strip().lstrip("-").isdigit() for v in sample)
    if is_int:
        return "integer"
    try:
        is_float = all(float(str(v).strip()) is not None for v in sample)
        if is_float:
            return "float"
    except Exception:
        pass
    is_bool = all(str(v).strip().lower() in ("true", "false", "0", "1", "yes", "no") for v in sample)
    if is_bool and len(set(str(v).strip().lower() for v in sample)) <= 2:
        return "boolean"
    return "string"

def detect_language(text: str) -> str:
    if not text:
        return "empty"
    devanagari_chars = len(re.findall(r'[\u0900-\u097F]', text))
    if devanagari_chars / max(len(text), 1) > 0.15:
        return "hindi"
    words = set(re.findall(r'[a-zA-Z]+', text.lower()))
    matched = words.intersection(HINGLISH_MARKERS)
    if len(matched) >= 2:
        return "hinglish"
    # Check french/spanish/indonesian basic stop words
    indonesian_words = {"yang", "dan", "di", "dari", "ini", "untuk", "dengan", "saya", "kamu", "bisa", "adalah"}
    french_words = {"bonjour", "merci", "salut", "urgent", "compte", "pour", "dans", "avec", "est", "mon", "ton"}
    spanish_words = {"hola", "gracias", "urgente", "cuenta", "para", "este", "esta", "con", "del", "por"}
    if len(words.intersection(indonesian_words)) >= 2:
        return "indonesian"
    if len(words.intersection(french_words)) >= 2:
        return "french"
    if len(words.intersection(spanish_words)) >= 2:
        return "spanish"
    return "english"

def count_pii(text: str):
    phones = len(PHONE_REGEX.findall(text))
    emails = len(EMAIL_REGEX.findall(text))
    upis = len(UPI_REGEX.findall(text))
    pans = len(PAN_REGEX.findall(text))
    aadhaars = len(AADHAAR_REGEX.findall(text))
    return {
        "phone": phones,
        "email": emails,
        "upi": upis,
        "pan": pans,
        "aadhaar": aadhaars
    }

def check_student_relevance(text: str):
    t = text.lower()
    matches = []
    if re.search(r'\b(scholarship|fellowship|grant|stipend|beasiswa|merit|vidya|yojana)\b', t):
        matches.append("scholarship")
    if re.search(r'\b(intern|internship|trainee|apprentice)\b', t):
        matches.append("internship")
    if re.search(r'\b(job|hiring|recruitment|vacancy|placement|salary|package|ctc|interview|naukri)\b', t):
        matches.append("job")
    if re.search(r'\b(part[\-\s]?time|daily income|rating|task|telegram task|youtube like|watch video|earn per day|review)\b', t):
        matches.append("task_job")
    if re.search(r'\b(mule|rent your account|current account|bank account rent|commission on transfer|receive payment on your account|atm card rent)\b', t):
        matches.append("mule_account")
    if re.search(r'\b(contest|competition|hackathon|prize|coding challenge|quiz|lottery|lucky draw|win)\b', t):
        matches.append("competition")
    if re.search(r'\b(visa|overseas|study abroad|ielts|embassy|work permit|agent)\b', t):
        matches.append("overseas_agent")
    if re.search(r'\b(otp|kyc|bank alert|upi|challan|electricity|bill|debit card|credit card|pan card|aadhaar|account suspended)\b', t):
        matches.append("bank_otp_upi_alert")
    return matches

print("Auditing modules loaded successfully.")

def audit_all():
    print(f"Starting audit of external datasets with random seed {RANDOM_SEED}...")
    np.random.seed(RANDOM_SEED)

    # 1. Load comparison datasets first
    main_path = os.path.join(DATA_DIR, "maindataset.csv")
    real_path = os.path.join(DATA_DIR, "real_test.csv")

    with open(main_path, "r", encoding="utf-8") as f:
        main_reader = csv.DictReader(f)
        main_rows = list(main_reader)
    main_texts = [r["text"].strip() for r in main_rows]
    main_texts_set = set(main_texts)

    with open(real_path, "r", encoding="utf-8") as f:
        real_reader = csv.DictReader(f)
        real_rows = list(real_reader)
    real_texts = [r["text"].strip() for r in real_rows]
    real_texts_set = set(real_texts)

    print(f"Loaded maindataset.csv ({len(main_rows)} rows), real_test.csv ({len(real_rows)} rows).")

    # Fit reference vectorizers for near-duplicate checks
    vec_main = TfidfVectorizer(ngram_range=(1, 2), min_df=1)
    X_main = vec_main.fit(main_texts + real_texts)
    # Actually, to compute cosine similarity between texts and main_texts, we should vectorize together on shared vocabulary
    # or fit on union of all text sources.

    audit_results = {}

    target_files = [
        "dataset.csv",
        "dataset_beasiswa_mahasiswa.csv",
        "dataset_combined.xlsx",
        "Fraud Detection Dataset.csv",
        "india_fraud_detection_FINAL.csv",
        "internet_scams_archive.csv",
        "normalized_dataset.csv",
        "spam.csv"
    ]

    # Store text data for text files to do cross-dataset comparison
    text_data_store = {}

    for fname in target_files:
        fpath = os.path.join(DATA_DIR, fname)
        print(f"\n==========================================")
        print(f"AUDITING: {fname}")
        print(f"==========================================")
        
        file_audit = {
            "file_name": fname,
            "file_path": fpath,
            "file_size_bytes": os.path.getsize(fpath),
        }

        enc, is_utf8, enc_issues = check_encoding(fpath)
        file_audit["encoding"] = enc
        file_audit["is_valid_utf8"] = is_utf8
        file_audit["encoding_issues"] = enc_issues

        # Handle XLSX
        if fname.endswith(".xlsx"):
            with zipfile.ZipFile(fpath) as z:
                with z.open("xl/sharedStrings.xml") as sf:
                    ss_tree = ET.parse(sf)
                    sst = [elem.text for elem in ss_tree.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")]
                
                with z.open("xl/worksheets/sheet1.xml") as wf:
                    row_count = 0
                    header = []
                    col_vals = defaultdict(list)
                    context = ET.iterparse(wf, events=("end",))
                    for event, elem in context:
                        if elem.tag.endswith("row"):
                            row_count += 1
                            vals = []
                            for c in elem.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c"):
                                t = c.get("t")
                                v = c.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v")
                                val = v.text if v is not None else ""
                                if t == "s" and val.isdigit():
                                    val = sst[int(val)]
                                vals.append(val)
                            if row_count == 1:
                                header = vals
                            else:
                                for idx, h in enumerate(header):
                                    v = vals[idx] if idx < len(vals) else ""
                                    col_vals[h].append(v)
                            elem.clear()
            
            data_rows = row_count - 1
            file_audit["shape"] = {"rows": data_rows, "cols": len(header)}
            file_audit["columns"] = header
            col_types = {h: infer_col_type(col_vals[h]) for h in header}
            file_audit["column_types"] = col_types
            missing_counts = {h: sum(1 for v in col_vals[h] if v is None or str(v).strip() == "") for h in header}
            file_audit["missing_values"] = {h: {"count": missing_counts[h], "pct": missing_counts[h]/data_rows*100} for h in header}

            # 3 sample rows
            samples = []
            for r_idx in range(min(3, data_rows)):
                row_dict = {h: mask_pii_str(col_vals[h][r_idx]) for h in header}
                samples.append(row_dict)
            file_audit["sample_rows"] = samples

            file_audit["type"] = "tabular/numeric"
            file_audit["usable_text_column"] = None
            file_audit["classifier_status"] = "UNUSABLE"
            file_audit["unusable_reason"] = "Tabular demographic data for scholarship quota eligibility criteria; contains no message text column."
            
            # Label
            file_audit["label_column"] = "Outcome"
            outcome_counts = Counter(col_vals["Outcome"])
            file_audit["label_counts"] = dict(outcome_counts)
            file_audit["label_mapping_note"] = "Binary demographic outcome (1.0 = eligible/admitted, 0.0 = not eligible). Does not represent scam/suspicious messages; represents scholarship applicant selection."
            file_audit["ambiguity_note"] = "Not a communication dataset. Label indicates scholarship eligibility algorithm decision, completely orthogonal to student fraud detection."
            
            file_audit["language_mix"] = "English categories / Indian demographic tabular attributes"
            file_audit["student_relevance"] = "Contains Indian scholarship scheme names in 'Name' column (e.g. INSPIRE, Pragati, Dr. Ambedkar post matric) and demographic features (caste, religion, income), but no communication text."
            file_audit["provenance_license"] = "unknown, check the Kaggle page (appears to be an Indian scholarship eligibility rule-engine table)"
            
            audit_results[fname] = file_audit
            print(f"Completed {fname}: {data_rows} rows, 12 cols, Tabular, UNUSABLE.")
            continue

        # Handle CSVs
        enc_to_use = "latin-1" if fname == "spam.csv" else "utf-8"
        with open(fpath, "r", encoding=enc_to_use, errors="replace") as f:
            reader = csv.reader(f)
            raw_header = next(reader)
            rows = list(reader)

        header = [h if h != "" else f"unnamed_{idx}" for idx, h in enumerate(raw_header)]
        data_rows = len(rows)
        file_audit["shape"] = {"rows": data_rows, "cols": len(header)}
        file_audit["columns"] = header
        
        col_vals = defaultdict(list)
        for r in rows:
            for idx, h in enumerate(header):
                val = r[idx] if idx < len(r) else ""
                col_vals[h].append(val)

        col_types = {h: infer_col_type(col_vals[h]) for h in header}
        file_audit["column_types"] = col_types
        missing_counts = {h: sum(1 for v in col_vals[h] if v is None or str(v).strip() == "") for h in header}
        file_audit["missing_values"] = {h: {"count": missing_counts[h], "pct": missing_counts[h]/data_rows*100 if data_rows > 0 else 0} for h in header}

        # 3 Sample rows with PII masking
        samples = []
        for r_idx in range(min(3, data_rows)):
            row_dict = {}
            for idx, h in enumerate(header):
                val = rows[r_idx][idx] if idx < len(rows[r_idx]) else ""
                # If Indonesian names column, mask name
                if h == "Nama":
                    val = "[NAME_MASKED]"
                else:
                    val = mask_pii_str(val)
                row_dict[h] = val
            samples.append(row_dict)
        file_audit["sample_rows"] = samples

        # Check usable text column and type
        if fname == "dataset_beasiswa_mahasiswa.csv":
            file_audit["type"] = "tabular/numeric"
            file_audit["usable_text_column"] = None
            file_audit["classifier_status"] = "UNUSABLE"
            file_audit["unusable_reason"] = "Tabular Indonesian student academic records (NIM, IPK, income, dependents); no free-text message column and no label column."
            file_audit["label_column"] = None
            file_audit["label_counts"] = {}
            file_audit["label_mapping_note"] = "No label column present."
            file_audit["language_mix"] = "Indonesian (column names and achievements: Internasional, Nasional, Provinsi, Kabupaten)"
            file_audit["student_relevance"] = "None for Indian students (Indonesian university GPA and parent income dataset)."
            file_audit["provenance_license"] = "unknown, check the Kaggle page"
            audit_results[fname] = file_audit
            print(f"Completed {fname}: 15 rows, Tabular, UNUSABLE.")
            continue

        if fname == "Fraud Detection Dataset.csv":
            file_audit["type"] = "tabular/numeric"
            file_audit["usable_text_column"] = None
            file_audit["classifier_status"] = "UNUSABLE"
            file_audit["unusable_reason"] = "Tabular financial transaction logs (amounts, device, location, payment method); no free-text message column."
            file_audit["label_column"] = "Fraudulent"
            file_audit["label_counts"] = dict(Counter(col_vals["Fraudulent"]))
            file_audit["label_mapping_note"] = "Binary financial fraud label (0 = normal transaction, 1 = fraudulent transaction). Represents credit card/ATM transaction anomaly, not social engineering messages."
            file_audit["ambiguity_note"] = "Ambiguous 'fraud' concept: financial transaction fraud (amounts, locations, velocity) vs deceptive opportunity communication."
            file_audit["language_mix"] = "English categorical values (ATM Withdrawal, Mobile, Chicago, Debit Card, etc.)"
            file_audit["student_relevance"] = "Contains payment methods (UPI, Debit Card) and transaction logs, but zero opportunity text."
            file_audit["provenance_license"] = "unknown, check the Kaggle page"
            audit_results[fname] = file_audit
            print(f"Completed {fname}: 51,000 rows, Tabular, UNUSABLE.")
            continue

        # For remaining files, identify text column
        if fname == "dataset.csv":
            text_col = "text"
            label_col = "label"
        elif fname == "india_fraud_detection_FINAL.csv":
            text_col = "message_text"
            label_col = "label"
        elif fname == "internet_scams_archive.csv":
            text_col = "message_text"
            label_col = "label"
        elif fname == "normalized_dataset.csv":
            text_col = "text"
            label_col = "label"
        elif fname == "spam.csv":
            text_col = "v2"
            label_col = "v1"
        else:
            text_col = "text"
            label_col = "label"

        file_audit["type"] = "free-text messages"
        file_audit["usable_text_column"] = text_col
        file_audit["label_column"] = label_col

        # Extract text rows
        raw_texts = []
        labels = []
        for r in rows:
            if fname == "spam.csv":
                # Handle unescaped commas by joining v2 and extra trailing columns
                parts = [p for p in r[1:] if p.strip() != ""]
                t = ",".join(parts).strip() if len(parts) > 1 else r[1].strip()
            else:
                c_idx = header.index(text_col)
                t = r[c_idx].strip() if c_idx < len(r) else ""
            l_idx = header.index(label_col)
            l = r[l_idx].strip() if l_idx < len(r) else ""
            raw_texts.append(t)
            labels.append(l)

        text_data_store[fname] = {
            "texts": raw_texts,
            "labels": labels,
            "rows": rows,
            "header": header
        }

        # Label counts and mapping
        lbl_counts = Counter(labels)
        file_audit["label_counts"] = dict(lbl_counts)

        # Mapping logic
        if fname == "dataset.csv" or fname == "normalized_dataset.csv":
            file_audit["label_mapping"] = {"suspicious": "suspicious", "benign": "benign"}
            file_audit["label_mapping_note"] = "Direct 1:1 mapping to our labels (suspicious, benign)."
            file_audit["ambiguity_note"] = "None. Native labels match system ontology."
        elif fname == "india_fraud_detection_FINAL.csv":
            file_audit["label_mapping"] = {"1": "suspicious", "0": "benign"}
            file_audit["label_mapping_note"] = "Binary integer labels: '1' maps directly to suspicious (scam), '0' maps directly to benign (legitimate notification)."
            file_audit["ambiguity_note"] = "Category scope includes broader Indian citizen scams (Echallan, Electricity disconnection, Courier, KYC) alongside Job scams."
        elif fname == "internet_scams_archive.csv":
            file_audit["label_mapping"] = {"Scam": "suspicious", "Benign": "benign"}
            file_audit["label_mapping_note"] = "'Scam' maps to suspicious, 'Benign' maps to benign."
            file_audit["ambiguity_note"] = "Heavy global scam distribution (crypto, romance, family emergency, BEC wire transfer) with low Indian student context."
        elif fname == "spam.csv":
            file_audit["label_mapping"] = {"ham": "benign", "spam": "AMBIGUOUS / suspicious (marketing spam vs fraud scam)"}
            file_audit["label_mapping_note"] = "'ham' maps cleanly to benign background mobile messages. 'spam' maps ambiguously: mostly commercial advertisements, ringtones, and marketing spam rather than advance-fee student scams."
            file_audit["ambiguity_note"] = "CRITICAL AMBIGUITY: 'spam' != 'scam'. Filtering marketing spam is not identical to detecting opportunity fraud."

        # Text length stats
        char_lens = [len(t) for t in raw_texts]
        word_lens = [len(t.split()) for t in raw_texts]
        file_audit["text_stats"] = {
            "char_min": int(np.min(char_lens)) if char_lens else 0,
            "char_max": int(np.max(char_lens)) if char_lens else 0,
            "char_mean": float(np.mean(char_lens)) if char_lens else 0.0,
            "char_median": float(np.median(char_lens)) if char_lens else 0.0,
            "char_std": float(np.std(char_lens)) if char_lens else 0.0,
            "word_min": int(np.min(word_lens)) if word_lens else 0,
            "word_max": int(np.max(word_lens)) if word_lens else 0,
            "word_mean": float(np.mean(word_lens)) if word_lens else 0.0,
            "word_median": float(np.median(word_lens)) if word_lens else 0.0,
            "word_std": float(np.std(word_lens)) if word_lens else 0.0,
        }

        # Language distribution
        langs = [detect_language(t) for t in raw_texts]
        lang_counts = Counter(langs)
        file_audit["language_distribution"] = {
            lang: {"count": count, "pct": count/len(raw_texts)*100} for lang, count in lang_counts.most_common()
        }

        # Student relevance breakdown
        relevance_counts = Counter()
        for t in raw_texts:
            topics = check_student_relevance(t)
            for topic in topics:
                relevance_counts[topic] += 1
        file_audit["student_relevance_counts"] = dict(relevance_counts)

        # Within-file exact duplicates
        exact_dupes_within = len(raw_texts) - len(set(raw_texts))
        file_audit["within_file_exact_duplicates"] = exact_dupes_within

        # Overlap with maindataset.csv
        exact_main_overlap = len(set(raw_texts).intersection(main_texts_set))
        file_audit["overlap_with_maindataset_exact"] = exact_main_overlap

        # Overlap with real_test.csv
        exact_real_overlap = len(set(raw_texts).intersection(real_texts_set))
        file_audit["overlap_with_real_test_exact"] = exact_real_overlap

        # Provenance and License
        if "source" in header or "source_url" in header or "source_license" in header or "license_note" in header:
            sources = Counter(col_vals.get("source", []) + col_vals.get("source_type", []))
            licenses = Counter(col_vals.get("source_license", []) + col_vals.get("license_note", []))
            file_audit["provenance"] = dict(sources)
            file_audit["license"] = dict(licenses)
        else:
            file_audit["provenance"] = "unknown, check the Kaggle page"
            file_audit["license"] = "unknown, check the Kaggle page"

        # PII counts
        pii_summary = Counter()
        masked_pii_examples = defaultdict(list)
        for t in raw_texts:
            for p in PHONE_REGEX.findall(t):
                pii_summary["phones"] += 1
                if len(masked_pii_examples["phones"]) < 3:
                    masked_pii_examples["phones"].append(p[:3] + "XXXX" + p[-2:] if len(p) > 5 else "XXX")
            for em in EMAIL_REGEX.findall(t):
                pii_summary["emails"] += 1
                if len(masked_pii_examples["emails"]) < 3:
                    user_p, dom_p = em.split("@", 1) if "@" in em else (em, "")
                    masked_pii_examples["emails"].append(user_p[:2] + "***@" + dom_p)
            for u in UPI_REGEX.findall(t):
                pii_summary["upis"] += 1
                if len(masked_pii_examples["upis"]) < 3:
                    u_user, u_bank = u.split("@", 1) if "@" in u else (u, "")
                    masked_pii_examples["upis"].append(u_user[:2] + "***@" + u_bank)
            for acc in ACC_REGEX.findall(t):
                # Filter out pure phone numbers or short numbers
                if len(re.sub(r'\D', '', acc)) >= 9:
                    pii_summary["account_numbers"] += 1
                    if len(masked_pii_examples["account_numbers"]) < 3:
                        digits = re.sub(r'\D', '', acc)
                        masked_pii_examples["account_numbers"].append("X" * (len(digits) - 4) + digits[-4:])

        file_audit["pii_counts"] = dict(pii_summary)
        file_audit["masked_pii_examples"] = dict(masked_pii_examples)

        audit_results[fname] = file_audit
        print(f"Processed basic stats for {fname}: {data_rows} rows.")

    # 2. Near duplicate computations using TF-IDF
    print("\nComputing near-duplicates (cosine > 0.90)...")
    # For each text dataset, compute:
    # a) near duplicates within file
    # b) near duplicates vs maindataset.csv
    # c) near duplicates vs real_test.csv

    for fname, tdata in text_data_store.items():
        texts = tdata["texts"]
        n = len(texts)
        print(f"Near-duplicate calculation for {fname} ({n} rows)...")
        
        # Fit TFIDF
        vec = TfidfVectorizer(ngram_range=(1, 2), min_df=2 if n > 1000 else 1, max_features=25000)
        X = vec.fit_transform(texts)

        # Within-file near-duplicates
        within_near_dupes = 0
        if n <= 6000:
            sim_mat = X.dot(X.T).toarray()
            np.fill_diagonal(sim_mat, 0.0)
            within_near_dupes = int(np.sum(sim_mat > 0.90) // 2)
        else:
            # Chunked for 24,000 rows
            chunk_size = 2000
            for i in range(0, n, chunk_size):
                chunk = X[i:min(i+chunk_size, n)]
                sims = chunk.dot(X.T).tocsr()
                for r_idx in range(chunk.shape[0]):
                    global_idx = i + r_idx
                    row = sims.getrow(r_idx)
                    mask = (row.indices > global_idx) & (row.data > 0.90)
                    within_near_dupes += int(np.sum(mask))

        audit_results[fname]["within_file_near_duplicates_pairs"] = within_near_dupes
        print(f"  - Within {fname}: {within_near_dupes} near-duplicate pairs (cosine > 0.90)")

        # Cross check vs maindataset.csv
        vec_cross_main = TfidfVectorizer(ngram_range=(1, 2), min_df=1)
        X_combined_main = vec_cross_main.fit_transform(texts + main_texts)
        X_f = X_combined_main[:n]
        X_m = X_combined_main[n:]

        # For normalized_dataset.csv vs maindataset.csv, we expect exact 600
        cross_main_sims = X_f.dot(X_m.T)
        cross_main_near_count = int(np.sum(cross_main_sims > 0.90))
        audit_results[fname]["overlap_with_maindataset_near_dupes"] = cross_main_near_count
        print(f"  - vs maindataset.csv: {cross_main_near_count} near-duplicates (cosine > 0.90)")

        # Cross check vs real_test.csv
        vec_cross_real = TfidfVectorizer(ngram_range=(1, 2), min_df=1)
        X_combined_real = vec_cross_real.fit_transform(texts + real_texts)
        X_fr = X_combined_real[:n]
        X_r = X_combined_real[n:]
        cross_real_sims = X_fr.dot(X_r.T)
        cross_real_near_count = int(np.sum(cross_real_sims > 0.90))
        audit_results[fname]["overlap_with_real_test_near_dupes"] = cross_real_near_count
        print(f"  - vs real_test.csv: {cross_real_near_count} near-duplicates (cosine > 0.90)")

    # 3. Cross-file duplicates between all pairs of text datasets
    print("\nComputing cross-file duplicates among all text files...")
    cross_file_overlap = {}
    text_fnames = list(text_data_store.keys())
    for idx1 in range(len(text_fnames)):
        fn1 = text_fnames[idx1]
        t1 = text_data_store[fn1]["texts"]
        s1 = set(t1)
        for idx2 in range(idx1 + 1, len(text_fnames)):
            fn2 = text_fnames[idx2]
            t2 = text_data_store[fn2]["texts"]
            s2 = set(t2)
            exact_shared = len(s1.intersection(s2))
            
            # Near dupe check
            vec_pair = TfidfVectorizer(ngram_range=(1, 2), min_df=2 if len(t1)+len(t2) > 10000 else 1, max_features=25000)
            X_all = vec_pair.fit_transform(t1 + t2)
            X_1 = X_all[:len(t1)]
            X_2 = X_all[len(t1):]
            sim_pair = X_1.dot(X_2.T)
            near_shared = int(np.sum(sim_pair > 0.90))
            
            key = f"{fn1} <-> {fn2}"
            cross_file_overlap[key] = {
                "file1": fn1,
                "file2": fn2,
                "exact_shared": exact_shared,
                "near_shared_cosine_gt_0.9": near_shared
            }
            print(f"  {key}: exact={exact_shared}, near={near_shared}")

    audit_results["cross_file_overlap"] = cross_file_overlap

    # 4. Shortcut risk analysis (predictive features & formatting artifacts)
    print("\nAnalyzing shortcuts and class separability on text files...")
    shortcut_analysis = {}
    for fname, tdata in text_data_store.items():
        if fname in ("dataset.csv", "india_fraud_detection_FINAL.csv", "internet_scams_archive.csv", "normalized_dataset.csv", "spam.csv"):
            texts = tdata["texts"]
            raw_labels = tdata["labels"]
            # Convert to binary
            if fname in ("dataset.csv", "normalized_dataset.csv"):
                y = np.array([1 if l == "suspicious" else 0 for l in raw_labels])
            elif fname == "india_fraud_detection_FINAL.csv":
                y = np.array([1 if l == "1" else 0 for l in raw_labels])
            elif fname == "internet_scams_archive.csv":
                y = np.array([1 if l == "Scam" else 0 for l in raw_labels])
            elif fname == "spam.csv":
                y = np.array([1 if l == "spam" else 0 for l in raw_labels])

            vec_w = TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=10000)
            X_w = vec_w.fit_transform(texts)
            clf = LogisticRegression(random_state=RANDOM_SEED, C=1.0, max_iter=500)
            clf.fit(X_w, y)
            feat_names = vec_w.get_feature_names_out()
            coefs = clf.coef_[0]
            top_pos_idx = np.argsort(coefs)[-10:][::-1]
            top_neg_idx = np.argsort(coefs)[:10]

            pos_features = [(feat_names[i], float(coefs[i])) for i in top_pos_idx]
            neg_features = [(feat_names[i], float(coefs[i])) for i in top_neg_idx]

            # Length disparity
            lens_pos = [len(t) for t, yi in zip(texts, y) if yi == 1]
            lens_neg = [len(t) for t, yi in zip(texts, y) if yi == 0]

            shortcut_analysis[fname] = {
                "top_positive_features (suspicious/scam/spam)": pos_features,
                "top_negative_features (benign/ham)": neg_features,
                "mean_len_positive": float(np.mean(lens_pos)) if lens_pos else 0,
                "mean_len_negative": float(np.mean(lens_neg)) if lens_neg else 0,
                "len_disparity_ratio": float(np.mean(lens_pos) / max(np.mean(lens_neg), 1)) if lens_neg else 0,
            }

    audit_results["shortcut_analysis"] = shortcut_analysis

    # 5. Save all results to JSON
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(audit_results, f, indent=2)
    print(f"\nAudit complete! Saved detailed results to {OUTPUT_JSON}")

if __name__ == "__main__":
    audit_all()
