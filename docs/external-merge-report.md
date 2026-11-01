# External Datasets Merge & Curation Report

**Date:** 28 October 2026  
**Auditor:** Antigravity (AI Systems & Evaluation)  
**Execution Policy:** Deterministic curation pipeline, fixed seed `42`, empirical command output only  
**Curation Script:** [`scripts/audit/build_merged_external_dataset.py`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/scripts/audit/build_merged_external_dataset.py)  
**Audit Manifest:** [`services/classifier/data/external_audit_manifest.json`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/services/classifier/data/external_audit_manifest.json)  
**Generated Candidate Datasets:**
- Training Candidates: [`services/classifier/data/external_train_candidates.csv`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/services/classifier/data/external_train_candidates.csv) (1,821 rows)
- Real Holdout Candidates: [`services/classifier/data/external_real_holdout_candidates.csv`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/services/classifier/data/external_real_holdout_candidates.csv) (115 rows)
**Test Suite:** [`tests/classifier/test_external_merge.py`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/tests/classifier/test_external_merge.py) (7 passing unit tests)

---

## 1. Executive Summary & Outputs

In accordance with user specifications, this pipeline ingested four external candidate sources (`dataset.csv`, `india_fraud_detection_FINAL.csv`, `internet_scams_archive.csv`, and `spam.csv`) without modifying any existing file. Baseline references ([`maindataset.csv`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/services/classifier/data/maindataset.csv), [`real_test.csv`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/services/classifier/data/real_test.csv), and `train.py`) were kept strictly untouched and monitored via cryptographic SHA-256 integrity verification.

All rows were standardized to the target schema:
```csv
text,label,scam_type,language,source_file,source_type,license_note,group_id
```

### Key Quantitative Results
- **Training Candidates (`external_train_candidates.csv`):** 1,821 rows (939 benign [51.57%], 882 suspicious [48.43%]).
- **Real Advisory Holdout (`external_real_holdout_candidates.csv`):** 115 rows (63 benign, 52 suspicious across 33 distinct real-world source URLs).
- **Leakage & Contamination Assertions:**
  - `external_train_candidates.csv` $\leftrightarrow$ `real_test.csv`: **0 exact matches, 0 near-duplicates (cosine > 0.90)**
  - `external_real_holdout_candidates.csv` $\leftrightarrow$ `real_test.csv`: **0 exact matches, 0 near-duplicates (cosine > 0.90)**
  - `external_train_candidates.csv` $\leftrightarrow$ `external_real_holdout_candidates.csv`: **0 exact matches, 0 near-duplicates (cosine > 0.90)** (264 leaking synthetic near-duplicate candidates pruned during iterative filtering)
- **PII Sanitation:** Zero unmasked phone numbers, emails, UPI IDs, Aadhaar numbers, PAN identifiers, or raw 12+ digit account numbers remain in either candidate file. All 482 raw PII occurrences were replaced with explicit placeholder tokens (`[PHONE]`, `[EMAIL]`, `[UPI]`, `[AADHAAR]`, `[PAN]`, `[ACCOUNT_NUMBER]`, `[NAME]`).
- **Typo Normalization:** 66 occurrences of the synthetic template generation artifact `Yoyour` were corrected to `Your` / `your` prior to tokenization.

---

## 2. Row Distribution & Breakdown

### 2.1 Training Candidates Breakdown (`external_train_candidates.csv` — 1,821 rows)

