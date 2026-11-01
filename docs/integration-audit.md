# Integration Audit: Frontend & Backend

**Date:** 2026-10-29  
**Audit Scope:** End-to-end integration between Next.js App Router frontend, backend API routes, SQLite data layer, L4 specialist agents, L5 pipeline coordinator, and the Python ML classifier microservice.  
**Governing Documents:** PRD.md (Sections 4, 5, 6, 11), ARCHITECTURE.md (Sections 2.3, 8, 17, 18), `lib/contracts/`.

---

## 1. API Route Audit (PRD.md Section 6 & ARCHITECTURE §17)

Every route specified in PRD.md Section 6 plus architectural additions was audited for implementation status, Zod input validation, response contract conformance, and automated test coverage.

| Route & Method | Implementation File | Status | Input Zod Validation | Contract Response Shape | Test Coverage |
|---|---|---|---|---|---|
| `POST /api/checks` | `app/api/checks/route.js` | **Exists** | `CheckSubmissionSchema` (`lib/contracts/submission.js`): Multipart/form-data with size limits (5MB/file, 26MB max total, 5 files max), sharp pixel bounds, and rate limiters. | `{ checkId: string, status: "created" }` (HTTP 201). Matches PRD §6. | `tests/api-routes.test.js`, `tests/api-security.test.js`, `tests/api-e2e.test.js` |
| `GET /api/checks/:id` | `app/api/checks/[id]/route.js` | **Exists** | `assertValidCheckId` (`z.string().uuid()`), rate limited per client IP. | `{ check: CheckSummarySchema, entities: EntitySchema[], text?: string }`. Filters sensitive database fields. Matches PRD §6. | `tests/api-routes.test.js`, `tests/api-e2e.test.js` |
| `POST /api/checks/:id/confirm` | `app/api/checks/[id]/confirm/route.js` | **Exists** | `ConfirmationBodySchema` (`texts`: max 10, `entities`: max 30 with strict entity kinds). Strict status guard (`awaiting_confirmation`). | `{ checkId: string, status: "investigating" }` (HTTP 200). Launches background job. Matches PRD §6. | `tests/api-routes.test.js`, `tests/api-e2e.test.js` |
| `GET /api/checks/:id/stream` | `app/api/checks/[id]/stream/route.js` | **Exists** | `assertValidCheckId`, `parseLastEventId` (header/query param). Max 25 concurrent subscribers per check. | SSE (`text/event-stream`). Emits keepalive comments (`: ping\n\n`) and JSON frames. *Note: Payload format currently uses legacy mapper; see Section 3.* | `tests/api-stream.test.js` |
| `GET /api/checks/:id/report` | `app/api/checks/[id]/report/route.js` | **Exists** | `assertValidCheckId`. Validates retrieved report against `ReportSchema` before responding. Strict guard (`report_ready`). | `{ report: ReportSchema }` (HTTP 200). Matches PRD §6 & PRD §11. | `tests/api-routes.test.js`, `tests/api-e2e.test.js` |
| `POST /api/checks/:id/feedback` | `app/api/checks/[id]/feedback/route.js` | **Exists** | `FeedbackRequestSchema` (`lib/contracts/feedback.js`): `{ verdict: "right" \| "wrong", outcome?, comment? }`. PII sanitization via `redactComment`. Single feedback per check constraint. | `{ ok: true, id: number }` (HTTP 200). Matches PRD §6. | `tests/api-feedback.test.js` |
| `POST /api/checks/:id/save-to-graph` | `app/api/checks/[id]/save-to-graph/route.js` | **Exists** | `SaveToGraphRequestSchema` (`lib/contracts/graph.js`): `{ consent: true }`. Strict guards: status `report_ready`, risk level `high`. | `{ saved: number, checkRef: string }` (HTTP 200). Matches PRD §6. | `tests/api-save-to-graph.test.js` |
| `POST /api/checks/:id/college-email` | `app/api/checks/[id]/college-email/route.js` | **Exists** | `CollegeEmailRequestSchema` (`lib/contracts/actions.js`): `{ recipientType: enum, language?: enum }`. | `CollegeEmailResponseSchema`: `{ subject, body, recipientRole, notes? }` (HTTP 200). Matches PRD §6. | `tests/api-actions.test.js` |
| `POST /api/checks/:id/fraud-summary` | `app/api/checks/[id]/fraud-summary/route.js` | **Exists** | `FraudSummaryRequestSchema` (`lib/contracts/actions.js`): `{ amount?, date?, paymentMethod?, language? }`. Date validated within 365 days past and not in future. | `FraudSummaryResponseSchema`: `{ title, narrative, victimSteps, reportingChannels, notes? }` (HTTP 200). Matches PRD §6. | `tests/api-actions.test.js` |
| `GET /api/guides/:type` | `app/api/guides/[type]/route.js` | **Exists** | Validates `:type` param against `GUIDE_TYPES`. Validates output against `GuideSchema` (`lib/contracts/guides.js`). | `GuideSchema` (HTTP 200). Matches PRD §6. | `tests/guides.test.js` |
| `GET /api/guides` | `app/api/guides/route.js` | **Exists** | Rate limited via `guideRead` limiter. | `GuideListResponseSchema`: `{ guides: GuideSummary[] }` (HTTP 200). | `tests/guides.test.js` |
| `GET /api/health` | `app/api/health/route.js` | **Exists** | Rate limited. Checks database connectivity. | Operational health summary `{ status: "ok", uptime, checksCount }`. | `tests/api-ops.test.js` |
| `GET /api/checks/:id/events` | *None* | **MISSING** | Specified in ARCHITECTURE §17 as the HTTP polling fallback for environments blocking SSE (`?after=<seq>`). | Expected `{ events: TraceEvent[] }`. Currently returns Next.js 404 HTML. | None |

