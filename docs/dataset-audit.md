# Labeled Text Dataset Audit: Student Opportunity Verifier

**Date:** 28 October 2026  
**Auditor:** Antigravity (AI Systems & Evaluation)  
**Primary Dataset Audited:** `services/classifier/data/maindataset.csv` (600 rows)  
**Baseline / Starter Dataset Referenced:** `services/classifier/data/dataset.csv` (89 rows)  
**Applicable Specifications:** PRD.md (Sections 2, 3, 9, 17) & ARCHITECTURE.md (Section 15)  
**Random Seed:** 42 (fixed across all splits and cross-validations)

---

## Executive Summary & Key Metrics Table

| Metric Category | Target / Requirement (PRD §9) | Starter Dataset (`dataset.csv`) | Main Dataset (`maindataset.csv`) | Audit Assessment |
|---|---|---|---|---|
| **Total Rows** | $\ge 500$ rows | 89 rows | **600 rows** | **PASS** (Meets size threshold) |
| **Class Balance** | Balanced (scam vs genuine) | 44 suspicious / 45 benign (0.98 ratio) | **300 suspicious / 300 benign (1.00 ratio)** | **PASS** (Exact 50/50 balance) |
| **Scam Types Covered** | 6 PRD types, $\ge 50$ per type | 0 of 6 types $\ge 50$ (Max: 16) | **All 6 types have exactly 50 examples** | **PASS** on counts |
| **Language Distribution** | English, Hindi (Devanagari), Hinglish | 100% English (0% Hindi/Hinglish) | **55.0% English, 30.0% Hinglish, 15.0% Hindi** | **PASS** (Tri-lingual coverage) |
| **Data Provenance** | Real, sourced data (PIB, advisories, portals) | 100% synthetic | **100% synthetic** (`source_type: synthetic`) | **FAIL** (Synthetic placeholder) |
| **Source URL Coverage** | Verifiable URLs / references | 0 URLs (no source column) | **0%** (`source_url` is 100% empty) | **FAIL** (Unverified provenance) |
| **Annotator Validation** | Inter-annotator agreement ($\ge 2$ annotators) | N/A (unlabeled metadata) | `labeler_1`: `curation_agent`, `labeler_2`: empty | **FAIL** (No human second labeler) |
| **Duplicates (Exact / Near)** | Zero leakage, minimal redundancy | 0 exact, 0 near-dupes | 0 exact, 0 near-dupes | **PASS** on string uniqueness |
| **Group / Pair Leakage** | Zero split contamination | N/A (no groups) | **83 / 180 group_ids & 36 / 126 pair_ids leak** | **FAIL** (Train/test contamination) |
| **Privacy / PII Safety** | Zero private individual PII | 2 synthetic UPI handles | 143 synthetic UPIs (`@fakebank`), 0 PII | **PASS** (Zero real private PII leaked) |
| **Test Set Split** | Fixed 20% stratified test split | 18 rows (9 benign, 9 suspicious) | 120 rows (60 benign, 60 suspicious) | **PASS** (20% held out) |
| **Test Macro F1** | $\ge 0.85$, honest reported numbers | 1.0000 | **1.0000** | **FAIL** (Overfitting / Shortcut artifact) |
| **5-Fold CV Macro F1** | Robust generalization ($\le 0.97$) | $0.9764 \pm 0.0472$ | **$0.9967 \pm 0.0041$** (Group-aware: $0.9949 \pm 0.0042$) | **FAIL** (Artificial separability > 0.97) |

---

## Detailed Audit Findings by Step

### Step 1: Structure & Data Hygiene
- **Columns & Data Types:** The dataset contains 14 columns: `id` (string), `text` (string), `label` (string), `scam_type` (string), `language` (string), `channel` (string), `source_type` (string), `source_url` (string), `source_date` (string), `license_note` (string), `group_id` (string), `labeler_1` (string), `labeler_2` (string), `notes` (string).
- **Encoding:** Verified valid UTF-8 (`check_encoding` reported zero decoding errors across all bytes).
- **Missing Values:**
  - `source_url`: 600 of 600 rows (100.0%) are empty strings.
  - `labeler_2`: 600 of 600 rows (100.0%) are empty strings.
  - All other 12 columns have 0 missing values (100.0% populated).
