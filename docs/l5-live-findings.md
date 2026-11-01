# Layer L5 Live-Run Diagnostic Findings (Step S0)

## Executive Summary
This document records the diagnosis of live-run behaviors observed during Layer L5 Step E2 execution across two self-written fake scenarios (`genuine` and `scam`), adhering strictly to the non-negotiable product principles in `AGENTS.md`.
No secrets or live keys were committed or logged.

---

## 1. Live Inputs and Extracted Entities

### Scenario 1: Scam (`--live-scenario scam`)
#### Form Field Inputs
- **`text`**: `"Urgent student opportunity: Selected for State Youth Assistance Grant of Rs 25,000. Submit verification deposit of Rs 400 to national.grant.desk@okaxis immediately to claim funds."`
- **`url`**: `"https://youth-grant-claim.example/portal"`
- **`upiId`**: `"national.grant.desk@okaxis"`
- **`company`**: `undefined`

#### Extracted & Confirmed Entities (`getEntities`)
| Kind | Value | Source |
|---|---|---|
| `url` | `https://youth-grant-claim.example/portal` | `user` |
| `domain` | `youth-grant-claim.example` | `user` (extracted by `normalizeDomain` from input URL) |
| `upi` | `national.grant.desk@okaxis` | `user` |
| `amount` | `25000` | `extracted` |
| `amount` | `400` | `extracted` |

#### Website Forensics Eligibility & `domain_no_history` Flag
- **Why `website_forensics` was eligible**: `website_forensics.canRun(snapshot)` checks for any unprocessed entity with `kind === "domain"` or `kind === "url"`. The presence of `domain:youth-grant-claim.example` made the agent eligible in Round 1.
- **Why it flagged `domain_no_history`**: `website_forensics` queried the Internet Archive Wayback Machine CDX API (`waybackFirstSeen`) for domain `youth-grant-claim.example`. Because `.example` is a reserved domain (RFC 2606 / RFC 6761) never registered on the public internet, the CDX server returned `found: false`. Under rule (b) in `website-forensics.js` (and contract `FLAG_REGISTRY.domain_no_history`), a successful query returning `found: false` legitimately emits `domain_no_history` (severity: `low`, 5 points) with the domain URL as evidence.

---

### Scenario 2: Genuine (`--live-scenario genuine`)
#### Form Field Inputs
- **`text`**: `"National Institute of Science Research: Applications are invited for the Summer Research Fellowship 2026. Selected scholars receive a monthly stipend of Rs 12,000. No application fee or deposit is ever required. Apply through official portal at https://research-portal.institute.edu.example/apply by May 15."`
- **`url`**: `"https://research-portal.institute.edu.example/apply"`
- **`company`**: `"National Institute of Science Research"`
- **`upiId`**: `undefined`

#### Extracted & Confirmed Entities (`getEntities`)
| Kind | Value | Source |
|---|---|---|
| `url` | `https://research-portal.institute.edu.example/apply` | `user` |
| `domain` | `research-portal.institute.edu.example` | `user` |
| `company` | `National Institute of Science Research` | `user` |
| `amount` | `12000` | `extracted` |

---

## 2. Deterministic Scoring Results (`ScoreResult`)

### Scam Scenario ScoreResult
```json
{
  "level": "low",
  "score": 5,
  "confidence": "medium",
  "completedCount": 4,
  "eligibleCount": 6,
  "completionRatio": 0.6666666666666666,
  "rulesFired": [],
  "reasonCodes": [],
  "flagPoints": [
    {
      "id": "domain_no_history",
      "points": 5,
      "status": "counted",
      "agents": ["website_forensics"]
    }
  ]
}
```

### Genuine Scenario ScoreResult
```json
{
  "level": "medium",
  "score": 25,
  "confidence": "medium",
  "completedCount": 4,
  "eligibleCount": 6,
  "completionRatio": 0.6666666666666666,
  "rulesFired": [],
  "reasonCodes": [],
  "flagPoints": [
    {
      "id": "not_on_official_portal",
      "points": 20,
      "status": "counted",
      "agents": ["official_verifier"]
    },
    {
      "id": "domain_no_history",
      "points": 5,
      "status": "counted",
      "agents": ["website_forensics"]
    }
  ]
}
```

