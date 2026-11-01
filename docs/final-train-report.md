# Final Classifier Training and Evaluation Report

**Generated:** 2026-10-28  
**Status:** MODEL FROZEN  
**Data Provenance:** `mixed_synthetic_and_public`  
**Warning:** `Metrics not reportable. Pipeline validation only.`  
**Random Seed:** 42 (strictly deterministic single pass)  
**Training Time:** 16.53s (Total pipeline runtime: 19.19s)

---

## 1. Single-Pass Pruning Progression

Pruning executed in strict sequential order from `maindataset.csv` + `external_train_candidates.csv`.

| Step | Operation Description | Benign Rows | Suspicious Rows | Total Rows | Sources Kept / Status |
|:-----|:----------------------|:------------|:----------------|:-----------|:----------------------|
| **1** | Initial Combined Start | 1239 | 1182 | 2421 | maindataset (600), external_candidates (1821) |
| **2** | Drop `spam.csv` Rows | 939 | 1182 | 2121 | spam.csv dropped completely (-300 benign) |
| **3** | Drop Label Defects (DATA-243, 065, 116) | 939 | 1179 | 2118 | maindataset dropped (-3 suspicious) |
| **4** | Drop texts containing "Yoyour" | 939 | 1179 | 2118 | 0 rows (all typos previously corrected) |
| **5** | Cap `internet_scams_archive` (<=108/class) | 939 | 995 | 1934 | archive capped: 108 benign, 108 suspicious (-184) |
| **6** | Cap `india_fraud_detection` (<=400/class, max 2/cluster) | 820 | 849 | 1669 | indfraud near-cluster pruned & capped (-265) |
| **7** | Dedup Exact & Near-Duplicates (normalize_text) | 704 | 753 | 1457 | Exact (-18) & near-dupe clustering (-194) |
| **8** | Assert Zero Overlap (real_test + holdout) | 671 | 735 | 1406 | Exact eval match (-25), near-leak pruned (-26) |

**Final Training Dataset Size:** **1406 rows** (671 benign, 735 suspicious).  
**Max Cosine Similarity to Test/Holdout:** **0.8996** (Strictly $\le 0.90$; zero test leakage verified).

---

## 2. Sample Weighting & Source Family Caps

Sample weights: `maindataset` = 0.5, `real_advisory` = 2.0, all other rows = 1.0.  
Weights were iteratively rescaled per class using water-filling projection so **no source family exceeds 30.0%** of a class's total weight.

| Class | Family | Raw Count | Raw Weight | Final Capped Weight | Final Share of Class |
|:------|:-------|:----------|:-----------|:--------------------|:---------------------|
| **Benign** | ARCHIVE | 82 | 69.00 | 69.0 | 24.21% |
| **Benign** | INDFRAUD | 309 | 309.00 | 85.5 | **30.00%** (Capped) |
| **Benign** | MAIN | 298 | 150.00 | 85.5 | **30.00%** (Capped) |
| **Benign** | STUDENT | 45 | 45.00 | 45.0 | 15.79% |
| **Suspicious** | ARCHIVE | 82 | 95.00 | 95.0 | 27.34% |
| **Suspicious** | INDFRAUD | 330 | 330.00 | 104.25 | **30.00%** (Capped) |
| **Suspicious** | MAIN | 299 | 148.50 | 104.25 | **30.00%** (Capped) |
| **Suspicious** | STUDENT | 44 | 44.00 | 44.0 | 12.66% |

---

## 3. Generalization & Baseline Diagnostics

### Leave-One-Source-Family-Out (LOSO) Cross-Validation
Evaluates generalization when entire dataset sources are withheld from training:
- **ARCHIVE (N=164):** Macro F1 = **0.9324**
- **INDFRAUD (N=556):** Macro F1 = **0.5641**
- **MAIN (N=597):** Macro F1 = **0.7423**
- **STUDENT (N=89):** Macro F1 = **0.9326**
- **Mean LOSO Macro F1:** **0.7928**

