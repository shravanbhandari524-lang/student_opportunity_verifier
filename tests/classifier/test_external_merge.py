"""tests/classifier/test_external_merge.py

Unit tests verifying integrity, validity, leakage-free isolation, and safety
of the curated external candidate datasets:
- services/classifier/data/external_train_candidates.csv
- services/classifier/data/external_real_holdout_candidates.csv
"""

import os
import csv
import re
from collections import Counter
import pytest
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA_DIR = os.path.join(REPO_ROOT, "services", "classifier", "data")

TRAIN_PATH = os.path.join(DATA_DIR, "external_train_candidates.csv")
HOLDOUT_PATH = os.path.join(DATA_DIR, "external_real_holdout_candidates.csv")
REAL_TEST_PATH = os.path.join(DATA_DIR, "real_test.csv")
MANIFEST_PATH = os.path.join(DATA_DIR, "external_audit_manifest.json")

EXPECTED_SCHEMA = [
    "text", "label", "scam_type", "language",
    "source_file", "source_type", "license_note", "group_id"
]
VALID_LABELS = {"benign", "suspicious"}
VALID_SOURCE_TYPES = {"real_advisory", "public_synthetic", "public_real_sms", "synthetic"}
VALID_LANGUAGES = {"en", "hi", "hinglish"}
VALID_GROUP_PREFIXES = ("GRP-STUDENT-", "GRP-INDFRAUD-", "GRP-ARCHIVE-", "GRP-SPAM-")

# Strict PII detection patterns
PHONE_REGEX = re.compile(
    r'(?:\+?91[\-\s]?)?[6-9]\d{4}[\-\s]?\d{5}\b|'
    r'\b0[6-9]\d{4}[\-\s]?\d{5}\b|'
    r'\b[6-9]\d{9}\b|'
    r'\b(?:\+?1[\-\s]?)?\(?\d{3}\)?[\-\s]?\d{3}[\-\s]?\d{4}\b|'
    r'\b(?:\+?44[\-\s]?)?07\d{3}[\-\s]?\d{6}\b'
)
EMAIL_REGEX = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b')
UPI_REGEX = re.compile(r'\b[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z0-9_-]{2,64}\b')
PAN_REGEX = re.compile(r'\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b')
AADHAAR_REGEX = re.compile(r'\b\d{4}\s\d{4}\s\d{4}\b')
RAW_ACC_REGEX = re.compile(r'\b(?=[0-9]*[0-9])[0-9]{12,18}\b')


def load_csv_strict_utf8(path):
    with open(path, "rb") as f:
        content = f.read()
    # Fails if invalid UTF-8
    decoded = content.decode("utf-8")
    assert "\ufffd" not in decoded, f"Replacement characters found in {path}"
    
    rows = []
    reader = csv.DictReader(decoded.splitlines())
    for r in reader:
        rows.append(r)
    return reader.fieldnames, rows


def test_utf8_validity_and_schema():
    """Verify both candidate CSVs are strictly valid UTF-8 and conform to schema."""
    for path in [TRAIN_PATH, HOLDOUT_PATH]:
        assert os.path.exists(path), f"File {path} does not exist!"
        fieldnames, rows = load_csv_strict_utf8(path)
        assert fieldnames == EXPECTED_SCHEMA, f"Schema mismatch in {path}: {fieldnames}"
        assert len(rows) > 0, f"File {path} is unexpectedly empty!"


def test_valid_labels_and_field_values():
    """Verify labels, source_types, languages, and group_ids adhere to project contracts."""
    for path in [TRAIN_PATH, HOLDOUT_PATH]:
        _, rows = load_csv_strict_utf8(path)
        for r in rows:
            assert r["label"] in VALID_LABELS, f"Invalid label '{r['label']}' in {path}"
            assert r["source_type"] in VALID_SOURCE_TYPES, f"Invalid source_type '{r['source_type']}' in {path}"
            assert r["language"] in VALID_LANGUAGES, f"Invalid language '{r['language']}' in {path}"
            assert r["group_id"].startswith(VALID_GROUP_PREFIXES), f"Invalid group_id '{r['group_id']}' in {path}"
            assert r["text"].strip() != "", f"Empty text encountered in {path}"


def test_no_overlap_with_real_test():
    """Verify ZERO exact or near-duplicate overlap with the held-out real_test.csv."""
    assert os.path.exists(REAL_TEST_PATH), "real_test.csv missing!"
    _, real_test_rows = load_csv_strict_utf8(REAL_TEST_PATH)
    real_test_texts = [r["text"].strip() for r in real_test_rows]

    _, train_rows = load_csv_strict_utf8(TRAIN_PATH)
    train_texts = [r["text"].strip() for r in train_rows]

    _, holdout_rows = load_csv_strict_utf8(HOLDOUT_PATH)
    holdout_texts = [r["text"].strip() for r in holdout_rows]

    # Exact string overlap
    assert len(set(train_texts).intersection(set(real_test_texts))) == 0, "Train exact overlap with real_test!"
    assert len(set(holdout_texts).intersection(set(real_test_texts))) == 0, "Holdout exact overlap with real_test!"

    # Near duplicate cosine > 0.90
    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=1)
    all_texts = train_texts + holdout_texts + real_test_texts
    X = vec.fit_transform(all_texts)

    n_tr = len(train_texts)
    n_ho = len(holdout_texts)
    X_tr = X[:n_tr]
    X_ho = X[n_tr:n_tr + n_ho]
    X_rt = X[n_tr + n_ho:]

    sim_tr_rt = X_tr.dot(X_rt.T)
    assert np.sum(sim_tr_rt > 0.90) == 0, f"Found {np.sum(sim_tr_rt > 0.90)} train near-dupes with real_test!"

    sim_ho_rt = X_ho.dot(X_rt.T)
    assert np.sum(sim_ho_rt > 0.90) == 0, f"Found {np.sum(sim_ho_rt > 0.90)} holdout near-dupes with real_test!"


