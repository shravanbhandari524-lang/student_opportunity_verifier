import os
import csv
import numpy as np
from sklearn.pipeline import Pipeline, FeatureUnion
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.metrics import precision_recall_fscore_support, accuracy_score

from services.classifier.normalize import normalize_text
from services.classifier.train import load_dataset_records, RANDOM_SEED

def evaluate_variant(norm_texts, labels, super_groups, weights, word_min_df=1, C=1.0, class_weight=None):
    sgkf = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED)
    macro_f1s = []
    accuracies = []

    for fold, (train_idx, val_idx) in enumerate(sgkf.split(norm_texts, labels, super_groups), start=1):
        pipe = Pipeline([
            ("features", FeatureUnion([
                ("word", TfidfVectorizer(ngram_range=(1, 2), analyzer="word", sublinear_tf=True, min_df=word_min_df, lowercase=True)),
                ("char", TfidfVectorizer(ngram_range=(2, 5), analyzer="char", sublinear_tf=True, min_df=1, lowercase=True))
            ])),
            ("clf", LogisticRegression(random_state=RANDOM_SEED, C=C, class_weight=class_weight, max_iter=500))
        ])

        X_train_f = [norm_texts[i] for i in train_idx]
        y_train_f = [labels[i] for i in train_idx]
        w_train_f = [weights[i] for i in train_idx]

        X_val_f = [norm_texts[i] for i in val_idx]
        y_val_f = [labels[i] for i in val_idx]

        pipe.fit(X_train_f, y_train_f, clf__sample_weight=w_train_f)
        val_preds = pipe.predict(X_val_f)

        _, _, macro_f1, _ = precision_recall_fscore_support(y_val_f, val_preds, average="macro", zero_division=0)
        acc = accuracy_score(y_val_f, val_preds)

        macro_f1s.append(macro_f1)
        accuracies.append(acc)

    return float(np.mean(macro_f1s)), float(np.std(macro_f1s)), float(np.mean(accuracies)), float(np.std(accuracies))

def main():
    data_dir = "services/classifier/data"
    _, records = load_dataset_records(data_dir)
    print(f"Loaded {len(records)} records.")

    # Re-normalize with new normalize_text
    norm_texts = [normalize_text(r["text"]) for r in records]
    labels = [r["label"] for r in records]
    super_groups = [r["super_group"] for r in records]
    weights = [1.0] * len(records)

    variants = [
        ("Current Settings (Baseline: C=1.0, min_df=1, class_weight=None)", 1, 1.0, None),
        ("C=0.1, min_df=1, class_weight=None", 1, 0.1, None),
        ("C=0.3, min_df=1, class_weight=None", 1, 0.3, None),
        ("C=1.0, min_df=1, class_weight=None", 1, 1.0, None),
        ("C=1.0, min_df=2 (word), class_weight=None", 2, 1.0, None),
        ("C=1.0, min_df=1, class_weight='balanced'", 1, 1.0, "balanced"),
        ("C=0.3, min_df=2 (word), class_weight=None", 2, 0.3, None),
        ("C=0.1, min_df=2 (word), class_weight=None", 2, 0.1, None),
        ("C=0.3, min_df=1, class_weight='balanced'", 1, 0.3, "balanced"),
        ("C=0.1, min_df=1, class_weight='balanced'", 1, 0.1, "balanced"),
        ("C=0.3, min_df=2 (word), class_weight='balanced'", 2, 0.3, "balanced"),
        ("C=1.0, min_df=2 (word), class_weight='balanced'", 2, 1.0, "balanced"),
    ]

    print("\n--- Model Settings Comparison (Grouped 5-Fold CV on Training Data Only) ---")
    results = []
    for name, min_df, c_val, cw in variants:
        f1_mean, f1_std, acc_mean, acc_std = evaluate_variant(
            norm_texts, labels, super_groups, weights,
            word_min_df=min_df, C=c_val, class_weight=cw
        )
        print(f"{name:55s} | Macro F1: {f1_mean:.4f} +/- {f1_std:.4f} | Acc: {acc_mean:.4f} +/- {acc_std:.4f}")
        results.append((f1_mean, f1_std, acc_mean, acc_std, name, min_df, c_val, cw))

    results.sort(key=lambda x: (x[0], -x[1]), reverse=True)
    best = results[0]
    print(f"\nBest variant by Grouped CV: {best[4]}")
    print(f"Macro F1: {best[0]:.4f} +/- {best[1]:.4f}")

if __name__ == "__main__":
    main()