- **Text Length Distribution:**
  - Character length: Min = 82, Max = 515, Mean = 198.12, Median = 165.00.
  - Word count: Min = 12, Max = 66, Mean = 26.38, Median = 22.00.
  - Very short texts ($< 20$ characters or $< 5$ words): **0**.
  - Very long texts ($> 1000$ characters): **0**.
- **Label Column Integrity:** Exactly two distinct values appear in the `label` column: `suspicious` (300) and `benign` (300). No misspelled, malformed, or ambiguous classes exist.

### Step 2: Size and Balance
- **Total Rows:** Exactly 600 rows. This satisfies the requirement of $\ge 500$ rows.
- **Class Balance:** Exactly 300 suspicious (50.0%) and 300 benign (50.0%), yielding a 1.0000 ratio.
- **Scam Type Representation (Suspicious Class):**
  - `scholarship`: 50 examples (16.7%)
  - `internship`: 50 examples (16.7%)
  - `task_job`: 50 examples (16.7%)
  - `mule_offer`: 50 examples (16.7%)
  - `competition`: 50 examples (16.7%)
  - `overseas_agent`: 50 examples (16.7%)
  - No scam type has fewer than 50 examples.
  - For the `benign` class, `scam_type` is consistently labeled `none` (300 examples).
- **Channel Distribution:** Perfectly balanced across 6 student communication surfaces (100 SMS, 100 Email, 100 Web, 100 WhatsApp, 100 Telegram, 100 Instagram).

### Step 3: Duplicates & Contamination Leakage
- **Exact Duplicates:** 0 exact text duplicates.
- **Normalized Duplicates:** 0 duplicates after stripping punctuation, collapsing whitespace, and lowercasing.
- **Near-Duplicates (Cosine Similarity > 0.90):** 0 pairs have TF-IDF cosine similarity $> 0.90$.
- **Group & Contrastive Pair Leakage (CRITICAL RISK):**
  - The dataset utilizes synthetic grouping (`group_id`) and contrastive pairs (`pair_id=P001` to `P126` in `notes`), where a suspicious message and a corresponding benign message were generated from identical prompt scaffolds.
  - In an 80/20 stratified random split (seed 42):
    - **83 of 180 `group_id`s (46.1%) span both train and test splits.**
    - **36 of 126 `pair_id`s (28.6%) span both train and test splits.**
  - **Impact:** The model learns specific entity names and phrasing patterns during training (e.g., `"Apex Education Foundation"`, `"Zenith Merit Directorate"`, `"Kestrel Publishing Hub"`) and easily classifies the paired instance in the test split.

### Step 4: Language Distribution & Verification
- **Distribution in Metadata:**
  - English (`en`): 330 examples (55.0%)
  - Hinglish (`hinglish`): 180 examples (30.0%)
  - Hindi (`hi`): 90 examples (15.0%)
- **Empirical Script & Lexicon Verification:**
  - Devanagari script detector: 93 examples (15.5%) have $> 15\%$ Devanagari characters (`\u0900-\u097F`).
  - Hinglish marker detector: 180 examples (30.0%) contain characteristic romanized Hindi particles (`dwara`, `karein`, `lene`, `ke liye`, `par`, `turant`, `yojana`).
  - English detector: 327 examples (54.5%).
- **Assessment:** Language representation matches the project goal of covering Indian students' communication channels (English, Hindi in Devanagari, and Hinglish).

### Step 5: Genuine (Benign) Class Quality & Hard Negatives
- **Realism of Benign Notices:**
  - Genuine examples are **not** real scrape data from official portals (`scholarships.gov.in`, `nsp.gov.in`, `aicte-india.org`). Instead, they are synthetic institutional templates with fictitious entities (e.g., `"Apex Education Foundation"`, `"Academic Scholarship Desk"`, `"Continental Technology Solutions"`, `"Campus Library Desk"`).
  - Crucially, **0 benign examples reference authentic `.gov.in` or `.ac.in` domains**. Instead, all 300 benign URLs use reserved RFC 2606 testing domains (`.test`, `.example`, `.invalid`).
