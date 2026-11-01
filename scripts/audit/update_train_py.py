with open("services/classifier/train.py", "r", encoding="utf-8") as f:
    content = f.read()

start_marker = "    # 5. TOP 20 PREDICTIVE TOKENS"
end_marker = 'if __name__ == "__main__":'

pos_start = content.find(start_marker)
pos_end = content.find(end_marker)

assert pos_start != -1, "start_marker not found"
assert pos_end != -1, "end_marker not found"

replacement = """    # 5. TOP 30 PREDICTIVE TOKENS & SHORTCUT AUDIT
    union_features = prod_pipe.named_steps["features"]
    feature_names = union_features.get_feature_names_out()
    coefs = prod_pipe.named_steps["clf"].coef_[0]
    classes = list(prod_pipe.named_steps["clf"].classes_)
    susp_idx = classes.index("suspicious")
    if susp_idx == 0:
        coefs = -coefs

    top_susp_idx = np.argsort(coefs)[-30:][::-1]
    top_benign_idx = np.argsort(coefs)[:30]

    flagged_terms = ["rs", "upi", "000", "transfer", "candidate", "daily", "ke liye", "fakebank", "example", "invalid", "test"]
    flagged_in_top_30_scam = []
    flagged_in_top_30_benign = []

    print("\\n=== TOP 30 PREDICTIVE TOKENS FOR SUSPICIOUS (SCAM) ===")
    top_suspicious_tokens = []
    for i in top_susp_idx:
        feat = feature_names[i]
        weight = float(coefs[i])
        clean_token = re.sub(r"^(word|char)__", "", feat)
        top_suspicious_tokens.append({"feature": feat, "token": clean_token, "weight": round(weight, 4)})
        print(f"  +{weight:.4f} : {feat} ('{clean_token}')")

        for ft in flagged_terms:
            if ft == clean_token.lower() or f" {ft} " in f" {clean_token.lower()} ":
                flagged_in_top_30_scam.append({"token": clean_token, "flagged_term": ft, "weight": round(weight, 4)})

    print("\\n=== TOP 30 PREDICTIVE TOKENS FOR BENIGN (GENUINE) ===")
    top_benign_tokens = []
    for i in top_benign_idx:
        feat = feature_names[i]
        weight = float(coefs[i])
        clean_token = re.sub(r"^(word|char)__", "", feat)
        top_benign_tokens.append({"feature": feat, "token": clean_token, "weight": round(weight, 4)})
        print(f"  {weight:.4f} : {feat} ('{clean_token}')")

        for ft in flagged_terms:
            if ft == clean_token.lower() or f" {ft} " in f" {clean_token.lower()} ":
                flagged_in_top_30_benign.append({"token": clean_token, "flagged_term": ft, "weight": round(weight, 4)})

    print("\\n--- TOKEN SHORTCUT & BOILERPLATE CHECK (TOP 30) ---")
    if flagged_in_top_30_scam:
        print(f"Flagged shortcuts/boilerplate in Top 30 Suspicious ({len(flagged_in_top_30_scam)}):")
        for item in flagged_in_top_30_scam:
            print(f"  - '{item['token']}' (matched: '{item['flagged_term']}', weight: +{item['weight']})")
    else:
        print("Zero flagged shortcuts/boilerplate in Top 30 Suspicious!")

    if flagged_in_top_30_benign:
        print(f"Flagged shortcuts/boilerplate in Top 30 Benign ({len(flagged_in_top_30_benign)}):")
        for item in flagged_in_top_30_benign:
            print(f"  - '{item['token']}' (matched: '{item['flagged_term']}', weight: {item['weight']})")
    else:
        print("Zero flagged shortcuts/boilerplate in Top 30 Benign!")

    training_duration = time.time() - start_time
    print(f"\\nTotal training run time: {training_duration:.2f} seconds")

    # 6. METRICS ARTIFACT
    is_real_reportable = real_test_metrics is not None and real_test_metrics.get("row_count", 0) >= 60
    final_provenance = "real" if is_real_reportable else "synthetic"
    final_warning = None if is_real_reportable else warning_msg

    metrics = {
        "data_provenance": final_provenance,
        "datasetProvenance": final_provenance,
        "warning": final_warning,
        "dataset_source": os.path.basename(source_path),
        "dataset_size": len(records),
        "synthetic_count": len(synthetic_records),
        "real_count": len(real_records),
        "unified_super_groups_count": len(set(super_groups)),
        "normalization_applied": True,
        "normalized_tokens": ["<URL>", "<EMAIL>", "<UPI>", "<PHONE>", "<AMT>", "<NUM>"],
        "model_settings": {
            "C": 1.0,
            "class_weight": "balanced",
            "word_min_df": 1,
            "char_min_df": 1,
            "ngram_word": [1, 2],
            "ngram_char": [2, 5],
        },
        "cv_5fold_grouped": {
            "macro_f1_mean": mean_macro_f1,
            "macro_f1_std": std_macro_f1,
            "accuracy_mean": mean_acc,
            "accuracy_std": std_acc,
            "per_fold_macro_f1": [float(f) for f in cv_macro_f1s],
            "per_fold_accuracy": [float(a) for a in cv_accuracies],
        },
        "test_set_metrics": test_metrics,
        "top_suspicious_tokens": top_suspicious_tokens,
        "top_benign_tokens": top_benign_tokens,
        "flagged_shortcuts_in_top_30": {
            "suspicious": flagged_in_top_30_scam,
            "benign": flagged_in_top_30_benign,
        },
        "training_time_seconds": round(training_duration, 2),
    }

    if real_test_metrics is not None:
        metrics["real_test_metrics"] = real_test_metrics

    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    print(f"\\nMetrics saved to {metrics_path}")


"""

new_content = content[:pos_start] + replacement + content[pos_end:]

with open("services/classifier/train.py", "w", encoding="utf-8") as f:
    f.write(new_content)

print("SUCCESS: services/classifier/train.py updated cleanly!")
