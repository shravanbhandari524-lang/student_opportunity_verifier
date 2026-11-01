"""services/classifier/app.py

FastAPI microservice exposing:
- GET /health -> { "status": "ok", "model_loaded": bool, "warning": str }
- POST /classify -> {
    "probability": float (0..1),
    "label": "suspicious" | "benign",
    "topTerms": list[str],
    "scamType": "scholarship_scam" | "recruitment_fraud" | ... | "unknown"
  }
Applies normalize_text (<URL>, <EMAIL>, <UPI>, <PHONE>) identically to training.
"""

import os
import re
import json
from typing import List
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import joblib

from services.classifier.normalize import normalize_text

app = FastAPI(title="Opportunity Verifier Classifier Service", version="0.2.0")

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model.joblib")
METRICS_PATH = os.path.join(os.path.dirname(__file__), "metrics.json")
model = None


def get_model():
    global model
    if model is None and os.path.exists(MODEL_PATH):
        try:
            model = joblib.load(MODEL_PATH)
        except Exception as e:
            print(f"Error loading model: {e}")
    return model


class ClassifyRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Message or offer text to classify")


class ClassifyResponse(BaseModel):
    probability: float = Field(..., ge=0.0, le=1.0)
    label: str = Field(..., pattern="^(suspicious|benign)$")
    topTerms: List[str] = Field(default_factory=list)
    scamType: str = Field(default="unknown")


@app.on_event("startup")
def startup():
    get_model()