- **Hard Negative Coverage:**
  - **Fee / Cost Mentions in Benign:** 72 of 300 (24.0%) mention legitimate fees (e.g., laboratory caution deposit, library late return fine, semester exam fee, hostel subsidy fee). This is a strong design feature that prevents the model from blindly equating "any fee = scam".
  - **Deadlines / Urgency in Benign:** 28 of 300 (9.3%) mention deadlines (e.g., `"before Friday 5 PM"`, `"before 20 November"`, `"submit before midnight"`).
  - **WhatsApp / Telegram Mentions in Benign:** **0 of 300 (0.0%)**. Genuine Indian college placement cells frequently share official PDF circulars or coordinator updates on department WhatsApp groups; this pattern is entirely absent from the benign set.

### Step 6: Scam Class Quality & Attack Pattern Coverage
- **Pattern Coverage Across 300 Suspicious Messages:**
  - Registration / file / processing fee: 19 examples (6.3%)
  - Task deposit / wallet recharge: 34 examples (11.3%)
  - Money mule / account rental: 50 examples (16.7% via `mule_offer`)
  - Selected without interview / instant grant: 42 examples (14.0%)
  - Credential phishing (OTP, net-banking password, ATM PIN): 83 examples (27.7%)
  - Overseas study / consular visa fee: 43 examples (14.3%)
- **Under-represented or Missing Scam Patterns:**
  - **APK Download Links:** Only 2 examples (0.7%) mention `.apk` or app installation. Malicious scholarship/loan APK distribution on WhatsApp is one of the most rampant Indian student scam vectors (PIB fact checks frequently cite fake NSP APKs).
  - **QR Code Payments:** 0 examples mention scanning a QR code to receive a stipend or pay a fee.
  - **Real Brand / Authority Impersonation:** 0 examples impersonate actual government ministries (e.g., Ministry of Tribal Affairs, UGC, NTA, PMSS) or major Indian recruiters (TCS, Infosys, Wipro). All use invented names (e.g., `"FutureTech Forum"`, `"Zenith Merit"`).

### Step 7: Shortcut and Lexical Bias Risks
- **Top 20 Most Predictive Features for Suspicious (Scam):**
  1. `rs` (+2.593)
  2. `fakebank` (+2.129)  *<-- Artificial placeholder shortcut*
  3. `000` (+1.719)
  4. `transfer` (+1.345)
  5. `to` (+1.297)
  6. `daily` (+1.158)
  7. `candidate` (+1.134)
  8. `task` (+1.031)
  9. `login` (+0.995)
  10. `fee rs` (+0.975)
  11. `password` (+0.973)
  12. `visa` (+0.945)
  13. `आई` (+0.945)
  14. `fakebank पर` (+0.945)  *<-- Artificial placeholder shortcut*
  15. `your` (+0.936)
  16. `liye` (+0.925)
  17. `ke liye` (+0.925)
  18. `करन` (+0.913)
  19. `clearance` (+0.877)
  20. `invalid` (+0.863)  *<-- Artificial TLD shortcut*

- **Top 20 Most Predictive Features for Benign (Genuine):**
  1. `the` (-1.467)
  2. `लय` (-1.054)
  3. `notice` (-1.035)
  4. `office` (-0.977)
  5. `work study` (-0.896)
  6. `guidelines` (-0.896)
  7. `department` (-0.856)
  8. `to the` (-0.834)
  9. `campus` (-0.824)
  10. `students` (-0.815)
  11. `example` (-0.815)
  12. `open` (-0.814)
  13. `cell` (-0.780)
  14. `room` (-0.772)
  15. `academic` (-0.761)
  16. `hai` (-0.712)
  17. `library` (-0.704)
  18. `international` (-0.697)
  19. `report` (-0.681)
  20. `are` (-0.662)

- **Identified Shortcut Vulnerabilities:**
  - **`fakebank` Artifact:** The token `fakebank` appears exclusively in suspicious examples (in 143 UPI handles such as `zenith-merit@fakebank`). It has an enormous weight of $+2.129$. Any message lacking `@fakebank` loses a major scam indicator.
  - **Placeholder Domain TLDs:** 216 samples explicitly feature `.example`, `.invalid`, `.test`, or `.fakebank`. The token `.invalid` has a $+0.863$ suspicious weight.
  - **Syntactic Contrast:** Suspicious texts disproportionately use direct imperative verbs (`transfer`, `login`, `submit PIN`), while benign texts disproportionately use passive departmental nouns (`department`, `campus`, `cell`, `room`, `office`).

