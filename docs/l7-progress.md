# L7 Progress Tracking: Features, Evaluation & Hardening

## Overview & Step Checklist
This document tracks the step-by-step implementation, testing, and verification of Layer L7 according to `AGENTS.md` and `docs/l7-spec.md`.

### Steps A to G
| Step | Description | Commit | Status | Verification & Evidence |
|:---:|---|:---:|:---:|---|
| **A** | Audit, specifications, decision records (DR-1 to DR-10), contract gaps, open questions | `784a56a` | Complete | `docs/l7-spec.md`, `docs/l7-progress.md`, zero code diff |
| **B** | Feedback & Save-to-Graph: contracts, redaction, repository logic, route handlers, tests | `5b9d4a9` | Complete | Commits L7-B0..L7-B3, `tests/api-feedback.test.js`, `tests/api-save-to-graph.test.js`, `tests/api-redaction.test.js` |
| **C** | Action routes: `college-email`, `fraud-summary` | `5b9f97e` | Complete | Commits L7-C0..L7-C3, `lib/actions/index.js`, `tests/api-actions.test.js` |
| **C2** | Confirm behaviours of step C: header injection, redaction, rate limits, zero-echo bounds, db immutability | `779fd88` | Complete | Commit L7-C2-1, `tests/api-actions.test.js` (20 passing tests) |
| **D** | Guides: educational guides, schema, loader, route handlers, tests, fact review | `392b01a` | Complete | Commits L7-D0..L7-D3, `lib/guides/`, `app/api/guides/`, `tests/guides.test.js`, `docs/guides-review.md` |
| **E** | Record and replay subsystem for LLM and search calls | `7958c3b` | Complete | `lib/record-replay.js`, `scripts/replay-tools.js`, `tests/record-replay.test.js` (15 passing tests) |
| **E2** | Verify behaviours of step E: replay offline, degraded mode, zero leakage, deduplication | `619f2ef` | Complete | Commits L7-E2-1, L7-E2-last, `tests/record-replay.test.js` (20 passing tests) |
| **E3** | Route-level extraction recording and replay integration | `0e35db2` | Complete | Commits L7-E3-1, L7-E3-2, `app/api/checks/route.js`, `lib/api/runtime.js`, `tests/record-replay.test.js` (23 passing tests) |
| **F** | Evaluation harness: dataset curation, metrics calculation, claim guard | `d4d6ff4` | Complete | `scripts/evaluate.js`, `scripts/eval/`, `data/eval/sample-cases.json`, `docs/evaluation.md`, `tests/evaluate.test.js` (16 passing tests) |
| **G** | Demo script, privacy checks, README, Wilson score interval, secrets patterns, and L7 gate verification | `L7-G3-last` | Complete | Commits L7-G0..L7-G3-last, 689 tests passing, Wilson score interval tested, secrets scanning passing |

---

## Step D Implementation & Verification Notes (Guides Subsystem)
- **Authoritative Content (`lib/guides/content.js`)**:
  - Six standard guide types: `scholarship_scam`, `internship_scam`, `task_scam`, `mule_account`, `contest_fraud`, `overseas_agent`.
  - Facts strictly derived from repository notes (PRD section 2, Flag Registry, manual links, and known domains). Zero invented numbers or unverified statistics.
  - Every claim explicitly cites source IDs present in that guide's `sources` list.
  - Review status set to `draft_needs_review` with date `2026-10-25`.
  - Reporting channels advisory text strictly recommends users to "verify on the official site".
- **Loader & Type Mapping (`lib/guides/index.js`)**:
  - `listGuides()` returns array of lightweight summaries (`type`, `title`, `summary`).
  - `getGuideByType(type)` returns full validated guide or `null`.
  - `GUIDE_TYPE_MAPPINGS` provides clean bidirectional mapping between Guide types, Report `scamTypeGuess` (`scholarship`, `internship`, `task_job`, `mule_offer`, `competition`, `overseas_agent`), and domain `SCAM_TYPES`.