---

## 3. `message_analyst` PARSE_ERROR Diagnosis

### The Zod Schema (`lib/agents/message-analyst.js:41-53`)
```javascript
const FindingItemSchema = z
  .object({
    flagId: z.enum(ALLOWED_FLAGS),
    quote: z.string().min(1),
    explanation: z.string().max(300),
  })
  .strict();

export const AnalystResponseSchema = z
  .object({
    findings: z.array(FindingItemSchema).max(MAX_FLAGS_PER_AGENT),
  })
  .strict();
```

### System & User Prompt Structure (`lib/agents/message-analyst.js:61-81, 153-154`)
The user prompt wraps untrusted text:
```
Analyze the following opportunity text for suspicious red flags:

<<<UNTRUSTED_CONTENT:MESSAGE_TEXT>>>
Urgent student opportunity: Selected for State Youth Assistance Grant of Rs 25,000. Submit verification deposit of Rs 400 to national.grant.desk@okaxis immediately to claim funds.
<<<END_UNTRUSTED_CONTENT:MESSAGE_TEXT>>>
```
The system prompt lists the allowed flags and mandates:
`"1. Report ONLY red flags that are clearly supported by the text."`
`"2. For each detected flag, you MUST extract an exact, verbatim quote from the text as evidence."`
`"4. If no red flags are found, return an empty findings list []."`

### What `generate()` returns on schema failure (`lib/llm/generate.js:456-463`)
`generate()` returns:
```javascript
{
  ok: false,
  error: {
    code: "PARSE_ERROR",
    message: "LLM output failed schema validation after retry: <issues>"
  }
}
```

### Real Model Call Debug Output & Root Cause Analysis
During our probe call on Gemini with the exact prompt and system instructions:
- **Raw Model Response**:
  ```json
  [
    {
      "red_flag_id": "authority_impersonation",
      "evidence_quote": "State Youth Assistance Grant",
      "explanation": "The message mimics an official government grant program to establish false trust."
    },
    {
      "red_flag_id": "scholarship_fee_demand",
      "evidence_quote": "Submit verification deposit of Rs 400 to national.grant.desk@okaxis immediately to claim funds.",
      "explanation": "An upfront deposit fee is demanded before the grant funds can be claimed."
    },
    {
      "red_flag_id": "urgency_pressure",
      "evidence_quote": "Urgent",
      "explanation": "Creates artificial time pressure to force the user to act without verifying."
    }
  ]
  ```
- **Zod Error on Attempt 1**:
  `Expected object, received array` (the model returned a top-level JSON array `[...]` instead of `{ "findings": [...] }`).
- **Zod Error on Schema Retry**:
  When `generate.js` retried with `[ATTENTION: Output failed schema validation: Expected object, received array...]`, the model returned `{ "findings": [ { "red_flag_id": "...", "evidence": "..." } ] }`.
  Validation failed with:
  `findings.0.flagId: Required; findings.0.quote: Required; findings.0: Unrecognized key(s) in object: 'red_flag_id', 'evidence'`.
- **Root Cause**:
  `buildSystemPrompt()` does not show the JSON key names required by `AnalystResponseSchema`. The model hallucinated generic field names (`red_flag_id`, `evidence_quote` / `evidence`) and root array syntax instead of `{ "findings": [ { "flagId", "quote", "explanation" } ] }`. Because `FindingItemSchema` is `.strict()`, unrecognized keys caused validation failure on both initial and retry attempts.
- **Proposed Smallest Fix**:
  In `lib/agents/message-analyst.js`, add an explicit JSON schema template example to `buildSystemPrompt()`:
  ```json
  Output must strictly be a JSON object with this shape:
  {
    "findings": [
      {
        "flagId": "<one of the allowed IDs>",
        "quote": "<exact verbatim quote>",
        "explanation": "<factual explanation under 300 chars>"
      }
    ]
  }
  ```

