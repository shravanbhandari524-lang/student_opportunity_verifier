# External Datasets Audit: Student Opportunity Verifier

**Date:** 28 October 2026  
**Auditor:** Antigravity (AI Systems & Evaluation)  
**Target Directory:** `services/classifier/data/` (Strictly READ-ONLY Audit)  
**Execution Policy:** Deterministic evaluation, fixed random seed `42`, empirical command output only  
**Audit Script:** `scripts/audit/audit_external_datasets.py`  
**Raw Metrics Output:** `scripts/audit/external_datasets_audit.json`  

---

## 1. Executive Summary

This audit evaluates all eight external and auxiliary datasets situated in `services/classifier/data/` to determine their structural integrity, relevance to Indian student opportunity verification (scholarships, internships, jobs, task-based scams, mule accounts, contests, and cyber alerts), label validity, duplicate density, and shortcut risks. Two reference datasets (`maindataset.csv` and `real_test.csv`) were audited in read-only mode for baseline comparison and contamination testing.

### Key High-Level Findings
1. **Tabular vs. Text Separation:** Three files (`dataset_beasiswa_mahasiswa.csv`, `dataset_combined.xlsx`, and `Fraud Detection Dataset.csv`) contain purely tabular/numeric records without communication message text. They are definitively **UNUSABLE** for text classification.
2. **Duplicate & Pre-normalized File:** `normalized_dataset.csv` is an exact 1:1 duplicate of `maindataset.csv` (all 600 IDs, texts, labels, and scam types match identically), augmented with pre-computed `normalized_text` and `super_group` annotations. It adds zero new training instances.
3. **High-Value Sourced Indian Text (`india_fraud_detection_FINAL.csv`):** Contains 3,200 balanced messages (1,600 fraudulent, 1,600 legitimate) across 8 Indian civic and cyber domains. Crucially, **463 rows are real-world advisories** with verifiable source URLs (e.g., Ampcus Cyber, PIB), and 400 rows cover the `Job_Scam` / `Job_Legitimate` domain. However, 239 synthetic scam rows contain an uncleaned template typo (`Yoyour`), and 3,106 near-duplicate pairs exist due to synthetic slot variations.
4. **Massive Synthetic Archive (`internet_scams_archive.csv`):** 24,000 synthetic rows generated from a compositional pipeline. While vast, it is predominantly Western/global (Canada, US, UK, Australia, Nigeria) with heavy multi-lingual content (Spanish, French, Indonesian) and romance/crypto/BEC fraud. Only the English `Fake Job Offer` and `Legitimate - Job Posting` subsets (1,920 rows) are relevant, but they exhibit severe template clustering (118,245 near-duplicate pairs).
5. **Colloquial Benign Mobile Background (`spam.csv`):** The 4,825 `ham` messages provide realistic mobile communication background to prevent the classifier from developing false positives on informal SMS text. However, the 747 `spam` messages represent commercial advertising and ringtone marketing rather than deceptive opportunity fraud; using them as "fraud" ground truth introduces critical label ambiguity.
6. **Zero Evaluation Contamination:** Across all audited datasets, there is **0 exact string overlap and 0 near-duplicate overlap (cosine > 0.90) with `real_test.csv` (25 rows)**, confirming that the ground-truth benchmark remains completely uncontaminated.

---

## 2. File-by-File Audit

---

### File 1: `dataset.csv`

#### 1. Shape, Schema, Encoding, Missing Values & Sample Rows
- **File Size:** 11,205 bytes
- **Shape:** 89 rows $\times$ 2 columns
- **Encoding:** Valid UTF-8 (zero decoding errors)
- **Columns & Inferred Types:**
  - `text`: string (0 missing, 0.0%)
  - `label`: string (0 missing, 0.0%)
- **Missing Values:** 0 across all columns (100.0% populated)
- **Masked Sample Rows:**
  - *Row 1:* `{"text": "Congratulations! You have been selected for the National Merit Scholarship. To claim your award of Rs 50000, please pay a refundable registration fee of Rs 1500 immediately to upi [UPI_MASKED].", "label": "suspicious"}`
  - *Row 2:* `{"text": "Dear Student, your profile matched our Work from Home HR Intern role. Earn Rs 2500 per day by rating products on Telegram. Send security deposit to start.", "label": "suspicious"}`
  - *Row 3:* `{"text": "Urgent: Win Rs 100000 in National Coding Contest. Pay entry fee of Rs 500 to account before slots fill up.", "label": "suspicious"}`

#### 2. Type & Classifier Usability
- **Type:** Free-text messages.
- **Usable Text Column:** `text`.
- **Status:** **USABLE**. Contains focused opportunity fraud lures and legitimate university notices.

#### 3. Label Column & Mapping
- **Label Column:** `label`
- **Unique Values & Counts:** `benign`: 45 rows (50.56%), `suspicious`: 44 rows (49.44%).
- **Mapping:** Direct 1:1 mapping to `{benign, suspicious}`.
- **Ambiguity:** Zero ambiguity. All rows represent student opportunity scenarios.

#### 4. Language Mix & Relevance to Indian Students
- **Language Breakdown:** 100.0% English (89 rows).
- **Domain Relevance:**
  - Scholarship: 13 rows
  - Job: 14 rows
  - Internship: 11 rows
  - Task Job: 9 rows
  - Competition: 7 rows
  - Bank/OTP/UPI Alert: 6 rows
  - Overseas Agent: 4 rows
  - Highly aligned with the core student threat model defined in PRD §2.

#### 5. Text Length Stats & Duplicate Analysis
- **Character Length:** Min: 89, Max: 199, Mean: 113.80, Median: 110.0, Std: 17.18
- **Word Count:** Min: 12, Max: 30, Mean: 17.46, Median: 17.0, Std: 2.92
- **Within-File Duplicates:** 0 exact duplicates; 0 near-duplicate pairs (cosine > 0.90).
- **Overlap with `maindataset.csv`:** 0 exact string duplicates; 0 near-duplicates (cosine > 0.90). This starter dataset is completely distinct from `maindataset.csv`.
- **Overlap with Other Folder Files:** 0 exact or near duplicates across all other datasets.

#### 6. Overlap with `real_test.csv`
- **Exact Overlap:** 0 rows.
- **Near-Duplicate Overlap (cosine > 0.90):** 0 rows.