---

## 2. UI Pages & Components Audit

Audit of active user-facing pages in `app/` and deferred foundation code in `deferred/ui/`:

### Active Pages (`app/`)

| Page / Component | Location | API Routes Called | Request & Response Shape Conformance |
|---|---|---|---|
| **Landing Page** (`/`) | `app/page.js` | *None* (static server component) | Renders hero, 3 steps, 6 archetypes. Links to `/check`, `/guides`, `/about`. Conforms to PRD §4. |
| **New Check Form** (`/check`) | `app/check/page.js` | `POST /api/checks` | **Matches:** Sends `multipart/form-data` with `text`, `images`, `url`, `upiId`, `company`, `handle`, `phone`, `language`, `consent`. Consumes `{ checkId }` and navigates to `/check/[id]`. |
| **Investigation & Report Page** (`/check/[id]`) | `app/check/[id]/page.js` | 1. `GET /api/checks/:id`<br>2. `POST /api/checks/:id/confirm`<br>3. `GET /api/checks/:id/stream`<br>4. `GET /api/checks/:id/report`<br>5. `POST /api/checks/:id/college-email`<br>6. `POST /api/checks/:id/save-to-graph`<br>7. `POST /api/checks/:id/feedback` | **1-6 Match:** Consumes `CheckSummary`, sends confirmed `texts` & `entities`, handles SSE events, renders `ReportSchema` flags & checklist, generates institutional email, saves high-risk graph nodes.<br><br>⚠️ **7 Mismatch (Feedback):** UI sends `{ helpful: boolean, notes: string }`. Backend expects `{ verdict: "right" \| "wrong", comment?: string }`. Returns HTTP 400 `BAD_REQUEST`.<br><br>⚠️ **Omission (Fraud Help):** Displays static Golden Hour text instead of calling `POST /api/checks/:id/fraud-summary`. |
| **Scam Guides Page** (`/guides`) | `app/guides/page.js` | *None* (reads `GUIDES_CONTENT` statically) | Displays interactive tabbed guide viewer for all 6 scam archetypes. |
| **About & Privacy** (`/about`) | `app/about/page.js` | *None* (static server component) | Explains verification invariants, 6 specialist agents, and DPDP Act 2023 compliance. |
| **Fraud Help** (`/report-fraud`) | `app/report-fraud/.gitkeep` | *Unimplemented* | **Missing:** Only `.gitkeep` exists. PRD §4 lists this route for students who already paid or shared details. |
| **Specific Guide Page** (`/guides/[type]`) | `app/guides/[type]/.gitkeep` | *Unimplemented* | **Missing:** Only `.gitkeep` exists. Currently all guides are embedded inside `/guides`. |