### Resolution Implemented (Step S1)
1. **Prompt Enhancement (`lib/agents/message-analyst.js:80-120`)**:
   - Explicit requirement added: strictly ONE JSON object with `"findings"`.
   - Explicit prohibition of root JSON arrays and markdown code fences.
   - Exact camelCase key names specified: `findings`, `flagId`, `quote`, `explanation`.
   - Two clearly fictitious examples added (Martian Astro-Mining Guild and Venusian Cloud Academy) demonstrating positive findings and empty findings `[]`.
2. **False-Positive Negation Guard (`lib/agents/config.js`, `lib/agents/message-analyst.js`)**:
   - `FEE_FLAG_IDS` and `FEE_NEGATION_PATTERNS` defined for fee-demand flags.
   - `isFeeQuoteNegated()` checks quote and surrounding clause (within sentence / boundary limits) for negation phrases like "no application fee", "never required", "free of charge", "is not required", "waived", "exempt".
   - Negated fee quotes are dropped and tracked as `dropped_negated_fee: <count>` in `notes`.
3. **Live Verification Results**:
   - **Scam Notice**: `status: "ok"`, duration: ~18.5s, 0 retries (`attemptCount: 1`). Flags emitted:
     1. `scholarship_fee_demand` (severity: `high`, quote: `"Submit verification deposit of Rs 400 to national.grant.desk@okaxis immediately to claim funds."`)
     2. `authority_impersonation` (severity: `high`, quote: `"State Youth Assistance Grant"`)
     3. `urgency_pressure` (severity: `low`, quote: `"Urgent"`)
     - `notes`: `"Identified 3 red flag(s)."`
   - **Genuine Notice**: `status: "ok"`, duration: ~10.3s, 0 retries (`attemptCount: 1`).
     - `flags`: `[]`
     - `notes`: `"No red flags found in message text; this does not mean the offer is safe (not a safety guarantee)."`
     - Zero false positive flags emitted.
4. **Structured Output Note (L2 Architecture Follow-up)**:
   - In `lib/llm/generate.js:146`, the Gemini API adapter passes `responseMimeType: "application/json"`, but does not pass `responseSchema` (OpenAPI format). Passing `responseSchema` directly in `generate.js` would provide provider-level schema enforcement and is tracked as an L2 hardening follow-up.

### Residual Risk Analysis: Scammer-Controlled Negation Text (Step S1b)
- **Attack Vector**: Scammers frequently craft notices with deceptive framing such as `"No application fee, only a refundable security deposit of Rs 500 is required"` or `"Zero registration charge; however send Rs 250 via UPI to book seat"`. If a negation guard were overly simplistic, it could mistakenly suppress legitimate fee-demand flags due to the presence of words like `"no fee"`, `"zero charge"`, or `"waived"`.
- **Defense In Depth**:
  1. **Affirmative Payment Signals (`PAYMENT_REQUEST_SIGNALS`)**: Even if negation keywords appear, the guard never drops a fee flag if the quote or its clause contains currency amounts (`Rs`, `INR`, `₹`, bare numbers near fee words), payment action verbs (`pay`, `send`, `transfer`, `submit`, `remit`, `is payable`), UPI IDs, or demand terms (`refundable`, `advance`, `processing charge`, `security deposit`, `token amount`).
  2. **Contrast-Word Pivot Detection (`CONTRAST_WORDS`)**: When a negation is followed by a contrast or pivot word (`but`, `however`, `only`, `except`, `though`, `although`, `yet`) in the same sentence, the sentence is deemed a conditional or mixed demand, preventing flag suppression.
  3. **Multi-Agent Redundancy**: Other specialist agents operate independently: `payment_entity` flags suspicious UPI handles and unregistered PSP handles; `website_forensics` checks domain freshness and threat feeds; `official_verifier` cross-references official schemes.
  4. **L3 Critical-Agent Rule (Step S2)**: If `message_analyst` fails or cannot verify, a low-risk score is forbidden, preventing scammers from turning failed analysis into a "safe" or "low-risk" verdict.

