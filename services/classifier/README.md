# Opportunity Verifier - Classifier Microservice

Lightweight scikit-learn and FastAPI microservice that analyzes message/offer text and provides:
1. `probability`: float between 0.0 and 1.0 indicating likelihood of scam/fraud.
2. `label`: `"suspicious"` or `"benign"`.
3. `topTerms`: N-gram features that contributed most heavily towards the suspicious classification.
4. `scamType`: Inferred opportunity scam category (e.g. scholarship scam, task scam, mule solicitation, etc.).

## Model Architecture
- **Features**: TF-IDF vectorizer extracting sublinear word n-grams (1, 2) and lowercase tokens.
- **Classifier**: Logistic Regression with L2 regularization (`C=1.0`, random seed 42).
- **Training Artifacts**:
  - `model.joblib`: Serialized trained model pipeline.
  - `metrics.json`: Train/test evaluation metrics and confusion matrix.

## Endpoints
- `GET /health`: Returns `{ "status": "ok", "model_loaded": true }`
- `POST /classify`: Payload `{ "text": "..." }` returning zod-compatible `ClassifierResult` shape.

## Commands
```bash
# Setup virtual environment
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Train model
python train.py

# Run unit tests
PYTHONPATH=. pytest tests/

# Serve service
uvicorn app:app --host 0.0.0.0 --port 8000
```