### Step 8: Synthetic vs. Real Sourcing
- **Provenance:** 100% of the dataset is synthetic.
  - `source_type`: 600 of 600 rows (100.0%) are `"synthetic"`.
  - `source_url`: 0 of 600 rows (100.0% empty).
  - `license_note`: `"synthetic"` across all rows.
  - `labeler_1`: Generated by an automated `"curation_agent"`.
  - `labeler_2`: Empty across all rows.
  - `notes`: Contains synthetic batch generation metadata (e.g., `batch=B01` through `B06`, `campaign=dbt_phishing`, `pair_id=P001`).
- **Conclusion:** While well-formatted for pipeline prototyping, the data is entirely machine-generated. In accordance with PRD Section 9, **no performance claim or reported production metric may be cited based on this synthetic data**.

### Step 9: Privacy and Safety
- **PII Scan Results:**
  - Real Phone Numbers: **0**
  - Real UPI IDs: **0** (All 143 detected UPI handles use fictitious test banks such as `@fakebank`).
  - Real Personal Email Addresses: **0** (All emails use `.example` domains such as `info@sterling-aid.example`).
  - Indian PAN Numbers: **0**
  - Indian Aadhaar Numbers: **0**
  - Bank Account Numbers: **0**
- **Assessment:** The dataset is safe from privacy leak hazards. No private individual PII exists that would require de-identification or masking.

---

## Baseline Experiment & Robustness Evaluation (Step 10 & 11)

### Experimental Protocol
- **Pipeline:** `FeatureUnion` combining word n-grams (1–2) and character n-grams (2–5) with sublinear TF scaling, feeding into `LogisticRegression(C=1.0, random_state=42, max_iter=500)`.
- **Split:** Fixed 80/20 stratified train/test split (seed 42).
  - Training Set: 480 samples (240 benign, 240 suspicious)
  - Test Set: 120 samples (60 benign, 60 suspicious)
- **Validation:** 5-fold Stratified Cross-Validation + 5-fold Stratified Group-Aware Cross-Validation (`StratifiedGroupKFold` on `group_id`).

### Test Set Performance
```
              precision    recall  f1-score   support

      benign       1.00      1.00      1.00        60
  suspicious       1.00      1.00      1.00        60

    accuracy                           1.00       120
   macro avg       1.00      1.00      1.00       120
weighted avg       1.00      1.00      1.00       120
```

### Confusion Matrix (Test Split)
$$\begin{pmatrix} \text{TN: } 60 & \text{FP: } 0 \\ \text{FN: } 0 & \text{TP: } 60 \end{pmatrix}$$

### Cross-Validation Results
- **Standard 5-Fold Stratified CV:**
  - Macro F1: $\mathbf{0.9967 \pm 0.0041}$
  - Accuracy: $\mathbf{0.9967 \pm 0.0041}$
  - Total Misclassifications: **2 out of 600 instances (0.33%)**
- **Group-Aware 5-Fold Stratified CV (`StratifiedGroupKFold` on `group_id`):**
  - Macro F1: $\mathbf{0.9949 \pm 0.0042}$
  - Accuracy: $\mathbf{0.9949 \pm 0.0042}$

### Out-of-Fold Performance by Scam Type & Language
- **By Scam Type (OOF 5-Fold CV):**
  - `scholarship` ($n=50$): Accuracy = 0.9800, F1 = 0.9800
  - `internship` ($n=50$): Accuracy = 1.0000, F1 = 1.0000
  - `task_job` ($n=50$): Accuracy = 1.0000, F1 = 1.0000
  - `mule_offer` ($n=50$): Accuracy = 1.0000, F1 = 1.0000
  - `competition` ($n=50$): Accuracy = 0.9800, F1 = 0.9800
  - `overseas_agent` ($n=50$): Accuracy = 1.0000, F1 = 1.0000
  - `benign` ($n=300$): Accuracy = 1.0000, F1 = 1.0000