---

## 4. `payment_entity` Investigation in Genuine Run

### Observations
In the genuine live run, `payment_entity` resulted in `status: could_not_check` with reason `all_checks_failed`.
- **Entities present**: `domain:research-portal.institute.edu.example`, `company:National Institute of Science Research`, `url:...`.
- **Eligible kinds for `payment_entity`**: `["upi", "phone", "handle", "email", "domain"]`. Thus, only `domain:research-portal.institute.edu.example` was eligible for `payment_entity`.
- **Executed Checks**:
  1. `graph_lookup` for domain: Returned `matched: false`.
  2. `scam_search` for domain: The Serper search query was:
     `"research-portal.institute.edu.example" scam OR fraud OR fake OR "not paying"`
     Serper returned an `UPSTREAM_ERROR` (HTTP 500 / timeout from search provider).
- **Why `payment_entity` returned `could_not_check`**:
  In `payment-entity.js:530`, the partial failure rule states:
  ```javascript
  if (successfulItemCount === 0 && failedItemCount > 0) {
    return buildCouldNotCheckResult({ reason: "all_checks_failed" });
  }
  ```
  Because the only eligible item was the single domain, and its scam-report search failed with an upstream error while the graph lookup yielded no match, `itemFailed` was flagged, causing the agent to degrade to `could_not_check`.
- **Direct Graph Lookup Probe**:
  - `lookup("domain", "research-portal.institute.edu.example")` -> `{ matched: false }`
  - `lookup("upi", "national.grant.desk@okaxis")` -> `{ matched: false }`
  The graph lookup itself works correctly and returns raw `matched: false` when entities are absent from the local graph database.

---

## 5. Classifier Microservice Status

- **Default URL**: `http://localhost:8000` (`CLASSIFIER_URL` in `lib/classifier.js:45`).
- **Return on `ECONNREFUSED`**:
  `classifyText` catches network/connection failure and returns `{ ok: false, error: { code: "NETWORK", message: "Network error contacting classifier service" } }`.
  `classifier_client.js:101` catches `!rawResult.ok` and returns `could_not_check` with reason `classifier_unavailable`.
- **Can the service be run locally?**:
  **Yes**. Python 3.11.16 is installed on the host system. The virtual environment `services/classifier/.venv` is already created with `uvicorn` and dependencies installed.
- **Commands to start the classifier** (listed for reference, not run):
  ```bash
  cd services/classifier
  source .venv/bin/activate
  uvicorn app:app --host 0.0.0.0 --port 8000
  ```

---

## 6. Scam Live Run Report Wording Audit

- **Assigned Risk Level**: `LOW` (due to `message_analyst` failing to validate and `domain_no_history` contributing only 5 points).
- **Summary**:
  `"No immediate suspicious indicators were detected during preliminary public record checks. Low risk is not a guarantee of safety or endorsement. Always stay alert and verify official channels."`
- **CouldNotCheck List**:
  - `classifier_client: classifier_unavailable`
  - `message_analyst: PARSE_ERROR`
- **Checklist**:
  Includes manual verification steps advising the student to verify items that could not be checked automatically:
  - `Check could not be completed automatically; verify manually (classifier_client: classifier_unavailable)`
  - `Check could not be completed automatically; verify manually (message_analyst: PARSE_ERROR)`
- **Evaluation**:
  Even though `message_analyst` failed on JSON schema parsing, the report strictly complied with safety invariants: it refused to label the offer as "safe", explicitly included the `LOW_RISK_NOTICE_EN` disclaimer, and surfaced the failed checks in `couldNotCheck` and the verification checklist.

---

## 7. Prioritized List of Proposed Fixes (Not Implemented)

