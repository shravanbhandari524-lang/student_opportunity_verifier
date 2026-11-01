# Student Opportunity Verifier

A website where students and parents can submit suspicious scholarships, internships, task-jobs, mule-account solicitations, or competitions to receive an evidence-backed risk assessment, source citations, and actionable next steps.

---

## 1. Setup & Installation

### Requirements
- **Node.js**: `v20.0.0+`
- **npm**: `v10.0.0+`

### Installation
Clone the repository and install dependencies:
```bash
npm install
```

Copy the example environment template:
```bash
cp .env.example .env.local
```

Configure your LLM credentials in `.env.local` (e.g. Gemini API key).

---

## 2. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `LLM_PROVIDER` | **Yes** | `gemini` | LLM adapter (`gemini`, `openai`) |
| `LLM_API_KEY` | **Yes** | - | API key for LLM calls |
| `LLM_MODEL` | **Yes** | `gemini-2.5-flash` | Model identifier |
| `SEARCH_PROVIDER` | No (L2) | - | Search provider for OSINT (`serper`) |
| `SEARCH_API_KEY` | No (L2) | - | Search API credentials (serper.dev) |
| `URLHAUS_AUTH_KEY` | No (L2) | - | abuse.ch URLhaus threat feed Auth-Key |
| `URLSCAN_API_KEY` | No (L2) | - | urlscan.io API key for public search |
| `CLASSIFIER_URL` | No (L2) | `http://localhost:8000` | Address of Python scikit-learn classifier service |
| `DB_PATH` | No | `./data/app.db` | Local SQLite database file location |
| `UPLOAD_DIR` | No | `./uploads` | Temporary directory for uploaded screenshot files |
| `TRUST_PROXY` | No (L6) | `false` | Whether to parse client IP from `X-Forwarded-For` header (must only be enabled behind a reverse proxy that appends client IP) |
| `TRUSTED_PROXY_HOPS` | No (L6) | `1` | Number of trusted proxy hops from right of `X-Forwarded-For` (1 means rightmost IP) |
| `MAX_CONCURRENT_CREATES` | No (L6) | `2` | Maximum concurrent multipart check creation/extraction handoffs (returns 503 if saturated) |
| `RATE_LIMIT_WINDOW_MS` | No (L6) | `900000` | Rate limiter window in milliseconds (default 15 minutes) |
| `RATE_LIMIT_CREATE_MAX` | No (L6) | `10` | Maximum check creations per IP per window |
| `RATE_LIMIT_CONFIRM_MAX` | No (L6) | `20` | Maximum confirmations per IP per window |
| `RATE_LIMIT_READ_MAX` | No (L6) | `60` | Maximum read operations (status/report) per IP per window |
| `RATE_LIMIT_STREAM_MAX` | No (L6) | `30` | Maximum SSE stream requests per IP per window |
| `MAX_CONCURRENT_INVESTIGATIONS` | No (L6) | `4` | Maximum concurrent background investigation jobs |
| `GLOBAL_DAILY_CHECK_CAP` | No (L6) | `500` | Global daily check creation rate cap across all IPs |
| `RECORD_REPLAY_MODE` | No (L7) | `off` | Record and replay mode (`off`, `record`, `replay`) for LLM and search calls |
| `RECORD_REPLAY_DIR` | No (L7) | `.recordings` | Directory storage for recorded request/response JSON files |
| `YOUTUBE_API_KEY` | No | - | Official YouTube Data API for comment analysis (deferred) |

> [!WARNING]
> **Proxy Trust Behavior:** When `TRUST_PROXY=false` (the default), all client proxy headers (`x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`) are ignored and all requests map to a single shared `"unknown"` rate-limit bucket. This means one client can consume the rate limit for all clients unless running directly on localhost without a proxy. Set `TRUST_PROXY=true` **only** when deployed behind a trusted reverse proxy (e.g. Cloudflare, Nginx, AWS ALB) that strips spoofed headers and reliably appends the client IP. Never use `TRUST_PROXY=true` in direct-to-internet deployments.

All environment variables are validated through [`lib/env.js`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/env.js). Missing required variables fail clearly with specific error messages and never print secret values.

---

## 3. How to Run