#### 7. Provenance and License
- **Provenance:** Starter seed dataset created for initial prototype testing.
- **Source / License Column:** None present.
- **License Status:** Project-internal synthetic starter data.

#### 8. Quality, Shortcuts & PII
- **Quality & Generation:** Synthetic short message templates modeled after Indian student scam SMS lures.
- **Shortcut Risks:**
  - Length disparity is low (positive mean: 108.4 chars, negative mean: 119.1 chars, ratio: 0.91).
  - Top positive predictive features from Logistic Regression: `rs` (+1.67), `pay` (+0.73), `earn` (+0.69), `fee` (+0.69).
  - Negative features: grammatical function words (`the`, `is`, `on`, `has`).
  - *Mitigation:* `normalize_text` masks `rs 1500` to `<AMT>`, mitigating the currency shortcut.
- **PII Counts:** 2 UPI handles detected (`sc***@okaxis`, `hr***@paytm`). Both are synthetic mock handles. 0 phone numbers, 0 emails, 0 account numbers.

---

### File 2: `dataset_beasiswa_mahasiswa.csv`

#### 1. Shape, Schema, Encoding, Missing Values & Sample Rows
- **File Size:** 820 bytes
- **Shape:** 15 rows $\times$ 7 columns
- **Encoding:** Valid UTF-8
- **Columns & Inferred Types:**
  - `NIM`: integer (0 missing, 0.0%) — Student Identification Number (*Nomor Induk Mahasiswa*)
  - `Nama`: string (0 missing, 0.0%) — Student Name
  - `IPK`: float (0 missing, 0.0%) — Grade Point Average (*Indeks Prestasi Kumulatif*)
  - `Penghasilan_Ortu_Rp`: integer (0 missing, 0.0%) — Parental Income in Indonesian Rupiah
  - `Jumlah_Tanggungan`: integer (0 missing, 0.0%) — Number of Dependents
  - `Prestasi_text`: string (0 missing, 0.0%) — Achievement Level (Internasional, Nasional, Provinsi, Kabupaten)
  - `Jarak_km`: integer (0 missing, 0.0%) — Distance to campus in kilometers
- **Missing Values:** 0 across all columns.
- **Masked Sample Rows:**
  - *Row 1:* `{"NIM": "2025001", "Nama": "[NAME_MASKED]", "IPK": "3.88", "Penghasilan_Ortu_Rp": "2500000", "Jumlah_Tanggungan": "2", "Prestasi_text": "Internasional", "Jarak_km": "95"}`
  - *Row 2:* `{"NIM": "2025002", "Nama": "[NAME_MASKED]", "IPK": "3.75", "Penghasilan_Ortu_Rp": "4500000", "Jumlah_Tanggungan": "3", "Prestasi_text": "Nasional", "Jarak_km": "80"}`
  - *Row 3:* `{"NIM": "2025003", "Nama": "[NAME_MASKED]", "IPK": "3.3", "Penghasilan_Ortu_Rp": "7000000", "Jumlah_Tanggungan": "1", "Prestasi_text": "Provinsi", "Jarak_km": "60"}`

#### 2. Type & Classifier Usability
- **Type:** Tabular / numeric student records.
- **Usable Text Column:** None.
- **Status:** **UNUSABLE**. Contains no communication message, social engineering text, or email body.

#### 3. Label Column & Mapping
- **Label Column:** None.
- **Unique Values & Counts:** N/A.
- **Mapping:** Cannot map.

#### 4. Language Mix & Relevance to Indian Students
- **Language Breakdown:** Indonesian (*Bahasa Indonesia*).
- **Domain Relevance:** Zero relevance. Indonesian university internal scholarship applicant ranking table.

#### 5. Text Length Stats & Duplicate Analysis
- **Text Stats:** N/A (tabular data).
- **Duplicates / Overlap:** N/A.

#### 6. Overlap with `real_test.csv`
- **Exact & Near Overlap:** 0 rows.

#### 7. Provenance and License
- **Provenance / License:** "unknown, check the Kaggle page" (likely an Indonesian university data science tutorial dataset for multi-criteria decision making like SAW or TOPSIS).

#### 8. Quality, Shortcuts & PII
- **PII:** Contains 15 real-looking student names and IDs (masked in audit). No contact info.

---

### File 3: `dataset_combined.xlsx`

#### 1. Shape, Schema, Encoding, Missing Values & Sample Rows
- **File Size:** 8,969,991 bytes (~8.55 MB compressed ZIP container)
- **Shape:** 245,760 data rows $\times$ 12 columns (plus 1 header row; 245,761 XML elements in `sheet1.xml`)
- **Encoding:** Binary OpenXML ZIP container (`xl/worksheets/sheet1.xml` with UTF-8 shared strings table `xl/sharedStrings.xml`)
- **Columns & Inferred Types:**
  - `Name`: string (0 missing, 0.0%) — Scholarship Scheme Name
  - `Education Qualification`: string (0 missing, 0.0%)
  - `Gender`: string (0 missing, 0.0%)
  - `Community`: string (0 missing, 0.0%)
  - `Religion`: string (0 missing, 0.0%)
  - `Exservice-men`: string (0 missing, 0.0%)
  - `Disability`: string (0 missing, 0.0%)
  - `Sports`: string (0 missing, 0.0%)
  - `Annual-Percentage`: string (0 missing, 0.0%)
  - `Income`: string (0 missing, 0.0%)
  - `India`: string (0 missing, 0.0%) — Residency status ("In")
  - `Outcome`: float (0 missing, 0.0%) — Binary admission/award result (`1.0` or `0.0`)
- **Missing Values:** 0 across all 245,760 rows (100.0% complete).
- **Sample Rows:**
  - *Row 1:* `{"Name": "INSPIRE Scholarship 2022-23 ? Scholarship for Higher Education (SHE)", "Education Qualification": "Undergraduate", "Gender": "Male", "Community": "General", "Religion": "Hindu", "Exservice-men": "Yes", "Disability": "Yes", "Sports": "Yes", "Annual-Percentage": "90-100", "Income": "Upto 1.5L", "India": "In", "Outcome": "1.0"}`
  - *Row 2:* `{"Name": "INSPIRE Scholarship 2022-23 ? Scholarship for Higher Education (SHE)", "Education Qualification": "Undergraduate", "Gender": "Male", "Community": "General", "Religion": "Hindu", "Exservice-men": "Yes", "Disability": "Yes", "Sports": "No", "Annual-Percentage": "90-100", "Income": "Upto 1.5L", "India": "In", "Outcome": "1.0"}`
  - *Row 3:* `{"Name": "INSPIRE Scholarship 2022-23 ? Scholarship for Higher Education (SHE)", "Education Qualification": "Undergraduate", "Gender": "Male", "Community": "General", "Religion": "Muslim", "Exservice-men": "Yes", "Disability": "Yes", "Sports": "Yes", "Annual-Percentage": "90-100", "Income": "Upto 1.5L", "India": "In", "Outcome": "1.0"}`

