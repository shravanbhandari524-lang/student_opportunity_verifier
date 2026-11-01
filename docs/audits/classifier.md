# Audit Report: ML Scam Classifier Agent (`classifier_client`)

**Audit Date:** 2026-10-30  
**Auditor:** Antigravity (AI Systems & Evaluation)  
**Target Components:**
- Microservice: `services/classifier/app.py`, `services/classifier/train.py`, `services/classifier/normalize.py`
- Node.js Service Client: `lib/classifier.js`
- L4 Specialist Agent Wrapper: `lib/agents/classifier-client.js`
- Contracts & Scoring: `lib/contracts/classifier-result.js`, `lib/scoring/score.js` (lines 245–265), `lib/coordinator.js` (lines 765–780)

---

## 1. Contract and Wiring

### 1.1 AgentResult Shape
The agent conforms to `AgentResultSchema` defined in [`lib/contracts/agent-result.js`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/contracts/agent-result.js#L1-L60). Through Migration 003 ([`lib/db/migrations/003_add_classifier_result_to_agent_results.js`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/db/migrations/003_add_classifier_result_to_agent_results.js)), `agent_results` accepts an optional `classifierResult` property adhering to `ClassifierResultSchema` ([`lib/contracts/classifier-result.js`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/contracts/classifier-result.js#L1-L14)):

```typescript
{
  checkId: string (UUID),
  agent: "classifier_client",
  kind: "agent",
  round: 1,
  status: "ok" | "skipped" | "could_not_check",
  reason: string | null,
  flags: Array<{
    id: "classifier_high",
    title: "Classifier High",
    severity: "medium",
    explanation: string,
    evidence: Array<{ type: "quote", value: string }>
  }>,
  verified: [],
  newEntities: [],
  processedEntities: [],
  unchecked: [],
  manualChecks: [],
  trace: Array<{
    check: "health",
    status: "ok",
    data_provenance: string,
    real_row_count: number,
    classifierMaxPoints: 10 | 25
  }>,
  notes: string,
  classifierResult?: {
    probability: number, // 0.0 to 1.0
    label: "suspicious" | "benign",
    topTerms: string[],
    scamType?: string
  }
}
```

### 1.2 Path Analysis: Dropped, Downgraded, or Converted Results
Every path in [`lib/agents/classifier-client.js`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/agents/classifier-client.js) was traced:

1. **Eligibility Rejection (`skipped`)**:
   - In [`canRun`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/agents/classifier-client.js#L28-L40), if text is empty/whitespace, round $\ne 1$, or finding already exists, coordinator records status `skipped` with deterministic reason `no_message_text`, `round_not_supported`, or `already_ran`.
   - In scoring, `skipped` contributes 0 points and does not penalize confidence.

2. **Empty Text Guard in `run()` (`could_not_check`)**:
   - Lines 88–96: If text is missing or whitespace, returns `status: "could_not_check"` with reason `"no_message_text"`.

3. **Service Down / Health Failure (`could_not_check`)**:
   - Lines 111–131: Calls `healthFn({ timeoutMs: Math.min(timeoutMs, 3000) })`. If the request throws or `healthRes.ok === false`, immediately returns `status: "could_not_check"` with reason `"classifier_service_unavailable"`.

4. **Inference Call Failure (`could_not_check`)**:
   - Lines 160–168: Calls `classifyFn(text, { timeoutMs })`. If `rawResult.ok === false`, returns `status: "could_not_check"` with reason `"classifier_unavailable"`.

5. **Schema Validation Failure (`could_not_check`)**:
   - Lines 170–179: Validates `rawResult.data` against `ClassifierResultSchema`. If validation fails, returns `status: "could_not_check"` with reason `"invalid_result"`.

6. **Unhandled Exception / Timeout in `run()` (`could_not_check`)**:
   - Lines 237–247: Catches errors; maps `TimeoutError` / `TIMEOUT_TRIGGERED` to reason `"timeout"`, otherwise `"classifier_unavailable"`.

7. **Flag Dropping via Verbatim Quote Guard**:
   - Lines 187–218: Even when `classifierResult.probability >= 0.80`, the agent checks `quoteInText(cleanTerm, text)` for each term in `classifierResult.topTerms`.
   - **Silent Drop Path**: If `topTerms` only contains normalized placeholders (e.g., `amt`, `amt to`, `num`) that do not exist verbatim in the raw input text, `matchingTerms` is empty. The flag `classifier_high` is **silently suppressed and omitted from `flags`**, even though the model predicted extreme scam likelihood ($p \ge 0.80$).

8. **Scoring on Missing / Failed Result**:
   - In [`lib/scoring/score.js`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/scoring/score.js#L251-L263), `classifierPoints` only computes when `finding.agent === "classifier_client" && finding.status === "ok"`.
   - If the agent returned `could_not_check` or `skipped`, `classifierPoints` remains exactly `0`. No points are added, and no fallback penalty is imposed.

---

## 2. Eligibility (`canRun`) Rule

### 2.1 Exact Deterministic Rule
Implemented in [`lib/agents/classifier-client.js`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/agents/classifier-client.js#L28-L40):

```javascript
export function canRun(snapshot) {
  const text = getMessageText(snapshot);
  if (!text || text.trim().length === 0) return false;
  if (getRound(snapshot) !== 1) return false;
  if (hasResultFor(snapshot, NAME)) return false;
  return true;
}
```

### 2.2 Input Matrix Behavior

| Input Kind | Snapshot Location | `canRun` Evaluation | Observed Behavior |
|:---|:---|:---:|:---|
| **Main Text Only** | `inputs[type="text"]` or `submission.text` | **`true`** | Runs round 1 classification. |
| **`userNotes` Only** | `inputs[type="user_notes"]` or `submission.userNotes` | **`false`** | `getMessageText` ignores user notes; returns `skipped` (`no_message_text`). |
| **OCR Text Only** | `inputs[type="image"]` (extracted OCR) | **`false`** | `getMessageText` ignores non-text inputs; returns `skipped` (`no_message_text`). |
| **Entities Only** | `entities: [...]` (domain, handle, company, phone, UPI) | **`false`** | Entities are never checked by `canRun`; returns `skipped` (`no_message_text`). |
| **Empty Input** | `text: ""` or whitespace `text: "   "` | **`false`** | Returns `skipped` with reason `no_message_text`. |

### 2.3 Confirmation: Classifier Receives Main Message Text Only
In [`lib/agents/base.js`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/agents/base.js#L67-L93):
- `getMessageText(snapshot)` strictly filters for `input.type === "text"` and `snapshot.submission.text`.
- `getUserNotes(snapshot)` ([lines 101–117](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/agents/base.js#L101-L117)) handles `user_notes`.
- `getAnalysisText(snapshot)` ([lines 126–150](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/agents/base.js#L126-L150)) merges main text + user notes + OCR text.
- `classifier-client.js` only imports and calls `getMessageText(snapshot)` ([lines 29, 49, 87](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/agents/classifier-client.js#L29)).
**Verified Fact:** The classifier never receives user notes or OCR text; it operates exclusively on the primary opportunity message text.

---

## 3. Inputs and Prompts

### 3.1 Input Payload
The agent extracts `raw_text = getMessageText(snapshot)` and transmits `{ "text": raw_text.trim() }` over HTTP POST to `/classify`.

### 3.2 LLM Prompts
- **LLM Calls:** **0**.
- **Prompts:** None. The ML classifier is a deterministic Python microservice utilizing a scikit-learn TF-IDF + Logistic Regression pipeline. There are no prompts, prompt injection vectors, or generative model calls.

### 3.3 Text Preprocessing & Truncation Invariant
In [`services/classifier/app.py`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/services/classifier/app.py#L171-L173):
```python
# Canonical normalization identically to train.py (truncated to 300 chars)
normalized = normalize_text(raw_text)[:300]
```
> [!CAUTION]
> **Severe Bug / Discrepancy Found:**
> `app.py` line 172 hard-truncates the normalized text to 300 characters (`[:300]`). In `train.py`, the training dataset was **never truncated** to 300 characters. For opportunities exceeding ~50 words, any fraudulent demand, UPI ID, or fee request placed in the second half of the message is completely ignored by the model during inference.

---

## 4. Tools and External Calls

The agent relies on two HTTP client functions in [`lib/classifier.js`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/classifier.js):

| Tool / Function | Endpoint | Default Timeout | Agent Timeout | Retries | Cache TTL | Failure Codes |
|:---|:---|:---:|:---:|:---:|:---:|:---|
| `classifierHealth` | `GET /health` | 2,000 ms | 3,000 ms | 0 | None (Uncached) | `NETWORK`, `TIMEOUT`, `UPSTREAM_ERROR` |
| `classifyText` | `POST /classify` | 3,000 ms | 20,000 ms | 0 | None (Uncached) | `INVALID_INPUT`, `RATE_LIMITED`, `UPSTREAM_ERROR`, `PARSE_ERROR`, `TIMEOUT`, `NETWORK` |

### 4.1 Real Node Client Behavior (Observed vs Intended)

The actual runtime behavior of the Node client under failure conditions was directly tested using live loopback requests:

#### Scenario A: Python Service is Down (Connection Refused)
- **Node Client Call:** `classifierHealth({ url: "http://127.0.0.1:9999" })`
- **Tool Result:**
  ```json
  {"ok": false, "error": {"code": "NETWORK", "message": "Network error contacting classifier health endpoint"}}
  ```
- **Agent Result:**
  ```json
  {
    "checkId": "11111111-1111-4111-8111-111111111111",
    "agent": "classifier_client",
    "kind": "agent",
    "round": 1,
    "status": "could_not_check",
    "reason": "classifier_service_unavailable",
    "flags": [],
    "trace": [],
    "durationMs": 0
  }
  ```
- **Observed Behavior:** Fails fast without throwing. Caught by health pre-check; logs `level: 40` (WARN) to pino.

#### Scenario B: Python Service is Slow / Hanging
- **Node Client Call:** `classifierHealth({ timeoutMs: 50, fetchFn: slowFetch })`
- **Tool Result:**
  ```json
  {"ok": false, "error": {"code": "NETWORK", "message": "Network error contacting classifier health endpoint"}}
  ```
- **Agent Result:** Returns `status: "could_not_check"`, `reason: "classifier_service_unavailable"`.
- **Observed Behavior:** AbortController fires cleanly at timeout; does not hang the process.

#### Scenario C: Python Service Returns Bad Shape (Corrupted / Invalid Schema)
- **Node Client Call:** Returning invalid types (`probability: "HIGH"`, `label: "unknown_label"`):
- **Tool Result:**
  ```json
  {
    "ok": false,
    "error": {
      "code": "PARSE_ERROR",
      "message": "Classifier response failed schema validation: [Expected number, received string; Invalid enum value]"
    }
  }
  ```
- **Agent Result:** Returns `status: "could_not_check"`, `reason: "classifier_unavailable"`.
- **Observed Behavior:** `ClassifierResultSchema.safeParse` protects downstream code from corrupted payloads.

#### Dev Environment Status
In `package.json`, `npm run dev` executes `next dev`. It does **not** launch `uvicorn services.classifier.app:app`. In local development, unless the engineer manually spawns the Python process in another terminal, the classifier is down by default and quietly emits `could_not_check`.

---

## 5. Flags and Scoring Integration

### 5.1 Emitted Flags
The agent is authorized in [`lib/contracts/flags.js`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/contracts/flags.js#L145-L149) to emit only one flag:

| Flag ID | Severity | Flag Weight in Scoring | Description | Trigger Condition |
|:---|:---:|:---:|:---|:---|
| `classifier_high` | `medium` | **0** | "ML classifier scam probability > 0.80" | `probability >= 0.80` AND at least 1 `topTerm` verbatim matches raw text. |

### 5.2 How Probability Enters Scoring (Up to 25 Points)
In [`lib/scoring/score.js`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/scoring/score.js#L245-L265):

$$\text{ratio} = \max\left(0, \frac{p - 0.50}{1.0 - 0.50}\right)$$

$$\text{classifierPoints} = \text{round}(\text{classifierMaxPoints} \times \text{ratio})$$

- If $p < 0.50$: $\text{ratio} = 0 \implies \text{classifierPoints} = 0$.
- If $p = 0.75$: $\text{ratio} = 0.50 \implies \text{classifierPoints} = \text{round}(0.50 \times \text{classifierMaxPoints})$.
- If $p = 1.00$: $\text{ratio} = 1.00 \implies \text{classifierPoints} = \text{classifierMaxPoints}$.

#### Dynamic Safeguard Cap (`classifierMaxPoints` = 10 vs 25)
In [`lib/agents/classifier-client.js`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/agents/classifier-client.js#L133-L156) and [`lib/coordinator.js`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/coordinator.js#L765-L777):
- The agent queries `/health` for `data_provenance` and `real_row_count`.
- If `data_provenance` is `"synthetic"` or `"mixed_synthetic_and_public"`, OR `real_row_count < 60`:
  $$\text{classifierMaxPoints} = 10 \quad (\text{capped to prevent synthetic overfitting from driving the score})$$
- Only when `data_provenance === "real"` and `real_row_count >= 60` is the full 25 points unlocked.
- Current active cap in production: **10 points** (`data_provenance: "mixed_synthetic_and_public"`, `real_row_count: 25`).

### 5.3 Missing Result Handling
If the classifier agent returns `could_not_check` or `skipped`, [`score.js`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/scoring/score.js#L253) ignores the finding:
- $\text{classifierPoints} = 0$.
- No risk points are assigned, and the overall score is derived solely from external verification and rule-based agent flags.

---

## 6. Evidence Validation and Leakage

### 6.1 Evidence Attachment Rule
In [`lib/agents/classifier-client.js`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/agents/classifier-client.js#L190-L218):
- Top terms are checked against the un-normalized input text with `quoteInText(cleanTerm, text)` (case-insensitive boundary check).
- Up to 3 unique matching terms are formatted as `{ type: "quote", value: term }`.

### 6.2 Evidence Defect: Token Masking Collision
- Normalization replaces entities with `<URL>`, `<EMAIL>`, `<UPI>`, `<PHONE>`, `<AMT>`, `<NUM>`.
- `extract_top_terms` in `app.py` extracts features from the normalized text. The most heavily weighted positive features in `model.joblib` are `amt` (+1.0065), `amt to` (+0.5120), and `deposit` (+0.7255).
- If the model's top terms are `['amt', 'amt to', 'deposit']`, but the user text used "Rs 50,000" (which became `<AMT>`) and does not use the exact word "deposit":
  - `quoteInText("amt", rawText)` returns `false`.
  - `quoteInText("amt to", rawText)` returns `false`.
  - Result: 0 matching terms. The flag `classifier_high` is suppressed because no quote can be attached!

---

## 7. Semantics Check

1. **Can the agent return `ok` with no findings when it did not check?**  
   **No.** `healthFn` and `classifyFn` must return HTTP 200 and schema-valid payloads.
2. **Is "checked, nothing found" distinguishable from "could not check"?**  
   **Yes.**
   - Checked, low suspicion: `status: "ok"`, `flags: []`, `classifierResult: { probability: 0.15, label: "benign" }`.
   - Could not check: `status: "could_not_check"`, `reason: "classifier_service_unavailable"` or `"classifier_unavailable"`.
3. **Does it present "no reports found" as safe?**  
   **No.** The agent attaches notes explicitly stating:
   `"Classifier probability is an informational model output and does not constitute a definitive assessment or safety guarantee."`

---

## 8. Live Behavior with REAL Services (8 Cases $\times$ 2 Runs)

The FastAPI classifier service was executed live on `http://127.0.0.1:8000` loading the frozen `services/classifier/model.joblib`. Each scenario was executed through `runAgent(classifierClient, snapshot)` in two successive runs:

| Case ID & Category | Opportunity Text Description | Run 1 Status (Latency) | Run 2 Status (Latency) | Prob / Label | Top Terms | Flags Emitted | Inconsistency |
|:---|:---|:---:|:---:|:---:|:---|:---:|:---:|
| **CASE-1: English Scam** (Clear Bad) | National Merit Scholarship asking Rs 1,500 refundable fee to `nsp-award@paytm` | `ok` (276ms) | `ok` (156ms) | **0.8807** (`suspicious`) | `['upi', 'amt', 'fee', 'selected for', 'amt to']` | `classifier_high` (quotes: "upi", "fee", "selected for") | None (Identical) |
| **CASE-2: Hinglish Scam** (Clear Bad) | Part-time job YouTube like & subscribe, deposit Rs 500 for telegram group | `ok` (174ms) | `ok` (159ms) | **0.7839** (`suspicious`) | `['deposit', 'earn', 'daily', 'time', 'ke liye']` | None ($p < 0.80$) | None (Identical) |
| **CASE-3: College Notice** (Benign) | Third year B.Tech mid-sem exam notification on dept notice board | `ok` (26ms) | `ok` (19ms) | **0.1516** (`benign`) | `[]` | None | None (Identical) |
| **CASE-4: Genuine Offer Letter** (Benign) | Infosys internship offer letter, Rs 25,000 stipend, signing contract | `ok` (162ms) | `ok` (165ms) | **0.6228** (`suspicious`) [FALSE POSITIVE] | `['amt', 'offer', 'we', 'please', 'to']` | None ($p < 0.80$) | None (Identical) |
| **CASE-5: Campus Notice** (Ambiguous) | Short campus placement drive reporting to auditorium block B | `ok` (20ms) | `ok` (18ms) | **0.4244** (`benign`) | `[]` | None | None (Identical) |
| **CASE-6: Bank OTP Alert** (Adversarial) | Legitimate card OTP security notification with INR 499 amount & Amazon | `ok` (157ms) | `ok` (139ms) | **0.5830** (`suspicious`) [FALSE POSITIVE] | `['otp', 'amt', 'your', 'to', 'this']` | None ($p < 0.80$) | None (Identical) |
| **CASE-7: Polite Formal Scam** (Adversarial) | CZone India TCS recruitment scam; fee demand placed at char 450 | `ok` (24ms) | `ok` (20ms) | **0.4124** (`benign`) [FALSE NEGATIVE] | `[]` | None | None (Identical) |
| **CASE-8: Whitespace / Empty** (Missing Input) | String with only whitespace (`"   "`) | `skipped` (1ms) | `skipped` (1ms) | N/A | N/A | None (`no_message_text`) | None (Identical) |

### Key Diagnostic Observations:
1. **Calibration vs Over-confidence:**  
   The model is **uncalibrated**. Logistic Regression output on TF-IDF features shows severe keyword sensitivity:
   - Genuine offer letters mentioning salary/stipend (`Rs 25,000`) score **0.6228 suspicious** purely due to `<AMT>` and the word `offer`.
   - Legitimate transactional OTP alerts score **0.5830 suspicious** due to currency tokens and card alerts.
   - Two-word queries like `"Job offer"` score **0.6057 suspicious**.
2. **300-Character Truncation Vulnerability:**  
   In CASE-7, a real scam offer letter requesting fee payment was classified as **0.4124 benign** because `services/classifier/app.py:172` slices the text at `[:300]`, discarding the payment demand.

---

## 9. Training Data and Metrics Audit

### 9.1 Training Dataset Composition (`final_train.csv`)
Audited from `services/classifier/data/final_train.csv` (1,406 rows):

- **Class Balance:** 735 suspicious (52.28%), 671 benign (47.72%).
- **Sources Contributing to Training:**
  - `maindataset.csv`: 597 rows (42.46%)
  - `india_fraud_detection_FINAL.csv`: 556 rows (39.55%)
  - `internet_scams_archive.csv`: 164 rows (11.66%)
  - `dataset.csv`: 89 rows (6.33%)
- **Data Provenance Breakdown:**
  - Pure Synthetic (`maindataset.csv` + `dataset.csv`): **686 rows (48.79%)**
  - Public Synthetic / Expansions: **637 rows (45.31%)**
  - Real Advisories (`real_advisory`): **83 rows (5.90%)**
  - **Total Synthetic / Semi-Synthetic:** **94.10%** of the dataset is synthetic.
- **Starter Dataset (`dataset.csv`):**
  - Size: 89 rows (44 suspicious, 45 benign).
  - Provenance: 100% synthetic, properly flagged in `metrics.json`.

### 9.2 Leakage and Overlap Prevention
- **Deduplication:** Near-duplicate string clustering and regex normalization were applied during L2 training.
- **Evaluation Split Protection:** Zero overlap verified between `final_train.csv` and `real_test.csv` (25 rows) or `external_real_holdout_candidates.csv` (115 rows). Max cosine similarity is 0.8996 (strictly $< 0.90$).

### 9.3 Honest Report of `metrics.json`

From [`services/classifier/metrics.json`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/services/classifier/metrics.json):

#### Real Test Evaluation (`real_test.csv`, $N=25$)
- **Confusion Matrix:**
  $$\begin{pmatrix} 19 & 3 \\ 1 & 2 \end{pmatrix} \quad (\text{Row 0 = Benign, Row 1 = Suspicious})$$
- **Benign ($N=22$):** Precision = 0.9500, Recall = 0.8636, F1 = 0.9048
- **Suspicious ($N=3$):** Precision = 0.4000, Recall = 0.6667, F1 = 0.5000
- **Macro Average:** Precision = 0.6750, Recall = 0.7652, **Macro F1 = 0.7024**
- **Accuracy:** 0.8400 (84.0%)

#### External Real Holdout Evaluation ($N=115$)
- **Confusion Matrix:**
  $$\begin{pmatrix} 60 & 3 \\ 2 & 50 \end{pmatrix}$$
- **Macro Average:** Precision = 0.9556, Recall = 0.9570, **Macro F1 = 0.9562**

#### Leave-One-Source-Family-Out (LOSO)
- ARCHIVE: 0.9324 | INDFRAUD: 0.5641 | MAIN: 0.7423 | STUDENT: 0.9326 | **Mean LOSO Macro F1 = 0.7928**
- **Source-Only Baseline Accuracy:** 0.5804 (close to random base rate of 0.5228).

#### Are These Metrics Meaningful?
**NO.** The metrics in `metrics.json` cannot be considered statistically representative for production performance:
1. **Severe Evaluation Imbalance:** The real test set consists of only 25 samples with just **3 suspicious samples** (12% support). A single classification mistake swings recall by 33.3% and precision by 20 percentage points.
2. **Compiler Paraphrasing in Holdout:** The 115-row holdout dataset consists of structured advisories paraphrased by dataset curators rather than noisy student messages.
3. **Explicit Warning:** `metrics.json` explicitly mandates:
   `"warning": "Metrics not reportable. Pipeline validation only."`

---

## 10. Test Coverage Analysis

### 10.1 Existing Tests
1. [`tests/classifier.test.js`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/tests/classifier.test.js) (157 lines):
   - 100% mocked fetch calls.
   - Tests `INVALID_INPUT`, schema parse success, P(scam) vs P(benign), schema validation failure (`PARSE_ERROR`), HTTP 429 (`RATE_LIMITED`), HTTP 5xx (`UPSTREAM_ERROR`), abort/timeout (`TIMEOUT`), and network failure (`NETWORK`).
2. [`tests/agents-classifier-client.test.js`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/tests/agents-classifier-client.test.js) (588 lines):
   - 100% mocked classifier dependencies.
   - Tests `canRun` conditions (empty text, round 2, existing result), skipped reasons, capped scoring (10 vs 25 points based on health provenance), verbatim quote matching, and `classifier_high` flag thresholding.
3. [`services/classifier/tests/test_classifier.py`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/services/classifier/tests/test_classifier.py):
   - Pytest unit tests for regex normalization, health response, and `/classify` endpoint schema.

### 10.2 Test Gaps
- **No Live End-to-End Test in CI:** No test verifies that the Node client and Python uvicorn service actually communicate across ports in a real environment.
- **No Long-Text Boundary Test:** No test evaluated inputs exceeding 300 characters to detect the truncation bug in `app.py`.
- **No Placeholder Evidence Test:** No test asserted what happens when the top contributing terms are placeholder tokens (`amt`, `num`).

---

## 11. Ranked Defect List

| Rank | Severity | Defect Description | Evidence (File & Line) | Proposed Fix (Proposal Only) |
|:---:|:---:|:---|:---|:---|
| **1** | **CRITICAL** | **300-character truncation in inference** causes false negatives on long offers | [`services/classifier/app.py:172`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/services/classifier/app.py#L172): `normalized = normalize_text(raw_text)[:300]` | Remove `[:300]` slice. Match `train.py` which trains on full un-truncated normalized text. |
| **2** | **HIGH** | **Normalization placeholder token leakage in top terms** suppresses `classifier_high` flag | [`services/classifier/app.py:133`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/services/classifier/app.py#L133) and [`lib/agents/classifier-client.js:198`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/agents/classifier-client.js#L198) | In `app.py`, filter out canonical tokens (`amt`, `url`, `email`, `upi`, `phone`, `num`) from `extract_top_terms` so only natural language words are returned as top terms. |
| **3** | **HIGH** | **False positives on legitimate stipends and bank notifications** | Live test CASE-4 ($p=0.6228$) and CASE-6 ($p=0.5830$) | Incorporate contextual n-grams or retrain with negative examples of university stipends and formal offers; keep score capped at 10 points. |
| **4** | **MEDIUM** | **Python service not spawned in `npm run dev`** | [`package.json:7`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/package.json#L7): `"dev": "next dev"` | Provide an npm run script (e.g. `npm run dev:all` or concurrently) that runs Next.js and uvicorn together, or document local dev prerequisites in README. |
| **5** | **LOW** | **Confidence score impact when service is down** | [`lib/scoring/score.js:253`](file:///home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/lib/scoring/score.js#L253) | Status `could_not_check` on classifier reduces check confidence denominator without explanation in report UI. |

---

## 12. Proposed Real Data Collection Plan & Dataset Format

To transition the model from `mixed_synthetic_and_public` to `data_provenance: "real"` without fabricating data or scraping prohibited platforms:

### 12.1 Sourcing Channels
1. **Public Government & Law Enforcement Fraud Bulletins:**
   - Press Information Bureau (PIB) Fact Check advisories (`pib.gov.in/factcheck`).
   - National Cyber Crime Reporting Portal alerts (`cybercrime.gov.in`).
   - UGC / AICTE public notices on fake universities and fraudulent scholarship portals.
2. **University Placement Cell Circulars (Legitimate Benign Baselines):**
   - Official internship circulars, stipend notices, and campus drive letters from public university placement bulletins (IITs, NITs, Central Universities).
3. **Opt-in Anonymous Student Submission Program:**
   - Anonymized submissions where students flag suspicious WhatsApp / Telegram messages, stripped of all personal names, phone numbers, and addresses.

### 12.2 Target Dataset Schema (`dataset_real_v1.csv`)

| Column Name | Type | Example / Description |
|:---|:---:|:---|
| `id` | string | Unique record identifier (e.g., `REAL-2026-001`) |
| `text` | string | Unmodified raw text of the opportunity / message |
| `label` | string | `suspicious` or `benign` |
| `scam_type` | string | `scholarship_scam`, `task_scam`, `mule_solicitation`, `recruitment_fraud`, `none` |
| `language` | string | `en`, `hi`, or `hinglish` |
| `channel` | string | `whatsapp`, `telegram`, `email`, `sms`, `portal` |
| `source_type` | string | `real_advisory`, `real_circular`, `verified_user_submission` |
| `source_url` | string | Verifiable public bulletin URL or notice link |
| `source_date` | string | ISO publication date (e.g., `2026-09-15`) |
| `license_note` | string | Public domain / Fair use documentation |
| `group_id` | string | Cluster identifier for campaign variants to prevent split leakage |
| `labeler_1` | string | Primary adjudicator ID |
| `labeler_2` | string | Secondary independent validator ID (enforcing inter-annotator agreement $\kappa \ge 0.85$) |
| `notes` | string | Contextual annotation |

### 12.3 Data Hygiene & Split Invariants
1. **Zero Overlap:** Stratified Group K-Fold splitting grouped by `group_id` ensuring no campaign or template leaks across train and holdout folds.
2. **Sanitization:** Apply `normalize_text` to verify zero personal phone numbers, personal bank accounts, or PII are retained.
3. **Minimum Target Size:** $\ge 600$ verified real samples (300 benign, 300 suspicious) to lift the 10-point safeguard cap to the full 25 points in accordance with ARCHITECTURE.md §15.