### Deferred UI (`deferred/ui/`)

Code built during L0 and moved out of `app/` to prevent premature coupling:

| File | Intended Route | Audit Finding & Compatibility with Current Backend |
|---|---|---|
| `deferred/ui/page.landing.js` | `/` | Clean static landing mockup. No API calls. |
| `deferred/ui/page.check.js` | `/check` | ⚠️ **Incompatible:** Sends `Content-Type: application/json` with `{ text, language }`. The backend strictly requires `multipart/form-data` and rejects JSON with HTTP 415 `UNSUPPORTED_MEDIA_TYPE`. |
| `deferred/ui/page.check-id.js` | `/check/[id]` | ⚠️ **Incompatible:** Calls `GET /api/checks/:id` but expects snake_case database columns (`check.created_at`, `check.expires_at`) instead of camelCase contract fields (`check.createdAt`, `check.expiresAt`). Lacks extraction confirmation, SSE streaming, and report rendering. |
| `deferred/ui/layout.js` | Root layout | Static shell with header and footer disclaimer. Compatible. |
| `deferred/ui/globals.css` | Styles | CSS custom properties and utility classes. Compatible. |

---

## 3. Server-Sent Events (SSE) Stream & Polling Fallback

### Emitted Shapes vs Expected UI Shapes

1. **Coordinator Emits Fine-Grained Trace Events:**
   In `lib/coordinator.js`, every agent step emits typed `TraceEvent` objects persisted with monotonic sequence numbers (`seq`) in `check_events`:
   - `tool_start` (`tool`, `agent`, `label`, `seq`)
   - `tool_end` (`tool`, `agent`, `status`, `summary`, `durationMs`, `seq`)
   - `note` (`agent`, `note`, `seq`)
   - `verdict` (`agent`, `verdict`, `seq`)
   - `flag` (`agent`, `flagId`, `severity`, `title`, `seq`)
   - `agent_status` (`agent`, `status`, `summary`, `seq`)
   - `stage` (`stage`, `seq`)
   - `round` (`round`, `seq`)
   - `complete` (`seq`)

2. **SSE Formatter Drops Trace Data (Provisional Mapper):**
   In `lib/api/sse.js`, `streamEvents()` runs `mapDbEventToProgressEvent(row)`:
   - Emits SSE frame with `id: row.id` (SQLite autoincrement primary key) instead of `row.seq` (the monotonic trace sequence number specified in ARCHITECTURE §17).
   - Maps `agent_status` to `{ type: "agent", round, agent, status }`.
   - Maps `stage` to `{ type: "stage", stage }`.
   - **Critical Gap:** All fine-grained events (`tool_start`, `tool_end`, `note`, `verdict`, `flag`) fall through to `{ type: "stage", stage: row.type }`. The event payload (tool name, tool input summary, execution duration, notes, and verdicts) is discarded.