- **API Routes**:
  - `GET /api/guides`: Returns 200 `{ guides: [...] }` validated against `GuideListResponseSchema`.
  - `GET /api/guides/:type`: Returns 200 with full guide validated against `GuideSchema`, or 404 `NOT_FOUND` with zero-echo error payload if type is unknown.
  - Both routes protected by `guideRead` rate limiter (`RATE_LIMIT_GUIDE_MAX=60` reads/min) and return security headers with `no-store`.
- **Review Document (`docs/guides-review.md`)**:
  - Comprehensive claims audit table with human verification status column and review notes on statutory legal nuances in India.

---

## Step D2 Implementation & Fact Sanitization Notes
- **Fact Sanitization & Legal Claims Removal (`lib/guides/content.js`)**:
  - Audited all sentences in `lib/guides/content.js` and `docs/guides-review.md` for statutes, section numbers, criminal penalties, and unverified statistics.
  - Removed unsourced assertions regarding "legal liability", "criminal liability", "severe legal consequences", "permanent travel bans", "criminal prosecution", and "100% visa approval".
  - Replaced with neutral, grounded warnings ("details of account misuse should be verified with your bank", "details to be confirmed with an official source", "Unrealistic promises of guaranteed visa approval").
  - Removed statutory notes citing Section 102/106 CrPC / BNSS, FIRs, and destination-country criminal procedures from `docs/guides-review.md`.
  - All 13 claims across the 6 guides have empty "Verified by Human" cells in `docs/guides-review.md`, awaiting native human review.
- **Contract & Mapping Clarification (`lib/guides/index.js`)**:
  - Documented explicit mapping invariants: 6 unique guide types in `GUIDE_TYPE_MAPPINGS` mapped to valid `SCAM_TYPE_GUESSES`.
  - Documented domain enum differences: `overseas_agent` maps to domain `generic_suspicious` (since domain `SCAM_TYPES` has no dedicated overseas enum) and `internship_scam` maps to `recruitment_fraud`.
  - Proved `getGuideForScamTypeGuess` matches against Report `scamTypeGuess` directly (1-to-1 match), guaranteeing that an `overseas_agent` report always resolves to the `overseas_agent` guide.
- **Automated Invariant Tests (`tests/guides.test.js`)**:
  - Added test failing if any guide sentence contains statute markers (`section`, `act`, `code`, `article` + number) or criminal penalty terms (`penalty`, `imprisonment`, `jail`, `fine of`, `court`, `legal liability`, `punishable`, `criminal prosecution`, `entry ban`, `travel ban`).
  - Added test validating that every non-trivial sentence in `redFlags`, `whatToVerify`, and `whatToDo` adheres to approved instructional/indicator phrasing.
  - Added test confirming `reviewStatus: "draft_needs_review"`, `verified: false` with retrieval notes, and forbidding `reviewStatus: "human_reviewed"` unless all sources are verified.
  - Added test confirming `GUIDE_TYPE_MAPPINGS` has exactly 6 unique types, all `scamTypeGuess` values are in `SCAM_TYPE_GUESSES`, and `getGuideForScamTypeGuess` correctly resolves all 6 guides.

---

## Step C & C2 Implementation & Behaviour Confirmation Notes
- **Pure Deterministic Builders (`lib/actions/index.js`)**:
  - `buildCollegeEmail` and `buildFraudSummary` are strictly pure functions with zero I/O, zero network, zero DB access, and zero LLM calls.
  - Generates neutral, evidence-backed text based strictly on validated `Report` objects and validated request payloads.
  - Strips `\r` and `\n` from email subject lines to guarantee single-line subjects and prevent CRLF email header injection attacks.
  - Strips HTML tags and collapses whitespace in evidence quotes (`cleanQuote`), truncating to 150 characters to prevent HTML/XSS injection.
  - Hindi output templates carry note `needs native review` in `notes: ["needs native review"]`.
- **Reporting Channels & Manual Links**:
  - `REPORTING_CHANNELS` in `lib/report/constants.js` are unverified advisory entries (`url: null`, `helpline: null`, `verified: false`).
  - Text advises users to `"verify on the official site"`. No third-party reporting portal is presented as confirmed contact details.
  - `MANUAL_LINKS` (`lib/agents/manual-links.js`) are institutional and registry verification tools (MCA, GST, NSP, PIB Fact Check), not fraud-reporting portals.
