# Agent Audit Report: Payment and Entity Agent (`payment_entity`)

**Audit Date:** 2026-10-30  
**Target File:** `lib/agents/payment-entity.js`  
**Dependencies & Related Files:**
- `lib/tools/payments.js`
- `lib/tools/search.js`
- `lib/graph.js`
- `lib/data/upi-handles.json`
- `lib/data/free-email-domains.json`
- `lib/data/seed-graph.json`
- `lib/contracts/flags.js`
- `lib/contracts/normalize.js`
- `tests/agents-payment-entity.test.js`

---

## 1. Contract and Wiring

### 1.1 AgentResult Shape
`payment_entity` implements the standard specialist agent contract defined in `lib/contracts/agent-result.js:10-74`. It returns an `AgentResult` object validated by `AgentResultSchema` via helper builders in `lib/agents/base.js`:
- `buildOkResult(...)` (`lib/agents/payment-entity.js:597-610`)
- `buildSkippedResult(...)` (`lib/agents/payment-entity.js:194-201`)
- `buildCouldNotCheckResult(...)` (`lib/agents/payment-entity.js:557-564`)

The returned shape adheres strictly to:
```typescript
{
  checkId: string (UUID),
  agent: "payment_entity",
  kind: "check",
  round: 1 | 2,
  status: "ok" | "skipped" | "could_not_check",
  reason: string | null,
  flags: Array<{
    id: string,
    title: string,
    severity: "low" | "medium" | "high",
    explanation: string,
    evidence: Array<{ type: "quote" | "url", value: string }>
  }>,
  verified: string[],
  newEntities: [], // Always empty array (payment_entity never discovers new entities)
  processedEntities: string[], // Format: ["kind:value"]
  unchecked: string[],
  manualChecks: [],
  trace: Array<Record<string, any>>,
  notes: string,
  durationMs?: number
}
```

### 1.2 Silent Drops, Downgrades, and Status Transitions

1. **Silent Drop of Web Search Scam Reports (`scam_reports_found`):**
   - In `lib/agents/payment-entity.js:467-510`, when the agent queries Serper for public scam complaints on an identifier and finds a corroborated report with a valid URL (`hit.url`), it attempts to emit `scam_reports_found`:
     ```javascript
     if (canEmit("scam_reports_found", NAME)) { // line 498
       flags.push({ id: "scam_reports_found", ... });
     }
     ```
   - In `lib/contracts/flags.js:127-133`, `scam_reports_found.emitters` is registered strictly as `["reputation_osint"]`.
   - Result: `canEmit("scam_reports_found", "payment_entity")` evaluates to `false`. Every scam report found via search by `payment_entity` is silently discarded from `flags`. The search executes, consumes external Serper API quota, sets `trace.corroborated = true`, but emits no flag.
2. **Silent Drop of `personal_payment_id` on Form/OCR Inputs:**
   - In `lib/agents/payment-entity.js:318-329`, the agent enforces:
     ```javascript
     if (quoteInText(ent.value, messageText)) {
       flags.push({ id: "personal_payment_id", ... });
     } else {
       droppedQuoteCount++; // line 328
     }
     ```
   - When a user inputs a UPI ID into a dedicated form field (`submission.upi`) or when an entity is extracted from an OCR image, but the exact string does not appear verbatim in `messageText`, `quoteInText` evaluates to `false`. The flag is discarded and silently converted into a summary sentence in `notes`: `"(N potential finding(s) dropped due to unverified quote evidence)"`.
3. **Silent Drop of Email Findings Without Context Keywords:**
   - In `lib/agents/payment-entity.js:415-452`, free consumer email providers (`@gmail.com`, `@yahoo.com`) are checked. If `emResult.isFreeProvider` is true, but `messageText` does not contain one of the 5 exact `RECRUITMENT_CONTEXT_TERMS` (`internship`, `job offer`, `recruiter`, `hiring`, `selected`), no flag is emitted and no note is generated. The finding exists only as `{ check: "email_facts", isFreeProvider: true }` in `trace`.
4. **Flag Deduplication by ID:**
   - In `lib/agents/payment-entity.js:567-574`, flags are deduplicated strictly by `id`:
     ```javascript
     for (const f of flags) {
       if (!seenFlagIds.has(f.id)) {
         seenFlagIds.add(f.id);
         dedupedFlags.push(f);
       }
     }
     ```
   - If a submission contains two distinct personal UPI IDs (e.g. `user1@okaxis` and `user2@ybl`), only the first UPI ID produces a flag. The second finding is dropped.