### Development Server
```bash
# Start Next.js alone (classifier calls fallback to could_not_check if service is down):
npm run dev

# Start Next.js AND the Python classifier microservice together:
npm run dev:all

# Start only the Python classifier microservice:
npm run classifier:dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application.

> [!NOTE]
> **Classifier Service Resilience:** If the Python microservice is not running, the Node application gracefully continues. The classifier agent returns `status: "could_not_check"` with reason `"classifier_service_unavailable"`, adding 0 risk points and never throwing.


### Linting
```bash
npm run lint
```

### Unit Tests
```bash
npm test
```

### Contract Validation
```bash
node scripts/validate-contracts.js
```
Validates all 100 valid/invalid fixtures, relational constraints, and end-to-end scenario CaseFiles against Zod schemas.

### Smoke Test
```bash
node scripts/smoke.js
```
The smoke test verifies check creation in SQLite, state retention, 24-hour expiration calculation, and (if `LLM_API_KEY` is present) calls `generate()` with a strict Zod schema.

### Scoring Fixtures
```bash
npm run score:fixtures
```
Demonstrates the pure-code L3 decision engine across Scenario A (Clear Scam), Scenario B (Genuine Notice), and Scenario C (Ambiguous Thin Evidence).

### Agent Fixture Runner
```bash
npm run agents:run
```
Runs all 6 specialist agents across Scenarios A, B, and C in an offline test harness using schema-validated mock dependencies.

### Full Pipeline Check Runner (L5)
```bash
# Offline mode (no network, no LLM API keys needed):
npm run check:run

# Live trace stream of agent actions (tools, lookups, queries, notes, verdicts, flags):
node scripts/run-check.js --trace
node scripts/run-check.js --trace --scenario A

# Negative assertion test (expects non-zero exit):
node scripts/run-check.js --expect-fail

# Live mode (requires real keys in .env.local and consent flag):
npm run check:live
```
Executes a full end-to-end opportunity check from input creation, regex/vision extraction, user entity confirmation, multi-round investigation loop, scoring, and report generation. Validates the report against `ReportSchema` and asserts risk level outcomes. Passing `--trace` streams the ordered real-time action sequence for each agent (tool start/end, lookups, notes, verdicts, flags).

### API & Operations Smoke Test (L6)
```bash
node scripts/ops-smoke.js
```
Boots a production `next start` server on an ephemeral port with an isolated temporary SQLite database and upload directory. Tests health endpoints, security headers, multipart error mapping, text opportunity creation, async extraction completion polling, SSE stream reconnection frames, and rate limiting with `429 Too Many Requests`.

### End-to-End Offline API Runner (L6-F)
```bash
# Offline execution across Scenarios A, B, C, and A-Image:
npm run api:e2e

# Negative assertion test (expects non-zero exit code):
node scripts/api-e2e.js --expect-fail
```
Tests the complete HTTP lifecycle directly through App Router handlers with an isolated database and upload directory: multipart check creation, background regex/vision extraction, polling, SSE progress event streaming, confirmation, investigation execution, scoring, ReportSchema conformance, flag evidence validation, upload cleanup, and strict non-zero exit on `--expect-fail`.

### Record and Replay Subsystem (L7-E)
```bash
# List all recorded interactions in .recordings:
node scripts/replay-tools.js list

# Verify integrity and checksums of recordings:
node scripts/replay-tools.js verify

# Prune recordings older than 30 days:
node scripts/replay-tools.js prune --age-days 30 --yes
```
**When to use replay:** Use replay mode (`RECORD_REPLAY_MODE=replay`) during offline regression testing, CI test runs, evaluation runs, and reproducible deterministic demonstrations where external network dependencies or LLM rate limits must be avoided.  
**Demonstration disclosure:** Any public demonstration or benchmark executed with recorded or replayed model/search calls **MUST explicitly state** that it was run in replay mode using pre-recorded model responses. Replay mode is strictly blocked from saving synthetic identifiers to the scam intelligence graph.

### Evaluation Harness (L7-F)
```bash
# Offline evaluation against canonical scenario fixtures:
npm run eval:fixtures

# Validate eval dataset schema and integrity only:
node scripts/evaluate.js --validate-only

# Run evaluation on sample cases (in smoke/replay mode):
npm run eval:replay
```
Measures confusion matrices, false alarms, and dangerous misses without making unfounded statistical accuracy claims. Discloses synthetic data boundaries explicitly.

### Privacy & Retention Verification (L7-G)
```bash
# Verify 24h expiration, image cleanup, PII redaction, and graph persistence:
npm run privacy:check