3. **Frontend UI Handling:**
   - In `app/check/[id]/page.js`, the UI parses incoming events and updates agent statuses via `payload.agent` and switches to the report when `payload.type === "complete"` or `payload.stage === "report_ready"`.
   - The UI tries to render an activity log using `ev.summary || `${ev.agent || "Pipeline"}: ${ev.phase || ev.status || "update"}`. Because `mapDbEventToProgressEvent` discards `summary`, the activity feed displays generic messages like `Pipeline: tool_start` instead of informative tool actions (e.g., `Domain & Web Forensics: Checking domain age on RDAP`).

### Polling Fallback Status
- **ARCHITECTURE §17 Specification:** Requires a polling fallback endpoint `GET /api/checks/:id/events?after=<seq>` returning `{ events: TraceEvent[] }` where `seq > after` sorted ascending.
- **Current State:**
  - Route `app/api/checks/[id]/events/route.js` **does not exist** (returns 404).
  - In `app/check/[id]/page.js`, if the SSE connection drops (`eventSource.onerror`), the UI falls back to polling `GET /api/checks/:id` every 2000ms until `status === "report_ready"`. It does not poll incremental events.

---

## 4. Environment & Startup Configuration

### Variable Inventory

| Variable | Required / Optional | Default Value | Defined in `.env.example`? |
|---|---|---|---|
| `LLM_PROVIDER` | **Required** | *None* | Yes (`gemini`) |
| `LLM_API_KEY` | **Required** | *None* | Yes |
| `LLM_MODEL` | **Required** | *None* | Yes (`gemini-2.5-flash`) |
| `SEARCH_PROVIDER` | Optional | `""` | Yes |
| `SEARCH_API_KEY` | Optional | `""` | Yes |
| `YOUTUBE_API_KEY` | Optional | `""` | Yes |
| `URLHAUS_AUTH_KEY` | Optional | `""` | Yes |
| `URLSCAN_API_KEY` | Optional | `""` | Yes |
| `CLASSIFIER_URL` | Optional | `http://localhost:8000` | Yes |
| `DB_PATH` | Optional | `./data/app.db` | Yes |
| `UPLOAD_DIR` | Optional | `./uploads` | Yes |
| `TRUST_PROXY` | Optional | `false` | **Missing** |
| `TRUSTED_PROXY_HOPS` | Optional | `1` | **Missing** |
| `MAX_CONCURRENT_CREATES` | Optional | `2` | **Missing** |
| `RATE_LIMIT_WINDOW_MS` | Optional | `900000` (15m) | **Missing** |
| `RATE_LIMIT_CREATE_MAX` | Optional | `10` | **Missing** |
| `RATE_LIMIT_CONFIRM_MAX` | Optional | `10` | **Missing** |
| `RATE_LIMIT_READ_MAX` | Optional | `60` | **Missing** |
| `RATE_LIMIT_STREAM_MAX` | Optional | `10` | **Missing** |
| `RATE_LIMIT_ACTION_MAX` | Optional | `15` | **Missing** |
| `RATE_LIMIT_GUIDE_MAX` | Optional | `60` | **Missing** |
| `MAX_CONCURRENT_INVESTIGATIONS` | Optional | `4` | **Missing** |
| `GLOBAL_DAILY_CHECK_CAP` | Optional | `500` | **Missing** |
| `RECORD_REPLAY_MODE` | Optional | `off` | **Missing** |
| `RECORD_REPLAY_DIR` | Optional | `.recordings` | **Missing** |

### Example File Status
- The file on disk is named `.env.example` (rather than `.env.local.example`).
- It contains the 3 required LLM keys and 8 basic tool keys, but omits all 14 rate-limiting, proxy, concurrency, and record-replay configuration options supported by `lib/env.js`.

### Startup Commands

To start the full system (Python ML classifier microservice + Next.js App Router API & UI):

**Option A: Dedicated Terminal Windows (Recommended for Development)**
```bash
# Terminal 1: ML Classifier Microservice (FastAPI on Port 8000)
services/classifier/.venv/bin/uvicorn services.classifier.app:app --host 127.0.0.1 --port 8000

# Terminal 2: Next.js Full-Stack Application (App Router on Port 3000)
npm run dev
```

**Option B: Single Background Command**
```bash
services/classifier/.venv/bin/uvicorn services.classifier.app:app --host 127.0.0.1 --port 8000 & npm run dev
```

---

## 5. End-to-End Live Execution Proof

The pipeline was executed end-to-end both through the offline orchestration suite (`scripts/run-check.js`) and live HTTP `curl` requests against the running Next.js dev server (port 3000) and classifier daemon (port 8000).