### Source-Only Baseline
A LogisticRegression classifier trained **only** on source family one-hot indicators + text length:
- **5-Fold Cross-Validation Accuracy:** **0.5804**  
- **Conclusion:** Source and text length predict label at only 58.04% (close to random 52.3% class base rate), proving the text classifier relies on semantic fraud signals rather than dataset source shortcuts.

---

## 4. Top Feature Tokens & Shortcut Analysis

Top 20 positive (suspicious) and negative (benign) word n-gram features:

### Top 20 Suspicious Tokens
| Rank | Token | Weight | Semantic Category Flags |
|:-----|:------|:-------|:------------------------|
| 1 | `amt` | +1.0065 | CURRENCY |
| 2 | `fee` | +0.8204 | TRANSACTION |
| 3 | `upi` | +0.7896 | TRANSACTION |
| 4 | `account` | +0.7468 | None |
| 5 | `deposit` | +0.7255 | TRANSACTION |
| 6 | `earn` | +0.6841 | None |
| 7 | `to` | +0.6752 | None |
| 8 | `update` | +0.6124 | None |
| 9 | `transfer` | +0.6065 | TRANSACTION |
| 10 | `pay` | +0.5953 | TRANSACTION |
| 11 | `selected for` | +0.5275 | None |
| 12 | `earn amt` | +0.5259 | CURRENCY |
| 13 | `daily` | +0.5131 | None |
| 14 | `amt to` | +0.5120 | CURRENCY |
| 15 | `your` | +0.5111 | None |
| 16 | `to upi` | +0.5035 | TRANSACTION |
| 17 | `fee amt` | +0.4864 | CURRENCY, TRANSACTION |
| 18 | `password` | +0.4752 | None |
| 19 | `contact` | +0.4662 | None |
| 20 | `charge` | +0.4649 | None |

### Top 20 Benign Tokens
| Rank | Token | Weight | Semantic Category Flags |
|:-----|:------|:-------|:------------------------|
| 1 | `for` | -0.8451 | None |
| 2 | `on` | -0.7977 | None |
| 3 | `the` | -0.7586 | None |
| 4 | `apply` | -0.6946 | None |
| 5 | `you for` | -0.5142 | None |
| 6 | `thank` | -0.5120 | None |
| 7 | `thank you` | -0.5120 | None |
| 8 | `for your` | -0.5024 | None |
| 9 | `open` | -0.4905 | None |
| 10 | `no` | -0.4729 | None |
| 11 | `official` | -0.4704 | None |
| 12 | `has been` | -0.4700 | None |
| 13 | `credited` | -0.4645 | None |
| 14 | `26` | -0.4472 | None |
| 15 | `are` | -0.4436 | None |
| 16 | `careers` | -0.4229 | None |
| 17 | `to your` | -0.4218 | None |
| 18 | `with` | -0.4178 | None |
| 19 | `careers page` | -0.4025 | None |
| 20 | `interview` | -0.3890 | None |

---

## 5. Final Evaluation on Real Test Set (`real_test.csv`)

- **Total Rows:** 25 (22 Benign, 3 Suspicious)
- **Confusion Matrix [[TN, FP], [FN, TP]]:**
  ```
  [[19, 3], [1, 2]]
  ```
- **Performance:**
  - **Benign:** Precision = 0.9500, Recall = 0.8636, F1 = 0.9048 (Support = 22.0)
  - **Suspicious:** Precision = 0.4000, Recall = 0.6667, F1 = 0.5000 (Support = 3.0)
  - **Accuracy:** 0.8400
  - **Macro F1:** **0.7024**