# Negative assertion test (expects non-zero exit):
node scripts/privacy-check.js --expect-fail
```
Verifies that after 24 hours all user message text, uploaded images, and intermediate checks are permanently deleted from the database and filesystem, feedback is anonymized with `check_id = NULL`, and only verified threat identifiers persist in the intelligence graph.

### Secrets & Credential Hygiene Scan (L7-G)
```bash
# Scan working tree, git history, and .env.local untracked status:
npm run secrets:scan
```
Scans for exposed API key patterns and private keys in the working tree and commit history, asserts `.env.local` is gitignored and untracked, and reports npm audit vulnerabilities by severity without auto-fixing.

### Runnable Interactive CLI Demo (L7-G)
```bash
# Run all canonical demonstration scenarios (A, B, C):
npm run demo

# Or run an individual scenario:
node scripts/demo.js --scenario A
node scripts/demo.js --scenario B
node scripts/demo.js --scenario C
```
Demonstrates complete offline end-to-end opportunity verification across high-risk scam, genuine notice, and ambiguous fallback scenarios. See [`docs/demo-script.md`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/docs/demo-script.md) for the live presentation walkthrough.

### Script Execution Modes (Offline vs Live)

| Script / Command | Mode | External Network Calls | Required API Keys |
|---|---|---|---|
| `npm test` | **Offline** | None (mocks/fakes) | None |
| `npm run lint` | **Offline** | None | None |
| `npm run build` | **Offline** | None | None |
| `npm run score:fixtures` | **Offline** | None (pure code) | None |
| `npm run agents:run` | **Offline** | None (schema stubs) | None |
| `npm run check:run` | **Offline** | None | None |
| `npm run check:live` | **Live** | Gemini LLM, OSINT tools | `LLM_API_KEY`, Search/OSINT keys |
| `npm run api:e2e` | **Offline** | None | None |
| `npm run api:live` | **Live** | Real Next.js server & external services | `LLM_API_KEY`, etc. |
| `npm run eval:fixtures` | **Offline** | None | None |
| `npm run eval:replay` | **Offline / Replay** | None (replays `.recordings/`) | None |
| `npm run privacy:check` | **Offline** | None | None |
| `npm run secrets:scan` | **Offline** | Local files & `npm audit` | None |
| `npm run demo` | **Offline** | None | None |

---

## 4. Project Structure

```
.
├── AGENTS.md               # Product rules, layer boundaries, and invariants
├── ARCHITECTURE.md         # Technical architecture and layer definitions
├── PRD.md                  # Product requirements and data specifications
├── app/
│   └── api/
│       ├── health/route.js # Health probe (?llm=1 runs small generate() test)
│       └── checks/
│           ├── route.js    # POST /api/checks (CheckSubmission validation)
│           └── [id]/route.js # GET /api/checks/:id
├── lib/
│   ├── env.js              # Single place reading and validating process.env with Zod
│   ├── contracts/          # Zod schemas, 28-flag registry, normalizers, fixtures
│   ├── db/
│   │   ├── index.js        # Typed SQLite repositories, check lifecycle, cleanup
│   │   ├── state-machine.js # Deterministic 7-state transitions & matrix assertion
│   │   └── migrations/     # Versioned idempotent SQLite migrations (001, 002)
│   ├── caseFile.js         # CaseFile assembly from SQLite & pure renderMarkdown
│   ├── data/
│   │   └── seed-graph.json # Curated scam graph seed data (placeholder, fake, replace from public advisories)
│   ├── graph.js            # Scam graph repository wrapper and write policy enforcement
│   ├── logger.js           # Structured pino logger with secret & user-content redaction
│   ├── cache.js            # TTL cache implementation on lookup_cache table
│   └── llm/
│       └── generate.js     # Unified generate() wrapper, retry, and wrapUntrusted()
├── scripts/
│   ├── validate-contracts.js # Full contract & scenario fixture validation script
│   └── smoke.js            # End-to-end smoke test script
├── tests/
│   ├── contracts.test.js   # Zod contract, normalization, and scenario tests
│   ├── migrations.test.js  # Schema migrations, pragmas, and idempotency tests
│   ├── repositories.test.js # Typed db repositories, cascade, and cleanup tests
│   ├── state-machine.test.js # 7x7 state machine Cartesian matrix test
│   ├── case-file.test.js   # Case file assembly and markdown rendering tests
│   ├── logger.test.js      # Structured logger redaction tests
│   └── api.test.js         # API route validation & error handling tests
└── .env.example            # Environment template
```

---

## 5. Decision Engine (L3)

The decision layer ([`lib/scoring/score.js`](file:///home/linuxlite/Desktop/dem2/lib/scoring/score.js)) implements a deterministic, pure-code scoring engine ([`scoreCase`](file:///home/linuxlite/Desktop/dem2/lib/scoring/score.js#L12-L215)) configured by [`lib/scoring/config.js`](file:///home/linuxlite/Desktop/dem2/lib/scoring/config.js):
- **Deterministic facts:** Computes risk levels (`low`, `medium`, `high`, `cannot_verify`) from agent findings and the 29-flag registry.
- **Group suppression & Hard rules:** Only the highest weight in a flag group (e.g. upfront fee group) counts; critical flags (`scholarship_fee_demand`, `mule_account_request`, `graph_match`) trigger a hard rule forcing the level to High and establishing a score floor of 60.
- **Confidence calculation & cap:** Confidence reflects the completion ratio of eligible checks (`completedCount / eligibleCount`). It is capped at `medium` unless at least one external-evidence agent (`website_forensics`, `official_verifier`, `reputation_osint`, `payment_entity`) has an `ok` result.
- **Synthetic classifier disclaimer:** Classifier points (up to 25) scale linearly from model probability; however, because the starter classifier dataset is synthetic, no accuracy or scoring claim is cited from classifier metrics.
- **Purity & safety:** Pure code with zero I/O, no network, no database, no LLM calls, and immutable input handling.

---

## 6. Layer Progress

- [x] **L0 Foundation** (Passed: Next.js init, env validation, SQLite baseline schema, LLM adapter, cache, API routes, lint & smoke tests)
- [x] **L1 Contracts and data** (Passed: Zod schemas, 28-flag registry, normalization rules, fixtures, versioned migrations 001-005, state machine matrix, typed repositories, case file assembly & markdown, structured logger, API validation, TraceEvent discriminated union, 4 KB serialized limit helper, trace stream fixtures, check_events seq & payload_json backfill, appendEvent/listEventsAfter repository methods, userNotes (max 5,000 chars) and handlePlatform on CheckSubmission, platform and quote evidence on Entity)
- [x] **L2 Services** (Passed: live proof for RDAP, DNS, SSL, Wayback, Serper, URLhaus, urlscan, classifier, and Gemini LLM; 112 offline unit tests passing; zero secret leaks; [TICKET-OSINT-YT] Deferred: YouTube Data API comment analysis tool in lib/tools/youtube.js with quota & burst heuristics)
- [x] **L3 Decision** (Passed: pure-code scoring engine, frozen config with 29 registry flag weights, fee group suppression, hard-rule floors, external evidence confidence cap, 142 offline tests, runnable score:fixtures script)
- [x] **L4 Agents** (Passed: 6 specialist agents with deterministic eligibility, execution timeout, multi-item partial failure, strict Zod validation, quote/URL evidence, source purity, central registry `lib/agents/index.js`, runnable `agents:run` fixture runner; Message Analyst upgraded with userNotes ingestion, normalized contiguous quote snapping, entity context block, adversarial carve-out protections, deterministic temperature 0, and 4 new flags: crypto_payment_request, paid_placement_guarantee, unpaid_trial_work, referral_recruitment)
- [x] **L5 Pipeline** (Passed: multi-source regex & vision extraction over text, userNotes, and OCR, UPI vs email disambiguation, grounded LLM entity sweep with retry and fallback, user confirmation step, multi-round coordinator with single-writer rule, report writer with deterministic fallback, cleanup service, offline & live run-check test runners)
- [x] **L6 API and UI** (Backend API, SSE stream, and Agent Activity endpoint complete; interactive check UI active with six agent cards, live SSE updates, and activity log drawer)
- [x] **L7 Features and hardening** (Backend complete: feedback & save-to-graph, deterministic action templates for college email & cybercrime fraud summary, educational guides subsystem with statutory sanitization, record-replay subsystem for offline LLM/search auditing, offline evaluation harness with 95% Wilson score interval and claim guard, automated privacy scanner with 24h retention check, credential hygiene scanner, and runnable CLI demo)