5. **Partial Failure Transition to `could_not_check`:**
   - In `lib/agents/payment-entity.js:556-564`, the agent transitions to `could_not_check` with reason `"all_checks_failed"` if and only if `successfulChecksCount === 0 && failedChecksCount > 0`.
   - If an entity format is syntactically invalid, `syntax: invalid_format` is counted as a successful check (`successfulChecksCount++` at line 333), preventing `could_not_check` even if all external network calls fail.

---

## 2. Eligibility & `canRun`

### 2.1 Exact Rule
`canRun(snapshot)` is a pure, deterministic, synchronous function without I/O or LLM calls (`lib/agents/payment-entity.js:138-141`):
```javascript
export function canRun(snapshot) {
  const eligible = getEligibleUnprocessedEntities(snapshot);
  return eligible.length > 0;
}
```
An entity is eligible if:
1. `ent.kind` is in `ELIGIBLE_KINDS = Object.freeze(["upi", "phone", "handle", "email", "domain"])` (`lib/agents/payment-entity.js:58`).
2. The key `${ent.kind}:${ent.value}` has not been processed yet in `snapshot.control.processedEntitiesByAgent.payment_entity` or prior findings (`lib/agents/payment-entity.js:67-95`).

### 2.2 Input Kinds Matrix

| Input Kind | Evaluated Directly by `canRun`? | What Happens |
|---|---|---|
| **Main Text (`snapshot.inputs[type='text']`)** | No | `canRun` does not inspect text directly. If L5 extraction created entities from text, `canRun` evaluates those. If text contains no extractable entities, `canRun` returns `false`. |
| **User Notes (`snapshot.inputs[type='user_notes']`)** | No | Evaluated only if L5 extraction generated eligible entities from user notes. |
| **OCR Text (`snapshot.inputs[type='image']`)** | No | Evaluated only if L5 OCR extraction produced eligible entities. |
| **Entity: `upi`** | Yes | Eligible. Triggers graph lookup, `upiFacts`, and Serper scam search. |
| **Entity: `phone`** | Yes | Eligible. Triggers graph lookup, `phoneFacts` (libphonenumber-js), and Serper scam search. |
| **Entity: `handle`** | Yes | Eligible. Triggers graph lookup and Serper scam search. |
| **Entity: `email`** | Yes | Eligible. Triggers `emailFacts`. (Note: graph lookup and Serper search are skipped for email). |
| **Entity: `domain`** | Yes | Eligible. Triggers graph lookup and Serper scam search. |
| **Entity: `company`** | **NO** | Excluded from `ELIGIBLE_KINDS`. Ignored by `canRun`. |
| **Entity: `url`** | **NO** | Excluded from `ELIGIBLE_KINDS`. Handled by `website_forensics`. |
| **Entity: `amount`** | **NO** | Excluded from `ELIGIBLE_KINDS`. Ignored by `payment_entity`. |
| **Empty Input (`entities: []`)** | Yes | Returns `false`. Skipped with reason `"no_eligible_entities"`. |

---

## 3. Inputs and Prompts

### 3.1 What the Agent Actually Receives
The coordinator executes `runAgent(paymentEntity, snapshot, deps, options)` (`lib/agents/base.js:673-694`). The agent receives:
- `snapshot`: The case file snapshot containing `check`, `inputs`, `submission`, `entities`, `findings`, `events`, and `control`.
- `deps`: `{ search, graphLookup, now, ctx }` bound by `buildDefaultDeps()` (`lib/coordinator.js:58-74`).
- `options`: `{ searchBudget, timeoutMs }`.

### 3.2 LLM Prompts
**There are NO LLM prompts in `payment_entity.js`.**  
As documented in `lib/agents/payment-entity.js:7-8`, `payment_entity` is a pure code orchestrator:
> "Pure code orchestrator using injected services/tools: { search, graphLookup, now }. No direct database or LLM imports."

No LLM calls are executed, no prompt templates exist, and no model inference is performed.

### 3.3 Untrusted Content Handling
Because no LLM is invoked, prompt injection against `payment_entity` is structurally impossible. For external tool invocations:
- Search queries pass through `buildScamQuery` and `buildUpiQuery` in `lib/tools/dorks.js:14-25`, which sanitize the input via `sanitizeQueryText(input)`:
  - Strips shell metacharacters, punctuation, newlines, and boolean operators (`AND`, `OR`, `site:`, `filetype:`).
  - Truncates query tokens to 80 characters.