#### 2. Type & Classifier Usability
- **Type:** Tabular demographic / eligibility decision matrix.
- **Usable Text Column:** None. The `Name` column contains only 10 repeated official Indian scholarship program titles (e.g. *INSPIRE Scholarship*, *Pragati Scholarship*, *Dr. Ambedkar Post Matric*, *ONGC Sports Scholarship*).
- **Status:** **UNUSABLE** for text classification.

#### 3. Label Column & Mapping
- **Label Column:** `Outcome`
- **Unique Values & Counts:** `0.0`: 212,992 rows (86.67%), `1.0`: 32,768 rows (13.33%).
- **Mapping:** Tabular eligibility outcome (awarded vs rejected based on demographic criteria). Does not represent scam vs legitimate messaging.
- **Ambiguity:** Total conceptual mismatch with opportunity fraud detection.

#### 4. Language Mix & Relevance to Indian Students
- **Language Breakdown:** English categorical labels.
- **Domain Relevance:** High conceptual relevance to Indian scholarships, but formatted purely as tabular applicant features rather than phishing or announcement messages.

#### 5. Text Length Stats & Duplicate Analysis
- **Text Stats:** N/A (tabular data).
- **Duplicates / Overlap:** N/A.

#### 6. Overlap with `real_test.csv`
- **Exact & Near Overlap:** 0 rows.

#### 7. Provenance and License
- **Provenance / License:** "unknown, check the Kaggle page" (synthetic or compiled Indian government scholarship eligibility simulator).

#### 8. Quality, Shortcuts & PII
- **Quality:** Exhaustive Cartesian product of demographic feature bins.
- **PII:** Zero personal names or identifiers. Scheme names only.

---

### File 4: `Fraud Detection Dataset.csv`

#### 1. Shape, Schema, Encoding, Missing Values & Sample Rows
- **File Size:** 3,692,523 bytes (~3.52 MB)
- **Shape:** 51,000 rows $\times$ 12 columns
- **Encoding:** Valid UTF-8
- **Columns & Inferred Types:**
  - `Transaction_ID`: string (0 missing, 0.0%)
  - `User_ID`: integer (0 missing, 0.0%)
  - `Transaction_Amount`: float (2,520 missing, 4.94%)
  - `Transaction_Type`: string (0 missing, 0.0%)
  - `Time_of_Transaction`: string (2,552 missing, 5.00%)
  - `Device_Used`: string (2,473 missing, 4.85%)
  - `Location`: string (2,547 missing, 4.99%)
  - `Previous_Fraudulent_Transactions`: integer (0 missing, 0.0%)
  - `Account_Age`: integer (0 missing, 0.0%)
  - `Number_of_Transactions_Last_24H`: integer (0 missing, 0.0%)
  - `Payment_Method`: string (2,469 missing, 4.84%)
  - `Fraudulent`: integer (0 missing, 0.0%) — Binary fraud indicator (`0` or `1`)
- **Missing Values:** ~4.8% to 5.0% missing across 5 feature columns (simulated data noise).
- **Masked Sample Rows:**
  - *Row 1:* `{"Transaction_ID": "T1", "User_ID": "4174", "Transaction_Amount": "1292.76", "Transaction_Type": "ATM Withdrawal", "Time_of_Transaction": "16.0", "Device_Used": "Tablet", "Location": "San Francisco", "Previous_Fraudulent_Transactions": "0", "Account_Age": "119", "Number_of_Transactions_Last_24H": "13", "Payment_Method": "Debit Card", "Fraudulent": "0"}`
  - *Row 2:* `{"Transaction_ID": "T2", "User_ID": "4507", "Transaction_Amount": "1554.58", "Transaction_Type": "ATM Withdrawal", "Time_of_Transaction": "13.0", "Device_Used": "Mobile", "Location": "New York", "Previous_Fraudulent_Transactions": "4", "Account_Age": "79", "Number_of_Transactions_Last_24H": "3", "Payment_Method": "Credit Card", "Fraudulent": "0"}`
  - *Row 3:* `{"Transaction_ID": "T3", "User_ID": "1860", "Transaction_Amount": "2395.02", "Transaction_Type": "ATM Withdrawal", "Time_of_Transaction": "", "Device_Used": "Mobile", "Location": "", "Previous_Fraudulent_Transactions": "3", "Account_Age": "115", "Number_of_Transactions_Last_24H": "9", "Payment_Method": "", "Fraudulent": "0"}`

#### 2. Type & Classifier Usability
- **Type:** Tabular financial transaction logs.
- **Usable Text Column:** None.
- **Status:** **UNUSABLE**. Contains transaction metadata, not natural language messages.

#### 3. Label Column & Mapping
- **Label Column:** `Fraudulent`
- **Unique Values & Counts:** `0`: 48,490 rows (95.08%), `1`: 2,510 rows (4.92%).
- **Mapping:** Financial transaction fraud (card fraud/unauthorized ATM withdrawal).
- **Ambiguity:** Critical ambiguity: financial anomaly detection is fundamentally different from linguistic opportunity deception.

#### 4. Language Mix & Relevance to Indian Students
- **Language Breakdown:** English categorical values.
- **Domain Relevance:** Mentions payment methods like UPI alongside US locations (San Francisco, New York, Chicago), but contains zero opportunity text.

#### 5. Text Length Stats & Duplicate Analysis
- **Text Stats:** N/A (tabular data).
- **Duplicates / Overlap:** N/A.

#### 6. Overlap with `real_test.csv`
- **Exact & Near Overlap:** 0 rows.

#### 7. Provenance and License
- **Provenance / License:** "unknown, check the Kaggle page" (synthetic financial fraud benchmark).

