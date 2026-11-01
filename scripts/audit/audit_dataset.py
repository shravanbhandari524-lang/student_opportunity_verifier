#!/usr/bin/env python3
"""scripts/audit/audit_dataset.py

Comprehensive dataset auditor for Student Opportunity Verifier.
Reads services/classifier/data/dataset.csv and performs all 11 audit steps.
Uses fixed random seed 42. Outputs real, unrounded numbers and details.
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

def load_raw_dataset(csv_path):
    rows = []
    with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        for line_num, row in enumerate(reader, start=2):
            rows.append({
                "line": line_num,
                "raw": row
            })
    return header, rows

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

def infer_scam_type(text):
    text_lower = text.lower()
    
    # Heuristics based on PRD Section 2:
    # 1. Fake scholarship: scholarship, fellowship, merit grant, nsp, pms, pm youth
    # 2. Fake internship or job: intern, job, hiring, recruiter, hr, data analyst, laptop delivery, joining, work from home, wfh, salary, stipend, placement, typing job
    # 3. Task or part-time job: telegram task, like youtube, rate products, crypto trading, review task, deposit, vip group
    # 4. Money mule offer: rent your bank account, atm card, rent account, commission weekly, share otp, transfer money, receive money
    # 5. Fake competition or certificate: coding contest, contest, lucky draw, prize, won a laptop, certificate, hackathon entry fee
    # 6. Overseas study or visa agent: visa, abroad, overseas, admission, foreign university, study permit
    
    scores = {}
    
    # Mule patterns
    mule_keywords = ["rent your bank", "rent your account", "rent account", "atm card", "share otp", "receive money for a commission", "trading firm. earn 10% commission"]
    if any(k in text_lower for k in mule_keywords) or ("rent" in text_lower and "bank" in text_lower):
        scores["money_mule"] = 10
    
    # Task job patterns
    task_keywords = ["task job", "like youtube", "rate products", "crypto trading", "review task", "vip group", "tasks available", "complete 3 tasks", "task"]
    if any(k in text_lower for k in task_keywords):
        scores["task_job"] = scores.get("task_job", 0) + 8

    # Scholarship patterns
    scholarship_keywords = ["scholarship", "merit award", "pm youth", "grant", "fellowship"]
    if any(k in text_lower for k in scholarship_keywords):
        scores["fake_scholarship"] = scores.get("fake_scholarship", 0) + 8

    # Competition / prize patterns
    comp_keywords = ["contest", "lucky draw", "prize", "won a laptop", "coding contest", "certificate fee"]
    if any(k in text_lower for k in comp_keywords):
        scores["fake_competition"] = scores.get("fake_competition", 0) + 8

    # Overseas study
    overseas_keywords = ["visa", "overseas", "abroad", "foreign admission", "study permit", "immigration"]
    if any(k in text_lower for k in overseas_keywords):
        scores["overseas_study"] = scores.get("overseas_study", 0) + 8

    # Internship / job
    intern_keywords = ["intern", "job", "hired", "hiring", "recruitment", "hr", "data analyst", "laptop security", "laptop delivery", "work from home", "wfh", "typing job", "apprenticeship", "offer letter", "resume was shortlisted"]
    if any(k in text_lower for k in intern_keywords):
        scores["fake_internship_job"] = scores.get("fake_internship_job", 0) + 6

    # Loan / financial scam (if any)
    if "loan" in text_lower:
        scores["fake_loan"] = scores.get("fake_loan", 0) + 8

    if not scores:
        return "unclassified_scam"
    
    # Return highest score
    return max(scores.items(), key=lambda x: x[1])[0]

def detect_language(text):
    # Devanagari Unicode block: U+0900 - U+097F
    devanagari_chars = len(re.findall(r'[\u0900-\u097F]', text))
    total_chars = len(text)
    
    if devanagari_chars / max(total_chars, 1) > 0.15:
        return "Hindi (Devanagari)"
    
    # Hinglish heuristic: common Hindi romanized words
    hinglish_words = {
        "aap", "aapko", "karo", "karein", "karna", "paisa", "paise", "milega", "apna", "apne",
        "dijiye", "bhejo", "sarkari", "yojana", "chahiye", "hai", "hain", "ke", "liye", "bhi",
        "naukri", "kaam", "ghar", "baithe", "khatam", "turant", "sampark", "kare", "jeet",
        "shamil", "muft", "padhe", "bina", "sirf"
    }
    words = re.findall(r'[a-zA-Z]+', text.lower())
    matched_hinglish = [w for w in words if w in hinglish_words]
    
    # If 2 or more distinct Hinglish markers or >= 10% words
    if len(matched_hinglish) >= 2 or (len(words) > 0 and len(matched_hinglish) / len(words) >= 0.08):
        return "Hinglish (Romanized Hindi)"
    
    return "English"

def audit():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    csv_path = os.path.join(repo_root, "services", "classifier", "data", "dataset.csv")
    
    print(f"Auditing file: {csv_path}")
    if not os.path.exists(csv_path):
        print(f"ERROR: Dataset not found at {csv_path}")
        sys.exit(1)
        
    encoding_valid, encoding_issues = check_encoding(csv_path)
    header, raw_rows = load_raw_dataset(csv_path)
    
    print("\n--- STEP 1: Structure ---")
    print(f"Header: {header}")
    num_cols = len(header) if header else 0
    row_col_counts = Counter([len(r["raw"]) for r in raw_rows])
    print(f"Row column length distribution: {dict(row_col_counts)}")
    
    parsed_samples = []
    missing_value_rows = []
    label_values = Counter()
    
    for r in raw_rows:
        line_num = r["line"]
        cols = r["raw"]
        if len(cols) != 2:
            missing_value_rows.append((line_num, f"Malformed columns count: {len(cols)}"))
            continue
        text, label = cols[0], cols[1]
        text_clean = text.strip()
        label_clean = label.strip()
        
        if not text_clean or not label_clean:
            missing_value_rows.append((line_num, "Empty text or label"))
            
        label_values[label_clean] += 1
        parsed_samples.append({
            "line": line_num,
            "text": text_clean,
            "label": label_clean,
            "char_len": len(text_clean),
            "word_len": len(text_clean.split())
        })
        
    print(f"Total parsed rows: {len(parsed_samples)}")
    print(f"Label distribution: {dict(label_values)}")
    print(f"Missing values / malformed rows count: {len(missing_value_rows)}")
    
    char_lens = [s["char_len"] for s in parsed_samples]
    word_lens = [s["word_len"] for s in parsed_samples]
    print(f"Char length - min: {min(char_lens)}, max: {max(char_lens)}, mean: {np.mean(char_lens):.2f}, median: {np.median(char_lens):.2f}")
    print(f"Word count - min: {min(word_lens)}, max: {max(word_lens)}, mean: {np.mean(word_lens):.2f}, median: {np.median(word_lens):.2f}")
    
    short_texts = [s for s in parsed_samples if s["char_len"] < 20 or s["word_len"] < 5]
    long_texts = [s for s in parsed_samples if s["char_len"] > 1000]
    print(f"Very short texts (<20 chars or <5 words): {len(short_texts)}")
    print(f"Very long texts (>1000 chars): {len(long_texts)}")
    
    print("\n--- STEP 2: Size and Balance ---")
    total_rows = len(parsed_samples)
    scam_count = label_values.get("suspicious", 0)
    genuine_count = label_values.get("benign", 0)
    ratio = scam_count / genuine_count if genuine_count > 0 else 0
    print(f"Total rows: {total_rows} (Requirement: 500+)")
    print(f"Suspicious (scam): {scam_count}, Benign (genuine): {genuine_count}, Ratio: {ratio:.2f}")
    
    # Scam type inference
    scam_samples = [s for s in parsed_samples if s["label"] == "suspicious"]
    scam_type_counts = Counter()
    for s in scam_samples:
        stype = infer_scam_type(s["text"])
        s["scam_type"] = stype
        scam_type_counts[stype] += 1
        
    print("Inferred Scam Type Distribution for 'suspicious' class:")
    for st, count in scam_type_counts.most_common():
        flag_str = " [FLAG: < 50 examples]" if count < 50 else ""
        print(f"  - {st}: {count}{flag_str}")
        
    print("\n--- STEP 3: Duplicates and Leakage ---")
    texts = [s["text"] for s in parsed_samples]
    exact_duplicates = len(texts) - len(set(texts))
    print(f"Exact string duplicates: {exact_duplicates}")
    
    normalized_texts = [re.sub(r'\s+', ' ', t.lower().strip()) for t in texts]
    norm_duplicates = len(normalized_texts) - len(set(normalized_texts))
    print(f"Normalized duplicates: {norm_duplicates}")
    
    # Cosine similarity with TF-IDF char/word
    tfidf_sim = TfidfVectorizer(ngram_range=(1, 2), min_df=1).fit_transform(texts)
    sim_matrix = cosine_similarity(tfidf_sim)
    np.fill_diagonal(sim_matrix, 0.0)
    
    near_dupe_pairs = []
    n = len(texts)
    for i in range(n):
        for j in range(i + 1, n):
            if sim_matrix[i, j] > 0.90:
                near_dupe_pairs.append((i, j, sim_matrix[i, j]))
                
    print(f"Near-duplicate pairs (cosine > 0.90): {len(near_dupe_pairs)}")
    for i, j, score in near_dupe_pairs[:5]:
        print(f"  Pair ({parsed_samples[i]['line']}, {parsed_samples[j]['line']}) sim={score:.3f}:")
        print(f"    1: {parsed_samples[i]['text'][:70]}...")
        print(f"    2: {parsed_samples[j]['text'][:70]}...")

    # Check leakage across 80/20 train/test split
    labels = [s["label"] for s in parsed_samples]
    indices = np.arange(len(parsed_samples))
    train_idx, test_idx = train_test_split(
        indices, test_size=0.2, random_state=RANDOM_SEED, stratify=labels
    )
    train_set = set(train_idx)
    test_set = set(test_idx)
    
    leaked_pairs = []
    for i, j, score in near_dupe_pairs:
        if (i in train_set and j in test_set) or (j in train_set and i in test_set):
            leaked_pairs.append((i, j, score))
    print(f"Near-duplicates spanning train and test splits: {len(leaked_pairs)}")
    
    print("\n--- STEP 4: Language Distribution ---")
    lang_counts = Counter()
    for s in parsed_samples:
        lang = detect_language(s["text"])
        s["language"] = lang
        lang_counts[lang] += 1
    for lang, count in lang_counts.items():
        share = count / total_rows * 100
        print(f"  - {lang}: {count} ({share:.1f}%)")
        
    print("\n--- STEP 5: Genuine Class Quality & Hard Negatives ---")
    benign_samples = [s for s in parsed_samples if s["label"] == "benign"]
    # Check for hard negative markers: fee, deadline, whatsapp, urgent, exam, stipend
    benign_with_fee = [s for s in benign_samples if re.search(r'\b(fee|fees|cost|charge|rs|inr|₹|\$)\b', s["text"], re.I)]
    benign_with_urgency = [s for s in benign_samples if re.search(r'\b(urgent|deadline|hurry|last date|immediate|apply now)\b', s["text"], re.I)]
    benign_with_whatsapp = [s for s in benign_samples if re.search(r'\b(whatsapp|telegram)\b', s["text"], re.I)]
    benign_with_official_domains = [s for s in benign_samples if re.search(r'(\.gov\.in|\.edu|\.ac\.in|careers\.|portal)', s["text"], re.I)]
    
    print(f"Total benign samples: {len(benign_samples)}")
    print(f"Benign samples mentioning fees/costs: {len(benign_with_fee)} ({len(benign_with_fee)/len(benign_samples)*100:.1f}%)")
    print(f"Benign samples mentioning urgency/deadlines: {len(benign_with_urgency)} ({len(benign_with_urgency)/len(benign_samples)*100:.1f}%)")
    print(f"Benign samples mentioning WhatsApp/Telegram: {len(benign_with_whatsapp)} ({len(benign_with_whatsapp)/len(benign_samples)*100:.1f}%)")
    print(f"Benign samples with official domain/portal references: {len(benign_with_official_domains)} ({len(benign_with_official_domains)/len(benign_samples)*100:.1f}%)")
    
    print("\nSample Benign texts:")
    for s in benign_samples[:3]:
        print(f"  Line {s['line']}: {s['text']}")
        
    print("\n--- STEP 6: Scam Class Quality & Patterns ---")
    pattern_checks = {
        "registration_or_training_fee": r'\b(registration fee|processing fee|training fee|security deposit|laptop security|uniform fee|entry fee)\b',
        "deposit_for_premium_task": r'\b(deposit|double your earnings|recharge|upgrade to vip)\b',
        "rent_your_account_mule": r'\b(rent your|rent account|atm card|mule|receive money|commission weekly)\b',
        "apk_link": r'\b(\.apk|install app|download apk)\b',
        "selected_without_interview": r'\b(selected|shortlisted|profile matched|you are hired|congratulations)\b',
        "otp_or_bank_details": r'\b(otp|bank details|card details|share otp)\b',
        "impersonated_placement_or_brand": r'\b(tata motors|google|techcorp|national merit|pm youth)\b',
        "crypto_or_trading_task": r'\b(crypto|trading tasks|product rating|typing job)\b'
    }
    for pname, pat in pattern_checks.items():
        matches = [s for s in scam_samples if re.search(pat, s["text"], re.I)]
        print(f"  Pattern '{pname}': {len(matches)} / {len(scam_samples)} ({len(matches)/len(scam_samples)*100:.1f}%)")
        
    print("\n--- STEP 7: Shortcut and Bias Risks ---")
    # Length comparison
    scam_char_lens = [s["char_len"] for s in scam_samples]
    benign_char_lens = [s["char_len"] for s in benign_samples]
    print(f"Mean char length - Suspicious: {np.mean(scam_char_lens):.1f}, Benign: {np.mean(benign_char_lens):.1f}")
    
    # Currency symbols & terms
    scam_rs = sum(1 for s in scam_samples if "rs" in s["text"].lower() or "₹" in s["text"])
    benign_rs = sum(1 for s in benign_samples if "rs" in s["text"].lower() or "₹" in s["text"])
    print(f"Mentions of Rs/₹ - Suspicious: {scam_rs}/{len(scam_samples)} ({scam_rs/len(scam_samples)*100:.1f}%), Benign: {benign_rs}/{len(benign_samples)} ({benign_rs/len(benign_samples)*100:.1f}%)")
    
    # Exclamations
    scam_excl = sum(1 for s in scam_samples if "!" in s["text"])
    benign_excl = sum(1 for s in benign_samples if "!" in s["text"])
    print(f"Exclamation marks (!) - Suspicious: {scam_excl}/{len(scam_samples)} ({scam_excl/len(scam_samples)*100:.1f}%), Benign: {benign_excl}/{len(benign_samples)} ({benign_excl/len(benign_samples)*100:.1f}%)")
    
    # Emojis
    emoji_pattern = re.compile(r'[\U00010000-\U0010ffff]', flags=re.UNICODE)
    scam_emojis = sum(1 for s in scam_samples if emoji_pattern.search(s["text"]))
    benign_emojis = sum(1 for s in benign_samples if emoji_pattern.search(s["text"]))
    print(f"Emoji presence - Suspicious: {scam_emojis}/{len(scam_samples)}, Benign: {benign_emojis}/{len(benign_samples)}")

    # Fit a simple LogisticRegression on word+char ngrams to extract top predictive coefficients
    vec_words = TfidfVectorizer(ngram_range=(1, 2), lowercase=True)
    X_w = vec_words.fit_transform(texts)
    y_bin = [1 if s["label"] == "suspicious" else 0 for s in parsed_samples]
    clf = LogisticRegression(random_state=RANDOM_SEED, C=1.0)
    clf.fit(X_w, y_bin)
    
    feature_names = vec_words.get_feature_names_out()
    coefs = clf.coef_[0]
    top_suspicious_idx = np.argsort(coefs)[-20:][::-1]
    top_benign_idx = np.argsort(coefs)[:20]
    
    print("\nTop 20 words predictive of SUSPICIOUS (scam):")
    top_susp_words = [(feature_names[i], coefs[i]) for i in top_suspicious_idx]
    for feat, c in top_susp_words:
        print(f"  +{c:.3f} : '{feat}'")
        
    print("\nTop 20 words predictive of BENIGN (genuine):")
    top_benign_words = [(feature_names[i], coefs[i]) for i in top_benign_idx]
    for feat, c in top_benign_words:
        print(f"  {c:.3f} : '{feat}'")

    print("\n--- STEP 8: Synthetic vs Real Evaluation ---")
    # Repeated prefixes
    prefixes = [re.match(r'^([A-Za-z]+[\s\W]+[A-Za-z]+)', s["text"]) for s in parsed_samples]
    prefix_texts = [p.group(0).strip().lower() for p in prefixes if p]
    print(f"Common opening phrases: {Counter(prefix_texts).most_common(8)}")
    
    # Check for placeholder names
    placeholders = ["TechCorp", "okaxis", "@paytm", "PM Youth", "ABC Ltd", "XYZ"]
    for ph in placeholders:
        count = sum(1 for s in parsed_samples if ph.lower() in s["text"].lower())
        print(f"  Count of placeholder '{ph}': {count}")

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
    
    for s in parsed_samples:
        t = s["text"]
        for p in phone_regex.findall(t):
            found_phones.append((s["line"], p))
        for u in upi_regex.findall(t):
            # UPI IDs might overlap with emails; filter out emails
            if not re.search(r'\.(com|org|net|in|gov|edu)$', u.split('@')[1], re.I):
                found_upis.append((s["line"], u))
            else:
                found_emails.append((s["line"], u))
        for pan in pan_regex.findall(t):
            found_pans.append((s["line"], pan))
        for a in aadhaar_regex.findall(t):
            found_aadhaar.append((s["line"], a))
            
    print(f"Phone numbers found: {len(found_phones)}")
    for line, ph in found_phones[:5]:
        masked = ph[:2] + "XXXXXX" + ph[-2:]
        print(f"  Line {line}: {masked}")
    print(f"UPI IDs found: {len(found_upis)}")
    for line, u in found_upis[:5]:
        parts = u.split('@')
        masked = parts[0][:2] + "***@" + parts[1]
        print(f"  Line {line}: {masked}")
    print(f"Emails found: {len(found_emails)}")
    for line, em in found_emails[:5]:
        parts = em.split('@')
        masked = parts[0][:2] + "***@" + parts[1]
        print(f"  Line {line}: {masked}")
    print(f"PAN cards found: {len(found_pans)}")
    print(f"Aadhaar numbers found: {len(found_aadhaar)}")

    print("\n--- STEP 10: Baseline Experiment (Word 1-2 + Char 2-5 grams, 80/20 stratified split, seed 42) ---")
    # Pipeline: FeatureUnion with word (1,2) and char (2,5)
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
            if true_l != pred_l:
                cv_misclassified.append({
                    "fold": fold,
                    "index": idx,
                    "line": parsed_samples[idx]["line"],
                    "text": texts[idx],
                    "true_label": true_l,
                    "pred_label": pred_l,
                    "prob": prob.tolist(),
                    "scam_type": parsed_samples[idx].get("scam_type", "n/a"),
                    "language": parsed_samples[idx].get("language", "n/a")
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
                "line": parsed_samples[i]["line"],
                "text": texts[i],
                "true_label": y_test[idx_in_test],
                "pred_label": y_pred[idx_in_test],
                "proba": y_proba[idx_in_test].tolist()
            })
    print(f"Test split misclassified count: {len(test_misclassified)}")
    
    # Collect up to 15 interesting examples (misclassified in CV or test, or closest to boundary 0.5)
    # Also evaluate performance per scam type and per language
    # Train full model or use out-of-fold predictions
    oof_preds = {}
    oof_probas = {}
    for fold, (f_train_idx, f_val_idx) in enumerate(skf.split(texts, labels)):
        f_pipe = Pipeline([
            ("features", FeatureUnion([
                ("word", TfidfVectorizer(ngram_range=(1, 2), analyzer="word", sublinear_tf=True, min_df=1, lowercase=True)),
                ("char", TfidfVectorizer(ngram_range=(2, 5), analyzer="char", sublinear_tf=True, min_df=1, lowercase=True))
            ])),
            ("clf", LogisticRegression(random_state=RANDOM_SEED, C=1.0, max_iter=500))
        ])
        f_pipe.fit([texts[i] for i in f_train_idx], [labels[i] for i in f_train_idx])
        preds = f_pipe.predict([texts[i] for i in f_val_idx])
        probs = f_pipe.predict_proba([texts[i] for i in f_val_idx])
        for i, p, prob in zip(f_val_idx, preds, probs):
            oof_preds[i] = p
            oof_probas[i] = prob

    # Per scam-type performance (OOF)
    print("\n--- OOF Performance per Scam Type ---")
    for stype in sorted(scam_type_counts.keys()):
        st_indices = [i for i in range(len(parsed_samples)) if parsed_samples[i].get("scam_type") == stype]
        st_true = [labels[i] for i in st_indices]
        st_pred = [oof_preds[i] for i in st_indices]
        acc = accuracy_score(st_true, st_pred) if st_true else 0.0
        print(f"  {stype} (n={len(st_indices)}): accuracy={acc:.4f}")

    # Per language performance (OOF)
    print("\n--- OOF Performance per Language ---")
    for lang in sorted(lang_counts.keys()):
        l_indices = [i for i in range(len(parsed_samples)) if parsed_samples[i].get("language") == lang]
        l_true = [labels[i] for i in l_indices]
        l_pred = [oof_preds[i] for i in l_indices]
        acc = accuracy_score(l_true, l_pred) if l_true else 0.0
        print(f"  {lang} (n={len(l_indices)}): accuracy={acc:.4f}")

    # Find 15 key error and borderline examples:
    # First the misclassified ones from CV, then the ones closest to boundary (most ambiguous)
    # Target names: 0 = benign, 1 = suspicious
    all_examples_ranked = []
    classes_list = list(pipeline.named_steps["clf"].classes_)
    susp_class_idx = classes_list.index("suspicious")
    
    for i in range(len(parsed_samples)):
        prob_susp = oof_probas[i][susp_class_idx]
        is_error = (oof_preds[i] != labels[i])
        uncertainty = abs(prob_susp - 0.5)
        all_examples_ranked.append({
            "index": int(i),
            "line": int(parsed_samples[i]["line"]),
            "text": texts[i],
            "true_label": labels[i],
            "pred_label": oof_preds[i],
            "prob_suspicious": float(prob_susp),
            "prob_benign": float(1.0 - prob_susp),
            "is_error": bool(is_error),
            "uncertainty": float(uncertainty),
            "scam_type": parsed_samples[i].get("scam_type", "n/a"),
            "language": parsed_samples[i].get("language", "n/a")
        })
    
    # Sort: errors first, then lowest uncertainty (closest to 0.5)
    all_examples_ranked.sort(key=lambda x: (not x["is_error"], x["uncertainty"]))
    top_15_examples = all_examples_ranked[:15]
    
    print("\n--- Top 15 Misclassified and Borderline Examples (OOF CV) ---")
    for rank, ex in enumerate(top_15_examples, start=1):
        status = "MISCLASSIFIED" if ex["is_error"] else "BORDERLINE"
        print(f"[{rank}] Line {ex['line']} ({status}) - True: {ex['true_label']}, Pred: {ex['pred_label']}, P(susp): {ex['prob_suspicious']:.4f}")
        print(f"    Text: {ex['text']}")

    # Step 11: Robustness check
    test_macro_f1 = clf_report["macro avg"]["f1-score"]
    print(f"\n--- STEP 11: Robustness Check ---")
    print(f"Test Set Macro F1: {test_macro_f1:.4f}")
    if test_macro_f1 > 0.97:
        print("WARNING: Macro F1 is > 0.97! Investigating shortcuts, leakage, and artificial separability.")

    # Export all audit data as JSON for artifact & report generation
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
        "label_counts": {k: int(v) for k, v in label_values.items()},
        "scam_type_counts": {k: int(v) for k, v in scam_type_counts.items()},
        "language_counts": {k: int(v) for k, v in lang_counts.items()},
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
        "near_duplicate_leaks_count": int(len(leaked_pairs)),
        "test_metrics": clf_report,
        "confusion_matrix": cm.tolist(),
        "cv_5fold_macro_f1_mean": float(np.mean(cv_macro_f1)),
        "cv_5fold_macro_f1_std": float(np.std(cv_macro_f1)),
        "cv_5fold_acc_mean": float(np.mean(cv_acc)),
        "cv_5fold_acc_std": float(np.std(cv_acc)),
        "top_suspicious_words": [(w, float(c)) for w, c in top_susp_words],
        "top_benign_words": [(w, float(c)) for w, c in top_benign_words],
        "privacy": {
            "phone_count": int(len(found_phones)),
            "upi_count": int(len(found_upis)),
            "email_count": int(len(found_emails)),
            "pan_count": int(len(found_pans)),
            "aadhaar_count": int(len(found_aadhaar))
        },
        "cv_misclassified": cv_misclassified,
        "top_15_examples": top_15_examples,
        "parsed_samples": parsed_samples
    }
    
    output_json_path = os.path.join(repo_root, "scripts", "audit", "audit_results.json")
    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(audit_data, f, indent=2, default=json_serializer)
    print(f"\nAudit results saved to {output_json_path}")

if __name__ == "__main__":
    audit()