- Failure reasons returned by the agent are hardcoded string enums (`"all_checks_failed"`, `"graph_lookup_failed"`, `"SEARCH_ERROR"`) and never interpolate raw user inputs, phone numbers, or UPI IDs (`lib/agents/payment-entity.js:18`, `tests/agents-payment-entity.test.js:400-420`).

---

## 4. Tools and External Calls

### 4.1 Tool Inventory

| Tool / Dependency | Source / Implementation | Timeout | Retries | Cache TTL | Failure Result Shape |
|---|---|---|---|---|---|
| `graphLookup` | Injected from `lib/graph.js:lookup(kind, value, { db })` via `lib/coordinator.js:69` | Synchronous SQLite query (<5ms) | 0 | None (Direct DB read) | Returns `{ matched: false }` or throws `Error`. |
| `search` | Injected from `lib/tools/search.js:search(query, opts)` via `lib/coordinator.js:60-61` | 10,000ms (`lib/tools/base.js:63`) | 0 | 6 hours (21,600s) in SQLite `tool_cache` (`lib/tools/search.js:37`) | Returns `{ ok: false, error: { code: string, message: string } }`. |
| `upiFacts` | Direct import from `lib/tools/payments.js:46-106` | Synchronous (<1ms) | 0 | None (Pure function) | Never throws; returns normalized fact object with `valid: false`. |
| `phoneFacts` | Direct import from `lib/tools/payments.js:185-240` (uses `libphonenumber-js`) | Synchronous (<1ms) | 0 | None (Pure function) | Never throws; returns normalized fact object with `valid: false`. |
| `emailFacts` | Direct import from `lib/tools/payments.js:122-166` | Synchronous (<1ms) | 0 | None (Pure function) | Never throws; returns normalized fact object with `valid: false`. |

### 4.2 Failure Escalation & Swallowing

- **Failure Isolation:** Each eligible entity is evaluated across multiple checks:
  1. Graph lookup
  2. Syntactic / fact validation (`upiFacts`, `phoneFacts`, `emailFacts`)
  3. Serper scam query search (if entity is `upi`, `domain`, `handle`, or `phone`)
- **Swallowed Failures:**
  - If `graphLookup` fails or the DB errors, the error is caught (`lib/agents/payment-entity.js:235-243, 287-296`) and recorded in trace as `{ check: "graph_lookup", status: "failed" }`.
  - If `search` returns `SEARCH_ERROR` or `NO_KEY`, it is recorded in trace as `{ check: "scam_search", status: "error" }`.
  - If UPI syntax or phone syntax succeeds, `itemSuccessfulChecks++`. The item is considered checked, and the agent returns `status: "ok"`. External search or graph failures are swallowed into `notes` and `trace`.
- **Escalation to `could_not_check`:**
  - Triggered **only** when `successfulChecksCount === 0 && failedChecksCount > 0` (`lib/agents/payment-entity.js:556-564`).

---

## 5. Flags & Flag Registry

### 5.1 Permitted Flags

Under `lib/contracts/flags.js`, exactly 4 flags have `payment_entity` in their `emitters` list:

| Flag ID | Severity | Emitters (`lib/contracts/flags.js`) | Score Weight (`lib/scoring/config.js`) | Scoring Hard Rule? | Description |
|---|---|---|---|---|---|
| `personal_payment_id` | **High** | `["payment_entity"]` (line 116) | 25 pts | No (High-evidence flag) | Payment requested to personal UPI handle or individual bank account. |
| `graph_match` | **High** | `["payment_entity"]` (line 137) | 25 pts | **YES** (`lib/scoring/score.js:132-138` immediately forces score to 95 and risk to `"high"`) | Identifier matched known scam entity in scam intelligence graph. |
| `free_email_recruiter` | **Medium** | `["payment_entity"]` (line 181) | 12 pts | No | Recruiter contacting from free webmail provider with recruitment context terms. |
| `foreign_or_voip_number` | **Low** | `["payment_entity"]` (line 288) | 5 pts | No | Non-Indian country code or VoIP / unassigned line type. |

### 5.2 Dead Flag Code (`scam_reports_found`)
- In `lib/agents/payment-entity.js:498-508`:
  The agent attempts to emit `scam_reports_found` when a search snippet mentions scam/fraud.
- In `lib/contracts/flags.js:127-133`:
  `scam_reports_found.emitters` is `["reputation_osint"]` only.
