"""services/classifier/eval_formal_held_out.py

Evaluates the trained classifier model on services/classifier/data/formal_held_out_eval.csv
(30 formal scams, 30 formal genuine notices).
Does NOT tune or train the model.
"""

import os
import csv
import sys
from pathlib import Path
import joblib
import numpy as np

base_dir = Path(__file__).resolve().parent
repo_root = base_dir.parent.parent
sys.path.insert(0, str(repo_root))
sys.path.insert(0, str(base_dir))

from normalize import normalize_text
from sklearn.metrics import confusion_matrix, classification_report

def main():
    model_path = base_dir / "model.joblib"
    data_path = base_dir / "data" / "formal_held_out_eval.csv"

    if not model_path.exists():
        print(f"Error: model not found at {model_path}")
        sys.exit(1)
    if not data_path.exists():
        print(f"Error: dataset not found at {data_path}")
        sys.exit(1)

    model = joblib.load(model_path)
    classes = list(model.classes_)
    susp_idx = classes.index("suspicious")

    rows = []
    with open(data_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows.append(r)

    print(f"Evaluating {len(rows)} independent formal held-out rows...")

    y_true = [r["label"] for r in rows]
    probs = []
    y_pred = []

    for r in rows:
        norm = normalize_text(r["text"])
        p = float(model.predict_proba([norm])[0][susp_idx])
        probs.append(p)
        y_pred.append("suspicious" if p >= 0.50 else "benign")

    target_names = ["benign", "suspicious"]
    cm = confusion_matrix(y_true, y_pred, labels=target_names)
    rep = classification_report(y_true, y_pred, target_names=target_names, output_dict=True, zero_division=0)

    tp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == "suspicious" and yp == "suspicious")
    tn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == "benign" and yp == "benign")
    fp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == "benign" and yp == "suspicious")
    fn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == "suspicious" and yp == "benign")

    print("\n================ FORMAL HELD-OUT EVALUATION ================")
    print(f"Total Rows:           {len(rows)} (30 benign, 30 suspicious)")
    print(f"True Positives (TP):  {tp:2d} / 30")
    print(f"True Negatives (TN):  {tn:2d} / 30")
    print(f"False Positives (FP): {fp:2d} / 30")
    print(f"False Negatives (FN): {fn:2d} / 30")
    print(f"Accuracy:             {rep['accuracy']:.4f} ({rep['accuracy']*100:.1f}%)")
    print(f"Macro F1:             {rep['macro avg']['f1-score']:.4f}")
    print(f"Confusion Matrix:     {cm.tolist()}")

    fps = [(r["id"], r["text"], p) for r, p, yt, yp in zip(rows, probs, y_true, y_pred) if yt == "benign" and yp == "suspicious"]
    fns = [(r["id"], r["text"], p) for r, p, yt, yp in zip(rows, probs, y_true, y_pred) if yt == "suspicious" and yp == "benign"]

    if fps:
        print("\n--- False Positives ---")
        for rid, txt, p in fps:
            print(f"[{rid}] (p={p:.4f}): {txt[:90]}...")
    if fns:
        print("\n--- False Negatives ---")
        for rid, txt, p in fns:
            print(f"[{rid}] (p={p:.4f}): {txt[:90]}...")

    print("============================================================\n")

if __name__ == "__main__":
    main()
