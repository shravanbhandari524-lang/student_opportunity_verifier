# Task Status: Classifier Formal Government Scholarship Scams

## 1. Identity
- Branch: feature/classifier-formal-scams
- Worktree: /home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM-g2
- Commits:
  - de0e988 feat(classifier): add 120 formal paired training examples and 60 independent held-out samples
  - a383b9d feat(classifier): retrain calibrated model on formal pairs and add top terms fallback

## 2. Reproduction and Root Cause Analysis
- Target Message: "Government of India – National Student Digital Empowerment Scholarship 2026 ... refundable document verification deposit of ₹799 is required to activate the scholarship ... Last date: 5 November 2026. Issued under the Department of Higher Education."
- Before Retraining: Probability = 0.1298 (12.98%, benign), Top Terms = []
- Nearest Training Rows (Cosine Similarity):
  1. INSPIRE scholarship genuine advisory (sim: 0.2561, p: 0.0002)
  2. State higher ed scholarship renewal (sim: 0.2345, p: 0.0004)
- Cause: Negative logistic regression weights for bureaucratic tokens ('word__the' -0.76, 'word__department' -0.24, 'word__india' -0.18) overpowered fee tokens ('word__deposit' +0.71, 'word__activate' +0.35) due to an imbalance of official announcements lacking matched fee-demanding counterparts.

## 3. Dataset Augmentation (final_train.csv)
- Added 120 balanced synthetic rows (60 formal scams + 60 matched genuine notices) to final_train.csv (total: 1,584 rows).
- Features matched: Ministry/department letterheads, official portal domains, verification/activation fees vs strictly free statutory disbursement notices.
- Provenance: Marked as source_type="synthetic" across all new rows with group IDs GRP-FORMAL-001 through GRP-FORMAL-060. The test message was not copied into training.

## 4. Independent Held-Out Evaluation (formal_held_out_eval.csv)
- Authored 60 independent evaluation rows (30 formal scams, 30 formal genuine notices) without template overlap.
- Note / Provenance: Marked as "synthetic, author-written, not evidence of accuracy" in metrics.json and evaluation logs.
- Results (eval_formal_held_out.py):
  - True Positives (TP): 30 / 30
  - True Negatives (TN): 30 / 30
  - False Positives (FP): 0 / 30
  - False Negatives (FN): 0 / 30
  - Accuracy: 1.0000, Macro F1: 1.0000, Confusion Matrix: [[30, 0], [0, 30]]

## 5. Model Calibration and Retraining
- Retrained with CalibratedClassifierCV(base_lr, method="sigmoid", cv=5) over FeatureUnion(word 1-2 + char 2-5).
- Target Message After Retraining: Probability = 0.8212 (82.12%, suspicious), Top Terms = ['deposit', 'activate', 'to', 'to activate', 'verification', 'refundable', 'document', 'verification deposit', 'deposit of', 'last']
- Never-Empty TopTerms Fallback: If positive-weight non-placeholder terms are empty after filtering placeholders, app.py falls back to the highest contributing non-placeholder n-grams.
- Scoring Cap & Provenance: metrics.json retains "data_provenance": "mixed_synthetic_and_public" and warning "Metrics not reportable. Pipeline validation only.", preserving the 10-point scoring cap.

## 6. Verification
- Python Pytest: 13 passed in 4.43s (services/classifier/tests/test_classifier.py)
- Node Classifier Tests: 36 passed in 475ms (tests/classifier.test.js, tests/agents-classifier-client.test.js)
- Base Agent & Conformance: 20 passed in 102ms (tests/agents-base.test.js)
- ESLint: Clean pass (0 errors, 0 warnings)