#### 8. Quality, Shortcuts & PII
- **PII:** Synthetic user and transaction identifiers.

---

### File 5: `india_fraud_detection_FINAL.csv`

#### 1. Shape, Schema, Encoding, Missing Values & Sample Rows
- **File Size:** 698,836 bytes (~682 KB)
- **Shape:** 3,200 rows $\times$ 8 columns
- **Encoding:** Valid UTF-8
- **Columns & Inferred Types:**
  - `message_text`: string (0 missing, 0.0%)
  - `category`: string (0 missing, 0.0%)
  - `subcategory`: string (0 missing, 0.0%)
  - `platform_found`: string (0 missing, 0.0%) — SMS, WhatsApp, Telegram, Email
  - `source_url`: string (0 missing, 0.0%) — 463 real advisory URLs, 2,737 marked "synthetic"
  - `language`: string (0 missing, 0.0%) — Tagged as "English"
  - `label`: integer (0 missing, 0.0%) — Binary `0` (legitimate) or `1` (scam)
  - `is_synthetic`: boolean (0 missing, 0.0%) — `False`: 463 rows (14.47%), `True`: 2,737 rows (85.53%)
- **Missing Values:** 0 across all columns.
- **Masked Sample Rows:**
  - *Row 1 (Real Sourced Scam):* `{"message_text": "Your vehicle was caught overspeeding by a traffic camera. Pay your pending challan of Rs 500 now at: https://echallaom.vip/in", "category": "Echallan_Scam", "subcategory": "Overspeeding", "platform_found": "SMS", "source_url": "https://www.ampcuscyber.com/shadowopsintel/the-rise-of-browser-based-e-challan-scams-in-india/", "language": "English", "label": "1", "is_synthetic": "False"}`
  - *Row 2 (Synthetic Legitimate):* `{"message_text": "Dear Consumer, your Smart Meter balance for Acc [ACC_NUM_MASKED] is low (Rs 2,100). Please recharge soon to avoid automatic disconnection. -TPDDL For queries, call our helpline.", "category": "Electricity_Legitimate", "subcategory": "Smart_Meter_Notification", "platform_found": "SMS", "source_url": "synthetic", "language": "English", "label": "0", "is_synthetic": "True"}`
  - *Row 3 (Synthetic Scam):* `{"message_text": "ACTION REQUIRED: Dear User, your number won the first prize in our annual lucky draw. Pay Rs 2,500 tax to receive Rs 299.", "category": "Lottery_Scam", "subcategory": "Tax_Fee", "platform_found": "Telegram", "source_url": "synthetic", "language": "English", "label": "1", "is_synthetic": "True"}`

#### 2. Type & Classifier Usability
- **Type:** Free-text messages.
- **Usable Text Column:** `message_text`.
- **Status:** **USE WITH CLEANING**. High relevance to Indian context, contains 463 real-world source URLs.

#### 3. Label Column & Mapping
- **Label Column:** `label`
- **Unique Values & Counts:** `1` (scam): 1,600 rows (50.0%), `0` (legitimate): 1,600 rows (50.0%).
- **Mapping:**
  - `1` $\rightarrow$ `suspicious`
  - `0` $\rightarrow$ `benign`
- **Category Balance (Exactly 200 per category):**
  - `Job_Scam`: 200 (`1`) vs `Job_Legitimate`: 200 (`0`) — **400 rows directly match student opportunities**
  - `KYC_Suspension`: 200 (`1`) vs `KYC_Legitimate`: 200 (`0`)
  - `Digital_Arrest`: 200 (`1`) vs `Digital_Arrest_Legitimate`: 200 (`0`)
  - `Electricity_Scam`: 200 (`1`) vs `Electricity_Legitimate`: 200 (`0`)
  - `Courier_Scam`: 200 (`1`) vs `Courier_Legitimate`: 200 (`0`)
  - `Echallan_Scam`: 200 (`1`) vs `Echallan_Legitimate`: 200 (`0`)
  - `Lottery_Scam`: 200 (`1`) vs `Lottery_Legitimate`: 200 (`0`)
  - `Tax_Refund_Scam`: 200 (`1`) vs `Tax_Legitimate`: 200 (`0`)
- **Ambiguity:** Non-job categories represent broader Indian citizen fraud (traffic fines, power utility bills, courier delays).

#### 4. Language Mix & Relevance to Indian Students
- **Language Breakdown:** English: 3,193 rows (99.78%), Hinglish: 7 rows (0.22%).
- **Domain Relevance:**
  - Bank/OTP/UPI/Utility Alerts: 1,031 rows
  - Job: 282 rows
  - Contest/Lottery: 117 rows
  - Task Job: 74 rows
  - Overseas Agent: 27 rows
  - Internship: 10 rows
  - The job subcategory directly addresses recruitment scams targeting fresh graduates.

#### 5. Text Length Stats & Duplicate Analysis
- **Character Length:** Min: 63, Max: 258, Mean: 126.30, Median: 123.0, Std: 29.78
- **Word Count:** Min: 10, Max: 37, Mean: 20.45, Median: 20.0, Std: 4.85
- **Within-File Duplicates:**
  - Exact string duplicates: 0 rows (all 3,200 strings are distinct).
  - Near-duplicate pairs (cosine > 0.90): **3,106 pairs**.
  - *Cause:* Synthetic generator used fixed sentence skeletons and only varied amount numbers, account digits, or tiny URLs.
- **Overlap with `maindataset.csv`:** 0 exact duplicates; 0 near-duplicates (cosine > 0.90).
- **Overlap with Other Folder Files:** 0 exact or near-duplicates with all other files.

#### 6. Overlap with `real_test.csv`
- **Exact & Near Overlap:** 0 rows.

#### 7. Provenance and License
- **Provenance:** Curated Indian cyber intelligence collection. 463 real cases sourced from public cybercell reports, PIB advisories, and cybersecurity whitepapers (e.g. `ampcuscyber.com`). 2,737 synthetic items expanded from those templates.
- **License:** Public cyber intelligence reports / Kaggle Open Data.