@app.get("/health")
def health():
    m = get_model()
    warning = "Metrics not reportable. Pipeline validation only."
    provenance = "synthetic"
    real_row_count = 0

    if os.path.exists(METRICS_PATH):
        try:
            with open(METRICS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                warning = data.get("warning", warning)
                provenance = data.get("data_provenance", data.get("datasetProvenance", provenance))
                real_metrics = data.get("real_test_metrics", {})
                real_row_count = real_metrics.get("row_count", 0)
        except Exception:
            pass

    return {
        "status": "ok",
        "model_loaded": m is not None,
        "data_provenance": provenance,
        "datasetProvenance": provenance,
        "real_row_count": real_row_count,
        "warning": warning,
    }


def infer_scam_type(text: str, label: str) -> str:
    if label != "suspicious":
        return "unknown"
    t = text.lower()
    if "scholarship" in t or "olympiad" in t or "grant" in t:
        return "scholarship_scam"
    if "task" in t or "review" in t or "like" in t or "typing" in t or "data entry" in t or "vip" in t:
        return "task_scam"
    if "rent" in t and ("account" in t or "atm" in t or "sim" in t or "card" in t):
        return "mule_solicitation"
    if "intern" in t or "hire" in t or "job" in t or "placement" in t or "recruiter" in t or "offer letter" in t:
        return "recruitment_fraud"
    if "contest" in t or "won" in t or "prize" in t or "lucky draw" in t:
        return "contest_fraud"
    if "loan" in t or "credit" in t:
        return "loan_scam"
    return "generic_suspicious"


PLACEHOLDER_TOKENS = frozenset({"amt", "num", "url", "email", "phone"})


def is_placeholder_term(term: str) -> bool:
    """Check if term contains canonical placeholder tokens that do not appear verbatim in raw text."""
    words = [w.lower().strip("<>._-") for w in term.split()]
    for w in words:
        if w in PLACEHOLDER_TOKENS or (w.startswith("<") and w.endswith(">")):
            return True
    return False


def extract_top_terms(normalized_text: str, clf_pipeline, max_terms: int = 5) -> List[str]:
    """Extract top contributing positive terms from FeatureUnion or TfidfVectorizer,
    filtering out synthetic normalization placeholder tokens (<AMT>, <NUM>, etc.).
    """
    try:
        vec = clf_pipeline.named_steps.get("features") or clf_pipeline.named_steps.get("tfidf")
        clf = clf_pipeline.named_steps.get("clf")
        if not vec or not clf:
            return []

        feature_names = vec.get_feature_names_out()
        classes = list(clf.classes_)
        suspicious_idx = classes.index("suspicious")

        # Handle both raw LogisticRegression and CalibratedClassifierCV
        if hasattr(clf, "coef_"):
            coefs = clf.coef_[0]
            if suspicious_idx == 0:
                coefs = -coefs
        elif hasattr(clf, "calibrated_classifiers_"):
            sub_coefs = []
            for cc in clf.calibrated_classifiers_:
                est = getattr(cc, "estimator", None)
                if est is not None and hasattr(est, "coef_"):
                    c = est.coef_[0]
                    sub_coefs.append(-c if suspicious_idx == 0 else c)
            if sub_coefs:
                coefs = np.mean(sub_coefs, axis=0)
            else:
                return []
        else:
            return []

        X = vec.transform([normalized_text])
        non_zero_indices = X.nonzero()[1]

        scored_word_terms = []
        scored_fallback = []

        for idx in non_zero_indices:
            weight = coefs[idx]
            tfidf_val = X[0, idx]
            if weight > 0:
                feat = feature_names[idx]
                score = weight * tfidf_val
                # Clean prefix from FeatureUnion
                clean_term = re.sub(r"^(word|char)__", "", feat).strip()
                if not clean_term:
                    continue

                if feat.startswith("word__") or not feat.startswith("char__"):
                    scored_word_terms.append((clean_term, score))
                else:
                    scored_fallback.append((clean_term, score))

        # Prioritize word n-grams
        chosen = scored_word_terms if scored_word_terms else scored_fallback
        chosen.sort(key=lambda x: x[1], reverse=True)

        seen = set()
        unique = []
        for term, _ in chosen:
            if is_placeholder_term(term):
                continue
            t_lower = term.lower()
            if t_lower not in seen and len(t_lower) > 1:
                seen.add(t_lower)
                unique.append(term)
            if len(unique) >= max_terms:
                break

        # If no positive-weight non-placeholder terms were found, fallback to the strongest non-placeholder
        # n-grams present in the text sorted by contribution
        if not unique:
            all_candidate_terms = []
            for idx in non_zero_indices:
                feat = feature_names[idx]
                clean_term = re.sub(r"^(word|char)__", "", feat).strip()
                if not clean_term or is_placeholder_term(clean_term):
                    continue
                score = coefs[idx] * X[0, idx]
                all_candidate_terms.append((clean_term, score))

            all_candidate_terms.sort(key=lambda x: x[1], reverse=True)
            for term, _ in all_candidate_terms:
                t_lower = term.lower()
                if t_lower not in seen and len(t_lower) > 1:
                    seen.add(t_lower)
                    unique.append(term)
                if len(unique) >= max_terms:
                    break

        return unique
    except Exception:
        return []


@app.post("/classify", response_model=ClassifyResponse)
def classify(req: ClassifyRequest):
    m = get_model()
    if m is None:
        raise HTTPException(status_code=503, detail="Classifier model not loaded")

    raw_text = req.text.strip()
    if not raw_text:
        raise HTTPException(status_code=400, detail="Empty text provided")

    try:
        # Canonical normalization identically to train.py (capped at safe 5000 chars)
        normalized = normalize_text(raw_text)

        classes = list(m.classes_)
        suspicious_idx = classes.index("suspicious")
        proba = float(m.predict_proba([normalized])[0][suspicious_idx])
        label = "suspicious" if proba >= 0.50 else "benign"

        top_terms = extract_top_terms(normalized, m, max_terms=5) if label == "suspicious" else []
        scam_type = infer_scam_type(raw_text, label)

        return ClassifyResponse(
            probability=round(proba, 4),
            label=label,
            topTerms=top_terms,
            scamType=scam_type
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Classification failed: {str(e)}")