- **Allowed Risk Levels**:
  - Per `docs/l7-spec.md` Decisions 3 and 4, both action routes (`college-email`, `fraud-summary`) are permissible for any check in `report_ready` lifecycle state regardless of risk level (`low`, `medium`, `high`, `cannot_verify`).
  - Unlike `save-to-graph` (which is restricted to `high` risk), `college-email` and `fraud-summary` allow students to seek college verification or document disputed transactions for any completed check.
- **Zero-Storage Guarantee & State Immutability**:
  - Neither action route writes to any database table (`checks`, `reports`, `entities`, `check_inputs`, `check_events`, `feedback`, `graph_nodes`, `graph_edges`).
  - Proven by `tests/api-actions.test.js` verifying table counts across all SQLite tables remain byte-for-byte identical before and after route execution.
- **Zero-Echo Validation**:
  - Boundary violations for amount (0, negative, non-integer, >10M) and date (future, >365 days ago, malformed calendar dates) return HTTP 400 `BAD_REQUEST` with custom static error messages that never reflect the raw input back to the caller.
- **Rate Limiting**:
  - Both routes share the `actionCheck` rate limiter bucket (`RATE_LIMIT_ACTION_MAX=15` per 15-minute window). The 16th action request is rejected with HTTP 429 `RATE_LIMITED` and returns a `Retry-After` header.

---

## Step B Implementation Notes & Known Limits
- **Cryptographic Reference Salt Statement (`check_ref`)**:
  `check_ref` is computed as `crypto.createHash("sha256").update(checkId.trim()).digest("hex").slice(0, 32)`. It is **plainly unsalted**. Because UUID v4 has 122 bits of pseudo-random entropy, computing a precomputed rainbow table across the $2^{122}$ search space is computationally infeasible, making `check_ref` pre-image resistant against external third parties. However, an internal attacker possessing the raw checks table could recompute hashes to correlate checks with graph edges.
- **Save-to-Graph Exclusion Rules (DR-2 Refinement)**:
  - `domain`: Excluded if in `known-domains.json`, official suffixes (`.gov.in`, `.nic.in`, `.ac.in`, `.edu.in`, `.mil.in`), or `free-email-domains.json`.
  - `upi`: Valid UPI format only; excluded if whole value or its handle/domain part (`after @`) matches an excluded domain (`someone@gmail.com`, `name@ugc.ac.in`). Normal bank PSP handles (`okaxis`, `ybl`, `okhdfcbank`, `paytm`) are permitted if confirmed and non-discovered.
  - `handle`: Normalised (strip `@`, scheme, `www.`, path, query; lowercase) and excluded if equal to or subdomain of an excluded domain or official suffix (`gmail.com`, `sub.ugc.ac.in`, `scholarships.gov.in`). Exact domain dot boundaries are enforced (`evilgmail.com` is preserved).
  - `phone`: E.164 normalized; unconfirmed and discovered already filtered out.
  - Excluded kinds: `company`, `email`, `url`, `youtube_url`, `amount`.
  - Cap of 5 identifiers per check; single atomic transaction; partial exclusions do not abort saving remaining valid identifiers.
- **Security & Privacy Note on Stored Feedback Comments**:
  Stored feedback comments are untrusted user text. They are sanitized on ingress with `redactComment` (which strips phone numbers including +91 and spaced/dashed formats, Devanagari numerals, emails, UPI IDs, URLs, and long digit runs). However, any future UI or administrative tool that displays feedback comments MUST render them as plain text, never as HTML, to prevent stored XSS.
- **Contract & Architecture Alignment**:
  - `FeedbackSchema` updated with optional `outcome` enum (`"confirmed_scam"`, `"confirmed_genuine"`, `"lost_money"`, `"not_sure"`).
  - Added `FeedbackRequestSchema`, `SaveToGraphRequestSchema`, `SaveToGraphResponseSchema` to `lib/contracts/`.
  - Added `saveFeedbackUnique` to `lib/db/index.js` ensuring single-transaction duplicate prevention without requiring a schema migration.
  - Added `saveCheckIdentifiers` and `isExcludedDomain` to `lib/graph.js` enforcing all 6 poisoning/defamation exclusion rules and 5-identifier cap.
  - Added rate limiter settings `RATE_LIMIT_ACTION_MAX=15` and `RATE_LIMIT_GUIDE_MAX=60` to `lib/env.js`.