### 5.1 Orchestration Script (`node scripts/run-check.js`)

```
=======================================================
  STUDENT OPPORTUNITY VERIFIER - OFFLINE PIPELINE RUN
=======================================================

Executing Scenario A (scenario-a-clear-scam)...
Executing Scenario B (scenario-b-genuine-notice)...
Executing Scenario C (scenario-c-ambiguous-thin-evidence)...

-------------------------------------------------------
  SCENARIO EXECUTION RESULTS
-------------------------------------------------------

Scenario A: scenario-a-clear-scam
  Status Progression: created -> extracting -> awaiting_confirmation -> investigating -> scoring -> report_ready
  Final Status:       report_ready
  Rounds Run:         2
  Risk Level:         HIGH
  Score:              100/100
  Confidence:         high
  Flags Count:        7
  Checklist Steps:    13
  CouldNotCheck:      0
  NotApplicable:      0
  Total DB Events:    110
  Live onEvents:      108
  Duration:           249ms

  Agent Execution Breakdown:
┌─────────┬─────────────────────┬───────┬────────┬────────┬────────────┬────────────┐
│ (index) │ agent               │ round │ status │ reason │ flagsCount │ durationMs │
├─────────┼─────────────────────┼───────┼────────┼────────┼────────────┼────────────┤
│ 0       │ 'classifier_client' │ 1     │ 'ok'   │ '-'    │ 1          │ 28         │
│ 1       │ 'message_analyst'   │ 1     │ 'ok'   │ '-'    │ 2          │ 19         │
│ 2       │ 'official_verifier' │ 1     │ 'ok'   │ '-'    │ 1          │ 32         │
│ 3       │ 'payment_entity'    │ 1     │ 'ok'   │ '-'    │ 2          │ 52         │
│ 4       │ 'reputation_osint'  │ 1     │ 'ok'   │ '-'    │ 0          │ 42         │
│ 5       │ 'website_forensics' │ 1     │ 'ok'   │ '-'    │ 1          │ 71         │
│ 6       │ 'official_verifier' │ 2     │ 'ok'   │ '-'    │ 0          │ 8          │
│ 7       │ 'payment_entity'    │ 2     │ 'ok'   │ '-'    │ 0          │ 13         │
│ 8       │ 'reputation_osint'  │ 2     │ 'ok'   │ '-'    │ 0          │ 30         │
│ 9       │ 'website_forensics' │ 2     │ 'ok'   │ '-'    │ 1          │ 44         │
└─────────┴─────────────────────┴───────┴────────┴────────┴────────────┴────────────┘
✔ All gate assertions passed successfully.
```

### 5.2 Live HTTP API Execution via `curl`

#### Step 1: Submit Check (`POST /api/checks`)
```bash
curl -s -X POST http://127.0.0.1:3000/api/checks \
  -F "text=Selected for PM Scholarship Scheme! Pay ₹3500 security deposit immediately to national.grant@okaxis or visit http://fake-scholarship-pib.org" \
  -F "language=en" \
  -F "consent=true"
```
**Output (HTTP 201):**
```json
{"checkId":"4da44d83-3913-4cb9-92d6-44f7eea7b4ed","status":"created"}
```

#### Step 2: Extraction Polling (`GET /api/checks/:id`)
```bash
curl -s http://127.0.0.1:3000/api/checks/4da44d83-3913-4cb9-92d6-44f7eea7b4ed
```
**Output (HTTP 200):**
```json
{
  "check": {
    "id": "4da44d83-3913-4cb9-92d6-44f7eea7b4ed",
    "status": "awaiting_confirmation",
    "currentRound": 0,
    "language": "en",
    "riskLevel": null,
    "score": null,
    "confidence": null,
    "failureReason": null,
    "createdAt": "2026-10-28T23:40:34.001Z",
    "updatedAt": "2026-10-28T23:40:34.012Z",
    "expiresAt": "2026-10-29T23:40:34.001Z"
  },
  "entities": [
    { "id": 243, "kind": "url", "value": "http://fake-scholarship-pib.org/", "source": "extracted", "confirmed": false },
    { "id": 244, "kind": "domain", "value": "fake-scholarship-pib.org", "source": "extracted", "confirmed": false },
    { "id": 245, "kind": "upi", "value": "national.grant@okaxis", "source": "extracted", "confirmed": false },
    { "id": 246, "kind": "amount", "value": "350", "source": "extracted", "confirmed": false }
  ],
  "text": "Selected for PM Scholarship Scheme! Pay ₹3500 security deposit immediately to national.grant@okaxis or visit http://fake-scholarship-pib.org"
}
```