#### 8. Quality, Shortcuts & PII
- **CRITICAL SHORTCUT DEFECT IDENTIFIED:**
  - **239 synthetic scam rows contain the typo token `Yoyour`** (e.g., *"Dear Customer, URGENT: Yoyour international shipment is on hold"* or *"Confirm yoyour identity"*).
  - All 239 instances are `label == 1` and `is_synthetic == True`.
  - In Logistic Regression, `yoyour` has a massive shortcut weight of **+2.58**, and `link` has **+3.05**.
  - Negative class features have `for` (-5.33), `00` (-2.31), `no` (-2.18).
  - *Required Cleaning:* String normalization must replace `yoyour` $\rightarrow$ `your` and run `normalize_text` to prevent shortcut memorization.
- **PII Counts:**
  - Phones: 244 (e.g., `180XXXX61`, `123XXXX90`)
  - Account Numbers: 292 (e.g., `XXXXXXX6161`, `XXXXXX7890`)
  - UPI Handles: 43 (e.g., `ai***@upi`, `an***@okicici`)

---

### File 6: `internet_scams_archive.csv`

#### 1. Shape, Schema, Encoding, Missing Values & Sample Rows
- **File Size:** 18,285,089 bytes (~17.44 MB)
- **Shape:** 24,000 rows $\times$ 37 columns
- **Encoding:** Valid UTF-8
- **Columns & Inferred Types:** 37 metadata columns including `scam_id`, `category`, `scam_pattern`, `platform`, `message_text`, `language`, `country_region`, `date`, `urgency_level`, `contains_link`, `requests_otp`, `label`, `is_synthetic`, `source`, `source_license`, `generation_template_id`, `split`.
- **Missing Values:** Only `subject` has missing values (15,710 empty, 65.46% — normal for SMS/chat messages). All other 36 columns are 100% populated.
- **Masked Sample Rows:**
  - *Row 1 (Scam, Canada):* `{"scam_id": "SCA-000001", "category": "WhatsApp Scam", "scam_pattern": "family_emergency", "platform": "Facebook", "message_text": "Hey it's me, please don't call this number yet, I can only text right now. I'm in a really difficult situation and need help with a phone repair. Please, I wouldn't ask if it wasn't serious — I need this by end of day. Can you send $900 to this account: [ACC_NUM_MASKED]? I'll pay you back.", "language": "English", "country_region": "Canada", "label": "Scam", "is_synthetic": "True"}`
  - *Row 2 (Scam, French/Senegal):* `{"scam_id": "SCA-000002", "category": "WhatsApp Scam", "scam_pattern": "family_emergency", "platform": "Instagram", "message_text": "Salut, c'est ton fils, j'ai perdu mon téléphone donc voici mon nouveau numéro. J'ai besoin de CFA150 de toute urgence pour des frais de visa. Peux-tu l'envoyer sur ce compte : [ACC_NUM_MASKED] ? Je t'expliquerai tout bientôt.", "language": "French", "country_region": "Senegal", "label": "Scam", "is_synthetic": "True"}`
  - *Row 3 (Scam, French/Canada):* `{"scam_id": "SCA-000003", "category": "WhatsApp Scam", "scam_pattern": "family_emergency", "platform": "Facebook", "message_text": "Salut, c'est ton meilleur ami, j'ai perdu mon téléphone donc voici mon nouveau numéro. J'ai besoin de $500 de toute urgence pour une réparation de voiture. Peux-tu l'envoyer sur ce compte : [ACC_NUM_MASKED] ? Je t'expliquerai tout bientôt.", "language": "French", "country_region": "Canada", "label": "Scam", "is_synthetic": "True"}`

#### 2. Type & Classifier Usability
- **Type:** Free-text messages with rich metadata.
- **Usable Text Column:** `message_text`.
- **Status:** **USE WITH CLEANING** (Selective English Job Subset Only).

#### 3. Label Column & Mapping
- **Label Column:** `label`
- **Unique Values & Counts:** `Scam`: 17,920 rows (74.67%), `Benign`: 6,080 rows (25.33%).
- **Mapping:**
  - `Scam` $\rightarrow$ `suspicious`
  - `Benign` $\rightarrow$ `benign`
- **Ambiguity:** High global scam diversity (pig butchering, romance, family emergency, BEC wire transfer, crypto). Only `Fake Job Offer` (960) and `Legitimate - Job Posting` (960) fit the student opportunity verification charter.

#### 4. Language Mix & Relevance to Indian Students
- **Language Breakdown (Empirical Verification):**
  - English: 22,775 rows (94.90%)
  - Spanish: 550 rows (2.29%)
  - French: 256 rows (1.07%)
  - Hindi (Devanagari): 210 rows (0.88%)
  - Hinglish: 125 rows (0.52%)
  - Indonesian: 84 rows (0.35%)
- **Country Distribution:** Canada (3,646), US (3,602), Australia (3,580), Philippines (3,578), Nigeria (3,549), UK (3,542). India is minimally represented.
- **Student Relevance:**
  - Contests/Prizes: 2,823 rows
  - Jobs: 2,144 rows
  - Bank/OTP Alerts: 729 rows
  - Task-Job: 411 rows
  - Overseas Agent: 416 rows

#### 5. Text Length Stats & Duplicate Analysis
- **Character Length:** Min: 114, Max: 472, Mean: 285.30, Median: 288.0, Std: 69.43
- **Word Count:** Min: 19, Max: 79, Mean: 45.33, Median: 45.0, Std: 12.66
- **Within-File Duplicates:**
  - Exact string duplicates: 0 rows.
  - Near-duplicate pairs (cosine > 0.90): **118,245 pairs**.
  - *Root Cause:* Templated slot-filling engine (`generation_template_id`). The pipeline re-used identical prompt templates across hundreds of generations, swapping only names, currencies, or bank accounts.
- **Overlap with `maindataset.csv`:** 0 exact; 0 near-duplicates.
- **Overlap with Other Folder Files:** 0 exact or near-duplicates.

#### 6. Overlap with `real_test.csv`
- **Exact & Near Overlap:** 0 rows.

#### 7. Provenance and License
- **Provenance:** `Synthetic - Compositional Template Pipeline v1` (100.0% of rows marked `is_synthetic == True`).
- **License Column:** `Original / CC-BY-4.0 (proposed)`.

#### 8. Quality, Shortcuts & PII
- **Shortcuts & Length Disparity:**
  - Severe length imbalance: Scam messages average **308.3 chars** vs Benign messages averaging **217.4 chars** (ratio: 1.42x).
  - Scam features emphasize urgency and links (`https`, `confirm`, `de`), while Benign features contain marketing email boilerplates (`any time`, `view`, `on`, `no` - e.g. "unsubscribe at any time").