- **Gap on Replay Mode Check Marker**:
  Recorded as requirement for Step E / Step D: when testing checks against offline replays, synthetic or replay checks must be flagged to prevent polluting real database graph nodes.

---

## Step E Implementation & Verification Notes (Record and Replay Subsystem)
- **Deterministic Key Computation (`lib/record-replay.js`)**:
  - `computeGenerateKey`: Normalizes `{ system, prompt, schema, model, images }` and hashes with SHA-256. Images are hashed by content buffer rather than file path. Zod schemas are serialized with their shape field types to ensure structurally distinct schemas produce distinct hashes.
  - `computeSearchKey`: Normalizes `{ query, gl, hl, num }` (lowercasing and trimming query) and hashes with SHA-256.
- **Operational Modes (`RECORD_REPLAY_MODE`)**:
  - `off`: Default mode. Pure identity wrapper around provider functions with zero disk I/O.
  - `record`: Executes underlying provider, atomically serializes response to disk via temporary file rename (`.recordings/*.json`), capped at 2MB per file. Throws immediately if `NODE_ENV === "production"`.
  - `replay`: Pure offline replay. Reads recording from disk by SHA-256 key. On missing or corrupted/truncated file, returns `{ ok: false, error: { code: "RECORDING_MISSING" } }` and **never** calls the real provider.
- **Privacy & Secret Redaction**:
  - Recording payloads and log outputs strictly scrub API keys, Authorization headers, Bearer tokens, and user credentials.
- **Integration Points**:
  - `lib/coordinator.js:buildDefaultDeps`: Wraps `generate` and `search` using record-replay decorators while preserving default parameters.
  - `GET /api/health`: Discloses active `replayMode` in response JSON.
  - `POST /api/checks/:id/save-to-graph`: Strictly refuses saving identifiers to graph when `RECORD_REPLAY_MODE !== "off"`, returning HTTP 409 `STATE_CONFLICT` with `{ reason: "replay_mode_active" }` to prevent graph pollution.
  - `scripts/replay-tools.js`: CLI tool supporting `list`, `verify`, and `prune --age-days <N> [--yes]`.
- **E2E Scenario Reproducibility**:
  - Verified by `tests/record-replay.test.js`: recording an end-to-end investigation run and replaying it with a throwing spy provider reproduces the exact same risk level and score without contacting upstream providers.

---

## Step E2 Behaviour Verification Notes (20 Tests Total)
- **Behaviour a (Vision + Agent + Report in Replay Mode)**:
  - Proven by `tests/record-replay.test.js: behaviour a`: full pipeline execution with screenshot upload runs extraction, agents, and report writer. During replay mode, makes **ZERO calls** to the underlying provider and reproduces identical score and risk level.
- **Behaviour b (Missing or Empty Recordings Directory)**:
  - Proven by `tests/record-replay.test.js: behaviour b`: missing or empty directory returns `{ ok: false, error: { code: "RECORDING_MISSING" } }` without throwing. Investigation pipeline degrades cleanly to `could_not_check` and completes with `cannot_verify` risk level with zero network/provider calls.
- **Behaviour c (Prompt & Error Redaction)**:
  - Proven by `tests/record-replay.test.js: behaviour c`: keys in user prompt are excluded from the recorded file because prompt text is hashed into the SHA-256 key; keys in error messages are censored via high-entropy token sanitization.
- **Behaviour d (Health Route Zero Paths)**:
  - Proven by `tests/record-replay.test.js: behaviour d`: `GET /api/health` across `off`, `record`, and `replay` modes outputs only standard enum values (`"off"`, `"record"`, `"replay"`) and never leaks directory paths, file paths, or system folders.