- **By Language (OOF 5-Fold CV):**
  - English (`en`, $n=330$): Accuracy = 0.9970, F1 = 0.9970
  - Hinglish (`hinglish`, $n=180$): Accuracy = 0.9944, F1 = 0.9944
  - Hindi (`hi`, $n=90$): Accuracy = 1.0000, F1 = 1.0000

---

## Qualitative Case Analysis: Misclassified and Top Borderline Examples

Because only 2 examples were misclassified across the entire 600-sample 5-fold cross-validation, the table below provides the 2 misclassified instances plus the 13 most ambiguous / borderline instances (ranked closest to the $P = 0.50$ decision boundary) to complete the 15-case qualitative error investigation:

| # | ID & Line | True Label | Predicted Label | $P(\text{susp})$ | Status | Full Text & Failure Diagnosis |
|---|---|---|---|---|---|---|
| **1** | `DATA-012` (Line 13) | `suspicious` | `benign` | 0.4713 | **MISCLASSIFIED** | *"Student Opportunity Notice: All-India Student Aid Society dwara merit fellowship announce ho chuki hai. Selected awardees apna bank account passbook copy aur transaction PIN accounts@student-aid.example par email karein before 30 November. Required security authentication verify na karne par scholarship allotment cancel kar diya jayega."*<br>**Diagnosis:** Mislabeled false negative. Heavily features bureaucratic genuine markers (`"Student Opportunity Notice"`, `"All-India Student Aid Society"`, `"merit fellowship"`). Lacks strong scam shortcuts (`Rs`, `pay`, `@fakebank`), so the phrase `"transaction PIN"` was insufficient to push it past 0.50. |
| **2** | `DATA-243` (Line 244) | `suspicious` | `benign` | 0.4335 | **MISCLASSIFIED** | *"Inter-Collegiate Coding Contest: Hackathon final stage registration details contest portal par Friday night tak register karein."*<br>**Diagnosis:** **Annotation / Generation Defect.** The generator's batch notes state `campaign=debate_league_scam; theme=identity_theft`, but the synthetic generator omitted the phishing payload or scam mechanism entirely! The text is completely benign; the model correctly predicted it as benign. |
| **3** | `DATA-369` (Line 370) | `benign` | `benign` | 0.4989 | Borderline | *"कॉन्टिनेंटल टेक्नोलॉजी सॉल्यूशंस: सिस्टम्स इंजीनियरिंग इंटर्नशिप के चयनित छात्र अपनी स्वीकृति https://continental-tech.example/join पर 27 नवंबर तक दर्ज करें। कोई शुल्क नहीं है। अपनी प्रविष्टि समय रहते पूरी करें।"*<br>**Diagnosis:** Contains `"इंटर्नशिप"`, `"चयनित"`, deadline urgency, and an external registration link. Predicted benign by a margin of only 0.0011 because `"कोई शुल्क नहीं है"` counterbalanced the urgency. |
| **4** | `DATA-032` (Line 33) | `suspicious` | `suspicious` | 0.5080 | Borderline | *"राज्य विद्यार्थी कल्याण ब्यूरो: निःशुल्क लैपटॉप योजना के लिए चयनित छात्र कूरियर शुल्क रु 950 लिंक https://matric-aid.invalid/device पर 25 नवंबर तक जमा करें। अंतिम तिथि 28 नवंबर निर्धारित है।"*<br>**Diagnosis:** Hindi laptop delivery courier scam. The high proportion of formal Hindi administrative vocabulary almost suppressed the courier fee signal (`रु 950`). |
| **5** | `DATA-124` (Line 125) | `suspicious` | `suspicious` | 0.5104 | Borderline | *"अकादमिक टास्क रजिस्ट्री: ऑनलाइन डाटा मूल्यांकन कार्य के लिए चयनित छात्र अपना छात्र पोर्टल पासवर्ड लिंक https://task-registry.test/eval पर 26 नवंबर तक अवश्य सबमिट करें। सत्यापन विंडो आज शाम 5 बजे बंद हो जाएगी।"*<br>**Diagnosis:** Hindi credential phishing. Uses `"अकादमिक टास्क रजिस्ट्री"` and formal tone. Model struggled to recognize `"पासवर्ड सबमिट करें"` as malicious in Devanagari script. |
| **6** | `DATA-286` (Line 287) | `suspicious` | `suspicious` | 0.5202 | Borderline | *"कॉलेजिएट ग्लोबल एडमिशंस ब्यूरो परिपत्र: विदेशी विश्वविद्यालयों में अध्ययन के इच्छुक छात्र ध्यान दें... कंसुलर सहायता शुल्क रु 6,500 यूपीआई global-admissions@fakebank पर 28 नवंबर से पूर्व जमा करना अनिवार्य है... पत्र टेलीग्राम पर उपलब्ध कराया जाएगा।"*<br>**Diagnosis:** Heavy bureaucratic padding diluted the fee demand and Telegram link. |
| **7** | `DATA-063` (Line 64) | `suspicious` | `suspicious` | 0.5211 | Borderline | *"United Student Welfare Board: Internship onboarding advisory. Selected trainees must upload scanned marksheet and internet banking login PIN at https://student-welfare.test/onboard grant expires before 25 November to claim stipend."*<br>**Diagnosis:** Phishing for net-banking PIN. Institutional wording (`"Welfare Board"`, `"onboarding advisory"`) pulled it close to the benign threshold. |
| **8** | `DATA-503` (Line 504) | `benign` | `benign` | 0.4649 | Borderline | *"HackIndus 2026 hackathon registrations open. Free registration, Rs 50,000 cash prizes. Team register karein https://hackathon-indus.example/portal valid before 25 November."*<br>**Diagnosis:** Hard negative. Mentions cash prizes (`Rs 50,000`), a link, and deadline urgency. The phrase `"Free registration"` prevented a false positive. |
| **9** | `DATA-224` (Line 225) | `suspicious` | `suspicious` | 0.5363 | Borderline | *"ऑल इंडिया कोडिंग काउंसिल: हैकाथॉन फाइनल के लिए अपना प्रोजेक्ट कोड एवं सर्वर पासवर्ड पोर्टल https://coding-council.invalid/submit पर 29 नवंबर से पहले अपलोड करें।"*<br>**Diagnosis:** Credential harvesting disguised as a hackathon submission. |
| **10** | `DATA-065` (Line 66) | `suspicious` | `suspicious` | 0.5424 | Borderline | *"Eastern Technology Consortium: Cloud trainee technical onboarding details candidate portal par Friday shaam se pehle check karein."*<br>**Diagnosis:** Subdued scam message with subtle link baiting; lacking monetary figures. |
| **11** | `DATA-019` (Line 20) | `suspicious` | `suspicious` | 0.5430 | Borderline | *"National Talent Council: Engineering scholarship grant Rs 30,000 approve ho chuka hai. Portal par verification documents submit karein, registration status approve ho jayega."*<br>**Diagnosis:** Advance-fee scholarship hook without an explicit fee demand in the snippet. |
| **12** | `DATA-166` (Line 167) | `suspicious` | `suspicious` | 0.5474 | Borderline | *"इंस्टेंट पेआउट हब: अपने बैंक खाते के माध्यम से छात्रवृत्ति फंड ट्रांसफर करें और 10% कमीशन कमाएं। संपर्क करें payout@instant-hub.example पर। ऑनलाइन आवेदन 27 नवंबर तक स्वीकार्य हैं।"*<br>**Diagnosis:** Hindi money mule offer. Formal phrasing muffled the account rental cue. |
| **13** | `DATA-038` (Line 39) | `suspicious` | `suspicious` | 0.5533 | Borderline | *"Immediate action required: Collegiate Bursary Trust: Shortlisted candidates must email their student identity card and bank passbook copies to bursary@gyandeep.example before Friday to avoid cancellation."*<br>**Diagnosis:** Identity theft / passbook collection scam disguised as university bursary. |
| **14** | `DATA-092` (Line 93) | `suspicious` | `suspicious` | 0.5561 | Borderline | *"Kestrel Publishing Hub: Creative intern role selected. Submit student portal password at https://kestrel-media.invalid/claim before 26 November."*<br>**Diagnosis:** Credential harvesting via fake intern portal. |
| **15** | `DATA-009` (Line 10) | `suspicious` | `suspicious` | 0.5578 | Borderline | *"Sterling Welfare Foundation: Candidate records for the annual Rs 15,000 welfare grant have been approved. Send your marksheet copy and processing fee receipt to info@sterling-aid.example. Complete document submission before the final date immediately."*<br>**Diagnosis:** Advance-fee scam requesting a processing fee receipt. |

