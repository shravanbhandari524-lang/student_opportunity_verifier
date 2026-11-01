# L7 Features and Hardening Specification (Step L7-A)

## Overview & Scope
This document specifies the architecture, data contracts, routes, security guards, record-and-replay subsystem, evaluation harness, and gate criteria for Layer L7 (Features and Hardening) of the Student Opportunity Verifier.
It provides exact decision records (DR-1 to DR-10), marks items requiring approval as `[NEEDS APPROVAL]`, documents contract gaps, and lists open technical questions.

In accordance with `AGENTS.md`:
- Pure code decision engine and deterministic rules establish facts; LLM never decides final risk levels.
- Strict single-writer rule: only `lib/db/` executes database operations.
- UI remains deferred (`deferred/ui/`). Backend and evaluation features first.
- Strict data privacy: no private citizen identification, no tracing, no user content in logs, and uploaded files are purged.

---

## Task 1: Audit Facts & Baseline Inventory

| Subsystem / Component | File & Line Reference | Current Fact / Implementation State |
|---|---|---|
| **Existing Routes** | [`app/api/`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/app/api/) | Six routes currently implemented: `POST /api/checks`, `GET /api/checks/:id`, `POST /api/checks/:id/confirm`, `GET /api/checks/:id/stream`, `GET /api/checks/:id/report`, `GET /api/health`. Action routes (`feedback`, `save-to-graph`, `college-email`, `fraud-summary`, `guides`) do not exist yet. |
| **Feedback Schema & Table** | [`lib/contracts/feedback.js:4-17`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/contracts/feedback.js#L4-L17)<br>[`lib/db/migrations/002_target_l1_schema.js:309-317`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/db/migrations/002_target_l1_schema.js#L309-L317) | `feedback` table schema: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `check_id TEXT NULL REFERENCES checks(id) ON DELETE SET NULL`, `verdict TEXT CHECK (verdict IN ('right', 'wrong'))`, `risk_level_shown TEXT NULL CHECK (risk_level_shown IN ('low', 'medium', 'high', 'cannot_verify'))`, `comment TEXT NULL CHECK (length(comment) <= 500)`, `created_at TEXT NOT NULL`. On check deletion, `check_id` is set to `NULL`; feedback rows survive check expiry and cleanup. |
| **Feedback Repository** | [`lib/db/index.js:1000-1024`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/db/index.js#L1000-L1024) | `saveFeedback(feedback, db = getDb())`: validates input with `FeedbackSchema.parse()`, executes `INSERT INTO feedback`, returns inserted object with auto-incremented integer `id`. Currently does not enforce a unique constraint on `check_id` (multiple feedbacks per check allowed in DB). |
| **Graph Tables & Functions** | [`lib/db/migrations/002_target_l1_schema.js:241-262`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/db/migrations/002_target_l1_schema.js#L241-L262)<br>[`lib/db/index.js:1037-1115`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/db/index.js#L1037-L1115)<br>[`lib/graph.js:170-210`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/graph.js#L170-L210) | `graph_nodes` has `UNIQUE(kind, value)`. `lookup(kind, value)` returns `GraphMatch`: `{ matched: boolean, nodeId?, kind?, value?, reportCount?, connectedNodesCount? }`. If matched, `reportCount` reflects `graph_nodes.report_count` (increments on every conflict upsert). `link()` creates pairwise edges in `graph_edges` under `check_ref` (SHA-256 hash slice of `checkId`). `recordReport()` enforces `riskLevel === "high"` and `consent === true`. |
| **`graph_match` Flag Trigger** | [`lib/agents/payment-entity.js:234-267`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/agents/payment-entity.js#L234-L267) | `payment_entity` emits `graph_match` whenever `graphResult.matched === true` (i.e. node exists in `graph_nodes`). It currently does **not** check whether `reportCount >= 2` or whether reports are from independent checks; a single prior report (`reportCount >= 1`) causes `graph_match` to fire. |
| **Seed Data & Known Domains** | [`lib/data/seed-graph.json`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/data/seed-graph.json)<br>[`lib/data/known-domains.json`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/data/known-domains.json)<br>[`lib/data/free-email-domains.json`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/data/free-email-domains.json)<br>[`scripts/seedGraph.js`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/scripts/seedGraph.js) | `seed-graph.json` contains 3 placeholder seed reports (`seed-check-0001` to `0003`). `known-domains.json` has 17 verified educational/government domains (`ugc.ac.in`, `scholarships.gov.in`, `internshala.com`, etc.). `free-email-domains.json` has 27 common webmail providers. `scripts/seedGraph.js` loads `seed-graph.json` idempotently into SQLite. |
| **Report Actions & Channels** | [`lib/report/constants.js:86-120`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/report/constants.js#L86-L120) | `ACTIONS_MAP` supports 3 action IDs: `"college_email"`, `"fraud_help"`, `"copy_checklist"`. `REPORTING_CHANNELS` has 2 entries (National Cyber Crime Reporting Portal and Chakshu Portal) with `url: null`, `helpline: null`, `verified: false`, and explicit disclaimer: `"verify on the official site"`. |
| **Manual Verification Links** | [`lib/agents/manual-links.js:12-33`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/agents/manual-links.js#L12-L33) | 4 curated official root URLs: MCA (`https://www.mca.gov.in`), GST (`https://www.gst.gov.in`), NSP (`https://scholarships.gov.in`), PIB Fact Check (`https://factcheck.pib.gov.in`). No other external URLs are confirmed. |
| **Existing Guides Content** | [`app/guides/`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/app/guides/) | Directory structure `app/guides/[type]` exists from initial scaffold with `.gitkeep`, but contains no static JSON, templates, markdown, or API routes. Currently UNKNOWN / unpopulated. |
| **Classifier Data & Metrics** | [`services/classifier/data/dataset.csv`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/services/classifier/data/dataset.csv)<br>[`services/classifier/metrics.json`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/services/classifier/metrics.json) | `dataset.csv` contains 89 rows (45 benign, 44 suspicious). `metrics.json` states: `"datasetProvenance": "synthetic"`, `"warning": "Starter dataset is synthetic placeholder for pipeline validation only..."`. Precision/recall/F1 are 1.0 on synthetic data. No real-world evaluation metrics exist. |
| **Cache Subsystem** | [`lib/cache.js`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/cache.js)<br>[`lib/tools/base.js:103-123`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/tools/base.js#L103-L123) | Caches external tool lookups (`rdapLookup`, `dnsRecords`, `sslInfo`, `waybackFirstSeen`, `urlhaus`, `urlscanSearch`, `search`, `fetchPage`) in `lookup_cache` table with TTL in seconds. Caches ONLY successful results (`ok: true`). Failures are never cached. Keys use SHA-256 hashes (`hashKey`) to prevent user PII leakage. |
| **Environment Variables** | [`lib/env.js:3-38`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/env.js#L3-L38) | Validated via Zod: `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `SEARCH_PROVIDER`, `SEARCH_API_KEY`, `YOUTUBE_API_KEY`, `URLHAUS_AUTH_KEY`, `URLSCAN_API_KEY`, `CLASSIFIER_URL`, `DB_PATH`, `UPLOAD_DIR`, `TRUST_PROXY`, `TRUSTED_PROXY_HOPS`, `MAX_CONCURRENT_CREATES`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_CREATE_MAX`, `RATE_LIMIT_CONFIRM_MAX`, `RATE_LIMIT_READ_MAX`, `RATE_LIMIT_STREAM_MAX`, `MAX_CONCURRENT_INVESTIGATIONS`, `GLOBAL_DAILY_CHECK_CAP`. |
| **Rate Limiters & Envs** | [`lib/api/runtime.js:40-64`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/api/runtime.js#L40-L64) | 5 existing rate limiters: `createCheck` (`RATE_LIMIT_CREATE_MAX`, default 10/15m), `confirmCheck` (`RATE_LIMIT_CONFIRM_MAX`, default 10/15m), `getCheck` (`RATE_LIMIT_READ_MAX`, default 60/1m), `streamCheck` (`RATE_LIMIT_STREAM_MAX`, default 10/1m), `globalDaily` (`GLOBAL_DAILY_CHECK_CAP`, default 500/24h). Action routes currently have no dedicated rate limiter. |

---

## Task 2: Numbered Decision Records (DR-1 to DR-10)

### Decision 1: Feedback Route (`POST /api/checks/:id/feedback`)
- **Route & Method**: `POST /api/checks/:id/feedback`
- **Request Body Contract**:
  ```typescript
  type FeedbackRequestBody = {
    verdict: "right" | "wrong";
    outcome?: "confirmed_scam" | "confirmed_genuine" | "lost_money" | "not_sure";
    comment?: string; // max 500 characters
  };
  ```
  *(Note: `outcome` field is a proposed addition to `FeedbackSchema` [NEEDS APPROVAL]).*
- **Lifecycle Preconditions**: Allowed strictly when check exists and its status is `report_ready`. Submissions against checks in `created`, `extracting`, `awaiting_confirmation`, `investigating`, `scoring`, or `failed` return HTTP 409 `STATE_CONFLICT` with code `"STATE_CONFLICT"`.
- **Comment Redaction Policy**:
  - Before writing to SQLite, `comment` is processed by pure-function sanitizer `redactFeedbackComment(comment)`:
    - Phone numbers (`\+?\d[\d -]{7,}\d`) -> `[REDACTED_PHONE]`
    - Email addresses (`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`) -> `[REDACTED_EMAIL]`
    - UPI handles (`[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9]{2,64}`) -> `[REDACTED_UPI]`
    - URLs (`https?://\S+`) -> `[REDACTED_URL]`
- **Idempotency & Duplicate Handling**:
  - Exactly one feedback record per check. If feedback for `checkId` already exists:
    - **Proposed Rule**: HTTP 409 `STATE_CONFLICT` with code `"FEEDBACK_EXISTS"` to prevent repeated overwrites or spam. [NEEDS APPROVAL].
- **Stored Fields & Privacy Guarantees**:
  - Stored row: `{ check_id, verdict, outcome, risk_level_shown, comment, created_at }`.
  - Zero check content, zero user inputs, zero extracted entities stored in `feedback`.
  - On check deletion after 24h, foreign key `ON DELETE SET NULL` clears `check_id` while preserving anonymous statistical counts.
- **Success Response**: HTTP 200 `{ ok: true, id: number }`.

### Decision 2: Save-to-Graph Route (`POST /api/checks/:id/save-to-graph`)
- **Route & Method**: `POST /api/checks/:id/save-to-graph`
- **Request Body Contract**:
  ```typescript
  type SaveToGraphRequestBody = {
    consent: true; // boolean literal true required
  };
  ```
- **Lifecycle Preconditions**: Eligible strictly when check status is `report_ready` AND `risk_level === "high"`.
  - If status != `report_ready`: HTTP 409 `STATE_CONFLICT`.
  - If risk_level != `"high"`: HTTP 400 `BAD_REQUEST` with message `"Only high-risk checks can be recorded in the scam intelligence graph"`.
- **Poisoning & Defamation Exclusion Rules**:
  To protect against graph poisoning, competitive defamation, and false associations, an identifier is excluded from graph recording if ANY of the following hold:
  1. **Discovered Entities**: Exclude entities with `source === "discovered"` (only user-submitted or user-confirmed entities can be saved).
  2. **Unconfirmed Entities**: Exclude entities with `confirmed !== true` (or `confirmed !== 1`).
  3. **User Company Field**: Exclude entity of kind `"company"` if derived from user-typed company name (prevents competitor smear campaigns).
  4. **Known Domains**: Exclude domain if present in `lib/data/known-domains.json` (`ugc.ac.in`, `internshala.com`, etc.).
  5. **Official & Government Suffixes**: Exclude domain if ends with `.gov.in`, `.nic.in`, `.ac.in`, `.edu.in`, `.mil.in`.
  6. **Free-Mail Domains**: Exclude domain if present in `lib/data/free-email-domains.json` (`gmail.com`, `yahoo.com`, `outlook.com`, etc.).
- **Per-Check Cap**: Maximum 5 identifiers recorded per check.
- **Edge Creation & Opaque Reference**: Pairwise edges added between all qualifying nodes using opaque `checkRef = computeCheckRef(checkId)` (SHA-256 hash slice, 32 chars). No raw `checkId` stored in graph tables.
- **Idempotency**: If `graph_edges` already has edges with `check_ref === computeCheckRef(checkId)`, returns `{ saved: 0, reason: "already_saved" }` without re-incrementing `report_count`.
- **Success Response**: HTTP 200 `{ saved: number, checkRef: string }`.
- **Options for Requiring >1 Independent Report Before `graph_match` Fires**:
  - *Option A*: Change `payment_entity.js` to emit `graph_match` only when `graphResult.reportCount >= 2`. (Requires L4 agent edit).
  - *Option B*: Change `lookup()` in `lib/graph.js` to return `matched: true` only if `report_count >= 2`. (Requires L2 tools edit).
  - *Option C*: Keep single-report lookup in L2/L4 for the demo, but add a confidence indicator (`priorReports: number`) in flag explanation.
  - **Verdict**: **DEFER** Options A and B to post-L7. AGENTS.md strictly forbids modifying lower completed layers (L2, L4). For L7, graph recording persists data, and existing L4 agent logic remains untouched.

### Decision 3: College Email Route (`POST /api/checks/:id/college-email`)
- **Route & Method**: `POST /api/checks/:id/college-email`
- **Request Body Contract**:
  ```typescript
  type CollegeEmailRequestBody = {
    recipientType: "placement_cell" | "dean_student_welfare" | "department_head" | "grievance_officer";
    language?: "en" | "hi"; // default "en"
  };
  ```
- **Generation Strategy**: Strictly deterministic template interpolation. **Zero LLM calls**.
- **Neutral Wording & Safety Policy**:
  - Never uses defamatory words (`scammer`, `fraudster`, `criminal`).
  - Frames incident as an unverified suspicious solicitation received by a student.
  - Content includes only: recipient greeting, check creation date, risk level assessment, flag titles, and short quotes already present in the validated `Report`.
  - Never includes full user message text, unconfirmed allegations, or personal student phone numbers.
  - Safe subject line: Single-line string stripped of all `\r` and `\n` characters to prevent email header injection.
  - Ephemeral: Email text is returned in response and **never stored in the database**.
- **Success Response**: HTTP 200 `{ subject: string, body: string, recipientRole: string }`.

### Decision 4: Fraud Summary Route (`POST /api/checks/:id/fraud-summary`)
- **Route & Method**: `POST /api/checks/:id/fraud-summary`
- **Request Body Contract**:
  ```typescript
  type FraudSummaryRequestBody = {
    amount?: number;        // integer, 1 to 10,000,000 (INR)
    date?: string;          // ISO date string YYYY-MM-DD, within past 365 days
    paymentMethod?: "upi" | "netbanking" | "card" | "wallet" | "cash" | "other";
    language?: "en" | "hi"; // default "en"
  };
  ```
- **Validation Ranges**:
  - `amount`: optional integer, min 1, max 10,000,000.
  - `date`: optional ISO string, must not be in the future, must not be > 365 days in the past.
  - `paymentMethod`: enum `["upi", "netbanking", "card", "wallet", "cash", "other"]`.
- **Content & Official Channels Constraint**:
  - Pre-fills a standardized complaint narrative suitable for copying into the National Cyber Crime Reporting Portal.
  - Victim steps: 1) Immediately call bank/payment provider to freeze transaction/account; 2) File complaint at official portal; 3) Preserve all SMS/chat records and transaction reference numbers.
  - Reporting channels: Rendered strictly with unverified advisory disclaimer: `"verify on the official site"`. No phone number or URL is output unless already verified in [`lib/agents/manual-links.js`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/agents/manual-links.js).
  - Ephemeral: Output is returned in response and **never stored in the database**.
- **Success Response**: HTTP 200 `{ title: string, narrative: string, victimSteps: string[], reportingChannels: object[] }`.

### Decision 5: Guides Routes (`GET /api/guides`, `GET /api/guides/:type`)
- **Routes & Methods**:
  - `GET /api/guides`: Returns list of 6 guide summaries.
  - `GET /api/guides/:type`: Returns full guide content for `:type`.
- **Six Standard Types**:
  1. `scholarship_scam` (Application fee demands, fake trust funds, lookalike portals).
  2. `internship_scam` (Unpaid tasks, training deposits, fake offer letters).
  3. `task_scam` (Telegram rating tasks, video likes, crypto deposits).
  4. `mule_account` (Bank account rental, commission per transfer, money laundering risks).
  5. `contest_fraud` (Registration fees for fake hackathons or Olympiads).
  6. `overseas_agent` (Fake visa guarantees, unaccredited universities, exorbitant documentation fees).
- **Static Content Schema**:
  ```typescript
  type GuideSource = {
    id: string; // e.g. "src_pib_2024", "src_rbi_mule"
    title: string;
    publisher: string;
    url: string; // verified official root or advisory URL
    publishedDate?: string;
  };

  type Guide = {
    type: string;
    title: string;
    summary: string;
    howItWorks: string[];
    redFlags: string[];
    whatToDo: string[];
    sources: GuideSource[];
    reviewStatus: "human_reviewed" | "draft_pending_review";
    lastReviewed: string; // ISO date YYYY-MM-DD
  };
  ```
- **Authoring Rules**:
  - Zero invented statistics or unsubstantiated claims.
  - Every claim in `howItWorks` or `redFlags` must map to at least one entry in `sources`.
  - Static JSON data lives in `lib/data/guides/` (framework-independent).
  - English first (`en`). Hindi translations marked with `"reviewStatus": "draft_pending_review"` until native speaker review.

### Decision 6: Rate Limits & Env Variables for Action Routes [NEEDS APPROVAL]
- **Proposed Environment Variables**:
  - `RATE_LIMIT_ACTION_MAX` (default `15`): Maximum action requests (`feedback`, `save-to-graph`, `college-email`, `fraud-summary`) per IP per 15-minute window.
  - `RATE_LIMIT_GUIDE_MAX` (default `60`): Maximum guide reads per IP per 1-minute window.
- **Wiring in `lib/api/runtime.js`**:
  - Add `actionLimit` and `guideLimit` to `rateLimiters` map.
  - Protect `POST /api/checks/:id/*` action routes using `actionLimit`.
  - Protect `GET /api/guides*` routes using `guideLimit`.

### Decision 7: Record and Replay Subsystem (`lib/record-replay.js`)
- **Modes**:
  - `off` (default): Normal network / provider execution.
  - `record`: Executes call against live provider and saves sanitized fixture to disk.
  - `replay`: Never contacts external provider; loads response from disk. If fixture is missing, returns typed error `RECORDING_MISSING` (never falls back to network).
- **Configuration**:
  - Env `RECORD_REPLAY_MODE`: `"off" | "record" | "replay"`. Default `"off"`.
  - Storage directory: `.recordings/` (strictly `.gitignore`d).
- **Production Guard**:
  - If `NODE_ENV === "production"`, `record` mode throws immediate startup error: `"Recording mode is strictly prohibited in production"`.
- **Sanitization & Safety Invariants**:
  - Fixture filename: `crypto.createHash("sha256").update(safeKey).digest("hex") + ".json"`.
  - Request headers and Authorization keys are stripped before saving.
  - Response headers containing cookies or auth tokens are stripped.
  - Replay miss: Returns `ok: false, error: { code: "RECORDING_MISSING", message: "Recorded response not found for key" }`.
- **Disclosure in `/api/health`**:
  - `GET /api/health` includes `{ recordReplay: { mode: "off" | "record" | "replay" } }`.

### Decision 8: Evaluation Harness (`scripts/evaluate.js`)
- **Case Schema**:
  ```typescript
  type EvalCase = {
    id: string; // UUID or unique slug
    text?: string;
    link?: string;
    upiId?: string;
    company?: string;
    handle?: string;
    phone?: string;
    language: "en" | "hi";
    expectedLevel: "low" | "medium" | "high" | "cannot_verify";
    scamType: string;
    why: string;
    provenance: "real_public" | "paraphrased" | "synthetic";
    sourceUrl?: string; // public advisory URL
    groupId?: string;   // for stratified sampling
    labels: [string, string]; // two independent annotator labels
  };
  ```
- **Modes**:
  - `fixtures`: Runs against static fixtures without LLM or search calls.
  - `replay`: Runs against `.recordings/` directory without network calls.
  - `live`: Runs against live APIs with strict per-run budget cap (max 20 calls total).
- **Leakage Checks**:
  - Asserts no eval case text or identifier overlaps with training dataset (`dataset.csv`).
- **Computed Metrics**:
  - Overall agreement (% matching `expectedLevel`).
  - 4x4 Confusion Matrix (`low`, `medium`, `high`, `cannot_verify`).
  - Dangerous Misses: Actual scam labelled `low` (CRITICAL severity).
  - False Alarms: Genuine opportunity labelled `high`.
  - `cannot_verify` rate.
  - Share of runs with at least one `could_not_check`.
  - Per-scam-type breakdown.
  - Per-flag precision.
  - Latency (mean, p50, p95).
  - Bootstrap 95% confidence intervals (fixed random seed).
- **Claim Guard**:
  - Script output enforces: **"No public accuracy claim may be asserted unless evaluation dataset contains at least 50 non-synthetic cases with double independent labels."**
  - Classifier metrics print mandatory synthetic warning.
  - Zero model training in L7.

### Decision 9: Demo Script, Privacy Document & README Updates
- **Demo Script (`scripts/demo.js`)**:
  - Interactive CLI / walkthrough script executing: 1) A clear upfront fee scam (Scenario A); 2) An authentic fellowship announcement (Scenario B); 3) An ambiguous thin lead (Scenario C).
  - Demonstrates: Input submission -> Confirmation -> Multi-round investigation -> SSE progress timeline -> Risk scoring -> Report generation -> College email draft.
- **Privacy Document (`docs/privacy.md`)**:
  - Plain-language disclosure complying with DPDP Act 2023 principles.
  - Explains 24-hour check TTL, immediate image purging, anonymous feedback retention, graph consent policy, and zero personal tracking.
- **README Update**:
  - Add section on L7 actions, evaluation commands, demo script usage, and privacy commitments.

### Decision 10: L7 Layer Gate Criteria
A layer gate passes only when all 10 criteria hold with command proof:
1. All unit and action route tests pass (`npm test`).
2. Contract schemas, fixtures, and migrations validate cleanly (`node scripts/validate-contracts.js`).
3. Offline operations smoke test passes with action routes (`node scripts/ops-smoke.js`).
4. End-to-end API runner passes across all scenarios (`npm run api:e2e`).
5. Evaluation harness runs cleanly in replay/fixture mode (`node scripts/evaluate.js --fixtures`).
6. Demo script executes cleanly (`node scripts/demo.js`).
7. Linting passes without warnings (`npm run lint`).
8. Production build compiles cleanly (`npm run build`).
9. Zero database access outside `lib/db/` and zero `process.env` access in `app/` and `lib/api/` outside `lib/env.js`.
10. README, AGENTS.md, and `docs/l7-progress.md` updated.

---

## Task 3: Contract and Doc Gaps & Open Questions

### Contract and Doc Gaps (Proposed Changes - None Applied Yet)
1. **[PROPOSED CHANGE] `FeedbackSchema` Expansion**:
   - Current schema in `lib/contracts/feedback.js` supports `{ id, checkId, verdict, riskLevelShown, comment, createdAt }`.
   - Proposed: add optional `outcome: z.enum(["confirmed_scam", "confirmed_genuine", "lost_money", "not_sure"]).optional()`.
   - Requires updating `docs/contracts.md`, `ARCHITECTURE.md`, `FeedbackSchema`, and fixtures in a dedicated contract step.
2. **[PROPOSED CHANGE] Action Route Request/Response Schemas**:
   - Need Zod schemas in `lib/contracts/`:
     - `CollegeEmailRequestSchema` and `CollegeEmailResponseSchema`
     - `FraudSummaryRequestSchema` and `FraudSummaryResponseSchema`
     - `SaveToGraphRequestSchema` and `SaveToGraphResponseSchema`
     - `GuideSchema` and `GuideSummarySchema`
3. **[PROPOSED CHANGE] Database Constraint on Duplicate Feedback**:
   - Migration `002` created `feedback` with `check_id TEXT NULL REFERENCES checks(id) ON DELETE SET NULL`, without a unique constraint.
   - To strictly enforce one feedback per check at the database level would require a migration adding `UNIQUE(check_id)`.
   - *Alternative (no migration)*: Enforce uniqueness in `lib/db/index.js` via `SELECT 1 FROM feedback WHERE check_id = ?` before insertion.
4. **[PROPOSED CHANGE] Environment Variables in `lib/env.js`**:
   - Add `RATE_LIMIT_ACTION_MAX` (default 15) and `RATE_LIMIT_GUIDE_MAX` (default 60).
   - Add `RECORD_REPLAY_MODE` (`"off" | "record" | "replay"`, default `"off"`).

### Open Questions (Requiring User Input Before Step B)
1. **Feedback Duplicate Policy**: Should duplicate `POST /api/checks/:id/feedback` return HTTP 409 `STATE_CONFLICT` (recommended) or silently update/replace the existing feedback comment?
2. **Action Route Rate Limiting**: Is a separate `RATE_LIMIT_ACTION_MAX` (15 per 15 minutes) approved for inclusion in `lib/env.js`, or should action routes share `RATE_LIMIT_READ_MAX`?
3. **Language Scope for Templates**: Should college email and fraud summary deterministic templates support Hindi (`hi`) in L7, or start English-only with Hindi marked as pending native review?
