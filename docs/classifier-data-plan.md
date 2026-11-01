# Data Collection Plan: Opportunity Verifier ML Classifier

**Status:** ACTIVE SPECIFICATION  
**Author:** AI Systems & Evaluation  
**Date:** 2026-10-30  
**Target:** Sourcing $\ge 600$ Verified Real Opportunities (300 Benign, 300 Suspicious) to unlock full 25-point scoring weight

---

## 1. Executive Summary & Problem Context

The text classifier currently operates under a defensive 10-point safeguard cap (out of a 25-point maximum in the scoring engine) because 94.3% of the training pool is synthetic or synthetic expansions (`data_provenance: "mixed_synthetic_and_public"`). Furthermore, the evaluation test set (`real_test.csv`) contains only 25 samples with 3 suspicious cases, which is statistically inadequate for reporting production generalization metrics.

To graduate the classifier to `data_provenance: "real"` and unlock the full 25 points, a human annotator/curator must collect, annotate, and verify a ground-truth dataset from real, public, or opt-in student channels. **No synthetic data may be labeled as real.**

---

## 2. Target Quotas & Class Distribution

The target real dataset requires **at least 600 unique rows**:

| Category / Scam Type | Minimum Target Count | Description | Primary Target Sources |
|---|:---:|---|---|
| **Scholarship Scam** | $\ge 50$ | Upfront registration fees, processing charges, fake government DBT portals, fake Olympiad award demands | PIB Fact Check, UGC/AICTE warnings, cybercrime.gov.in alerts, state scholarship portals |
| **Recruitment Fraud** | $\ge 50$ | Offer letters demanding training fees, laptop security deposits, interview processing charges | Corporate fraud advisories (TCS, Infosys, Wipro, L&T), National Career Service advisories |
| **Task / Part-Time Job Scam** | $\ge 50$ | YouTube like/subscribe, telegram VIP investment, prepaid tasks, hotel/app review jobs | State Police Cyber Cell advisories, consumer forum reports, verified student submissions |
| **Mule Account Solicitation** | $\ge 50$ | Renting bank accounts, ATM cards, corporate current accounts, commission for receiving transfers | Indian Cyber Crime Coordination Centre (I4C), RBI advisories, college noticeboard alerts |
| **Contest / Lucky Draw Fraud** | $\ge 50$ | Fake lotteries, brand anniversary lucky draws, electronics gift tax demands | Public police bulletins, verified WhatsApp forward archives |
| **Loan / Credit Fraud** | $\ge 50$ | Student loan processing fee upfront, unaccredited instant loan app harassment notices | RBI cautioned list, cyber crime portal alerts |
| **Total Suspicious Rows** | **$\ge 300$** | **Balanced across all 6 opportunity fraud families** | |
| **Genuine Offer Letters** | $\ge 75$ | Official corporate internship/job offers with stipends, joining details, contract reviews | University placement cells, corporate onboarding circulars (redacted PII) |
| **Genuine College Notices** | $\ge 75$ | Examination schedules, library notices, fee submission circulars, hostel advisories | Public university websites (.ac.in / .edu.in noticeboards) |
| **Genuine Scholarships** | $\ge 75$ | NSP announcements, AICTE Pragati, state DBT notices, college merit scholarships | scholarships.gov.in, UGC notices, university trust grant notifications |
| **Genuine Bank / OTP Alerts** | $\ge 75$ | Transaction receipts, OTP verification security messages, debit/credit notifications | Standard transactional bank templates (with dummy/masked identifiers) |
| **Total Benign Rows** | **$\ge 300$** | **Balanced hard negatives preventing false alarms** | |
| **Overall Dataset Target** | **$\ge 600$** | **50% Suspicious / 50% Benign** | |

---

## 3. CSV Dataset Schema (`dataset_real_v1.csv`)

Curators must store collected samples in a standard CSV file with UTF-8 encoding. All 13 columns are mandatory:

```csv
id,text,label,scam_type,language,channel,source_type,source_url,source_date,license_note,group_id,labeler_1,labeler_2,notes
```

### Detailed Column Definitions

| Column Name | Allowed Values | Description & Rules |
|---|---|---|
| `id` | String (`REAL-[0-9]{4}`) | Unique identifier (e.g., `REAL-0001`, `REAL-0002`). |
| `text` | String (10 to 5000 chars) | Exact raw text of the message, offer letter, or advisory as presented to the student. Do not redact currency or URLs manually (handled by normalization). |
| `label` | `suspicious` \| `benign` | Binary classification label. |
| `scam_type` | `scholarship_scam`, `recruitment_fraud`, `task_scam`, `mule_solicitation`, `contest_fraud`, `loan_scam`, `none` | Subcategory of scam. Must be `none` if label is `benign`. |
| `language` | `en`, `hi`, `hinglish` | Dominant language of the message text. |
| `channel` | `whatsapp`, `telegram`, `email`, `sms`, `portal`, `physical_notice` | Communication medium where the message originated. |
| `source_type` | `real_advisory`, `real_circular`, `verified_user_submission` | Provenance of the row. Must **never** be `synthetic` for real dataset. |
| `source_url` | Valid HTTP(S) URL | Direct public reference link (e.g. `https://pib.gov.in/FactCheckDetail.aspx?id=1234`). |
| `source_date` | ISO 8601 Date (`YYYY-MM-DD`) | Date when the advisory, circular, or message was originally published. |
| `license_note` | String | Documentation of usage rights (e.g., `public_domain_gov_notice`, `fair_use_research`). |
| `group_id` | String (`GRP-[A-Z0-9_-]+`) | Group cluster identifier. **Crucial:** all campaign variants sharing the same template, phone number, or recruiter handle must share the same `group_id` so they are kept in the same fold during cross-validation. |
| `labeler_1` | String (Annotator ID) | Identifier of the primary human annotator. |
| `labeler_2` | String (Annotator ID) | Identifier of the second independent human reviewer. |
| `notes` | String | Contextual rationale, reason for label, or verification notes. |

---

## 4. Annotation & Labeling Rules

To ensure high data quality and inter-annotator agreement ($\kappa \ge 0.85$):

1. **Rule of Suspicion:** A sample is labeled `suspicious` if it contains **any** of the following:
   - Upfront fee demand for a scholarship, grant, or student aid.
   - Payment requested for job application, onboarding, interview slot, or background verification.
   - Solicitation of personal bank account, UPI ID, or SIM card for receiving third-party funds.
   - Guaranteed payment for social media tasks (liking YouTube videos, posting fake Google reviews).
   - High-urgency pressure to transfer funds to a personal UPI handle or unverified wallet.
2. **Rule of Benign Baseline:** A sample is labeled `benign` if:
   - It is an authentic job offer, college notification, bank transactional alert, or scholarship award that asks for standard academic credentials without soliciting fees or financial credentials.
3. **Dual-Review Requirement:** Every row must be independently assessed by `labeler_1` and `labeler_2`. Disagreements must be adjudicated by a third senior reviewer before inclusion.
4. **Group Leakage Rule:** Similar messages from the same scam ring (varying only in candidate name or transaction amount) must share the same `group_id`. During training, `StratifiedGroupKFold` will guarantee that no group spans across training and test splits.

---

## 5. Privacy, PII & Legal Safety Standards

- **No Scraping Prohibited Platforms:** No automated scraping of Instagram, Facebook, LinkedIn, or private messaging platforms (per AGENTS.md Product Rule 5).
- **PII Scrubbing:** Real student names, personal residential addresses, and private phone numbers must be redacted or sanitized.
- **Law Enforcement & Government Advisories:** Prioritize publicly published press bulletins and cyber cell releases which are in the public domain.