#### Step 3: Entity Confirmation (`POST /api/checks/:id/confirm`)
```bash
curl -s -X POST http://127.0.0.1:3000/api/checks/4da44d83-3913-4cb9-92d6-44f7eea7b4ed/confirm \
  -H "Content-Type: application/json" \
  -d '{"texts":["Selected for PM Scholarship Scheme! Pay ₹3500 security deposit immediately to national.grant@okaxis or visit http://fake-scholarship-pib.org"],"entities":[{"kind":"domain","value":"fake-scholarship-pib.org","source":"user"},{"kind":"upi","value":"national.grant@okaxis","source":"user"}]}'
```
**Output (HTTP 200):**
```json
{"checkId":"4da44d83-3913-4cb9-92d6-44f7eea7b4ed","status":"investigating"}
```

#### Step 4: Investigation Completion (`GET /api/checks/:id`)
```bash
curl -s http://127.0.0.1:3000/api/checks/4da44d83-3913-4cb9-92d6-44f7eea7b4ed
```
**Output (HTTP 200):**
```json
{
  "check": {
    "id": "4da44d83-3913-4cb9-92d6-44f7eea7b4ed",
    "status": "report_ready",
    "currentRound": 1,
    "language": "en",
    "riskLevel": "high",
    "score": 100,
    "confidence": "high",
    "failureReason": null,
    "createdAt": "2026-10-28T23:40:34.001Z",
    "updatedAt": "2026-10-28T23:41:05.315Z",
    "expiresAt": "2026-10-29T23:40:34.001Z"
  },
  "entities": [
    { "id": 247, "kind": "domain", "value": "fake-scholarship-pib.org", "source": "user", "confirmed": true },
    { "id": 248, "kind": "upi", "value": "national.grant@okaxis", "source": "user", "confirmed": true }
  ],
  "text": "Selected for PM Scholarship Scheme! Pay ₹3500 security deposit immediately to national.grant@okaxis or visit http://fake-scholarship-pib.org"
}
```