1. **Fix `message_analyst` Prompt Formatting (`lib/agents/message-analyst.js`)**:
   Add the exact JSON structure (`{ "findings": [ { "flagId", "quote", "explanation" } ] }`) to `buildSystemPrompt()`. This will prevent Gemini from returning a top-level array or alternate field names (`red_flag_id`, `evidence_quote`), restoring proper detection of `scholarship_fee_demand`, `authority_impersonation`, and `urgency_pressure`.
2. **Start Classifier Microservice During Live Runs (`services/classifier`)**:
   Running the FastAPI service on `http://localhost:8000` will allow `classifier_client` to return statistical scam probability and improve completion ratio.
3. **Handle Search Transient Errors in `payment_entity` (`lib/agents/payment-entity.js`)**:
   Ensure `scam_search` upstream failures do not mark the entire entity as failed if graph lookup succeeded with `no_match` (or allow search retry for transient errors).

---

## 8. Step S3 Audit Findings & Probe Results

### Search Probe Diagnosis Table (Step S3b)
| Probe Query | Pattern / Description | HTTP Status | isJSON | Safe Message Field (Redacted) | Diagnosis |
|---|---|:---:|:---:|---|---|
| (a) `"research-portal.institute.edu.example" scam OR fraud OR fake OR "not paying"` | Exact original failing domain query | 400 | true | `Query pattern not allowed for free accounts.` | Free-tier pattern rejection: quoted domain string before boolean operators |
| (b) `research-portal.institute.edu.example scam fraud fake not paying` | Query without quotes and OR | 200 | true | `Success: 10 results` | Accepted by provider |
| (c) `test` | Plain word query | 200 | true | `Success: 9 results` | Accepted by provider |
| (d) `"National Institute of Science Research" scam OR fraud OR fake OR "not paying"` | Company scam query with quotes | 200 | true | `Success: 0 results` | Accepted by provider (non-domain quoted strings permitted) |

- **Root Cause**: The upstream provider (Serper) rejects quoted domain-like string patterns (`"domain.tld" scam...`) under its free-tier query analyzer; unquoted domains (`domain.tld scam OR fraud...`) are accepted without error.
- **Resolution**: Updated `buildScamQuery` in `lib/tools/dorks.js` so that identifiers containing dots (such as domain names) are not enclosed in quotes, while multi-word brand/company names retain double quotes. Hardened `lib/tools/search.js` to capture provider error details truncated to 100 characters with key-like token redaction.

### Audit of Other Specialist Agents for Sub-Check Erasure Patterns
We audited `website_forensics`, `official_verifier`, and `reputation_osint` to inspect whether one failed sub-check erases a successful sub-check on the same item:

1. **`website_forensics` (`lib/agents/website-forensics.js`)**:
   - Lines 406, 444, 478, 529: Sets `hostHasSuccess = true` if ANY sub-check succeeds (RDAP, DNS, SSL, Wayback, lookalike, URLhaus, or readPage).
   - Line 590: `if (hostHasSuccess) { successfulItemCount++; } else { failedItemCount++; }`.
   - **Finding**: **No erasure bug**. A successful lookup (e.g. RDAP or lookalike check) is NOT erased by a failed sub-check (e.g. Wayback or readPage failure). Failed sub-checks are recorded in `trace` as `{ check, status: "error" }` without overriding `hostHasSuccess`.

2. **`official_verifier` (`lib/agents/official-verifier.js`)**:
   - Lines 393-395: Domain entities are evaluated via `isGovHost` and official claim checks; successfully checked domain entities always increment `successfulItemCount++`.
   - Lines 427, 675-681: For company entities, iterates through queries (`qGov`, `qPib`, `qPlain`). If any search executes, `anySearchExecuted = true` and `successfulItemCount++`. If all searches fail, `failedItemCount++`.
   - Lines 634-638: `not_on_official_portal` requires `allSiteSearchesSucceeded`. If one site search fails, `not_on_official_portal` is suppressed, which is intentional (cannot declare absence if search was incomplete).
   - **Finding**: **No erasure bug**. A successful domain or company search check is not erased by another failing query.