| Dimension | Category / Value | Row Count | Percentage |
|---|---|---|---|
| **Class Label** | `benign` | 939 | 51.57% |
| | `suspicious` | 882 | 48.43% |
| **Source File** | `india_fraud_detection_FINAL.csv` | 1,032 | 56.67% |
| | `internet_scams_archive.csv` | 400 | 21.97% |
| | `spam.csv` | 300 | 16.47% |
| | `dataset.csv` | 89 | 4.89% |
| **Source Type** | `public_synthetic` | 1,316 | 72.27% |
| | `public_real_sms` | 300 | 16.47% |
| | `real_advisory` | 116 | 6.37% |
| | `synthetic` | 89 | 4.89% |
| **Language** | `en` (English) | 1,821 | 100.00% |
| **Scam Type** | `none` (Benign baseline) | 939 | 51.57% |
| | `job` (Recruitment / Employment fraud) | 423 | 23.23% |
| | `bank_alert` (KYC / Electricity civic alerts) | 265 | 14.55% |
| | `competition` (Lottery / Contest fraud) | 172 | 9.45% |
| | `internship` | 6 | 0.33% |
| | `scholarship` | 5 | 0.27% |
| | `task_job` | 5 | 0.27% |
| | `mule_offer` | 5 | 0.27% |
| | `overseas_agent` | 1 | 0.05% |

### 2.2 Real Advisory Holdout Breakdown (`external_real_holdout_candidates.csv` — 115 rows)

All 115 holdout rows originate from genuine real-world advisories (`source_type: real_advisory`) in `india_fraud_detection_FINAL.csv`, partitioned strictly by domain URL (33 URLs):
- `benign`: 63 rows (54.78%)
- `suspicious`: 52 rows (45.22%)
- `scam_type`: `none`: 63, `bank_alert`: 28, `job`: 19, `competition`: 5

---

## 3. Class vs. Source Representation & Imbalance Flags

The table below details source contributions within each class. As specified in the audit instructions, **any source providing more than 30.0% of a class is flagged**.

### Share of Sources Within Each Class

| Class Label | Source File | Rows | Share of Class | Audit Status |
|---|---|---|---|---|
| **Suspicious** (882 total) | `india_fraud_detection_FINAL.csv` | 546 | **61.90%** | > [!WARNING] **FLAGGED (> 30%): Dominant source of fraud lures** |
| | `internet_scams_archive.csv` | 292 | **33.11%** | > [!WARNING] **FLAGGED (> 30%): Exceeds 30% threshold** |
| | `dataset.csv` | 44 | 4.99% | Balanced contribution |
| **Benign** (939 total) | `india_fraud_detection_FINAL.csv` | 486 | **51.76%** | > [!WARNING] **FLAGGED (> 30%): Dominant source of genuine alerts** |
| | `spam.csv` | 300 | **31.95%** | > [!WARNING] **FLAGGED (> 30%): Exceeds 30% threshold** |
| | `internet_scams_archive.csv` | 108 | 11.50% | Balanced contribution |
| | `dataset.csv` | 45 | 4.79% | Balanced contribution |

### Class vs. Source Crosstab Matrix

| Source File | Benign Rows | Suspicious Rows | Total Rows | Source Balance Ratio |
|---|---|---|---|---|
| `india_fraud_detection_FINAL.csv` | 486 | 546 | 1,032 | 0.89 |
| `internet_scams_archive.csv` | 108 | 292 | 400 | 0.37 |
| `spam.csv` | 300 | 0 | 300 | $\infty$ (Benign background only) |
| `dataset.csv` | 45 | 44 | 89 | 1.02 |
| **Total Combined** | **939** | **882** | **1,821** | **1.06 (51.6% Benign / 48.4% Suspicious)** |

---

## 4. Shortcut Risks & Artifact Scan

### 4.1 Length & Formatting Disparity Between Classes

Evaluating text length and punctuation distributions across the 1,821 training candidates:

| Formatting Metric | Suspicious Class ($N=882$) | Benign Class ($N=939$) | Ratio / Disparity | Shortcut Risk Level |
|---|---|---|---|---|
| **Mean Character Length** | 186.83 chars | 129.19 chars | **1.45x longer** | Moderate: Suspicious lures include longer threat scripts |
| **Median Character Length** | 123.0 chars | 126.0 chars | **0.98x** | Low: Medians are virtually identical |
| **Character Length Std Dev** | 107.89 chars | 69.40 chars | 1.55x | Suspicious class has long-tail job offer letters |
| **Mean Word Count** | 29.54 words | 21.49 words | **1.37x words** | Moderate |
| **Exclamation Marks (`!`)** | 0.246 per text | 0.100 per text | **2.46x higher in Suspicious** | High: Urgency markers (`!`) correlate with fraud |
| **Question Marks (`?`)** | 0.020 per text | 0.114 per text | **5.70x higher in Benign** | High: Conversational SMS in `spam.csv` contains questions |
| **Uppercase Character Ratio** | 6.81% uppercase | 8.68% uppercase | 0.78x | Low: Benign acronyms (MSEDCL, TPDDL, ICICI) balance text |

