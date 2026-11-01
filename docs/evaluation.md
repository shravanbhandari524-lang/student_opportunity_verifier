# Evaluation Protocol & Dataset Guide

## 1. Overview and Design Principles
The Evaluation Harness (`scripts/evaluate.js`) provides rigorous, repeatable, and offline-compatible benchmarking for the Student Opportunity Verifier. It measures how effectively the system assesses opportunity risk levels and extracts evidentiary indicators without making ungrounded claims.

> [!IMPORTANT]
> **CLAIM GUARD RULE:**
> No public accuracy claim (e.g. *"Our system detects 95% of scams"*) may be asserted or cited in documentation, presentations, or marketing unless the evaluation dataset contains **at least 50 non-synthetic cases with two independent human labels**.

---

## 2. Dataset Schema & Column Specification
Evaluation cases can be authored in either JSON or CSV format. CSV files must use the exact following column names:

| Column Name | Type / Allowed Values | Required? | Description |
|---|---|---|---|
| `id` | String | Yes | Unique case identifier (e.g. `SCHOL-001`, `SYN-TASK-002`). |
| `text` | String | Condition | Raw text of the message, SMS, email, or listing. (Either `text` or `link` required). |
| `link` | URL string | Condition | Primary URL or link attached to the opportunity. |
| `upi_id` | UPI handle | No | Payment UPI address (e.g. `scholarship@okaxis`). |
| `company` | String | No | Claimed company or organisation name. |
| `handle` | String | No | Social media, Telegram, or messaging handle. |
| `phone` | Phone string | No | Contact phone number (E.164 preferred). |
| `language` | `en` \| `hi` | Yes | Primary language of the opportunity text. |
| `expected_level` | `low` \| `medium` \| `high` \| `cannot_verify` | Yes | Ground-truth consensus risk level. |
| `scam_type` | `scholarship` \| `internship` \| `task_job` \| `mule_offer` \| `competition` \| `overseas_agent` \| `unknown` | Yes | Specific scam taxonomy category. Matches `ReportSchema.scamTypeGuess`. |
| `why` | String | Yes | Explicit rationale explaining why this expected level and scam type apply. |
| `source_type` | `synthetic` \| `real_public` \| `paraphrased` | Yes | Provenance category. |
| `source_url` | URL string | Optional | Public advisory or official source URL where the scam pattern was documented. |
| `source_date` | ISO Date (`YYYY-MM-DD`) | Optional | Date when the case was collected or published. |
| `license_note` | String | Optional | Intellectual property or license terms (e.g. `CC0`, `Public Advisory`). |
| `group_id` | String | Optional | Identifier linking related cases or templates for stratified grouping. |
| `labeler_1` | `low` \| `medium` \| `high` \| `cannot_verify` | Yes | Independent assessment by first labeler. |
| `labeler_2` | `low` \| `medium` \| `high` \| `cannot_verify` | Yes | Independent assessment by second labeler. |
| `notes` | String | Optional | Additional context, annotator comments, or linguistic details. |

---

## 3. Dataset Curation and Labelling Rules

1. **Two Independent Labelers**:
   - Every case must be reviewed independently by two labelers (`labeler_1` and `labeler_2`).
   - If labelers disagree, the case is preserved in the dataset with `hasLabelDisagreement: true`. Consensus or tie-breaker establishes `expected_level`.
2. **Provenance Definitions**:
   - `synthetic`: Artificial sample created by developers or researchers using reserved test domains (`.example`) and fake identifiers. Used exclusively for testing code paths and harness tools.
   - `real_public`: Actual suspicious offer or genuine public notice published in government consumer warnings, police advisories, university circulars, or press releases.
   - `paraphrased`: Real complaint or post where all identifying victim data has been completely stripped, generalized, or rewritten to protect privacy.
3. **Group ID Invariants**:
   - Cases sharing a `group_id` represent variations of the same underlying campaign.
   - All cases in the same `group_id` **must share the same `expected_level` and `scam_type`**. Leakage or contradiction across identical groups will cause `--validate-only` to fail.
4. **No Classifier Leakage**:
   - Evaluation text is hashed (normalized text SHA-256) and verified against the auxiliary classifier dataset (`services/classifier/data/dataset.csv`). Overlaps are flagged to prevent evaluation data leakage.

---

## 4. Execution Modes & CLI Usage

### Validation Only Mode
Validates dataset formatting, checks enum conformance, duplicate hashes, group consistency, and outputs a summary distribution table without running the pipeline:
```bash
node scripts/evaluate.js --validate-only --dataset data/eval/sample-cases.json
```

### Mode 1: Fixtures Mode (Smoke & Baseline)
Executes reference scenarios (`scenario-a`, `scenario-b`, `scenario-c`) through static stub dependencies:
```bash
npm run eval:fixtures
# Or: node scripts/evaluate.js --fixtures
```
Guarantees 100% agreement against baseline reference scenarios without hitting networks or LLMs.