- In `tests/agents-payment-entity.test.js:869-898`:
  A test explicitly enforces: `assert.deepEqual(res.flags, [], "payment_entity must never emit flags from search results")`.
- **Verdict:** Dead code. The agent consumes Serper search quota, analyzes results, but the flag is permanently blocked by `canEmit`.

### 5.3 PRD Patterns with No Flag ID
1. **Malformed / Syntactically Invalid UPI ID:** When a user provides `invalid..vpa@@@axis`, `upiFacts` returns `valid: false`. The agent records `{ check: "syntax", status: "invalid_format" }` in trace, but emits no flag.
2. **Company / Personal UPI Mismatch:** When an offer claims an established enterprise brand (e.g. Google, Amazon) but provides an individual UPI handle, there is no specialized flag.
3. **Unknown / Unregistered PSP Handle:** When a UPI handle does not exist in NPCI's registered PSP handle list (`upi-handles.json`), no flag exists to notify the user.

---

## 6. Evidence Validation & Preservation

### 6.1 Validation Rules by Flag

| Flag ID | Evidence Type | Generation Logic (`lib/agents/payment-entity.js`) | Risk of Loss / Dropped Finding |
|---|---|---|---|
| `personal_payment_id` | `quote` | Lines 318-327: `quoteInText(ent.value, messageText)`. | **HIGH.** If the UPI is entered in the form input field `submission.upi` or extracted from an image OCR, but not present in `messageText`, the flag is dropped (`droppedQuoteCount++`). |
| `graph_match` | `quote` or `url` | Lines 257-265: If `quoteInText(ent.value, messageText)` matches, uses `quote`. Otherwise falls back to `https://verifier.internal/graph/nodes/${graphResult.nodeId}`. | **NONE.** Guaranteed to produce evidence via fallback URL. |
| `foreign_or_voip_number` | `quote` or `url` | Lines 367-377: Prefers `quote` of `ent.value` or `pResult.raw`; falls back to `https://verifier.internal/tools/phone-validation`. | **NONE.** Guaranteed to produce evidence via fallback URL. |
| `free_email_recruiter` | `quote` | Lines 432-449: `quoteInText(matchedTerm, messageText)` where `matchedTerm` is the recruitment context word (e.g. "internship"). | **MEDIUM.** The evidence quotes the word `"job offer"`, NOT the email address itself. If the term was present in `userNotes` rather than `messageText`, quote validation fails. |

### 6.2 Coordinator Sanitization
In `lib/coordinator.js:77-130`, `sanitizeAgentResult` inspects every emitted flag:
1. Validates that `flag.id` exists in `FLAG_REGISTRY`.
2. Validates that `canEmit(flag.id, "payment_entity")` returns `true`.
3. Validates that `flag.evidence` is a non-empty array conforming to `{ type: "quote" | "url", value: string }`.
4. If `evidence.type === "quote"`, confirms the quote exists in `snapshot` text. If validation fails, the flag is stripped before DB persistence.

---

## 7. Semantics Check

### 7.1 "Checked, Nothing Found" vs "Could Not Check"
- **Checked, Nothing Found:**
  When identifiers are checked and no risks are detected, the agent returns `status: "ok"` with `flags: []` and notes:
  > `"No payment or entity red flags found; this does not mean the offer is safe (not a safety guarantee)."`
  If search checks returned 0 complaints, it explicitly appends:
  > `"Search checks returned no public complaints for N identifier(s) (not a safety guarantee)."`
  **Compliance with Non-Negotiable Product Rule 3:** No result is ever reported as "safe" or "verified clean".
- **Could Not Check:**
  Returned if and only if all attempted checks across all entities failed (`status: "could_not_check"`, `reason: "all_checks_failed"`). In this case:
  - `flags = []`
  - `verified = []`
  - `processedEntities = []`
  - `unchecked = [all entity keys]`

### 7.2 Silent Failure Vulnerability (Invalid Syntax Counted as Success)
In `lib/agents/payment-entity.js:331-339`:
```javascript
} else {
  itemSuccessfulChecks++;
  successfulChecksCount++;
  trace.push({
    entity: ent.kind,
    check: "syntax",
    status: "invalid_format",
  });
}
```
If a user submits an unparseable, malformed UPI ID or invalid phone number, the syntax check fails, but the agent increments `successfulChecksCount++`. Because `successfulChecksCount > 0`, the agent returns `status: "ok"` with `flags: []`. The user is told "No payment or entity red flags found" rather than being warned that the payment ID is malformed!