---

## Step 11: Robustness Analysis (Why F1 = 1.0000 is a Critical Red Flag)

In real-world text classification for fraud detection, an out-of-the-box TF-IDF Logistic Regression model **never** scores $F_1 = 1.0000$ on held-out text. This metric is a mathematical signature of **artificial separability**:

1. **Synthetic Generation Artifacts:** All 600 examples were synthesized by the same automated curation pipeline (`curation_agent`). The model easily latched onto formulaic structure rather than underlying semantic risk.
2. **Leakage of Synthetic Entities:** 83 groups and 36 contrastive pairs span the train and test split. When the model trains on `Apex Education Foundation` in the scam class, it memorizes the template token context and trivially separates `Apex Education Foundation` in the benign class.
3. **Absence of Real-World Noise:** The dataset has zero spelling mistakes, zero informal chat slang (e.g., `"bro"`, `"bhai"`, `"sirji"`), zero emojis (0.0%), and zero forwarded message headers (`Forwarded as received`). Real scam messages intercepted by students on Telegram/WhatsApp have high noise, non-standard spelling, and obfuscated keywords (e.g., `"P@ym3nt"`, `"₹₹₹"`).

---

## Audit Verdict

### **VERDICT: USABLE WITH FIXES (FOR PIPELINE DEVELOPMENT ONLY) / NOT READY (FOR REPORTED METRICS)**