- **PII Counts:**
  - Phone Numbers: 5,786
  - Account Numbers: 6,144
  - Emails: 478
  - UPI Handles: 478
  - All PII strings are synthetic template filler variables.

---

### File 7: `normalized_dataset.csv`

#### 1. Shape, Schema, Encoding, Missing Values & Sample Rows
- **File Size:** 321,161 bytes (~313 KB)
- **Shape:** 600 rows $\times$ 11 columns
- **Encoding:** Valid UTF-8
- **Columns & Inferred Types:**
  - `id`: string (0 missing, 0.0%)
  - `text`: string (0 missing, 0.0%)
  - `normalized_text`: string (0 missing, 0.0%) — Pre-normalized with placeholder tokens
  - `label`: string (0 missing, 0.0%)
  - `scam_type`: string (0 missing, 0.0%)
  - `language`: string (0 missing, 0.0%)
  - `channel`: string (0 missing, 0.0%)
  - `source_type`: string (0 missing, 0.0%)
  - `group_id`: string (0 missing, 0.0%)
  - `pair_id`: string (348 missing, 58.0% — benign unpaired controls)
  - `super_group`: string (0 missing, 0.0%)
- **Missing Values:** `pair_id` is empty for 348 unpaired controls; other 10 columns are 100% complete.
- **Sample Rows:**
  - *Row 1:* `{"id": "DATA-001", "text": "Apex Education Foundation alert: Rs 25,000 scholarship requires immediate verification. Submit details at https://apex-foundation.example/grant before midnight.", "normalized_text": "Apex Education Foundation alert: <AMT> scholarship requires immediate verification. Submit details at <URL> before midnight.", "label": "suspicious", "scam_type": "scholarship", "super_group": "SUPERGRP_301"}`
  - *Row 2:* `{"id": "DATA-002", "text": "National Talent Trust: Immediate action required. Confirm your bank account login credentials at https://talent-trust.invalid/verify before Thursday 5 PM to prevent scholarship cancellation.", "normalized_text": "National Talent Trust: Immediate action required. Confirm your bank account login credentials at <URL> before Thursday 5 PM to prevent scholarship cancellation.", "label": "suspicious", "scam_type": "scholarship", "super_group": "SUPERGRP_301"}`
  - *Row 3:* `{"id": "DATA-003", "text": "Horizon Academic Council alert: Rs 18,000 scholarship lene ke liye visit https://horizon-council.test/sanction before midnight.", "normalized_text": "Horizon Academic Council alert: <AMT> scholarship lene ke liye visit <URL> before midnight.", "label": "suspicious", "scam_type": "scholarship", "super_group": "SUPERGRP_306"}`

#### 2. Type & Classifier Usability
- **Type:** Free-text messages with pre-computed normalized text.
- **Status:** **UNUSABLE FOR EXTENSION / DUPLICATE OF MAINDATASET**. It is literally `maindataset.csv` saved after the L2 canonical normalization step.

#### 3. Label Column & Mapping
- **Label Column:** `label`
- **Unique Values & Counts:** `suspicious`: 300 rows (50.0%), `benign`: 300 rows (50.0%).
- **Mapping:** 1:1 match.

#### 4. Language Mix & Relevance to Indian Students
- **Language Breakdown:** English: 339 rows (56.5%), Hinglish: 168 rows (28.0%), Hindi (Devanagari): 93 rows (15.5%).
- **Domain Relevance:** Exact coverage of 6 PRD opportunity types (50 examples each).

#### 5. Text Length Stats & Duplicate Analysis
- **Character Length:** Min: 82, Max: 515, Mean: 198.12, Median: 165.0, Std: 94.13
- **Word Count:** Min: 12, Max: 66, Mean: 26.38, Median: 22.0, Std: 12.45
- **Within-File Duplicates:** 0 exact, 0 near-duplicates.
- **Overlap with `maindataset.csv`:** **600 exact matches (100.0%)**; **600 near-duplicates (100.0%)**.

#### 6. Overlap with `real_test.csv`
- **Exact & Near Overlap:** 0 rows.

#### 7. Provenance and License
- **Provenance:** Generated from `maindataset.csv` during Layer 2 classifier hardening.
- **License:** Project-internal synthetic training set.

#### 8. Quality, Shortcuts & PII
- **Shortcuts:** Solved by `normalized_text` and `super_group` grouping during training.
- **PII:** 143 mock UPI handles (`@fakebank`), 19 mock emails (`@central-board.example`). Zero real PII.

---

### File 8: `spam.csv`

#### 1. Shape, Schema, Encoding, Missing Values & Sample Rows
- **File Size:** 503,663 bytes (~491 KB)
- **Shape:** 5,572 rows $\times$ 5 columns
- **Encoding:** **Windows-1252 / Latin-1** (fails UTF-8 decoding at byte 606 due to `\xe5\xa3` pound sterling character).
- **Columns & Inferred Types:**
  - `v1`: string (0 missing, 0.0%) — Label (`ham` or `spam`)
  - `v2`: string (0 missing, 0.0%) — Primary SMS message text
  - `unnamed_2`: string (5,522 missing, 99.10%) — Overflow text from unescaped commas
  - `unnamed_3`: string (5,560 missing, 99.78%) — Overflow text from unescaped commas
  - `unnamed_4`: string (5,566 missing, 99.89%) — Overflow text from unescaped commas
- **Missing Values:** Extra columns are artifacts of parsing CSV lines containing unquoted commas.
- **Masked Sample Rows:**
  - *Row 1:* `{"v1": "ham", "v2": "Go until jurong point, crazy.. Available only in bugis n great world la e buffet... Cine there got amore wat..."}`
  - *Row 2:* `{"v1": "ham", "v2": "Ok lar... Joking wif u oni..."}`
  - *Row 3:* `{"v1": "spam", "v2": "Free entry in 2 a wkly comp to win FA Cup final tkts 21st May 2005. Text FA to 87121 to receive entry question(std txt rate)T&C's apply [PHONE_MASKED]over18's"}`

#### 2. Type & Classifier Usability
- **Type:** Free-text mobile SMS messages.
- **Usable Text Column:** `v2` (reconstituted with trailing overflow columns).
- **Status:** **USE AS BENIGN BACKGROUND ONLY**.