---

## 8. Live Behavior with REAL Services

Conducted using real Serper search API (`SEARCH_API_KEY` active) and live SQLite scam graph database (`data/app.db`). Each of the 8 cases was executed **2 consecutive times** to assess reproducibility, caching, and timing.

### 8.1 Live Test Matrix (16 Executions)

| # | Test Scenario | Run | Status | Emitted Flags | Verified Findings | Duration (ms) | Consistency / Inconsistency Notes |
|---|---|:---:|:---:|---|---|:---:|---|
| **1** | **Google Case**<br>Company: Google<br>UPI: `rahul.sharma99@okaxis`<br>Handle: `@google_careers_intern`<br>Phone: `+919876543210` | 1<br>2 | `ok`<br>`ok` | `graph_match` (evidence: `+919876543210`)<br>`graph_match` (evidence: `+919876543210`) | `UPI syntax valid (okaxis)`<br>`Phone number valid format` | 8,586<br>8 | **100% Consistent.** Caching reduced Run 2 to 8ms. However, `personal_payment_id` was NOT emitted because text lacked specific regex terms and Google company entity was ignored. |
| **2** | **Genuine Company Official UPI**<br>Company: National Merit Scholarship Council<br>UPI: `merit.grants@sbi` | 1<br>2 | `ok`<br>`ok` | `personal_payment_id` (evidence: `merit.grants@sbi`)<br>`personal_payment_id` (evidence: `merit.grants@sbi`) | `UPI syntax valid (sbi)`<br>`UPI syntax valid (sbi)` | 2,735<br>3 | **100% Consistent.** **FALSE POSITIVE:** Emitted `personal_payment_id` on official `@sbi` bank handle because text contained the word "Scholarship". |
| **3** | **Graph-Seeded Known Scam**<br>UPI: `scholarship.scam@okaxis`<br>(Seeded in `data/app.db`) | 1<br>2 | `ok`<br>`ok` | `graph_match` (evidence: `scholarship.scam@okaxis`)<br>`personal_payment_id` (evidence: `scholarship.scam@okaxis`) | `UPI syntax valid (okaxis)`<br>`UPI syntax valid (okaxis)` | 1,877<br>2 | **100% Consistent.** Hard-rule graph match fired with verified quote evidence; also emitted `personal_payment_id`. |
| **4** | **Unknown PSP Suffix**<br>UPI: `dev.user@unknowncryptopsp` | 1<br>2 | `ok`<br>`ok` | `personal_payment_id` (evidence: `dev.user@unknowncryptopsp`)<br>`personal_payment_id` (evidence: `dev.user@unknowncryptopsp`) | `UPI syntax valid (unknowncryptopsp)`<br>`UPI syntax valid (unknowncryptopsp)` | 2,902<br>3 | **100% Consistent.** `upiFacts` accepted unknown suffix as valid. Emitted `personal_payment_id` due to "registration" in text. |
| **5** | **Malformed UPI**<br>UPI: `invalid..vpa@@@axis` | 1<br>2 | `ok`<br>`ok` | *None* (`flags: []`)<br>*None* (`flags: []`) | *None* (`verified: []`)<br>*None* (`verified: []`) | 2,990<br>4 | **100% Consistent.** No flag emitted for malformed UPI. Status was `ok` because search executed. |
| **6** | **Handle-Only Input**<br>Handle: `student_internships_hub` | 1<br>2 | `ok`<br>`ok` | *None* (`flags: []`)<br>*None* (`flags: []`) | *None* (`verified: []`)<br>*None* (`verified: []`) | 1,799<br>2 | **100% Consistent.** Graph checked, Serper search checked. Returned `ok` with safety disclaimer. |
| **7** | **Missing Input**<br>Entities: `[]` | 1<br>2 | `skipped`<br>`skipped` | *None* (`reason: no_eligible_entities`)<br>*None* (`reason: no_eligible_entities`) | *None*<br>*None* | 1<br>0 | **100% Consistent.** `canRun` returned `false`; skipped immediately without I/O. |
| **8** | **Free Email + Foreign VoIP Phone**<br>Email: `careers.recruiter@gmail.com`<br>Phone: `+12025550143` | 1<br>2 | `ok`<br>`ok` | `free_email_recruiter` (evidence: `"job offer"`)<br>`foreign_or_voip_number` (evidence: `"+12025550143"`) | `Email syntax valid`<br>`Phone number valid format` | 3,119<br>3 | **100% Consistent.** Successfully flagged both free email recruiter and US phone number. |

