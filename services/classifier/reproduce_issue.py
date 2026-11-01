import csv
import sys
from pathlib import Path

base_dir = Path(__file__).resolve().parent
repo_root = base_dir.parent.parent
sys.path.insert(0, str(repo_root))
sys.path.insert(0, str(base_dir))

import joblib
import numpy as np
from normalize import normalize_text
from sklearn.metrics.pairwise import cosine_similarity

test_message = "Government of India – National Student Digital Empowerment Scholarship 2026 ... refundable document verification deposit of ₹799 is required to activate the scholarship ... Last date: 5 November 2026. Issued under the Department of Higher Education."

base_dir = Path(__file__).resolve().parent
model_path = base_dir / "model.joblib"
train_path = base_dir / "data" / "final_train.csv"

model = joblib.load(model_path)
classes = list(model.classes_)
suspicious_idx = classes.index("suspicious")

norm_msg = normalize_text(test_message)
print("--- TEST MESSAGE ---")
print(test_message)
print("\n--- NORMALIZED ---")
print(norm_msg)

proba = float(model.predict_proba([norm_msg])[0][suspicious_idx])
label = "suspicious" if proba >= 0.5 else "benign"
print(f"\n--- PREDICTION ---")
print(f"Probability: {proba:.4f} ({proba*100:.2f}%)")
print(f"Label: {label}")

# Top terms via app's logic
import app
top_terms = app.extract_top_terms(norm_msg, model, max_terms=10)
print(f"Top Terms: {top_terms}")

# Nearest training rows by TF-IDF cosine similarity
train_rows = []
with open(train_path, "r", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for r in reader:
        train_rows.append(r)

train_texts = [normalize_text(r["text"]) for r in train_rows]

# Get the vectorizer from the pipeline
features_step = model.named_steps["features"]

test_vec = features_step.transform([norm_msg])
train_vecs = features_step.transform(train_texts)

sims = cosine_similarity(test_vec, train_vecs)[0]
top_sim_indices = np.argsort(sims)[::-1][:10]

print("\n--- TOP 10 NEAREST TRAINING ROWS BY TF-IDF SIMILARITY ---")
for rank, idx in enumerate(top_sim_indices, 1):
    r = train_rows[idx]
    row_proba = float(model.predict_proba([train_texts[idx]])[0][suspicious_idx])
    print(f"{rank}. [Sim: {sims[idx]:.4f}] [True: {r['label']}, Pred Proba: {row_proba:.4f}] [ID: {r.get('id', 'N/A')}]")
    print(f"   Text: {r['text'][:140]}...")
    print(f"   Source: {r.get('source_name', 'N/A')} | Provenance: {r.get('source_type', 'N/A')}")