#### Step 5: Report Retrieval (`GET /api/checks/:id/report`)
```bash
curl -s http://127.0.0.1:3000/api/checks/4da44d83-3913-4cb9-92d6-44f7eea7b4ed/report
```
**Output (HTTP 200):**
```json
{
  "report": {
    "checkId": "4da44d83-3913-4cb9-92d6-44f7eea7b4ed",
    "riskLevel": "high",
    "score": 100,
    "confidence": "high",
    "scamTypeGuess": "unknown",
    "language": "en",
    "summary": "This offer exhibits high-risk warning signs (Upfront fee demanded for a scholarship offer (Hard rule); Posing as an official ministry, government authority, or reputable institution; Claiming to be an official Indian government scheme on a non-.gov.in domain). Exercise extreme caution and do not proceed without independent verification.",
    "flags": [
      {
        "id": "scholarship_fee_demand",
        "title": "Upfront fee demanded for a scholarship offer (Hard rule)",
        "severity": "high",
        "explanation": "Demands an upfront security deposit fee for the scholarship offer.",
        "evidence": [{ "type": "quote", "value": "Pay ₹3500 security deposit immediately" }]
      },
      {
        "id": "authority_impersonation",
        "title": "Posing as an official ministry, government authority, or reputable institution",
        "severity": "high",
        "explanation": "Impersonates an official government scholarship program to build false trust.",
        "evidence": [{ "type": "quote", "value": "PM Scholarship Scheme" }]
      },
      {
        "id": "non_gov_domain_claiming_gov",
        "title": "Claiming to be an official Indian government scheme on a non-.gov.in domain",
        "severity": "high",
        "explanation": "Claiming to be an official Indian government scheme on a non-.gov.in domain",
        "evidence": [{ "type": "quote", "value": "pib" }]
      },
      {
        "id": "personal_payment_id",
        "title": "Payment requested to a personal UPI handle or individual bank account",
        "severity": "high",
        "explanation": "Payment requested to personal or consumer UPI handle (okaxis) for purported institutional or scholarship program.",
        "evidence": [{ "type": "quote", "value": "national.grant@okaxis" }]
      },
      {
        "id": "unsolicited_award",
        "title": "Winning a competition or scholarship never entered, requiring claiming fee or details",
        "severity": "medium",
        "explanation": "Notifies unexpected selection for a scholarship scheme requiring a fee.",
        "evidence": [{ "type": "quote", "value": "Selected for PM Scholarship Scheme!" }]
      },
      {
        "id": "domain_no_history",
        "title": "Domain has no prior archived snapshot records in the Wayback Machine",
        "severity": "low",
        "explanation": "Domain 'fake-scholarship-pib.org' has no historical snapshot records in the Wayback Machine archive.",
        "evidence": [{ "type": "quote", "value": "fake-scholarship-pib.org" }]
      },
      {
        "id": "classifier_high",
        "title": "ML classifier scam probability > 0.80 (Weight is 0 in scoring; informational)",
        "severity": "medium",
        "explanation": "ML classifier scam probability > 0.80 (Weight is 0 in scoring; informational)",
        "evidence": [{ "type": "quote", "value": "deposit" }, { "type": "quote", "value": "selected for" }, { "type": "quote", "value": "pay" }]
      }
    ],
    "verified": ["UPI syntax valid (okaxis)"],
    "checklist": [
      { "text": "Do NOT pay any upfront registration or processing fee. Legitimate government and institutional scholarships never charge application or release fees.", "url": "https://scholarships.gov.in" },
      { "text": "Cross-check the sender's claims directly on the official ministry or institution portal (e.g., gov.in or nic.in) before responding.", "url": "https://factcheck.pib.gov.in" }
    ],
    "actions": [
      { "id": "fraud_help", "label": "View cybercrime reporting steps" },
      { "id": "college_email", "label": "Send template to college authority" }
    ],
    "disclaimer": "This report is an automated risk assessment based on publicly verifiable data and evidence provided. It does not constitute a legal verdict, formal accusation, or guarantee of authenticity.",
    "generatedAt": "2026-10-28T23:41:05.310Z"
  }
}
```

#### Step 6: Post-Report Actions
- **Draft College Email:** `POST /api/checks/:id/college-email` succeeded, returning subject line and structured draft body.
- **Save to Graph:** `POST /api/checks/:id/save-to-graph` succeeded, returning `{"saved":2,"checkRef":"de53f308d466f070a5ebd6708e4114e9"}`.
- **Submit Feedback (UI Payload):** `POST /api/checks/:id/feedback` with `{"helpful":true,"notes":"..."}` **FAILED** with HTTP 400:
  ```json
  {"code":"BAD_REQUEST","message":"JSON schema validation failed","details":{"issues":[{"path":"verdict","message":"Required"},{"path":"","message":"Unrecognized key(s) in object: 'helpful', 'notes'"}]}}
  ```
  *(Calling with `{ "verdict": "right", "comment": "..." }` succeeded with `{"ok":true,"id":1}`)*.
- **Polling Fallback:** `GET /api/checks/:id/events?after=0` **FAILED** with HTTP 404 (route missing).

---

## 6. Audit of `fee_before_selection`

- **Within `lib/agents/`:** **0 references.**
  The old flag `fee_before_selection` has been completely replaced by `fee_demand` across all agent modules (`lib/agents/config.js`, `lib/agents/message-analyst.js`, and test suites).