### 4.2 Top Tokens per Class per Source Family

| Source Family | Class | Top 5 Predictive / Frequent Tokens |
|---|---|---|
| **INDFRAUD** (`india_fraud_detection_FINAL.csv`) | `suspicious` | `your` (556), `dear` (205), `you` (197), `account` (192), `update` (180) |
| | `benign` | `for` (743), `your` (419), `you` (218), `our` (187), `dear` (156) |
| **ARCHIVE** (`internet_scams_archive.csv`) | `suspicious` | `your` (824), `the` (436), `and` (354), `account` (301), `our` (237) |
| | `benign` | `apply` (198), `our` (144), `careers` (144), `page` (144), `role` (126) |
| **SPAM** (`spam.csv`) | `benign` | `you` (105), `the` (61), `and` (39), `that` (38), `but` (32) |
| **STUDENT** (`dataset.csv`) | `suspicious` | `for` (23), `fee` (17), `pay` (16), `earn` (16), `your` (11) |
| | `benign` | `the` (56), `for` (37), `your` (27), `has` (17), `been` (17) |

### 4.3 Top 30 Artifact Tokens (Single-Class & Single-Source/Template)

An empirical scan across the training candidates identified tokens that appear exclusively in one class and within a single source category or template family. Per task instructions, these were **scanned and recorded without auto-fixing**:

| Rank | Token | Frequency | Class | Source / Category | Description / Risk |
|---|---|---|---|---|---|
| 1 | `pan` | 69 | `suspicious` | `KYC_Suspension` | KYC suspension scams demand immediate PAN verification |
| 2 | `msedcl` | 36 | `benign` | `Electricity_Legitimate` | Maharashtra State Electricity Distribution brand token |
| 3 | `engineer` | 36 | `benign` | `Job_Legitimate` | Legitimate software engineer job posting title |
| 4 | `winner` | 32 | `suspicious` | `Lottery_Scam` | Advance-fee lottery scam announcement token |
| 5 | `but` | 32 | `benign` | `spam.csv` | Conversational conjunction in mobile SMS chat |
| 6 | `cut` | 31 | `suspicious` | `Electricity_Scam` | Power disconnection threat: "power will be cut" |
| 7 | `blocked` | 31 | `suspicious` | `KYC_Suspension` | Account suspension lure: "account is blocked" |
| 8 | `naukri` | 28 | `benign` | `Job_Legitimate` | Official Naukri.com recruitment notification |
| 9 | `paytm` | 28 | `benign` | `Lottery_Legitimate` | Genuine Paytm cashback balance updates |
| 10 | `vpa` | 23 | `benign` | `KYC_Legitimate` | Bank notification term: Virtual Private Address / UPI |
| 11 | `discount` | 22 | `benign` | `Electricity_Legitimate` | Power bill prompt payment discount notices |
| 12 | `tangedco` | 22 | `benign` | `Electricity_Legitimate` | Tamil Nadu Generation and Distribution brand token |
| 13 | `mahadiscom` | 21 | `benign` | `Electricity_Legitimate` | Official Maharashtra power portal URL token |
| 14 | `then` | 21 | `benign` | `spam.csv` | Conversational pronoun/adverb in mobile SMS |
| 15 | `meter` | 20 | `benign` | `Electricity_Legitimate` | Smart meter balance notification keyword |
| 16 | `lnkd` | 20 | `benign` | `Job_Legitimate` | Shortened LinkedIn job posting URL anchor |
| 17 | `debited` | 20 | `benign` | `KYC_Legitimate` | Banking transactional notification keyword |
| 18 | `when` | 20 | `benign` | `spam.csv` | Conversational SMS adverb |
| 19 | `previous` | 19 | `suspicious` | `Electricity_Scam` | Threat lure: "previous month bill was not updated" |
| 20 | `what` | 19 | `benign` | `spam.csv` | Conversational SMS pronoun |
| 21 | `snapdeal` | 18 | `suspicious` | `Lottery_Scam` | Impersonation of Snapdeal lucky draw prizes |
| 22 | `monsoon` | 18 | `suspicious` | `Lottery_Scam` | Fake seasonal promotional contest name |
| 23 | `nkr` | 17 | `benign` | `Job_Legitimate` | Naukri URL token |
| 24 | `cloud` | 17 | `benign` | `Job_Legitimate` | Legitimate IT job requisition keyword |
| 25 | `its` | 17 | `benign` | `spam.csv` | Colloquial SMS contraction |
| 26 | `how` | 17 | `benign` | `spam.csv` | Colloquial SMS adverb |
| 27 | `take` | 17 | `benign` | `spam.csv` | Colloquial SMS verb |
| 28 | `expired` | 16 | `suspicious` | `KYC_Suspension` | KYC urgency lure: "KYC validity expired" |
| 29 | `kbc` | 16 | `suspicious` | `Lottery_Scam` | Kaun Banega Crorepati lottery impersonation token |
| 30 | `bescom` | 15 | `benign` | `Electricity_Legitimate` | Bangalore Electricity Supply Company brand token |