### Justification Against Product & Architectural Requirements
1. **Size Requirement ($\ge 500$ rows):** **MET.** The dataset contains 600 rows.
2. **Scam Type Balance:** **MET.** All 6 scam types have exactly 50 examples.
3. **Language Coverage:** **MET.** English (55%), Hinglish (30%), and Hindi (15%) are represented.
4. **Data Provenance & Source URLs:** **FAILED.** PRD Section 9 strictly mandates: *"a labeled set built from public scam advisories and news reports, Reddit scam posts, and genuine notices from official career pages and scholarship portals... the starter dataset is synthetic for pipeline validation only, so no performance claim may cite starter metrics."* The dataset is 100% synthetic with 0% real source URLs.
5. **Validation Integrity:** **FAILED.** Single-labeler LLM generation (`labeler_2` is 100% empty) resulted in label errors (e.g., `DATA-243` is a completely benign sentence mislabeled as suspicious).
6. **Data Leakage:** **FAILED.** 46.1% of groups and 28.6% of contrastive pairs contaminate the train/test boundary under naive stratified splits.

---

## Prioritized List of Fixes

| Priority | Action Item | Target Quantity / Scope | Rationale |
|---|---|---|---|
| **P0 (Critical)** | **Enforce Group-Aware Splitting in Training Code** | Update `services/classifier/train.py` to use `StratifiedGroupKFold` or `GroupShuffleSplit` on `group_id`. | Eliminates contrastive pair and template leakage across train and test sets. |
| **P0 (Critical)** | **Fix Labeling / Generation Bug on `DATA-243`** | Edit or replace `DATA-243` (currently benign text mislabeled as suspicious). | Prevents noise injection into the competition scam category. |
| **P1 (High)** | **Replace Fictitious TLDs and `@fakebank` Shortcuts** | Normalize or neutralize `@fakebank` and RFC 2606 domains (`.invalid`, `.test`, `.example`) into realistic synthetic or generic masked tokens (e.g., `@upi`, `https://portal...`). | Prevents the model from learning `@fakebank = scam`. |
| **P1 (High)** | **Inject Real Sourced Advisories & Warnings** | Collect **100–150 real scam advisories** from PIB Fact Check, National Cyber Crime Reporting Portal (cybercrime.gov.in), and student Reddit threads. | Satisfies PRD Section 9 requirement for real, sourced data before citing public metrics. |
| **P2 (Medium)** | **Add Real Genuine Official Notices** | Collect **75–100 genuine circulars** from `scholarships.gov.in`, `aicte-india.org`, IIT/NIT placement cell notices, and university portals. | Teaches the model authentic `.gov.in` and `.ac.in` institutional syntax. |
| **P2 (Medium)** | **Inject Real Chat Noise & Attack Vectors** | Add 30 APK scam messages, 25 QR code payment traps, and realistic Telegram task screenshots. | Fills critical attack pattern blind spots (currently only 0.7% APK, 0% QR codes). |
| **P3 (Low)** | **Dual-Annotator Spot Check** | Sample 20% of the dataset (120 rows) for independent human labeling (`labeler_2`). | Establishes human baseline agreement and validates synthetic label quality. |