### Mode 1b: Sample Smoke Mode (Synthetic Harness Plumbing Check)
Executes all synthetic cases in `data/eval/sample-cases.json` through the coordinator with deterministic scenario stubs:
```bash
node scripts/evaluate.js --sample-smoke
```
- Emits the mandatory header: `"PLUMBING CHECK ON SYNTHETIC CASES; NOT A MEASUREMENT"`.
- Validates end-to-end extraction, coordinator, scoring, and report generation without making an accuracy claim.

### Mode 2: Replay Mode (Offline Test Set Execution)
Runs cases against recorded tool and model calls in `.recordings/`:
```bash
npm run eval:replay
# Or: node scripts/evaluate.js --replay --dataset data/eval/sample-cases.json
```
If a recording is missing, it returns `{ ok: false, error: { code: "RECORDING_MISSING" } }`. It degrades cleanly to `could_not_check` without calling real external APIs.

### Mode 3: Live Mode (Controlled Production Audit)
Runs against real Gemini and search endpoints with mandatory safety guards:
```bash
node --env-file=.env.local scripts/evaluate.js --live \
  --yes-use-fake-or-public-data \
  --max-llm-calls 20 \
  --max-searches 10 \
  --dataset data/eval/real-cases.csv
```
- Reaching `--max-llm-calls` or `--max-searches` halts execution immediately and marks the generated report as **PARTIAL**.
- Never retries quota exhaustion (HTTP 429).

---

## 5. Metrics & Interpretation

| Metric | Definition | Critical Threshold |
|---|---|---|
| **Agreement** | Percentage of runs where predicted `riskLevel` matches `expected_level`. In measurement modes, always presented with sample size and Wilson score 95% CI: e.g. `Agreement: 88.0% (N=50, 95% CI: [76.5%, 94.7%])`. Never bare. In `fixtures` and `sample-smoke` plumbing modes, suppressed and replaced by matched stubs count (`plumbing check, no measurement (14 of 14 matched their stubs)`). | Target: >= 85% on verified real datasets. |
| **4x4 Confusion Matrix** | Cross-tabulation of expected vs predicted across all 4 levels. Every cell partitions into an explicit error category or "correct" (16 cells total). | Must show clear diagonal concentration. |
| **Dangerous Misses** | Scam opportunities (`high` or `medium`) predicted as `low` (2 cells: `(high, low)`, `(medium, low)`). | **ZERO TOLERANCE**. Any high -> low miss is a critical safety defect. |
| **False Alarms** | Authentic opportunities (`low`) predicted as `high` (1 cell: `(low, high)`). | Minimize to prevent blocking legitimate students. |
| **Over-cautious** | Authentic opportunities (`low`) predicted as `medium` (1 cell: `(low, medium)`). | Tracked to avoid unnecessary caution for genuine opportunities. |
| **Unhelpful Abstention** | Evaluated cases (`high`, `medium`, or `low`) predicted as `cannot_verify` (3 cells). | Indicates missing or inaccessible evidence for decisive offers. |
| **Missed Abstention** | Truly inconclusive cases (`cannot_verify`) predicted as `low`, `medium`, or `high` (3 cells). | Guard against guessing on thin evidence. |
| **Flag Agreement Rate** | For each flag ID, the proportion of runs where the final level matched the label in cases where this flag fired ("how often the final level matched the label in cases where this flag fired; not the accuracy of the flag"). | Diagnostic indicator for flag utility. |
| **Cannot Verify Rate** | Percentage of cases ending in `cannot_verify`. | Inconclusive cases should lower confidence, not guess. |
| **Could Not Check Share** | Percentage of checks where at least one agent encountered a timeout or failure. | Reflects tool network resiliency. |
| **Wilson Score 95% CI** | Closed-form Wilson score confidence interval (z=1.95996) for binomial proportions. Replaces naive bootstrap resampling and does not collapse to zero width at boundary proportions. | Provides exact, deterministic statistical bounds on agreement. |

---

## 6. What May Be Claimed vs What May Not

### Permitted Claims
- *"In offline benchmark testing against our reference fixtures, the system correctly resolved Scenarios A, B, and C with 100% agreement."*
- *"Evaluated on synthetic dataset `sample-cases.json` (N=14), the harness validated all 4 risk levels and 6 scam taxonomies."*
- *"Dangerous misses (High to Low) were 0 in the audited evaluation run."*
- Preliminary figures with qualifying double-labelled non-synthetic cases: *"Agreement: 86.0% (N=50 qualifying, 95% CI: [76.0%, 94.0%])"*.

### Prohibited Claims
- ❌ *"Our AI detects 99% of job scams"* (Unless backed by >= 50 real, double-labelled public cases with zero labeler disagreement).
- ❌ Bare accuracy percentages without sample size and confidence interval (e.g. *"Accuracy: 92%"* is prohibited).
- ❌ *"Guaranteed 100% safe opportunities"* (The system never produces a 'safe' output level; genuine offers are assessed as `low` risk).
- ❌ Citing classifier synthetic training metrics (`metrics.json`) as real-world accuracy.
