"""services/classifier/tests/test_classifier.py

Unit and integration tests for FastAPI app and classification logic.
"""

import os
import csv
import tempfile
from fastapi.testclient import TestClient
from services.classifier.app import app, get_model
from services.classifier.normalize import normalize_text
from services.classifier.train import evaluate_real_test_set

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["model_loaded"] is True
    assert data["data_provenance"] in ("synthetic", "mixed_synthetic_and_public")
    assert data["datasetProvenance"] in ("synthetic", "mixed_synthetic_and_public")
    assert "warning" in data
    assert "Metrics not reportable" in data["warning"] or "Pipeline validation only" in data["warning"]


def test_classify_suspicious_text():
    response = client.post("/classify", json={
        "text": "Congratulations! You won scholarship of Rs 50000. Send registration fee Rs 1500 to scholarship@fakebank."
    })
    assert response.status_code == 200
    data = response.json()
    assert data["label"] == "suspicious"
    assert data["probability"] >= 0.50
    assert len(data["topTerms"]) > 0
    assert data["scamType"] == "scholarship_scam"


def test_classify_benign_text():
    response = client.post("/classify", json={
        "text": "Please return the library book borrowed on Monday to avoid late fee. Check portal."
    })
    assert response.status_code == 200
    data = response.json()
    assert data["label"] == "benign"
    assert data["probability"] < 0.50
    assert data["scamType"] == "unknown"


def test_scam_offer_with_payment_instruction_after_char_450():
    # Long formal preamble > 450 chars before the scam payment demand
    long_scam_offer = (
        "Congratulations, and we welcome you to the National Talent Recruitment Programme. "
        "As per your application submitted through the student employment exchange portal, "
        "your profile has been shortlisted for the final onboarding stage by the technical panel. "
        "You are required to confirm your joining availability for the upcoming orientation schedule. "
        "Failure to confirm will result in cancellation of your candidacy. "
        "Please complete mandatory pro registration by paying a refundable verification fee of Rs 1,500 "
        "via UPI to registration-desk@fakebank before the deadline."
    )
    assert len(long_scam_offer) > 450
    assert "refundable verification fee of Rs 1,500" in long_scam_offer[450:]
    response = client.post("/classify", json={"text": long_scam_offer})
    assert response.status_code == 200
    data = response.json()
    assert data["label"] == "suspicious"
    assert data["probability"] >= 0.50


def test_placeholder_tokens_filtered_from_top_terms():
    text = "Selected for scholarship award of Rs 50,000. Pay refundable registration fee of Rs 1,500 immediately."
    response = client.post("/classify", json={"text": text})
    assert response.status_code == 200
    data = response.json()
    assert data["label"] == "suspicious"
    assert len(data["topTerms"]) > 0
    for term in data["topTerms"]:
        words = [w.lower().strip("<>") for w in term.split()]
        assert "amt" not in words, f"Found placeholder 'amt' in topTerm: {term}"
        assert "num" not in words, f"Found placeholder 'num' in topTerm: {term}"
        assert "url" not in words, f"Found placeholder 'url' in topTerm: {term}"


def test_classify_empty_text():
    response = client.post("/classify", json={"text": "   "})
    assert response.status_code == 400


def test_normalization_tokens():
    raw = "Pay Rs 500 to student-aid@fakebank at https://portal.example/pay or call +91 9876543210 or email test@example.com"
    norm = normalize_text(raw)
    assert "<UPI>" in norm
    assert "<URL>" in norm
    assert "<PHONE>" in norm
    assert "<EMAIL>" in norm
    assert "<AMT>" in norm
    assert "fakebank" not in norm
    assert "9876543210" not in norm


def test_normalization_currency_amounts():
    cases = [
        ("Pay Rs 500 fee", "Pay <AMT> fee"),
        ("Due is Rs. 1,250.00 today", "Due is <AMT> today"),
        ("Credited with INR 15,000.00 on 28-10-26", "Credited with <AMT> on 28-10-26"),
        ("Registration fee is ₹1000 only", "Registration fee is <AMT> only"),
        ("Security deposit ₹ 5,000/- refundable", "Security deposit <AMT> refundable"),
        ("Offered 24400 RS per month", "Offered <AMT> per month"),
    ]
    for raw, expected in cases:
        assert normalize_text(raw) == expected