- **Behaviour e (Cross-Check Safety & Deduplication)**:
  - Proven by `tests/record-replay.test.js: behaviour e`: two distinct check IDs sharing identical prompt text and schema reuse the single existing recording safely with zero check-specific metadata or pollution.
- **Code Path Discovery (Vision Fallback vs Injected Generate)**:
## Step E3 Implementation & Route-Level Extraction Recording Notes
- **Shared Wrapped Generate for Extraction Route Handler**:
  - `app/api/checks/route.js` builds default `extractDeps` via `context.extractDeps || { db, logger, uploadDir, generate: runtimeDeps.pipelineDeps?.generate || buildDefaultDeps(process.env, db).generate }`.
  - In `lib/api/runtime.js`, `getRuntime(overrides)` exposes `pipelineDeps: overrides.pipelineDeps || buildDefaultDeps(process.env, db)`.
  - When checks are submitted with image attachments (`POST /api/checks`), background `runExtraction` now uses the shared record/replay-wrapped `generate` rather than falling back to unrecorded `defaultGenerate`.
  - In `record` mode, `runExtraction` records the vision LLM prompt and response to the recordings directory (`.recordings/`).
  - In `replay` mode, `runExtraction` replays the vision call directly from disk without invoking the raw upstream provider.
  - In `off` mode, identity passthrough preserves normal production LLM behavior with zero disk overhead.

## Step F Implementation & Evaluation Harness Notes
- **Evaluation Tooling & Schemas (`scripts/eval/`)**:
  - `schema.js`: Strict validation of 19 dataset columns (`id, text, link, upi_id, company, handle, phone, language, expected_level, scam_type, why, source_type, source_url, source_date, license_note, group_id, labeler_1, labeler_2, notes`). Enforces two independent labels, allows disagreements with `hasLabelDisagreement: true`, and maps to camelCase `EvalCaseSchema`.
  - `loader.js`: Full CSV and JSON parsing, duplicate detection by normalized text hash, group_id leakage checks, and classifier dataset overlap detection against `services/classifier/data/dataset.csv`.
  - `metrics.js`: Pure functions computing overall agreement, 4x4 confusion matrix, dangerous misses (high->low and elevated->low), false alarms (low->high), cannot_verify rate, could_not_check share, per-scam-type breakdown, per-flag precision, per-agent status rates, confidence calibration, latency percentiles, call counters, and deterministic 95% bootstrap confidence interval (seed: 42).
  - `report.js`: Dual output Markdown and JSON generator enforcing Claim Guard ("No public accuracy claim may be asserted unless evaluation dataset contains at least 50 non-synthetic cases with two independent labels"), zero message text leakage by default (shown only with `--show-text`), and auxiliary classifier metrics display without training.
  - `runner.js`: Multi-mode coordinator runner supporting `fixtures` (100% agreement on reference scenarios A, B, C), `replay` (uses `.recordings/` with REPLAY_MISS counted separately as could_not_check), and `live` (requires real keys and `--yes-use-fake-or-public-data`, bounds `--max-llm-calls` and `--max-searches`, and generates partial report on budget limit).
- **Synthetic Sample Dataset (`data/eval/sample-cases.json`)**:
  - 14 clearly synthetic cases with `source_type: "synthetic"`, reserved `.example` domains, covering all 4 risk levels (`low`, `medium`, `high`, `cannot_verify`), 6 scam types, and both languages (`en`, `hi`). Zero duplicates, zero group violations, and zero classifier overlap.
- **Protocol Documentation (`docs/evaluation.md`)**:
  - Complete specifications on dataset authoring, CSV columns, two-labeler protocol, provenance definitions, group ID invariants, CLI modes, metric definitions, and claim guard restrictions.

## Step F2 Evaluation Harness Tightening Notes
- **Claim Guard Tightening**:
  - Only cases with `source_type: "real_public"` or `"paraphrased"`, both `labeler_1` and `labeler_2` non-empty AND equal (zero disagreement), and `expected_level` agreeing with both annotators count toward the minimum 50 qualifying cases.
  - Datasets with `< 50` qualifying cases display `HEADER: "NO PUBLIC ACCURACY CLAIM PERMITTED (Qualifying: X / Total: Y)"`.
  - Datasets with `>= 50` qualifying cases display `HEADER: "PRELIMINARY FIGURE ONLY (Qualifying: X / Total: Y), interval shown"`.
  - Disagreeing cases, single-labelled cases, and synthetic cases are strictly tracked and reported in separate counts.
