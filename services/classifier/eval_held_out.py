"""services/classifier/eval_held_out.py

Evaluates the frozen classifier model on the independent held-out evaluation dataset
(services/classifier/data/held_out_eval.csv) of 30 fresh hard negatives and 30 fresh scams.

Does NOT modify or retrain the model.
"""

import csv
import sys
import joblib
from pathlib import Path
from normalize import normalize_text

def run_evaluation():
    base_dir = Path(__file__).resolve().parent
    model_path = base_dir / "model.joblib"
    data_path = base_dir / "data" / "held_out_eval.csv"

    if not model_path.exists():
        print(f"Error: Model not found at {model_path}")
        sys.exit(1)

    if not data_path.exists():
        print(f"Error: Dataset not found at {data_path}")
        sys.exit(1)

    model = joblib.load(model_path)
    
    rows = []
    with open(data_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows.append(r)

    classes = list(model.classes_)
    suspicious_idx = classes.index("suspicious")

    benign_count = sum(1 for r in rows if r["label"] == "benign")
    suspicious_count = sum(1 for r in rows if r["label"] == "suspicious")

    print(f"Loaded held-out evaluation dataset: {len(rows)} rows ({benign_count} benign, {suspicious_count} suspicious)")
    print(f"Model classes: {classes}")

    tp = 0
    tn = 0
    fp = 0
    fn = 0

    fps = []
    fns = []

    for row in rows:
        text = str(row["text"])
        label = str(row["label"])
        norm_text = normalize_text(text)

        proba = float(model.predict_proba([norm_text])[0][suspicious_idx])
        pred = "suspicious" if proba >= 0.50 else "benign"

        if label == "suspicious" and pred == "suspicious":
            tp += 1
        elif label == "benign" and pred == "benign":
            tn += 1
        elif label == "benign" and pred == "suspicious":
            fp += 1
            fps.append((row["id"], text, proba))
        elif label == "suspicious" and pred == "benign":
            fn += 1
            fns.append((row["id"], text, proba))

    total = len(rows)
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
    accuracy = (tp + tn) / total

    # Macro F1
    prec_benign = tn / (tn + fn) if (tn + fn) > 0 else 0.0
    rec_benign = tn / (tn + fp) if (tn + fp) > 0 else 0.0
    f1_benign = 2 * prec_benign * rec_benign / (prec_benign + rec_benign) if (prec_benign + rec_benign) > 0 else 0.0
    macro_f1 = (f1 + f1_benign) / 2.0

    print("\n================ HELD-OUT EVALUATION RESULTS ================")
    print(f"Total Evaluated: {total}")
    print(f"True Positives (TP):  {tp:2d} / 30")
    print(f"True Negatives (TN):  {tn:2d} / 30")
    print(f"False Positives (FP): {fp:2d} / 30")
    print(f"False Negatives (FN): {fn:2d} / 30")
    print(f"Accuracy:             {accuracy:.4f} ({accuracy*100:.1f}%)")
    print(f"Precision:            {precision:.4f}")
    print(f"Recall:               {recall:.4f}")
    print(f"F1 (suspicious):      {f1:.4f}")
    print(f"Macro F1:             {macro_f1:.4f}")
    print(f"Confusion Matrix:     [[{tn}, {fp}], [{fn}, {tp}]]")

    if fps:
        print("\n--- False Positives (Benign scored as Suspicious) ---")
        for row_id, text, proba in fps:
            print(f"[{row_id}] (p={proba:.4f}): {text[:90]}...")

    if fns:
        print("\n--- False Negatives (Suspicious scored as Benign) ---")
        for row_id, text, proba in fns:
            print(f"[{row_id}] (p={proba:.4f}): {text[:90]}...")

    print("=============================================================\n")

if __name__ == "__main__":
    run_evaluation()