def test_group_integrity_and_holdout_isolation():
    """Verify holdout and train candidates have zero group leakage, zero exact overlap, and zero near-duplicates."""
    _, train_rows = load_csv_strict_utf8(TRAIN_PATH)
    train_groups = set(r["group_id"] for r in train_rows)
    train_texts = [r["text"].strip() for r in train_rows]

    _, holdout_rows = load_csv_strict_utf8(HOLDOUT_PATH)
    holdout_groups = set(r["group_id"] for r in holdout_rows)
    holdout_texts = [r["text"].strip() for r in holdout_rows]

    # Group ID isolation
    group_overlap = train_groups.intersection(holdout_groups)
    assert len(group_overlap) == 0, f"Leaked group IDs between train and holdout: {group_overlap}"

    # Exact string overlap
    assert len(set(train_texts).intersection(set(holdout_texts))) == 0, "Exact overlap between train and holdout!"

    # Near duplicate cosine > 0.90
    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=1)
    X = vec.fit_transform(train_texts + holdout_texts)
    X_tr = X[:len(train_texts)]
    X_ho = X[len(train_texts):]
    sim_tr_ho = X_tr.dot(X_ho.T)
    assert np.sum(sim_tr_ho > 0.90) == 0, f"Found {np.sum(sim_tr_ho > 0.90)} near-duplicates between train and holdout!"


def test_source_caps():
    """Verify that dataset sources do not exceed declared caps."""
    _, train_rows = load_csv_strict_utf8(TRAIN_PATH)
    
    # spam.csv ham rows <= 300
    spam_rows = [r for r in train_rows if r["source_file"] == "spam.csv"]
    assert len(spam_rows) <= 300, f"spam.csv exceeded cap 300: got {len(spam_rows)}"
    assert all(r["label"] == "benign" for r in spam_rows), "spam.csv contains non-benign rows!"

    # archive rows <= 400
    archive_rows = [r for r in train_rows if r["source_file"] == "internet_scams_archive.csv"]
    assert len(archive_rows) <= 400, f"archive exceeded cap 400: got {len(archive_rows)}"

    # archive template cap <= 3 per template
    template_counts = Counter(r["group_id"] for r in archive_rows)
    max_template_count = max(template_counts.values()) if template_counts else 0
    assert max_template_count <= 3, f"Archive template exceeded max 3 per template: got {max_template_count}"

    # dataset.csv exactly 89 rows
    dataset_rows = [r for r in train_rows if r["source_file"] == "dataset.csv"]
    assert len(dataset_rows) == 89, f"dataset.csv expected 89 rows: got {len(dataset_rows)}"


def test_no_unmasked_pii():
    """Verify that all candidate texts have phone numbers, emails, UPIs, Aadhaar, and PAN masked."""
    for path in [TRAIN_PATH, HOLDOUT_PATH]:
        _, rows = load_csv_strict_utf8(path)
        for idx, r in enumerate(rows, 1):
            text = r["text"]
            # Check phone numbers
            phones = PHONE_REGEX.findall(text)
            assert len(phones) == 0, f"Unmasked phone {phones} in {path} row {idx}: {text}"
            
            # Check emails
            emails = EMAIL_REGEX.findall(text)
            assert len(emails) == 0, f"Unmasked email {emails} in {path} row {idx}: {text}"

            # Check UPI
            upis = UPI_REGEX.findall(text)
            assert len(upis) == 0, f"Unmasked UPI {upis} in {path} row {idx}: {text}"

            # Check Aadhaar
            aadhaars = AADHAAR_REGEX.findall(text)
            assert len(aadhaars) == 0, f"Unmasked Aadhaar {aadhaars} in {path} row {idx}: {text}"

            # Check PAN
            pans = PAN_REGEX.findall(text)
            assert len(pans) == 0, f"Unmasked PAN {pans} in {path} row {idx}: {text}"

            # Check raw account numbers
            raw_accs = RAW_ACC_REGEX.findall(text)
            assert len(raw_accs) == 0, f"Unmasked 12+ digit account {raw_accs} in {path} row {idx}: {text}"


def test_manifest_integrity():
    """Verify manifest file exists and matches output files."""
    assert os.path.exists(MANIFEST_PATH), "Manifest missing!"
    import json
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        m = json.load(f)
    assert "output_files" in m
    assert "external_train_candidates.csv" in m["output_files"]
    assert "external_real_holdout_candidates.csv" in m["output_files"]
    assert len(m["top_30_artifacts"]) == 30