#### 3. Label Column & Mapping
- **Label Column:** `v1`
- **Unique Values & Counts:** `ham`: 4,825 rows (86.59%), `spam`: 747 rows (13.41%).
- **Mapping:**
  - `ham` $\rightarrow$ `benign` (Highly valuable realistic mobile conversational text).
  - `spam` $\rightarrow$ **AMBIGUOUS**. Do NOT map to `suspicious`.
- **Ambiguity Analysis:**
  - The `spam` rows are classic 2003-2007 UK mobile advertisements, adult chat lines, ringtone downloads, and lottery promos.
  - Conflating commercial spam with student opportunity fraud would degrade model precision on legitimate student marketing announcements while failing to identify nuanced advance-fee scams.

#### 4. Language Mix & Relevance to Indian Students
- **Language Breakdown:** English: 5,570 rows (99.96%), Hinglish: 2 rows (0.04%). Primarily British/Singaporean colloquial English.
- **Domain Relevance:**
  - General conversational mobile messages: 4,500+ rows
  - Contest/Raffle alerts: 154 rows
  - General employment mentions: 57 rows
  - Bank/OTP alerts: 13 rows
  - Valuable as a non-scam negative control to anchor the model on informal mobile chat.

#### 5. Text Length Stats & Duplicate Analysis
- **Character Length:** Min: 2, Max: 910, Mean: 80.66, Median: 62.0, Std: 60.00
- **Word Count:** Min: 1, Max: 171, Mean: 15.60, Median: 12.0, Std: 11.39
- **Within-File Duplicates:**
  - Exact duplicates: 414 rows (403 duplicate `ham` messages, 11 duplicate `spam` messages).
  - Near-duplicate pairs (cosine > 0.90): **1,357 pairs**.
  - Unique `ham` messages: **4,516 rows**.
- **Overlap with `maindataset.csv`:** 0 exact, 0 near-duplicates.
- **Overlap with Other Folder Files:** 0 exact or near-duplicates.

#### 6. Overlap with `real_test.csv`
- **Exact & Near Overlap:** 0 rows.

#### 7. Provenance and License
- **Provenance:** UCI Machine Learning Repository SMS Spam Collection (Almeida & Hidalgo, 2012), collected from the Grumbletext UK website and NUS SMS Corpus.
- **License:** Public domain / CC-BY-4.0 for academic research.

#### 8. Quality, Shortcuts & PII
- **Shortcuts & Length Disparity:**
  - High length imbalance: `spam` averages **139.1 chars** while `ham` averages **71.6 chars** (1.94x ratio).
  - Top spam features: `call` (+4.99), `txt` (+4.66), `free` (+3.89), `text` (+3.70), `to` (+3.37).
  - Top ham features: conversational pronouns (`my`, `me`, `ok`, `that`, `it`).
- **PII Counts:**
  - Phones: 405 (UK premium-rate shortcodes e.g., `090XXXX61`, `080XXXX30`)
  - Account Numbers: 441 (e.g., `XXXXXXX1461`)
  - Emails / Handles: 25

---

## 3. Comparison Datasets Baseline Check

To ensure evaluation integrity and confirm data isolation, the two active project datasets were verified:

| Reference Dataset | Shape | Encodings & Format | Relationship to Audited Datasets | Contamination Check |
|---|---|---|---|---|
| `maindataset.csv` | 600 rows $\times$ 14 cols | UTF-8, 50/50 balance | Exact source of `normalized_dataset.csv`. Zero overlap with other 7 external files. | Baseline Training Dataset |
| `real_test.csv` | 25 rows $\times$ 12 cols | UTF-8, PIB / official alerts | **0 exact matches, 0 near-duplicates (cosine > 0.90) across all 8 files.** | **100% UNCONTAMINATED (Zero Leakage)** |

---

## 4. Summary Table & Recommendations

| File Name | Shape | Data Type | Relevance to Indian Students | Contamination Risk | Recommendation | One-Line Actionable Reason |
|---|---|---|---|---|---|---|
| `dataset.csv` | 89 $\times$ 2 | Text (SMS/email) | High (Scholarships, Internships, Jobs) | 0% overlap with test | **USE FOR TRAINING** | High-quality, balanced (44 susp / 45 ben) student opportunity lures completely distinct from `maindataset.csv`. |
| `dataset_beasiswa_mahasiswa.csv` | 15 $\times$ 7 | Tabular | Zero (Indonesian student GPAs & incomes) | None | **UNUSABLE** | Tabular numerical records from Indonesia with no message text and no fraud label. |
| `dataset_combined.xlsx` | 245,760 $\times$ 12 | Tabular | Moderate (Demographics for Indian schemes) | None | **UNUSABLE** | Tabular demographic eligibility matrix for scholarship quota allocation; contains no message text. |
| `Fraud Detection Dataset.csv` | 51,000 $\times$ 12 | Tabular | Zero (US banking transaction anomalies) | None | **UNUSABLE** | Tabular ATM/card transaction logs; contains no message text or opportunity context. |
| `india_fraud_detection_FINAL.csv` | 3,200 $\times$ 8 | Text (SMS/chat) | High (400 Job rows, 1,200 Student/Cyber alerts) | 0% overlap with test | **USE WITH CLEANING** | Contains 463 real advisories with source URLs, but requires fixing the `Yoyour` template typo and deduplicating near-dupes. |
| `internet_scams_archive.csv` | 24,000 $\times$ 37 | Text (Multi-channel) | Low-Medium (English Job subset only) | 0% overlap with test | **USE WITH CLEANING** | Massive global archive; filter exclusively for the 1,920 English Job rows and prune template near-duplicates. |
| `normalized_dataset.csv` | 600 $\times$ 11 | Text (Pre-normalized) | High (Identical to `maindataset.csv`) | 100% overlap with main | **UNUSABLE (Duplicate)** | 100% byte-for-byte duplicate of `maindataset.csv` with pre-computed tokens; provides zero new data. |
| `spam.csv` | 5,572 $\times$ 5 | Text (Mobile SMS) | Low-Medium (Mobile background chat) | 0% overlap with test | **USE AS BENIGN BACKGROUND ONLY** | Extract up to 4,516 unique `ham` messages as realistic non-fraud mobile chat background; discard `spam` class. |

---

## 5. Usable Row Estimates & Per-Class Source Diversity