### 8.2 External Call Budget & Cache Verification
- **Total Uncached Queries:** 8 Serper queries executed during Run 1 (well below the 30-query audit ceiling).
- **Cache Hit Rate:** Run 2 achieved a **100% cache hit rate**, executing 0 network calls and dropping execution latency from ~2,000–8,500ms down to 0–8ms.

---

## 9. Test Coverage & Gap Analysis

Existing test suite: `tests/agents-payment-entity.test.js` (35 tests, 5 suites, 100% pass rate).

### 9.1 What Existing Tests Cover
- Synchronous `canRun` and `skippedReason` across the 5 eligible entity kinds.
- Eligibility transitions in Round 2 when new entities are added to the case file.
- `graph_match` flag emission and evidence generation with mocked graph lookup.
- `personal_payment_id` emission when text contains government/scholarship wording.
- Dropping quotes when UPI string is absent from message text (`droppedQuoteCount`).
- `foreign_or_voip_number` emission for `+1` numbers.
- Search budget cap enforcement (`PAYMENT_SEARCH_BUDGET = 4`).
- Resilience when graph throws but search works, and when both throw (`could_not_check`).
- Redaction guarantee: phone numbers never leak into failure reasons or notes.
- Schema conformance of agent result against `AgentResultSchema`.

### 9.2 What Existing Tests Do NOT Cover (Critical Gaps)
1. **Zero Live Integration Tests:** All 35 tests use `routeMock` or stubbed functions for `search` and `graphLookup`. None test against live SQLite database queries or real Serper responses.
2. **Missing Company vs Personal UPI Tests:** No tests check whether a `company` entity in `snapshot.entities` (or `snapshot.submission.company`) triggers a mismatch flag against a personal UPI handle.
3. **No Test for Institutional UPI False Positives:** Existing test 5 tests `student.desk@okaxis` and asserts `personal_payment_id` is emitted. No test verifies that official bank or merchant VPAs (e.g. `pmcares@sbi`, `fees@icici`) are exempted.
4. **No Test for Email-as-UPI Disambiguation:** No test checks `upiFacts("user@gmail.com")`.
5. **No Test for Uppercase/Whitespace in End-to-End Run:** No test checks whether `ent.value = " USER@OKAXIS "` properly normalizes during agent execution.
6. **Search Flag Dead Code Enforced by Test:** Test 35 (`"payment_entity emits no flags from search results"`) asserts that search findings are discarded, codifying the dead-code search behavior rather than flagging it as a defect.

---

## 10. Agent-Specific Deep Dives

### 10.1 Merchant Status Verification Check
- **The Claim:**
  - `app/check/[id]/page.js:12`: `desc: "Verifying UPI VPAs, merchant status & advance fees"`
  - `app/about/page.js:177`: `"our payment agent evaluates VPA syntax, merchant status, and previous scam advisories."`
  - `docs/read.md:line 58`: `"- Say this to a judge: 'We cross-reference UPI handles against the official NPCI registry to distinguish verified merchant gateways from personal phone-number VPAs.'"`
- **The Code Reality:**
  - `lib/tools/payments.js:22-28` imports `lib/data/upi-handles.json`, which contains a static list of 28 consumer PSP / bank handle suffixes (e.g. `okaxis`, `ybl`, `paytm`).
  - There is **no NPCI merchant lookup API**. NPCI does not provide any free public API to check whether a VPA belongs to a verified merchant.
  - `upiFacts` only performs string splitting (`username@handle`) and checks whether `handle` exists in the 28-item map.
  - In `lib/agents/payment-entity.js:307`, the agent only pushes `"UPI syntax valid (${upiResult.handle})"`. It **never** verifies merchant status.
- **Verdict:** **BLATANT OVERCLAIM.** The code does not and cannot verify merchant status. Describing this agent as verifying "merchant status" in UI copy, pitch scripts, and documentation is false advertising and misleads users.

### 10.2 Company vs. Personal UPI Mismatch
- **Test Findings:**
  - Tested with text `"Google India summer internship program... pay fee to rahul.sharma99@okaxis"`:
    - **With** `{ kind: "company", value: "Google" }` in case file: `flags: []`.
    - **Without** `{ kind: "company", value: "Google" }` in case file: `flags: []`.
  - In `lib/agents/payment-entity.js`:
    - The word `company` does not appear a single time.
    - `ELIGIBLE_KINDS` excludes `company`.
    - `isInstitutionalClaim` only checks `/scholarship|recruitment|ministry|government|portal|admission|exam|registration/i`. Words like "internship", "job", "hiring", or company names like "Google" fail the regex.