- **Across the Entire Codebase:**
  Only intentional negative contract/test fixtures exist:
  1. `lib/contracts/fixtures/invalid/invalid-fixtures.js`: Explicitly tests that an agent result containing the obsolete identifier `fee_before_selection` is rejected by `AgentResultSchema`.
  2. `tests/contracts.test.js`: Asserts `isFlagId("fee_before_selection") === false`.
  3. `tests/scoring-config.test.js`: Asserts `fee_before_selection` does not exist in `config.flagWeights`.
  4. `tests/scoring.test.js`: Asserts `fee_before_selection` does not exist in `defaultConfig.flagWeights`.

No production logic references `fee_before_selection`.

---

## 7. Blockers & Discrepancies in Dependency Order

Ordered by dependency and architectural severity:

| # | Discrepancy / Blocker | File(s) to Change | Complexity & Size Estimate |
|---|---|---|---|
| **1** | **Fix Feedback Payload in UI (`app/check/[id]/page.js`)**<br>The UI in `app/check/[id]/page.js` sends `{ helpful: boolean, notes: string }`. The backend contract `FeedbackRequestSchema` strictly requires `{ verdict: "right" \| "wrong", comment?: string }`. Submitting user feedback from the report page returns an immediate HTTP 400 Bad Request error. | `app/check/[id]/page.js` | **Small** (~5 lines). Map `helpful === true` $\rightarrow$ `"right"`, `false` $\rightarrow$ `"wrong"`, and `notes` $\rightarrow$ `comment`. |
| **2** | **Implement Polling Fallback Route (`GET /api/checks/:id/events`)**<br>ARCHITECTURE §17 requires an incremental polling endpoint (`?after=<seq>`) returning `{ events: TraceEvent[] }` for environments where SSE or long-lived streams are blocked. The route does not exist and returns HTTP 404. | `app/api/checks/[id]/events/route.js` | **Small** (~35 lines). Read `seq > after` via `getEventsAfter` and return `{ events }`. |
| **3** | **Stream Raw TraceEvents with Monotonic Sequence IDs (`lib/api/sse.js`)**<br>`streamEvents()` currently pipes rows through `mapDbEventToProgressEvent()`, which discards all fine-grained events (`tool_start`, `tool_end`, `note`, `verdict`, `flag`), discards execution summaries, and sets `id: row.id` instead of `id: row.seq`. ARCHITECTURE §17 requires emitting raw `TraceEvent` objects with `id: <seq>`. | `lib/api/sse.js` | **Medium** (~45 lines). Stream parsed `payload_json` directly as `TraceEvent` with `id: row.seq`. |
| **4** | **Wire Fraud Summary Action to UI (`/report-fraud` & `app/check/[id]/page.js`)**<br>The backend endpoint `POST /api/checks/:id/fraud-summary` exists and is tested, but the UI currently only shows hardcoded static Golden Hour text and never invokes the complaint narrative generator. Additionally, PRD §4 lists a `/report-fraud` page which currently only has a `.gitkeep`. | `app/report-fraud/page.js`<br>`app/check/[id]/page.js` | **Medium** (~80 lines). Add a form on `/report-fraud` and in `/check/[id]` to collect optional `amount`, `date`, `paymentMethod` and display the generated dispute text. |
| **5** | **Implement Standalone Guide Page Route (`/guides/[type]`)**<br>PRD §4 lists `/guides/[type]`. Currently only `.gitkeep` exists in `app/guides/[type]/` (though `app/guides/page.js` has a working tabbed viewer for all guides). | `app/guides/[type]/page.js` | **Small** (~40 lines). Render the individual guide for direct linking. |
| **6** | **Synchronize `.env.example` with `lib/env.js`**<br>14 optional runtime variables (rate limits, proxy hops, concurrency caps, record-replay mode) are validated in `lib/env.js` but missing from `.env.example`. Create `.env.local.example` with all configuration options documented. | `.env.local.example` | **Trivial** (~25 lines). |