---

## 20 Suggested New Real-World Example Types to Collect (Descriptions Only)

*Note: Per audit rules, these are descriptive collection targets, not fabricated messages.*

1. **PIB Fact-Checked Fake National Sports Scholarship:** SMS circular claiming immediate grant disbursement under an official-sounding PM sports scheme, prompting users to click a non-governmental portal link.
2. **AICTE Laptop Scheme Forward:** Viral WhatsApp forward claiming free laptops for college students under a fake central education ministry initiative, directing students to pay a courier delivery charge.
3. **Genuine NSP Merit Scholarship Renewal Circular:** Official notice from `scholarships.gov.in` detailing biometric authentication dates and institute verification deadlines for state post-matric scholars.
4. **Telegram "Like & Subscribe" YouTube Task Job:** Telegram direct message promising ₹50–₹100 per video like, paying out for the first three tasks before demanding a ₹1,000 security recharge to access VIP tasks.
5. **Student Bank Account Rental (Money Mule Recruitment):** Instagram DM offering college students ₹3,000 per week for allowing "crypto trade settlements" through their student savings bank account.
6. **Fake Campus Placement Drive (Tier-1 IT Impersonation):** Email masquerading as Infosys or Wipro HR offering direct appointment for software trainees, requesting a refundable laptop security deposit.
7. **Genuine College Placement Cell Circular:** Department placement circular announcing an upcoming TCS/Cognizant on-campus drive, interview schedules, dress codes, and explicit zero-fee disclaimers.
8. **Fake International Conference / Paper Presentation Fee:** Unsolicited email inviting engineering students to present research papers in Dubai/Singapore with mandatory upfront publication and delegate fees.
9. **Fake Data Entry / Typing Job with Penalty Clauses:** Offer letter for home-based manuscript transcription demanding a software activation charge, followed by legal threat notices for delayed submissions.
10. **Genuine University Semester Examination Fee Notification:** Official circular from a state technical university specifying semester backlog exam registration dates, late fees, and portal links.
11. **Overseas University Visa Approval Fee Scam:** Email from a fraudulent Canadian/UK immigration agency claiming guaranteed student visa issuance upon payment of consular verification fees to a personal account.
12. **Fake Hackathon Registration Fee Trap:** Student hackathon flyer on social media charging ₹500 per team entry, using stolen sponsor logos and promising cash prizes, with no institutional affiliation.
13. **Genuine Major Hackathon Announcement (e.g., Smart India Hackathon):** Official SIH notification regarding problem statement releases, internal college rounds, SPOC registration, and zero registration fees.
14. **Fake Student Emergency Loan App SMS:** SMS offering instant collateral-free loans of ₹20,000 to students with a link to download an untrusted APK outside Google Play.
15. **Pre-Selection Training Fee for Airline Ground Staff:** WhatsApp message offering direct selection for airport baggage or ticket counter roles, requiring upfront uniform and security clearance charges.
16. **Genuine University Hostel Admission & Mess Fee Circular:** Official institute notice specifying hostel room allotment lists, caution deposit fees, and online payment through the state treasury or SBI Collect.
17. **Fake Internship Offer from Stolen Startup Domain:** Recruiter email using a newly registered lookalike domain of a Y Combinator startup, offering remote analyst roles upon payment for training modules.
18. **Telegram Movie Ticket / Hotel Review Scam:** Telegram channel invitation promising daily earnings for rating Bollywood movie trailers, with tiered deposit tasks.
19. **Genuine Government Research Fellowship (e.g., CSIR / UGC JRF):** Official notification regarding Junior Research Fellowship contingency grants, score card validity, and portal claim procedures.
20. **WhatsApp Group QR Code Fee Scam:** Impersonator inside a college freshman WhatsApp group sharing a personal UPI QR code to collect "department symposium badge fees".