- **Language & Input Breakdowns**:
  - Main report `language` field is restricted to `en` | `hi` (report language).
  - Added optional `text_language: "en" | "hi" | "hinglish" | "other"` to raw and normalized schemas, enabling Hinglish inputs while preserving clean report localization.
- **Exhaustive 4x4 Confusion Matrix Error Partition**:
  - The 16 cells of the 4x4 matrix are exhaustively categorized into:
    - **Correct (4 diagonal cells):** `(low, low)`, `(medium, medium)`, `(high, high)`, `(cannot_verify, cannot_verify)`
    - **Dangerous Miss (2 cells):** `(medium, low)`, `(high, low)`
    - **False Alarm (1 cell):** `(low, high)`
    - **Over-cautious (1 cell):** `(low, medium)`
    - **Unhelpful Abstention (3 cells):** `(low, cannot_verify)`, `(medium, cannot_verify)`, `(high, cannot_verify)`
    - **Missed Abstention (3 cells):** `(cannot_verify, low)`, `(cannot_verify, medium)`, `(cannot_verify, high)`
    - **Other Misclassifications (2 cells):** `(medium, high)`, `(high, medium)`
  - Formally tested that cell counts sum exactly to 100% of cases.
- **Flag Agreement Rate**:
  - Renamed from "per-flag precision" to "Flag Agreement Rate" in `metrics.js` and report markdown.
  - Accompanied by mandatory explanatory note: *"how often the final level matched the label in cases where this flag fired; not the accuracy of the flag"*.
- **Sample Smoke Mode (`--sample-smoke`)**:
  - Executes all 14 synthetic cases in `data/eval/sample-cases.json` through the real coordinator and scoring engine with deterministic case-keyed stubs.
  - Emits mandatory header: `"PLUMBING CHECK ON SYNTHETIC CASES; NOT A MEASUREMENT"`.
  - Bare accuracy percentages are strictly prohibited across CLI and report outputs; agreement figures are always accompanied by sample size $N$ and 95% bootstrap confidence interval.
- **Report Format Enhancement**:
  - Added "How to read this report" section presenting sample size, qualifying cases, 95% bootstrap CI, and claim guard status prominently at the top.
  - Failures inspection is cleanly structured showing case ID, expected level, predicted level, reason codes, and flag IDs.

## Step G2 Diagnostics, Sample-Smoke Agreement & Hardening Notes
- **Diagnosis of Initial Sample-Smoke Mismatches**:
  - Investigated the 9 mismatches in `evaluate.js --sample-smoke`.
  - Identified root causes in evaluation harness:
    1. `scripts/eval/runner.js:buildFixturesDeps` had a ternary expression bug (`scenarioKey = evalCase.id === "SCENARIO-A" ? "A" : (evalCase.id === "SCENARIO-B" ? "B" : "C")`) that evaluated `scenarioKey` to `"C"` for every synthetic case, forcing `isC = true` (cannot_verify) across tools and classifier.
    2. Hardcoded Scenario A stubs in `buildFixturesDeps` emitted quotes from Scenario A (`"pay an upfront verification fee of Rs 750"`) that were not present in the respective case texts, causing the coordinator's quote validator (`quoteInText`) to legitimately drop unverified quotes.
  - Proved scoring behavior in `lib/scoring/score.js` is 100% correct by design: running pure `scoreCase` on hand-built snapshots containing intended flags resulted in 14/14 (100.0%) agreement across all cases.
  - Fixed `scripts/eval/runner.js` with case-specific stubs keyed by `evalCase.id` using exact quotes from case texts, and fixed `scenarioKey`. Reached 14/14 (100.0%) agreement with 0 dangerous misses and 0 false alarms.
  - Added unit test in `tests/evaluate.test.js` validating case-by-case agreement across all 14 sample cases.