### Estimated Usable Text Rows After Cleaning & Deduplication

Depending on curation strategy, three integration tiers are possible:

| Adoption Strategy | Source Breakdown | Usable Benign | Usable Suspicious | Total Usable Rows | Balance Ratio |
|---|---|---|---|---|---|
| **Tier 1: Conservative (Student Opportunities Only)** | `dataset.csv` (89) + `india_fraud_detection_FINAL.csv` (Job subset: 386 unique) + `internet_scams_archive.csv` (English Job subset: 1,345 unique) | 884 rows | 936 rows | **1,820 rows** | **0.94 (Near 50/50)** |
| **Tier 2: Balanced Indian Citizen & Opportunity (Recommended)** | Tier 1 + `india_fraud_detection_FINAL.csv` (KYC, Electricity, Lottery alerts: 1,120 unique) + `spam.csv` (Sampled 1,000 unique `ham` background) | 2,444 rows | 1,496 rows | **3,940 rows** | **1.63 (Benign-heavy)** |
| **Tier 3: Full Cleaned Scale** | All deduplicated unique texts from `dataset.csv` (89) + `india_fraud_detection_FINAL.csv` (2,933) + `internet_scams_archive.csv` (English Job: 1,345) + `spam.csv` (4,516 `ham`) | 5,993 rows | 2,890 rows | **8,883 rows** | **2.07 (Realistic prevalence)** |

### Per-Class Source Diversity Analysis

A core vulnerability of synthetic datasets is **source-specific shortcut learning**: if all fraudulent examples originate from one generator (e.g., `curation_agent` in `maindataset.csv`), the model learns the generator's idiosyncratic syntax rather than genuine deceptive signals.

Integrating cleaned external datasets directly addresses this:
- **Suspicious Class Diversity:**
  - Currently: 100% synthetic from single generator.
  - After Merge: 4 distinct sources:
    1. Real Indian cybercell and news advisories (Ampcus, PIB via `india_fraud_detection_FINAL.csv`)
    2. Indian student scam seed lures (`dataset.csv`)
    3. Indian civic fraud synthetic models (`india_fraud_detection_FINAL.csv`)
    4. Compositional employment fraud templates (`internet_scams_archive.csv`)
- **Benign Class Diversity:**
  - Currently: 100% synthetic academic and government notices.
  - After Merge: 4 distinct sources:
    1. Authentic Indian utility and banking notifications (TPDDL, BESCOM, SBI)
    2. Authentic mobile conversational messages (UCI `ham`)
    3. Legitimate employment postings (`internet_scams_archive.csv`)
    4. Official university and scholarship notices (`dataset.csv`)

---

## 6. Proposed Merge Plan (Schema, Grouping & Normalization)

> [!IMPORTANT]
> This plan is proposed for review. In accordance with task constraints, **no merged file has been created or modified**.

### 1. Unified Dataset Schema
The merged dataset will follow this standardized schema:
```csv
text,label,scam_type,language,source_file,source_type,license_note,group_id
```
- `text`: Raw unnormalized text message string.
- `label`: Strictly binary: `suspicious` or `benign`.
- `scam_type`: Standardized ontology: `scholarship`, `internship`, `job`, `task_job`, `mule_offer`, `competition`, `overseas_agent`, `bank_alert`, or `none`.
- `language`: Standardized language tag: `en`, `hi`, or `hinglish`.
- `source_file`: Original file name (e.g., `india_fraud_detection_FINAL.csv`).
- `source_type`: Set to `"public_dataset"` (or `"real_advisory"` where `is_synthetic == False`).
- `license_note`: Clear copyright/usage tag (e.g., `"CC-BY-4.0"`, `"Public Domain"`, `"Kaggle Open Data"`).
- `group_id`: Deterministic clustering key ensuring train/test splits never leak identical templates.

### 2. Deduplication & Cleaning Rules
1. **Typo Sanitization:** Replace `(?i)\byoyour\b` $\rightarrow$ `your` before tokenization to remove the synthetic generation artifact in `india_fraud_detection_FINAL.csv`.
2. **Canonical Normalization Check:** Compute `norm_text = normalize_text(text)`. Discard exact duplicate `norm_text` strings within the same source and category.
3. **Template Pruning:** For clusters with cosine similarity $> 0.90$ within a single template family (e.g., `generation_template_id`), retain at most 3 exemplars to eliminate synthetic over-representation.
4. **Encoding Standardization:** Re-encode all output to strict UTF-8, handling Latin-1 pound signs and special currency symbols gracefully.

### 3. Group ID Strategy for Leakage-Free Splitting
To support `StratifiedGroupKFold`:
- Format: `GRP-<SOURCE_ABBR>-<CATEGORY_ABBR>-<TEMPLATE_ID>`
- Examples:
  - `GRP-INDFRAUD-JOB-REAL01` (Real job advisories)
  - `GRP-INDFRAUD-JOB-SYNTH04` (Synthetic job template variation 4)
  - `GRP-ARCHIVE-JOB-T801c` (English job archive template `801c124226`)
  - `GRP-SPAM-HAM-001` (UCI Ham conversational cluster)
This guarantees that all variations of a single template or conversational cluster remain strictly on one side of any train/val/test split.

### 4. Text Normalization
All records will pass through the established `normalize_text` pipeline (`services/classifier/normalize.py`) to canonicalize `<URL>`, `<EMAIL>`, `<UPI>`, `<PHONE>`, `<AMT>`, and `<NUM>` tokens identically during feature extraction.

---

## 7. Files to Produce Upon Approval

Once approved, the following artifacts would be created:
1. `scripts/audit/build_merged_external_dataset.py`: A deterministic, reproducible script that ingests the raw source files, applies typo fixes, filters by domain and language, performs template deduplication, assigns group IDs, and validates the output against the schema.
2. `services/classifier/data/external_cleaned_candidates.csv`: The clean, curated candidate dataset (Tier 1 or Tier 2 based on chosen scope).
3. `services/classifier/data/external_audit_manifest.json`: An automated manifest recording row counts, category distributions, deduplication drop counts, and SHA256 checksums.
4. `tests/classifier/test_external_merge.py`: Unit tests verifying UTF-8 encoding, zero leakage into `real_test.csv`, label validity, and group integrity.

---
*End of Audit Report. Awaiting user review and authorization before generating any merged datasets.*