3. **`reputation_osint` (`lib/agents/reputation-osint.js`)**:
   - Lines 355-356, 462-469: Tracks `itemAttempts` and `itemHadSuccess`.
   - Iterates across up to 3 queries per entity (`cleanName`, Reddit, complaint sites). If ANY query succeeds (`sRes.ok`), `itemHadSuccess = true`.
   - Line 464: `if (itemHadSuccess) { successfulItemCount++; } else if (itemAttempts > 0) { failedItemCount++; }`.
   - **Finding**: **No erasure bug**. If at least one search query returns results or succeeds, the entity is counted as successful even if other queries fail. Failed searches only push an error trace item.

---

## 9. Step S3c: Full Search Query Shape Verification and Error Containment

### Provider Probes for All Distinct Search Shapes
All 8 distinct query shapes built across `lib/tools/dorks.js`, `lib/agents/payment-entity.js`, `lib/agents/reputation-osint.js`, and `lib/agents/official-verifier.js` were probed directly against the live Serper endpoint using fake inputs (reserved `.example` domains, invented names, fake UPI/phone values).

| Shape ID | Shape Description | Query String Probed | Status | isJSON | Results Count | Upstream Message | Provider Result |
|---|---|---|:---:|:---:|:---:|---|:---:|
| **S1** | Domain scam query (unquoted domain) | `research-portal.institute.edu.example scam OR fraud OR fake OR "not paying"` | 200 | true | 0 | none | Accepted |
| **S2** | Brand/company scam query (quoted brand) | `"National Institute of Science Research" scam OR fraud OR fake OR "not paying"` | 200 | true | 0 | none | Accepted |
| **S3** | Reddit dork | `site:reddit.com "National Institute of Science Research" scam OR legit OR review` | 200 | true | 0 | none | Accepted |
| **S4** | Complaint sites dork (grouped site: OR) | `(site:consumercomplaints.in OR site:mouthshut.com) "National Institute of Science Research"` | 200 | true | 0 | none | Accepted |
| **S5** | Minus site query (-site: exclusion) | `"National Institute of Science Research" -site:institute.edu.example scam OR review OR complaint` | 200 | true | 0 | none | Accepted |
| **S6** | UPI scam query | `"scholarship.dept@okaxis" scam OR fraud OR cybercrime OR complaint` | 200 | true | 0 | none | Accepted |
| **S7** | Gov scheme / official portal search | `site:gov.in "National Institute of Science Research"` | 200 | true | 0 | none | Accepted |
| **S8** | PIB portal scam query | `site:pib.gov.in "National Institute of Science Research" fake OR scam` | 200 | true | 0 | none | Accepted |

- **Probe Result**: All 8 distinct query shapes returned HTTP 200 with valid JSON. No complex operators (`site:`, `OR`, `-site:`, parentheses groupings) were rejected by the upstream search provider when domain names were unquoted.

### Error Containment Verification
- Audited all agent trace recorders and result builders across `payment_entity`, `reputation_osint`, and `official_verifier`.
- Verified that upstream provider `error.message` text is never copied into agent `trace`, `notes`, `events`, or API responses. Only machine codes (`sRes.error?.code` such as `"UPSTREAM_ERROR"`, `"SEARCH_ERROR"`) are placed into `trace` objects.
- Unit tests added to `tests/agents-payment-entity.test.js`, `tests/agents-reputation-osint.test.js`, and `tests/agents-official-verifier.test.js` asserting that sensitive internal provider error markers injected into `error.message` never leak into agent results, notes, traces, or reasons.

### Precision & Proximity Verification
- Verified that `payment_entity` emits zero flags from search results (only `reputation_osint` is registered in `FLAG_REGISTRY` to emit `scam_reports_found`). Added explicit unit test verifying zero flag emission from search in `payment_entity`.
- Verified that `reputation_osint` requires both `isNearScamWord` proximity checking and LLM disambiguation (`aboutSameEntity === "yes"`) before emitting `scam_reports_found`. Added test verifying that unquoted domain mentions in unrelated search contexts do not trigger `scam_reports_found`.