- **Verdict:** **CRITICAL VULNERABILITY.** An obvious scam offering a job/internship at a Fortune 500 company while collecting payments to an individual personal UPI handle is completely ignored unless the user happens to include the exact word "recruitment" or "scholarship".

### 10.3 UPI Parsing & Edge Cases
- **Known PSP Handles:** Correctly maps 28 consumer handles to banks (e.g. `okaxis` -> Axis Bank / Google Pay).
- **Unknown Suffixes:** `upiFacts("user@unknowncryptopsp")` returns `valid: true`, `isKnownPsp: false`. However, `payment_entity.js` ignores `isKnownPsp` and treats unknown suffixes the same as known handles.
- **Numeric VPAs (Phone@PSP):** `looksLikePhone` correctly detects 10-digit usernames (`/^\d{10}$/`). However, `payment_entity.js:309-325` **never uses `looksLikePhone`**. The comment claims it checks `looksLikePhone`, but the actual `if` condition only checks `isInstitutionalClaim`.
- **Uppercase & Whitespace:** Handled by `normalizeUpi` (`input.trim().toLowerCase()`).
- **UPI That is Really an Email (`user@gmail.com`):**
  - `upiFacts("user@gmail.com")` returns `valid: true`, `username: "user"`, `handle: "gmail.com"`.
  - `upiFacts` fails to invoke `classifyAtString` (`lib/contracts/normalize.js:171`), allowing email addresses with domain dots to be parsed as valid UPI IDs.

### 10.4 Phone Handling & Privacy Invariants
- **Validation:** Uses `isValidE164` followed by `parsePhoneNumberFromString` from `libphonenumber-js`. Correctly parses country calling code, national number, and line type.
- **Foreign / VoIP Numbers:** Flags `country !== "IN"` as foreign, and `type === "VOIP"` as virtual/VoIP.
- **Strict Privacy Invariant:** Confirmed 100% compliant:
  - Phone numbers are never traced, geo-located, or reverse-queried against Truecaller or person directories.
  - Failure reasons never contain phone numbers.
  - Verified entries output generic text: `"Phone number valid format"`.

### 10.5 Scam Graph Mechanics
- **Seed Data:** `lib/data/seed-graph.json` contains 3 synthetic clusters (labeled with comment `"placeholder, fake, replace from public advisories"`):
  - Cluster 1: `fake-scholarship-portal.com`, `scholarship.scam@okaxis`, `+919876543210`, `fast_scholarship_offers`, `Fake India Scholarship Trust`.
  - Cluster 2: `task-job-earning.xyz`, `task.payment@paytm`, `+919123456789`, `daily_task_earning_bot`, `Global Task Marketing Ltd`.
  - Cluster 3: `mule-account-recruit.net`, `hr.recruiter@okhdfcbank`, `+919988776655`, `Apex International HR Services`.
- **Lookup Behavior:** Synchronously queries `graph_nodes` by `kind` and normalized `value`. If matched, counts connected nodes via `graph_edges`.
- **Hard Rule:** Emitting `graph_match` triggers a hard rule in the scoring engine (`lib/scoring/score.js:132-138`), immediately assigning score 95 (High Risk).
- **Write Invariant:** **Nothing is written to the graph during a check.** The graph write API (`saveCheckIdentifiers` in `lib/graph.js`) is only accessible via `POST /api/checks/[id]/save-to-graph` after report generation with explicit user consent (`consent === true`).

---

## 11. Ranked Defect List