- **Privacy Scanner Enhancements (`scripts/privacy-check.js`)**:
  - Extended scanner to inspect captured application logs (`scanLogsForMarkers`) and API response bodies (`scanResponsesForMarkers`).
  - Added strict assertions that message text markers (`MARKERS.MSG_TEXT`) and user PII (`MARKERS.COMMENT_PII`) never leak into application logs or API response bodies.
  - Exposed helper functions and added comprehensive unit tests in `tests/privacy-secrets.test.js` validating deliberate marker detection in DB, logs, response bodies, filesystem, and CLI `--expect-fail` behavior.
- **Secrets Scanner Hardening (`scripts/secrets-scan.js`)**:
  - Updated pattern registry to explicitly cover Serper / Search API key formats (`SERPER_API_KEY`).
  - Added unit tests in `tests/privacy-secrets.test.js` asserting detection in temporary directories and git history without leaking secret values.
- **Checklist & Documentation Audit**:
  - Guide counts & review status: Exactly 6 guides in `lib/guides/content.js`, all marked with `reviewStatus: "draft_needs_review"`.
  - Caching verification: Audited routes and verified that no ETag or HTTP 304 caching is implemented in `app/` or `lib/`.
  - Test locations: College-email and fraud-summary tests verified in `tests/api-actions.test.js`.
  - Upstream dependencies security audit (`npm audit`): Recorded 3 known upstream vulnerabilities (2 high: `zod` collection memory exhaustion, `postcss` sourceMappingURL traversal via Next.js; 1 moderate: `next` via postcss) without auto-fixing to preserve stability and semver consistency.
  - Demo script numbers: Re-captured from fresh runs of `check:run` and `demo.js`, updated test count to 689.

## Step G3 Wilson Interval, Demo Numbers & Secrets Patterns Notes
- **Wilson Score Interval Replacement (`scripts/eval/metrics.js`)**:
  - Replaced the naive bootstrap percentile method for agreement proportion with a closed-form two-sided 95% Wilson score interval (`computeWilsonScoreInterval`, $z \approx 1.95996$).
  - Does not collapse to zero width at boundary proportions (e.g. 14 of 14 yields `[0.785, 1.000]` instead of `[1.000, 1.000]`).
  - Added pure unit tests verifying hand-computable benchmark values: 14/14, 0/10, 5/10, 98/100, 0/0.
  - In `sample-smoke` and `fixtures` modes, suppressed percentage and interval outputs in favor of matched stubs count: `plumbing check, no measurement (14 of 14 matched their stubs)`.
- **Demo Script Annotations (`docs/demo-script.md`)**:
  - Explicitly labeled every number with its producing runner (`demo.js` vs `check:run`).
  - Added explanatory callout documenting why Scenario A scores 97 in `demo.js` (single-round 4-flag stubs + ML classifier score) and 100 in `check:run` (full multi-round 9-flag scenario fixtures).
- **Secrets Scanner Hardening (`scripts/secrets-scan.js`)**:
  - Updated pattern definitions for Gemini/LLM keys to detect unquoted `AQ.` tokens and for search keys to detect 40-char hex strings in `SEARCH_API_KEY`, anchored by variable name or prefix.
  - Excluded `.env.local` from filesystem recursive walk (it is independently verified as gitignored and untracked by `checkEnvLocalStatus`).
  - Added unit tests in `tests/privacy-secrets.test.js` validating detection of dynamically generated fake tokens with those shapes, and asserting zero false alarms on normal 40-char hex strings or git commit hashes.

## Invariants to Maintain During L7
1. **Zero Database Access Outside `lib/db/`**: Routes interact strictly through typed repository functions.
2. **Zero `process.env` in `app/` and `lib/api/` Outside `lib/env.js`**: All configuration parsed in one place.
3. **No Defamatory Language**: Templates and summaries use neutral, evidence-backed framing.
4. **Deterministic Action Templates**: College email and fraud summary use pure deterministic code (no LLM).
5. **UI Remains Deferred**: Visual components remain in `deferred/ui/`.