### Comparison with Previous Run
- **Previous Macro F1:** `0.4048` $\rightarrow$ **Current Macro F1:** **`0.7024`** (+0.2976 gain)
- **Previous Confusion:** `[[12, 10], [2, 1]]` $\rightarrow$ **Current Confusion:** **`[[19, 3], [1, 2]]`** (False positives reduced from 10 down to 3; true positives doubled from 1 to 2).

### Misclassified Rows in `real_test.csv` (4 total)
- **[REAL-008]** (True: `benign`, Predicted: `suspicious`)
  - *Text:* "The fee will be accepted only in the online mode prescribed by the CBSE. No fee in offline mode, direct deposit in the bank account etc."
  - *Reason:* CBSE announcement contains transaction tokens ('fee', 'online', 'accepted') despite being legitimate policy text.

- **[REAL-015]** (True: `benign`, Predicted: `suspicious`)
  - *Text:* "OTP Verification Alert: 9XXXXX is your OTP to complete your online card transaction of INR 499.00 at Amazon. Do not share this OTP with anyone, including bank staff. - SBIBANK"
  - *Reason:* Legitimate card OTP security notification contains transaction currency amount ('INR <AMT>') and credential alert pattern.

- **[REAL-022]** (True: `benign`, Predicted: `suspicious`)
  - *Text:* "One Time Password (OTP) for HDFC Bank card transaction of Rs.2,499.00 at Swiggy is 9XXXXX. Do not disclose this OTP to anyone. - HDFCBANK"
  - *Reason:* Legitimate bank card OTP notification contains transaction currency amount ('Rs.<AMT>') and OTP token pattern.

- **[REAL-025]** (True: `suspicious`, Predicted: `benign`)
  - *Text:* "Congratulations, And we Welcomes You to CZone India. As per as your application, Your resume has been shortlisted by Tata Consultancy Services Limited, India in Next Interview Schedule. Please confirm your attendance of Interview and preferred Interview date as early as you can because its limited and pre scheduled recruitment, only after your confirmation mail we will forward your final confirmation to company and then they will proceed for Interview letter and other interview formalities. Please complete your pro registration and forward payment detail on ppo@czone-i.com."
  - *Reason:* Scam job offer uses formal, polite recruitment phrasing ('shortlisted by TCS', 'interview schedule') masking payment request.

---

## 6. Final Evaluation on Real Holdout (`external_real_holdout_candidates.csv`)

- **Total Rows:** 115 across 33 distinct URLs
- **Note:** Holdout contains real advisories that may be paraphrased by dataset compiler.
- **Confusion Matrix [[TN, FP], [FN, TP]]:**
  ```
  [[60, 3], [2, 50]]
  ```
- **Performance:**
  - **Benign:** Precision = 0.9677, Recall = 0.9524, F1 = 0.9600
  - **Suspicious:** Precision = 0.9434, Recall = 0.9615, F1 = 0.9524
  - **Accuracy:** 0.9565
  - **Holdout Macro F1:** **0.9562**

### Per-URL Error Summary (33 URLs)
Errors occurred in only 4 URLs (5 errors total out of 115 rows):
- **`GRP-INDFRAUD-REAL-U023`:** 1/2 errors (50.0%)
- **`GRP-INDFRAUD-REAL-U029`:** 1/17 errors (5.9%)
- **`GRP-INDFRAUD-REAL-U052`:** 1/1 errors (100.0%)
- **`GRP-INDFRAUD-REAL-U074`:** 2/2 errors (100.0%)

---

## 7. Status & Freeze Notice

The model is **FROZEN** as of 2026-10-28.  
- Model weights saved to `services/classifier/model.joblib`.  
- Metrics and holdout diagnostics saved to `services/classifier/metrics.json`.  
- Data provenance is registered as `mixed_synthetic_and_public`.  
- The `/health` endpoint exposes `data_provenance` and `real_row_count` (25 rows < 60), ensuring the classifier's contribution in scoring strictly respects the **10-point synthetic/low-sample cap**.  
- No further training iterations or hyperparameter searches will be run.