| # | Severity | Defect Description | Evidence (File & Line) | Proposed Fix (No Code Changed) | Shared-File Changes Needed? |
|---|:---:|---|---|---|:---:|
| **1** | **CRITICAL** | **Company vs. Personal UPI Mismatch Ignored**<br>`payment_entity` never reads `company` entities from the case file and ignores corporate job/internship claims requesting payment to personal VPAs. | `lib/agents/payment-entity.js:58, 309-330`<br>Tested in Live Test 1: Google internship with `rahul.sharma99@okaxis` produced 0 payment flags. | Update `payment_entity.js` to read company entities from `snapshot.entities` and check if a company is present alongside a personal UPI handle or consumer PSP handle. | None (within `lib/agents/payment-entity.js`). |
| **2** | **HIGH** | **False Positives on Institutional Bank UPIs**<br>Any valid UPI in a message with "scholarship" or "registration" is flagged as `personal_payment_id`, even official bank handles (`merit.grants@sbi`). | `lib/agents/payment-entity.js:311-325`<br>Tested in Live Test 2: `merit.grants@sbi` flagged as personal payment. | Check `upiResult.looksLikePhone` OR verify if the handle is a known consumer PSP before emitting `personal_payment_id`. Exclude institutional/bank VPAs unless username looks like a personal phone number. | None (logic in `lib/agents/payment-entity.js`). |
| **3** | **HIGH** | **Overclaiming in UI and Pitch Copy ("Merchant Status")**<br>UI copy claims the agent verifies "merchant status" and cross-references NPCI registries. No such capability exists in code or free NPCI APIs. | `app/check/[id]/page.js:12`<br>`app/about/page.js:177`<br>`docs/read.md:58` | Update UI copy and docs to state accurately: *"Validates UPI VPA syntax, consumer vs bank PSP handles, phone-number VPAs, and cross-references scam graph."* Remove all references to "merchant status". | UI files (`app/check/[id]/page.js`, `app/about/page.js`, `docs/read.md`). |
| **4** | **MEDIUM** | **Dead Flag Code & Wasted Search Budget**<br>Serper search is executed looking for scam reports, but `scam_reports_found` cannot be emitted by `payment_entity` under `lib/contracts/flags.js`. | `lib/agents/payment-entity.js:498`<br>`lib/contracts/flags.js:127-133`<br>`tests/agents-payment-entity.test.js:897` | Either: (a) Add `"payment_entity"` to `scam_reports_found.emitters` in `lib/contracts/flags.js`, or (b) Remove the search call from `payment_entity` and leave reputation searches to `reputation_osint`. | Requires contract change in `lib/contracts/flags.js` if (a). |
| **5** | **MEDIUM** | **Dropped Findings When UPI Not Verbatim in Text**<br>If a UPI ID is submitted in a dedicated form input or extracted via OCR, `quoteInText` fails and drops `personal_payment_id`. | `lib/agents/payment-entity.js:318-329` | Fall back to entity source or internal reference (similar to fallback in `foreign_or_voip_number` at lines 373-376) instead of dropping the flag. | None. |
| **6** | **LOW** | **`upiFacts` Accepts Email Addresses as Valid UPIs**<br>`upiFacts("user@gmail.com")` returns `valid: true` because it does not verify that the handle lacks domain dots. | `lib/tools/payments.js:46-75` | In `upiFacts`, verify that `handle` does not contain dots, or call `classifyAtString` from `lib/contracts/normalize.js:171`. | None (tool file `lib/tools/payments.js`). |

---

## 12. Proposed Test Plan

When fixes are authorized, implement the following test additions in `tests/agents-payment-entity.test.js`:

1. **Test: Company vs. Personal UPI Mismatch Detection:**
   - Input: Snapshot with `company: "Google"` and `upi: "rahul.sharma@okaxis"`, message text: `"Google internship program: send application fee to rahul.sharma@okaxis"`.
   - Assertion: Emits `personal_payment_id` with explanation highlighting the corporate employer vs personal UPI mismatch.
2. **Test: Institutional Bank UPI Exemption (No False Positive):**
   - Input: Snapshot with `company: "National Scholarship Trust"` and `upi: "admissions@sbi"`, message text: `"National scholarship registration: pay Rs 100 to admissions@sbi"`.
   - Assertion: Does NOT emit `personal_payment_id` because `admissions@sbi` uses an institutional bank handle without phone number syntax.
3. **Test: Email-as-UPI Rejection:**
   - Input: `upiFacts("user@gmail.com")`.
   - Assertion: Returns `{ valid: false }`.
4. **Test: Form-Input / Discovered UPI Evidence Fallback:**
   - Input: Snapshot where UPI `student@okaxis` is in `entities` (source: `user_form`), but message text says `"Pay the fee to our official account"`.
   - Assertion: Flag `personal_payment_id` is NOT dropped; uses fallback URL or entity reference.
5. **Test: Search Budget Optimization:**
   - Input: Payment entity run with Serper search.
   - Assertion: Ensure any search query executed has a registered flag emitter in `FLAG_REGISTRY`.