def test_normalization_masked_patterns():
    cases = [
        ("Account XXXXXX1234 credited", "Account <NUM> credited"),
        ("OTP Verification: 9XXXXX is your code", "OTP Verification: <NUM> is your code"),
        ("If not done by you, call 1800-XXX-XXXX immediately", "If not done by you, call <NUM> immediately"),
        ("Balance in A/c XX5678 is available", "Balance in A/c <NUM> is available"),
    ]
    for raw, expected in cases:
        assert normalize_text(raw) == expected


def test_normalization_standalone_numbers():
    cases = [
        ("Transferred 50,000 into wallet", "Transferred <NUM> into wallet"),
        ("Deadline for year 2026 applications", "Deadline for year <NUM> applications"),
        ("Only 12 seats left out of 100", "Only 12 seats left out of <NUM>"),
    ]
    for raw, expected in cases:
        assert normalize_text(raw) == expected


def test_evaluate_real_test_set_optional_loader():
    model = get_model()
    assert model is not None

    with tempfile.TemporaryDirectory() as tmpdir:
        # Case 1: real_test.csv does not exist -> returns None (skips silently)
        assert evaluate_real_test_set(model, tmpdir) is None

        # Case 2: real_test.csv exists but fewer than 30 rows -> returns None (skips silently)
        csv_path = os.path.join(tmpdir, "real_test.csv")
        with open(csv_path, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["text", "label", "source_url", "source_type"])
            w.writeheader()
            for i in range(10):
                w.writerow({
                    "text": f"Sample message {i}",
                    "label": "benign" if i % 2 == 0 else "suspicious",
                    "source_url": "https://pib.gov.in/test",
                    "source_type": "real"
                })
        assert evaluate_real_test_set(model, tmpdir) is None

        # Case 3: real_test.csv exists with >= 30 real rows -> returns metrics dictionary
        with open(csv_path, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["text", "label", "source_url", "source_type"])
            w.writeheader()
            for i in range(35):
                lbl = "benign" if i % 2 == 0 else "suspicious"
                txt = f"Department announcement {i}" if lbl == "benign" else f"Selected for grant {i}. Pay Rs 500 to UPI"
                w.writerow({
                    "text": txt,
                    "label": lbl,
                    "source_url": "https://pib.gov.in/alert",
                    "source_type": "real"
                })

        metrics = evaluate_real_test_set(model, tmpdir)
        assert metrics is not None
        assert metrics["row_count"] == 35
        assert "benign" in metrics
        assert "suspicious" in metrics
        assert "precision" in metrics["benign"]
        assert "recall" in metrics["suspicious"]
        assert "confusion_matrix" in metrics


def test_formal_government_scholarship_scam_scores_suspicious():
    test_msg = (
        "Government of India – National Student Digital Empowerment Scholarship 2026 ... "
        "refundable document verification deposit of ₹799 is required to activate the scholarship ... "
        "Last date: 5 November 2026. Issued under the Department of Higher Education."
    )
    response = client.post("/classify", json={"text": test_msg})
    assert response.status_code == 200
    data = response.json()
    assert data["label"] == "suspicious"
    assert data["probability"] >= 0.50
    assert len(data["topTerms"]) > 0
    assert any(term in ("deposit", "activate", "verification", "refundable") for term in data["topTerms"])


def test_top_terms_never_empty_on_suspicious():
    # Suspicious message where key features include amounts: topTerms should still be populated
    # with strongest non-placeholder n-grams and never empty.
    test_msg = "Pay Rs 500 immediately to unlock account and deposit fee Rs 1000"
    response = client.post("/classify", json={"text": test_msg})
    assert response.status_code == 200
    data = response.json()
    assert data["label"] == "suspicious"
    assert isinstance(data["topTerms"], list)
    assert len(data["topTerms"]) > 0
    for term in data["topTerms"]:
        assert "<AMT>" not in term
        assert "<NUM>" not in term