---

## 5. Audit Sample: 20 Random Masked Real Advisory Rows

To verify that rows tagged as `source_type: real_advisory` originate from authentic advisories rather than synthetic paraphrasing by dataset compilers, 20 rows were sampled uniformly with random seed `42`:

| # | Verified Class | Category | Source URL Reference | Cleaned & Masked Message Text |
|---|---|---|---|---|
| 1 | `suspicious` | `Job_Scam` | [gendigital.com/.../part-time-job-scams](https://www.gendigital.com/blog/insights/research/part-time-job-scams) | Boost your income! Participate in our survey and earn Rs 500 daily. Sign up here: [Link] |
| 2 | `benign` | `Lottery_Legitimate` | [support.phonepe.com](https://support.phonepe.com/) | Cashback of Rs. 10 credited to your PhonePe Gift Balance for your transaction. |
| 3 | `suspicious` | `Electricity_Scam` | [truecaller.com/.../the-electricity-bill-fraud](https://www.truecaller.com/blog/scam-alert/the-electricity-bill-fraud-the-sms-scam-that-refuses-to-die) | Your electricity P0wer will be disconnected 10.30 pm because your b! II not updated. Contact power office [PHONE] |
| 4 | `suspicious` | `KYC_Suspension` | [reddit.com/r/IndiaInvestments/...](https://www.reddit.com/r/IndiaInvestments/comments/p7cc6r/survived_a_credit_card_fraud_today_sharing_my/) | 234567 is OTP (one time password) for updating your RBL Bank Credit Card settings. |
| 5 | `benign` | `Lottery_Legitimate` | [sbicard.com/.../rewards.page](https://www.sbicard.com/en/personal/benefits/rewards.page) | Dear Customer, your SBI Card ending 4321 has earned 100 reward points for spends in Feb. |
| 6 | `suspicious` | `Electricity_Scam` | [quora.com/...](https://www.quora.com/I-got-a-message-from-Snapdeal-that-I-got-a-prize-Is-it-real) | Electricity Office: Your power will be disconnected tonight. Call officer [PHONE] to verify payment. |
| 7 | `benign` | `KYC_Legitimate` | [icicibank.com/.../sms-banking](https://www.icicibank.com/personal-banking/ways-to-bank/mobile-banking/sms-banking) | Dear Customer, your ICICI Bank a/c XX123 is debited for Rs 2000 on 28-FEB-26. Info: BIL*Electricity. Total Avail Bal is Rs 45000. |
| 8 | `benign` | `Job_Legitimate` | [techmahindra.com/en-in/careers](https://www.techmahindra.com/en-in/careers/) | Tech Mahindra: Congratulations! You have successfully cleared the Technical Round. HR round is scheduled for 02-Mar-2026. - TECHM |
| 9 | `suspicious` | `Electricity_Scam` | [truecaller.com/.../the-electricity-bill-fraud](https://www.truecaller.com/blog/scam-alert/the-electricity-bill-fraud-the-sms-scam-that-refuses-to-die) | Notification Dear consumer Your Electricity Power will be disconnected Tonight at 9.30 pm from electricity Office. because your previous month bill was not update please immediately contact with Our electricity officer [PHONE] Thank you. |
| 10 | `benign` | `Electricity_Legitimate` | [mahadiscom.in](https://www.mahadiscom.in/) | Dear Consumer, Thank You for registering your mobile no. with MSEDCL. For any queries on your bill please contact Call Center: [PHONE] or 1912. |
| 11 | `benign` | `Lottery_Legitimate` | [paytm.com/.../cashback-points](https://paytm.com/blog/how-to-check-cashback-points-on-paytm/) | Rs. 100 Cashback credited to your Paytm wallet for your first flight booking. |
| 12 | `suspicious` | `Electricity_Scam` | [phonepe.com/.../lights-out-for-fraudster](https://www.phonepe.com/blog/trust-and-safety/lights-out-for-fraudster/) | Your electricity bill status: Unpaid. Power will be cut at 10:30 PM today. Update now on WhatsApp. |
| 13 | `suspicious` | `Job_Scam` | [mcafee.com/.../rising-scams-in-india](https://www.mcafee.com/blogs/other-blogs/mcafee-labs/rising-scams-in-india-building-awareness-and-prevention/) | Your profile was shortlisted for a remote data entry role. Pay Rs 500 for the training kit to start. |
| 14 | `suspicious` | `KYC_Suspension` | [timesofindia.indiatimes.com/...](https://timesofindia.indiatimes.com/gadgets-news/this-sms-about-your-electricity-bill-is-fake/articleshow/95102658.cms) | Dear Customer, Your KYC is incomplete. Call [PHONE] to verify and avoid account block. |
| 15 | `benign` | `Electricity_Legitimate` | [scribd.com/document/489949225](https://www.scribd.com/document/489949225/Latest-E-bill-1) | Your electricity bill for A/c No [ACCOUNT_NUMBER] for DEC-25 is Rs. 1591.26. Due Date 21-DEC-25. Arrears: Rs. 0.00. -UPPCL |
| 16 | `benign` | `Electricity_Legitimate` | [tgsouthernpower.org/...](https://tgsouthernpower.org/prepaidmetersfaq) | Prepaid Alert: Your meter [ACCOUNT_NUMBER] has exhausted 80% of recharge amount. Remaining Balance: Rs. 120.00. Please recharge. -TSSPDCL |
| 17 | `benign` | `KYC_Legitimate` | [axisbank.com/.../confirm-kyc](https://www.axisbank.com/bank-smart/digital-banking/confirm-kyc-details) | Dear Customer, your KYC documents have been successfully verified and updated for your Axis Bank A/c XX5678. Thank you. |
| 18 | `benign` | `Lottery_Legitimate` | [flipkart.com/helpcentre](https://www.flipkart.com/helpcentre) | Bonus! 50 SuperCoins credited for using Flipkart Axis Bank Credit Card on your last order. |
| 19 | `suspicious` | `Lottery_Scam` | [goodmoneying.com/financial-frauds](https://goodmoneying.com/financial-frauds/) | Amazon Pay: You have won a cashback of Rs 1000. Click to claim into your bank account. |
| 20 | `benign` | `KYC_Legitimate` | [bankofbaroda.in/.../sms-banking](https://www.bankofbaroda.in/personal-banking/digital-banking/mobile-banking/sms-banking) | Your Bank of Baroda A/c XX998 balance is Rs 1,50,450.00. For Mini Statement, give a missed call on [PHONE]. |

---

## 6. License Status & Provenance

| Source File | Source Type | Declared / Inferred License | Provenance & Usage Status |
|---|---|---|---|
| `dataset.csv` | `synthetic` | `unknown, check Kaggle page` | Project-internal starter seed set. Free for internal testing; review prior to public redistribution. |
| `india_fraud_detection_FINAL.csv` | `real_advisory` & `public_synthetic` | `unknown, check Kaggle page` | Curated Indian cybercrime compilation. 463 rows cited from public news/advisories (PIB, Ampcus Cyber, SBI, Truecaller); rest synthetic expansions. |
| `internet_scams_archive.csv` | `public_synthetic` | `CC-BY-4.0 (proposed)` | Compositional synthetic pipeline generated by community contributors. Permissive attribution license. |
| `spam.csv` | `public_real_sms` | `Public domain / research` | UCI SMS Spam Collection (Almeida & Hidalgo, 2012). Established academic research benchmark. |

---

## 7. Audit Verdict & The 5 Main Concerns

### Final Verdict: **READY WITH FIXES**

The curated candidate datasets [`external_train_candidates.csv`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/services/classifier/data/external_train_candidates.csv) and [`external_real_holdout_candidates.csv`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/services/classifier/data/external_real_holdout_candidates.csv) successfully meet all structural, safety, deduplication, and zero-leakage requirements. 

However, before executing a live training merge into `train.py`, the following **5 main concerns** must be addressed during Layer 2 classifier retraining:

1. **Source Imbalance (>30% threshold exceeded):**
   - `india_fraud_detection_FINAL.csv` comprises 61.90% of suspicious training candidates and 51.76% of benign training candidates. 
   - *Required Fix:* Stratified group sampling or inverse source-frequency sample weighting ($w_s = \frac{1}{\sqrt{N_s}}$) must be applied during model fitting so the classifier does not overfit to this single dataset's stylistic rhythm.
2. **Domain Vocabulary Skew (Utility vs. Opportunity):**
   - 437 rows in `india_fraud_detection_FINAL.csv` involve municipal power disconnection (MSEDCL, BESCOM, TSSPDCL) and bank KYC alerts rather than student recruitment, scholarships, or internships.
   - *Required Fix:* Maintain high representation of core student opportunity categories (from `maindataset.csv` and `dataset.csv`) to ensure the decision boundary remains focused on scholarship/internship deception.
3. **Template Artifact Shortcuts (Single-Class Brand Tokens):**
   - As cataloged in Section 4.3, brand tokens like `msedcl`, `kbc`, `snapdeal`, and `naukri` appear with 100% class purity due to template generation skeletons.
   - *Required Fix:* Mandatory canonical surface normalization via [`normalize_text`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/services/classifier/normalize.py) to convert URLs, numbers, phones, amounts, and handles into invariant placeholders (`<URL>`, `<AMT>`, `<NUM>`).
4. **Sentence Length Asymmetry:**
   - Suspicious training messages average 186.8 characters vs. 129.2 characters for benign messages (1.45x ratio).
   - *Required Fix:* Feature union must rely strictly on character/word n-gram TF-IDF with sublinear term frequency scaling (`sublinear_tf=True`) rather than text length or token count heuristics.
5. **Leakage-Safe Cross-Validation Enclosure:**
   - While `external_real_holdout_candidates.csv` and `real_test.csv` have proven 0.00% overlap with training candidates, synthetic templates within `external_train_candidates.csv` share phrase structures.
   - *Required Fix:* Any future cross-validation must strictly utilize `StratifiedGroupKFold` grouped on `group_id` (`GRP-INDFRAUD-...`, `GRP-ARCHIVE-...`) to ensure that no template family spans both training and validation folds.

---
*End of Report. Output candidate files generated in `services/classifier/data/` awaiting approval.*
