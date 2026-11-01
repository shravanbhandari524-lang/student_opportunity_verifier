# Architecture: Student Opportunity Verifier

Companion to PRD.md · Draft v3 · 19 October 2026 (layered build method in section 2, case file and coordinator in section 3)

PRD.md defines what the product does. This file defines how it is built. Where they conflict, PRD.md wins on product behavior and this file wins on technical design.

## 1. Design principles

1. **Deterministic code establishes facts; the LLM reads and explains.** Domain age, DNS, registry lookups and scoring are plain functions. The LLM interprets language, summarizes findings and writes the report. It never decides the final risk level.
2. **Evidence first.** Every flag carries a quote from the user's input or a source URL. A claim without evidence is not shown.
3. **Fail soft.** Any lookup, agent or service can fail. A failure becomes `could_not_check`, lowers confidence, and never crashes a run.
4. **Untrusted input everywhere.** User text, screenshots and fetched web pages may contain instructions aimed at the model. They are always treated as data.
5. **Privacy by design.** Collect the minimum, delete early, store only identifiers with consent.
6. **Provider-agnostic.** LLM, search and classifier sit behind small interfaces so any can be replaced.
7. **Cache everything external.** Saves quota, speeds repeat checks, and makes demos reliable.
8. **One shared case file, one writer.** All state about a check lives in a single case file. Agents read a snapshot and return results; only the coordinator writes to the case file.

## 2. Layers and build method

The system is built **layer by layer, bottom-up**. Each layer is finished, tested and demonstrated before the next one starts. This keeps errors close to where they start and makes every later layer easy to test against stable foundations.

### 2.1 Layer map

| Layer | Name | Contains | Depends on | Exit gate |
|---|---|---|---|---|
| L0 | Foundation | Repo, Next.js init, env validation, logging, lint, test runner, folder structure | nothing | Dev server, lint and tests run; missing env variables fail with a clear message |
| L1 | Contracts and data | zod schemas for every shared shape (Check, CheckInput, Entity, Flag, AgentResult with `skipped` status and `newEntities`, CaseFile, ScoreResult, Report, progress events), a fixed flag registry, fixtures for each, SQLite schema and versioned migrations, state machine, repositories, cache | L0 | Every fixture validates; invalid data is rejected; invalid state transitions are rejected; a CaseFile snapshot can be assembled from the database and rendered as markdown |
| L2 | Services | LLM layer (`generate`), tools (domain, payments, search, fetchPage with SSRF guard, youtubeComments), scam graph, classifier service and client, crawler service (`services/crawler` with pinned-IP safeProxy and adapter) | L0, L1 | Each service has mocked tests plus a runnable script proving one real call; failures return error results and never throw |
| L3 | Decision | Scoring engine: weights, hard rules, thresholds, confidence (counted over eligible agents only). Pure code | L1 | Fixture tests: clear scam gives High, genuine gives Low, thin evidence gives Cannot verify; skipped agents do not lower confidence; every result lists the rules that fired |
| L4 | Agents | Six agents (Message Analyst, Website Forensics, Official Verifier, Reputation / OSINT, Payment and Entity, plus the classifier client wrapper), each with a `canRun(snapshot)` rule and a `run(snapshot)` function, and the agent registry | L1, L2 | Each agent passes tests with mocked tools and LLM; canRun is correct on every fixture; every flag has evidence; timeout and failure produce could_not_check; nothing is written to the database |
| L5 | Pipeline | Extraction (regex and vision), the coordinator (main agent) with its round loop, report writer, progress events, cleanup job | L1 to L4 | `scripts/run-check.js` runs a full check from the command line on fixtures and on a live example, using rounds and skipping ineligible agents, and produces a valid report |
| L6 | API and UI | API routes, SSE stream, agent activity endpoint `GET /api/checks/:id/agents`, interactive agent cards, live activity stream, and inspection panel | L1, L5 | Full browser flow and agent activity log work on mobile and desktop |
| L7 | Features and hardening | College email, fraud help, guide content, feedback, rate limiting, privacy cleanup, evaluation script, README, demo script | L6 | Evaluation script runs, privacy checks pass, demo rehearsed |

### 2.2 Build order and runtime flow

Build order is bottom-up: L0, L1, L2, L3, L4, L5, L6, L7.

Runtime flow is top-down and passes through the same layers:

```
Browser
  -> API routes ................................ L6
      -> Pipeline: extraction .................. L5
      -> Coordinator (main agent): case file, rounds .. L5
          -> Eligible agents (canRun), in parallel .. L4
              -> LLM, tools, graph, classifier . L2
          <- agent results, validated by contracts (L1)
      -> Scoring ............................... L3
      -> Report writer (uses the LLM layer) .... L5
      -> Database: checks, results, report ..... L1
Browser <- report through the API and SSE ...... L6
```

Why bottom-up: the UI and pipeline are the most visible parts but depend on everything else. Building the stable layers first means each higher layer is tested against code that already works.

### 2.3 Dependency rules

1. A layer imports only from layers below it. Never upward.
2. Only L1 (`lib/db`) touches the database. Agents and tools never read or write the database. The pipeline passes them a context and saves their results.
3. Only the LLM layer talks to an LLM provider. Only L2 tools talk to external services.
4. Agents never call each other and never write to the database or the case file. They read a snapshot and return a result; the coordinator validates and merges it.
5. Scoring (L3) is pure: results in, score out. No I/O and no LLM.
6. The UI talks only to API routes, never to agents or services.

### 2.4 Contracts first

Every shared shape lives in `lib/contracts/` as a zod schema with fixtures in `lib/contracts/fixtures/`. All layers validate data against these schemas at their boundaries. The UI can be built against the fixtures before the backend exists.

Change control: a contract change is made in this file first, then in `lib/contracts/`, then in the layers that depend on it, with fixtures and tests updated in the same change.

### 2.5 Layer gates

A layer is complete only when all of these hold:

1. Tests for the layer pass.
2. A runnable script demonstrates the layer working (a real call for services, a fixture run for agents and scoring, a command-line check for the pipeline).
3. Lint passes.
4. Contracts are unchanged, or this file and the fixtures were updated first.
5. The README and the layer status list in AGENTS.md are updated.

No work on the next layer starts before the gate passes. A bug found in a later layer is fixed in the layer that owns it, with a test added there.

### 2.6 Parallel tracks (do not block the layers)

- **Data track:** collect the classifier dataset and the 50 to 100 case test set, fill the known-domains list and the graph seed file. Needed for real classifier metrics (L2) and the evaluation script (L7).
- **UI track:** once the L1 fixtures exist, pages and components can be built against them while the backend layers continue.
- **Keys and accounts track:** obtain the search API key and optional keys before the L2 search work.

### 2.7 Current scope: backend first

Layers L0 to L5, the backend part of L6 (API routes and the SSE stream) and the backend part of L7 (cleanup, evaluation, hardening) are built first. UI pages and components are deferred until the backend passes its gates. UI code built early lives in `deferred/ui/` and is reviewed when UI work starts. Code built ahead of its layer is marked PROVISIONAL and audited at its own layer gate. The layers, dependency rules and gates do not change.

## 3. Case file and coordinator

### 3.1 Idea

The system follows a blackboard pattern. One **case file** holds everything known about a check. A **coordinator** (the main agent) fills it from the user's input, decides which specialist agents have something to do, collects their findings back into the case file, and then evaluates the score. Specialists never talk to each other; they communicate only through the case file.

### 3.2 What the case file contains

| Part | Content |
|---|---|
| Inputs | What the user submitted: text, links, payment IDs, company, handle, phone, language, image metadata |
| Entities | Normalized items: domains, URLs, UPI IDs, emails, phones, companies, handles, amounts. Source is extracted, user or discovered |
| Findings | One AgentResult per agent per round: status, reason, summary, activity array, flags with evidence, verified items, discovered entities, optional tool trace |
| Ledger | Evidence ledger entries { id, agent, round, kind, flagId, claimKey, quoteOrUrl, evidenceType, verificationStatus, confidence, supportingSource, timestamp } and reconciliation record |
| Events | Append-only timeline of what happened and when |
| Control | Check status, current round, which entities each agent has already processed |

The case file is stored in SQLite (the tables in section 9 are its parts) and validated by the CaseFile contract. It is not a markdown file, because parallel agents can overwrite each other in a text file, markdown cannot be validated, and scoring needs structured data.

### 3.3 Single-writer rule

Agents receive a read-only snapshot and return an AgentResult. Only the coordinator writes to the case file, after validating each result against the contracts. This removes write conflicts and means a malformed agent output can never corrupt the case.

### 3.4 Coordinator loop

1. Create the case file from the validated input and run extraction (regex, then the vision model for screenshots). Extraction fills the entities.
2. After the user confirms or edits the entities, start round 1.
3. Take a snapshot. For each registered agent, evaluate `canRun(snapshot)`.
4. Run the eligible agents in parallel, each with a 25-second timeout. Record skipped agents with a reason.
5. Validate each result, merge flags, findings and discovered entities into the case file, and emit events.
6. If new entities were discovered and the round limit (2) is not reached, emit an `evidence_transfer` event for discovered entities delivered to round 2 agents, then go back to step 3. Otherwise continue.
7. Build the evidence ledger from sanitized agent results (`lib/evidence/ledger.js`), run pure `reconcile(ledger)` to detect duplicates, corroborations, and contradictions, and persist the ledger with the check.
8. Emit an `evidence_transfer` event recording ledger transfer to the report writer.
9. Run the scoring engine (pure code) using the ledger and reconciliation record.
10. Run the report writer (LLM) on the ledger and reconciliation findings, adding "Where the checks disagreed" when contradictions exist.
11. Save the report and finish.

The coordinator is plain code. The LLM is used only in extraction (vision), inside agents that need language understanding, and in the report writer. The risk level always comes from the scoring engine. Agents still never call each other and never write to the case file; the coordinator only routes.

### 3.5 Agent eligibility (`canRun`)

Each agent decides cheaply, with deterministic code and no LLM, whether it has work to do:

| Agent | Runs only when the case file has |
|---|---|
| Message Analyst | Message text |
| Classifier client | Message text |
| Website Forensics | At least one domain or URL entity it has not processed |
| Payment and Entity | At least one UPI ID, phone, handle, email or domain entity it has not processed |
| Official Verifier | At least one company entity or domain entity it has not processed |
| Reputation / OSINT | At least one company, domain, handle or YouTube URL entity it has not processed |

Example: if the user submits only a chat screenshot, extraction runs first. Agents then wake up only for what the screenshot actually contained. An agent with nothing to check returns `skipped` with a reason such as "no domain found".

### 3.6 Statuses

| Status | Meaning | Effect on confidence |
|---|---|---|
| ok | The agent ran and returned findings | counts as completed |
| skipped | Nothing applicable to check | not counted |
| could_not_check | The agent was eligible but failed or timed out | lowers confidence |

### 3.7 Discovery and rounds

An agent may return `newEntities`, for example a linked domain found by Website Forensics or another handle found by Reputation. The coordinator merges them, and they can make agents eligible in round 2. Safeguards: at most 2 rounds, at most 5 discovered entities per agent per round, only domain, handle and company kinds, evidence required (the page or quote they came from), normalization and deduplication, a `discovered` source marker, and the SSRF guard before any fetch.

Round execution and scoring rules:
- In round 2, the coordinator runs and records results only for agents that became newly eligible based on newly discovered entities; it writes no skipped rows for the rest.
- For scoring, each (agent, round) result with status `ok` or `could_not_check` counts once toward eligibility; skipped results are not counted.
- Website-related agents key their processed lists on the domain entity. A submitted URL creates both a `url` entity and a derived `domain` entity. Fields submitted in the initial form (`upiId`, `company`, `handle`, `phone`, `youtubeUrl`) create entities with source `"user"` and round 0. Entity kinds supported in the case file include `domain`, `url`, `upi`, `email`, `phone`, `company`, `handle`, `amount`, `youtube_url`, and `scheme` (for government and institutional scholarships/schemes). Company entities may carry an optional `orgType` (`government`, `education`, `bank`, `company`, `unknown`). Government and education bodies route to Official Verifier government/PIB/NSP checks and are excluded from MCA/Trustpilot; OSINT never executes a standalone query on generic authority names (such as "Government of India").

### 3.8 Markdown view

`lib/caseFile.js` exposes `renderMarkdown(snapshot, options)`, which produces a compact human-readable markdown view of the case file. It is used to give an agent a short view of the case inside its prompt, for debugging, and for a "show the case file" demo screen. It is output only and is never parsed back.

### 3.9 Live Agent Trace Streaming and Single-Writer Emit

To allow users to watch every specialist agent work live (queries sent to search engines, result snippets, pages fetched, lookups performed, hypotheses tested, and flags identified) without altering agent scoring or decision logic:

1. **Single-Writer Rule Maintained:** Agents never write to the SQLite database or the case file.
2. **Coordinator-Owned Emit Function:** The coordinator instantiates and owns `emit(eventData)` for each check execution:
   - `seq` is assigned only by the coordinator's `emit()`, synchronously, strictly increasing per check, initialised from `MAX(seq)` for that check on startup (defaulting to 0 when no prior events exist).
   - **Order inside `emit()`:**
     1. Truncate oversized fields via the 4 KB serialization limit helper (`truncateEventPayload`).
     2. Validate against `TraceEventSchema`. Events still invalid after truncation are dropped and logged without payload; `emit` never throws.
     3. Assign `seq` (monotonically incrementing).
     4. Persist atomically to `check_events` with `seq` and `payload_json`.
     5. Broadcast to live SSE subscribers via the in-process `eventBus`.
3. **Agent Context (`ctx`):** When launching each agent, the coordinator provides a per-agent execution context:
   - `ctx.note(text)`: Plain-language progress note (max 80 chars, e.g. "Reading top 3 search results").
   - `ctx.verdict(claim, verdict, sources)`: Specific verification claim outcome (`verified` | `contradicted` | `not_found` | `unverified` | `partial`). Absence of results is never `contradicted`.
   - `ctx.tools`: Wrapped tool suite generated by `instrumentTools(tools, emit, agent, round)`.
4. **Lifecycle and Result Events:** The coordinator emits:
   - `stage` and `round` events when pipeline phases change.
   - Granular `tool_start`, `tool_end`, `note`, and `verdict` events as agents execute.
   - `flag`, `entity`, and `agent_status` ("done") events are emitted only by the coordinator *after* validating and merging an `AgentResult`.
   - `complete` when the investigation and report generation finish.

## 4. System overview

```
Browser (Next.js UI)
   |  HTTPS: forms, uploads, SSE progress
   v
Next.js server (App Router API routes)
   |-- Validation (zod) + rate limiting
   |-- Extraction (regex + vision LLM)
   |-- Coordinator (main agent, mostly code)
   |       |-- owns the case file, runs rounds, validates and merges results
   |       |-- Message Analyst ........ LLM
   |       |-- Website Forensics ...... domain tools only, no LLM: every fact comes from a tool; the report writer summarizes
   |       |-- Official Verifier ...... search + fetch + LLM
   |       |-- Reputation / OSINT ..... search + fetch + YouTube API + LLM
   |       |-- Payment & Entity ....... payment tools + graph lookup
   |       '-- Classifier client ...... HTTP to Python service
   |-- Scoring engine (pure code)
   |-- Report writer (LLM)
   '-- SQLite (case file: inputs, entities, findings, events; cache, graph, feedback)

Python service (FastAPI): TF-IDF + logistic regression classifier

External: LLM provider, search API, RDAP/DNS/crt.sh/Wayback,
          Safe Browsing, URLScan, YouTube Data API
```

## 5. Components

| Component | Responsibility | Location |
|---|---|---|
| UI | Forms, confirmation editor, progress timeline, report, guides | `app/` |
| API routes | Validation, state transitions, SSE, actions | `app/api/` |
| Extraction | Regex entities, vision-LLM screenshot reading | `lib/extract.js` |
| Coordinator (main agent) | Owns the case file, runs the round loop, merges validated results, calls scoring and the report writer | `lib/coordinator.js` |
| Agents | Six investigation units sharing one contract | `lib/agents/` |
| Tools | Plain functions for external lookups | `lib/tools/` |
| LLM layer | One `generate()` interface over providers | `lib/llm/` |
| Scoring | Weights, hard rules, thresholds, confidence | `lib/scoring/` |
| Graph | Scam identifier graph read and write | `lib/graph.js` |
| Classifier service | Train and serve the text classifier | `services/classifier/` |
| DB | SQLite access, migrations, state machine | `lib/db/` |
| Contracts | zod schemas, flag registry and fixtures for every shared shape | `lib/contracts/` |
| Case file | Assemble a snapshot from the database, render a markdown view | `lib/caseFile.js` |
| Cache | TTL cache over `lookup_cache` | `lib/cache.js` |
| Env | The only place environment variables are read | `lib/env.js` |

## 6. Technology

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 20 or newer | |
| Web framework | Next.js (App Router) route handlers for the API; UI deferred | Pipeline code lives in `lib/` and is framework-independent, so it can move to another server later |
| Validation | zod | Inputs, env, LLM outputs |
| Database | SQLite via better-sqlite3 | Needs a persistent disk. For serverless hosting, move to Postgres (for example Supabase) behind `lib/db` |
| Classifier | Python 3, scikit-learn, FastAPI | Separate small service |
| Phone validation | libphonenumber-js | Validation only |
| LLM | Provider chosen by env | Must support image input |
| Search | Serper (serper.dev), selected through `SEARCH_PROVIDER=serper`, behind the search wrapper so it can be swapped | Returns Google results as JSON. 2,500 free queries on signup (one-time). Check current pricing, credit expiry and terms before relying on it |
| Logging | pino | Structured logs, no user content |
| HTML parsing | cheerio | In `fetchPage` (L2) |
| IP validation | ipaddr.js | SSRF guard (L2) |
| Upload checks | file-type (magic-byte detection), sharp (resize) | Needed at L5 extraction, not before |

## 7. Repository layout

```
/
  AGENTS.md
  PRD.md
  ARCHITECTURE.md
  .agents/                skills used by the coding agent
  deferred/ui/            UI built early; reviewed when UI work starts
  app/
    page.js               landing
    check/page.js         input form
    check/[id]/page.js    confirm, progress, report
    guides/               guides index and [type]
    report-fraud/         post-payment help
    about/
    api/
      health/
      checks/             create, read, confirm, stream, report,
                          feedback, save-to-graph, college-email, fraud-summary
      guides/
  lib/
    env.js
    contracts/            zod schemas and fixtures for every shared shape
    cache.js
    extract.js
    coordinator.js        main agent: rounds, merge, calls scoring and report writer
    caseFile.js           assemble snapshot, render markdown view
    graph.js
    record-replay.js      model and search decorators for deterministic replay and recording
    classifier.js         HTTP client for the Python service
    llm/generate.js
    db/
    actions/              pure deterministic action builders (college-email, fraud-summary)
    guides/               static guide content, loader, and type mapping
    agents/
    tools/
    scoring/
    data/                 known-domains.json, seed-graph.json
  services/classifier/
    data/dataset.csv
    train.py
    app.py
    requirements.txt
  scripts/
    smoke.js
    run-check.js          runs a full check from the command line
    seedGraph.js
    evaluate.js
  docs/
  data/                   app.db (gitignored)
```

## 8. Check lifecycle

State machine (invalid transitions are rejected in `lib/db`):

| From | To | Trigger |
|---|---|---|
| created | extracting | Inputs stored |
| extracting | awaiting_confirmation | Extraction finished |
| awaiting_confirmation | investigating | User confirms entities |
| investigating | scoring | All agents finished or timed out |
| scoring | report_ready | Report saved |
| any | failed | Unrecoverable error |

Sequence:

1. `POST /api/checks` validates input, creates the check (expires in 24 hours), stores inputs, starts extraction.
2. Extraction runs regex over all text and the vision model over each image, then deletes image files.
3. The user reviews and edits the extracted text and entities (through the API now, through the UI later). `POST /api/checks/:id/confirm` saves the edits and atomically transitions the check from `awaiting_confirmation` to `investigating` using a single conditional UPDATE (`WHERE id = ? AND status = 'awaiting_confirmation'`) with a row-count check. If already in `investigating`, `scoring`, or `report_ready`, confirm is idempotent and returns HTTP 200 with the current status immediately without re-running. The coordinator runs asynchronously in the background via a bounded `jobRunner`. Concurrent confirm calls are deduplicated so `jobRunner.run` is called exactly once.
4. The coordinator runs rounds (maximum 2). In each round it runs every agent whose `canRun` rule is satisfied, in parallel with `Promise.allSettled`, each under a 25-second timeout. Agents receive instrumented tools and `ctx.note`; tool actions and observations emit fine-grained trace events (`tool_start`, `tool_end`, `note`, `verdict`). The coordinator validates each result, merges flags, findings and discovered entities into the case file, emits validated `flag`, `entity`, and `agent_status` events, and fans out all events to live SSE subscribers and persists them with monotonic sequence IDs in `check_events`. New entities discovered in a round can make other agents eligible in the next round (section 3).
5. Scoring computes score, level and confidence from the saved results.
6. The report writer produces the explanation and checklist from the evidence only.
7. The report is saved and the status becomes `report_ready`.
8. Stale-check sweep: checks stuck in `investigating` or `scoring` longer than 10 minutes are detected by the maintenance cleanup job, moved to `failed` with failure reason `coordinator_pipeline_error`, and emit an error `check_event`.

## 9. Data model

| Table | Columns |
|---|---|
| `checks` | id (text, pk, UUID), status, current_round (integer, default 0), language, risk_level, score (integer, CHECK 0..100), confidence, failure_reason (text, nullable), created_at (text, ISO), updated_at (text, ISO), expires_at (text, ISO) |
| `check_inputs` | id (integer, pk, autoincrement), check_id (text, fk), type (text, image, url, upi, company, handle, phone, youtube_url), value, file_path (nullable, temporary), mime_type (text, nullable), size_bytes (integer, nullable), created_at (text, ISO) |
| `entities` | id (integer, pk, autoincrement), check_id (text, fk), kind, value, source (extracted, user or discovered), platform (nullable), org_type (nullable), purpose (nullable, for amount), direction (nullable, for amount: to_candidate, from_candidate, unclear), discovered_by (agent, nullable), round, confirmed (bool), evidence_json (nullable), UNIQUE(check_id, kind, value) |
| `agent_results` | id (integer, pk, autoincrement), check_id (text, fk), agent, round, kind (check, llm_call or agent), status (ok, skipped, could_not_check), reason, flags_json, verified_json, new_entities_json, processed_json, unchecked_json, manual_checks_json, trace_json, notes, duration_ms, summary, activity_json, entity_status_json, UNIQUE(check_id, agent, round) |
| `check_events` | id (integer, pk, autoincrement), check_id (text, fk), seq (integer, not null), round (integer), type (text), agent (text, nullable), status (text, nullable), summary (text, nullable), payload_json (text, not null), created_at (text, ISO), UNIQUE(check_id, seq) |
| `reports` | check_id (text, pk, fk), report_json, created_at |
| `graph_nodes` | id (integer, pk, autoincrement), kind, value (unique with kind), first_seen, last_seen (not null), report_count |
| `graph_edges` | id (integer, pk, autoincrement), node_a (integer, fk), node_b (integer, fk), check_ref (text, not null, deliberately not a foreign key), created_at |
| `feedback` | id (integer, pk, autoincrement), check_id (text, nullable, set to null when check is deleted), verdict ("right" \| "wrong"), risk_level_shown, comment (max 500 characters), created_at |
| `lookup_cache` | key (text, pk), result_json, fetched_at (integer, epoch seconds), ttl_seconds (integer) |
| `crawl_results` | id (text, pk), check_id (text, fk, REFERENCES checks(id) ON DELETE CASCADE), entity_id (text), result_json (text), status (text), created_at (text, ISO), updated_at (text, ISO) |

A cleanup job runs on startup and hourly: deletes expired checks and everything attached to them. Graph rows and feedback persist. Feedback stores no check content.

### 9.1 L5 Repository Additions (`lib/db/index.js`)
To support the L5 extraction, confirmation, and investigation pipeline without modifying contracts or schemas:
- `addEntities(checkId, entities, db = getDb())`: Inserts entities, ignoring rows that violate `UNIQUE(check_id, kind, value)` (`INSERT OR IGNORE`); never deletes or modifies existing rows; returns `{ addedCount: number }`.
- `clearInputFile(inputId, db = getDb())`: Sets `file_path` to `NULL` for a single `check_inputs` row by primary key `id`.
- `replaceTextInputs(checkId, texts, db = getDb())`: Within an atomic transaction, deletes only `type = 'text'` inputs for the check and inserts the given texts; leaves image, url, and other input types untouched.
- `saveConfirmation(checkId, { texts, entities }, db = getDb())`: Atomically replaces text inputs and entities (setting `confirmed = 1`, preserving source, setting user-added entities to source `"user"`). Allowed strictly when `checks.status === 'awaiting_confirmation'` (rejects otherwise with typed `InvalidStateTransitionError`, writing nothing).
- `saveRoundResults(checkId, { result, newEntities, events }, db = getDb())`: Atomically saves one `AgentResult`, adds discovered entities (via `INSERT OR IGNORE`), and appends timeline events. Rolls back completely on duplicate or validation error.

### 9.2 Trace Event Storage and Repository Methods

To support granular live trace observation and lossless replay:
- **Database Schema Migration:** `check_events` stores `seq` (integer, not null) and `payload_json` (text, not null). A unique constraint and index `UNIQUE(check_id, seq)` enforces strictly sequential, gapless/monotonic event sequencing per check. The migration backfills `seq` for existing `check_events` rows (ordered by `created_at, id`) and sets `payload_json` to a minimal JSON object for them, so `NOT NULL` and `UNIQUE(check_id, seq)` hold.
- **Repository Methods (`lib/db/index.js`):**
  - `appendEvent(checkId, event, db = getDb())`: Persists a validated event with sequence number `seq`, basic columns (`round`, `type`, `agent`, `status`, `summary`), and full `payload_json`. Enforces a 4 KB maximum serialized event payload limit (truncates long excerpt/string fields, never drops a valid event).
  - `listEventsAfter(checkId, seq = 0, db = getDb())`: Queries events for `check_id` where `seq > :seq` ordered by `seq ASC`. Deserializes `payload_json` and returns full `TraceEvent` objects for replay or polling.

### 9.3 Crawl Results Storage (Migration 012)

- **Database Schema Migration:** `crawl_results` stores full `CrawlResult` JSON objects linked to checks with `FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE CASCADE`.
- **Indices:** `idx_crawl_results_check_id` on `crawl_results(check_id)` and `idx_crawl_results_entity_id` on `crawl_results(entity_id)`.
- **Lifecycle & Cleanup:** When a check is deleted (by 24-hour expiration or test teardown), SQLite foreign key cascades automatically delete all associated `crawl_results` rows.

## 10. LLM layer

Interface: `generate({ system, prompt, images, schema })` returns data validated by the zod `schema`.

- Provider adapters live behind the interface and are selected by `LLM_PROVIDER`.
- Output is requested as JSON, parsed and validated. On failure, retry once with the validation error appended, then throw a typed error that the calling agent turns into `could_not_check`.
- Every call has a timeout.
- `wrapUntrusted(label, text)` wraps untrusted content in clear delimiters (`<UNTRUSTED_${label}>`) with an instruction to treat it as data and ignore any instructions inside. Delimiter substrings inside user text (`</UNTRUSTED_`, `<UNTRUSTED_`, `--- DATA START ---`, `--- DATA END ---`) are escaped prior to wrapping to prevent delimiter breakout.
- Prompts never include secrets. Logs never include prompt or response bodies.
- Keep calls few: one call per agent that needs one, plus extraction per image and one report call.

## 11. Tools layer

Plain async functions that return structured results and never throw (they return an error field instead). Suggested starting cache TTLs:

| Tool | Purpose | Cache TTL |
|---|---|---|
| `rdapLookup` | Registration date and registrar | 24 hours |
| `dnsRecords` | DNS records | 1 hour |
| `sslInfo` | Certificate issuer and validity | 24 hours |
| `waybackFirstSeen` | First archived snapshot | 7 days |
| `lookalikeCheck` | Distance to known domains in `lib/data/known-domains.json` | none |
| `urlhaus` | URL or host lookup in the abuse.ch URLhaus feed, needs Auth-Key | 1 hour |
| `urlscanSearch` | Search of existing public scans only, no submission, no Pro endpoints | 1 hour |
| `search` | Search API wrapper with dork builders and a per-run query budget | 6 hours |
| `fetchPage` | Safe page fetch and text extraction | 1 hour |
| `youtubeComments` | Deferred, built last: official API plus comment heuristics | 6 hours |
| `payments` | UPI format validation, phone validation, consistency checks | none |
| `crawler` | Read-only deep crawl for pages, forms, and external domains (user-initiated, informational only) | 24 hours |

`fetchPage` protections: allow only http and https, resolve and block private, loopback and link-local addresses (including after redirects), enforce a timeout and a response size limit, strip scripts and return plain text.

### 11.1 External Services & Microservices

| Service | Protocol / Transport | Auth | Role | Fallback / Degradation Policy |
|---|---|---|---|---|
| Classifier Service | HTTP POST to `CLASSIFIER_URL/classify` | Optional token | Predicts scam probability and top contributing terms | Returns `could_not_check`; scoring degrades gracefully without classifier weight |
| Crawler Service | HTTP POST/GET to `CRAWLER_URL/api/crawl` | `CRAWLER_API_KEY` header (`x-api-key`) | Read-only shallow crawl of target domain, form extraction, external link tree | Returns `CRAWLER_UNAVAILABLE` (503); crawl is purely informational and NEVER affects score or flags |


## 12. Agents

Contract shared by all agents:

```
{
  agent: string,
  kind: "check" | "llm_call" | "agent",
  round: number,
  status: "ok" | "skipped" | "could_not_check",
  reason: string,            // required when skipped or could_not_check
  flags: [{ id, title, severity: "low"|"medium"|"high", explanation,
            evidence: [{ type: "quote"|"url", value }] }],   // id from registry; severity matches registry; max 20 flags
  verified: string[],
  newEntities: [{ kind, value, evidence }],   // max 5 discoveries (domain, handle, company)
  processedEntities: string[], // "kind:value" pairs examined in this execution
  unchecked: string[],         // entity keys or items eligible but left unchecked
  manualChecks: [{ label: string, url: string }], // pointers for manual user verification (http or https only)
  trace: [],                 // optional tool-call trace
  notes: string,
  classifierResult?: {       // optional; allowed ONLY when agent is classifier_client AND status is ok
    probability: number,     // P(scam) float 0..1
    label: "suspicious" | "benign",
    topTerms: string[],
    scamType?: string
  }
}
```

When `status` is not `"ok"`: `flags`, `verified`, `newEntities`, `processedEntities`, `unchecked`, and `manualChecks` must all be empty, and `classifierResult` must be absent.
`classifierResult` is allowed ONLY when `agent` is `"classifier_client"` AND `status` is `"ok"`. It must be absent for every other agent and for non-ok status.
Message-text agents (Message Analyst, Classifier client) run in round 1 only.
The classifier_high flag is emitted only when classifier probability is at least 0.80 and at least one top contributing term appears verbatim in the message text as quote evidence (at most 3 terms).

Registry: `lib/agents/index.js` exports a list of `{ name, canRun(snapshot), run(snapshot, deps) }`. `canRun` is a cheap deterministic rule (section 3.5); `run` returns an AgentResult and never writes to the database. Adding an agent means adding one file and one registry line.

### 12.1 Agent behavior rules
- **R1 Eligibility:** Each agent implements a deterministic, cheap, synchronous `canRun(snapshot)` check with no I/O and no LLM. If there is nothing to check, the result is `skipped` with a fixed reason and no resources are used. Eligibility follows section 3.5 (including the "not yet processed" rule for entity agents). There is no "scheme" entity kind.
- **R2 Single writer:** Agents only return findings (`flags`, `verified`, `newEntities`, `notes` and other `AgentResult` fields). They never write to SQLite or the case file. The L5 coordinator validates and merges.
- **R3 Execution safety:** 25-second timeout (`AGENT_TIMEOUT_MS = 25000`). Agents never throw; every error, timeout or invalid output becomes status `"could_not_check"` with a short fixed reason. Discovered entities are capped at 5 per agent per round, restricted to kinds `domain`, `handle`, and `company`, require non-empty evidence, are normalized and deduplicated, and domains must pass a synchronous SSRF host check before being returned.
- **R4 Registry flags only:** An agent may emit only the 36 registered flag IDs and only those for which `canEmit(flagId, agentName)` is true in `lib/contracts/flags.js`. Severity and title come from the registry, never from an LLM or the agent.
- **R5 Result rules:** Status `"ok"` returns findings; `"skipped"` when `canRun` is false (reason required, all arrays empty); `"could_not_check"` on timeout, error or invalid result (reason required, all arrays empty, `classifierResult` absent). A result always validates against `AgentResultSchema` before leaving the runner. "No red flags found" is a valid `ok` result and its notes must state that this does not mean the offer is safe.
- **R6 Explanations in English:** Agent explanations are in English; the L5 report writer handles user-facing translation.
- **Multi-item partial failure rule:** Every agent that processes several items treats them independently. If some items are checked and others fail, the result is ok with per-item outcomes in trace and notes; could_not_check only when every eligible item failed.
- **Official Verifier check rules:** Official Verifier makes no registry claims it cannot check. Registries without a free API (MCA, GST, National Scholarship Portal listing) are returned as manual_check entries in trace and are never reported as checked or verified. not_on_official_portal is based on a bounded site-restricted search and is worded as 'not found in a limited search', never as proof of absence. In Official Verifier, the LLM is restricted to finding official_warning_found only. non_gov_domain_claiming_gov and not_on_official_portal are strictly code-decided. authority_impersonation stays unemitted by this agent.
- **Website Forensics check rules:** Website Forensics does not emit non_gov_domain_claiming_gov (Official Verifier is the sole emitter in agent code). A `.org` (or any generic open TLD) domain is NEVER added to `verified[]` on the TLD alone; `verified[]` is strictly reserved for deterministic cryptographic and network facts. For `domain_new`, evidence prioritizes a verified quote of the domain from user text, then the RDAP `evidenceUrl`, and falls back to the inspected origin URL `https://${host}` when neither is present.
- **Reputation / OSINT check rules:** The agent does no automated Trustpilot, Reddit, Telegram or Instagram access; Reddit and review sites are reached only through site-restricted search results, and a Trustpilot manual_check link goes in trace for company and domain items. The LLM is used only to judge whether a search result is about the same entity. The agent returns no newEntities in L4 (`newEntities: []`). "No reports found" is never a flag, a verified item or a safety claim.
- **Manual checklist items rule:** Signals that represent an absence of data or require external phone/physical verification (`no_past_winners`, `no_video_contact`, `no_footprint`, `stale_site`, `exec_dm_outreach`) are routed exclusively to the report's manual checklist and are never emitted as automated scoring flags.
- **Payment and Entity check rules:** When an email entity is processed and `emailFacts` reports it is from a free provider (`isFreeProvider === true`), the agent checks if the message text contains a recruitment context term (`RECRUITMENT_CONTEXT_TERMS`). If matched with a code-verified quote, it emits `free_email_recruiter` with quote evidence. The default graph dependency is a no-op failure; the coordinator injects the real lookup. payment_entity counts each check (graph lookup, validation, scam-report search) separately. The result is could_not_check only when every check on every item failed. An item with at least one successful check is ok; a failed search is recorded in trace and notes and never reported as 'no reports found'.
- **Dependency injection:** Agents receive dependencies through a second argument `run(snapshot, deps)` with shape `{ generate, classify, now }` defaulting to real implementations (`lib/llm/generate.js`, `lib/classifier.js`, and `() => Date.now()`), allowing offline tests to inject fakes.

| Agent | Inputs | Tools | LLM use | Typical failure handling |
|---|---|---|---|---|
| Message Analyst | Conversation text | none | Finds red-flag patterns, quotes evidence | LLM error: could_not_check |
| Website Forensics | Domains | domain tools, urlhaus, urlscanSearch, search | domain tools only, no LLM: every fact comes from a tool; the report writer summarizes | No domain: skipped; lookup error: that item listed as unchecked |
| Official Verifier | Scheme, organization, links | search, fetchPage | Labels claims verified, unverified or contradicted | Registry lookups without an API become "verify manually" items |
| Reputation / OSINT | Brand, domain, handles, YouTube URL | search, fetchPage, youtubeComments | Disambiguates search results (same entity check only) | No results is reported as "no reports found", never as safe |
| Payment and Entity | UPI IDs, phone, domains, handles | payments, graph, search | none or light | Graph error: could_not_check for that part |
| Classifier client | Conversation text | HTTP to Python service | none | Service down: contributes nothing, listed as could_not_check |

The coordinator emits trace events conforming to `TraceEventSchema` (`agent_status`, `round`, `stage`, `complete`, `tool_start`, `tool_end`, `note`, `flag`, `verdict`, `entity`). The older progress events (`agent`, `round`, `stage`, `complete`) are superseded by `agent_status`, `round`, `stage`, and `complete` in `TraceEvent`. Live streaming and replay emit only `TraceEvent`; `mapDbEventToProgressEvent` is retained purely as a `PROVISIONAL` backward-compatibility mapper for legacy database rows.

### 12.2 Fine-Grained Trace Events and Tool Instrumentation

To make agent activity observable in real time down to individual searches, page fetches, and lookups:

#### Trace Event Contract
`TraceEvent` is a zod discriminated union in `lib/contracts/trace.js` on `type`. Common fields on every event: `{ seq: number, checkId: string, ts: string, round: number, agent: string | null }`.
Event types:
- `agent_status`: `{ status: "started" | "done" | "skipped" | "could_not_check", summary: string }`
- `tool_start`: `{ callId: string, tool: string, label: string, input: string }` (input is a short redacted summary, e.g. query string or URL)
- `tool_end`: `{ callId: string, tool: string, status: "ok" | "error" | "cached", durationMs: number, summary: string, detail: ToolEndDetail }` where `detail` is a discriminated union on `tool`:
  - `search`: `{ query: string, resultCount: number, results: Array<{ title: string, url: string, snippet: string, read: boolean }> }` (results max 10, snippet max 200 chars)
  - `fetchPage`: `{ url: string, httpStatus: number, title: string, excerpt: string, blocked: boolean }` (excerpt max 300 chars)
  - `rdapLookup`: `{ domain: string, registeredAt: string | null, ageDays: number | null, registrar: string | null }`
  - `dnsRecords`: `{ domain: string, hasMx: boolean, hasA: boolean }`
  - `sslInfo`: `{ issuer: string | null, validTo: string | null }`
  - `waybackFirstSeen`: `{ firstSeen: string | null }`
  - `lookalikeCheck`: `{ closestDomain: string | null, distance: number | null }`
  - `classifier`: `{ probability: number, topTerms: string[] }`
  - `payments`: `{ identifier: string, formatValid: boolean }`
  - `graphLookup`: `{ identifier: string, matchCount: number, linked: string[] }`
  - `youtubeComments`: `{ sampled: number, duplicateRatio: number }`
  - `safeBrowsing` / `urlscan`: `{ verdict: string }`
- `note`: `{ text: string }` (plain language, max 80 chars, e.g. "Reading the top 3 results")
- `flag`: `{ flagId: string, title: string, severity: "low" | "medium" | "high", evidence: Array<{ type: "quote" | "url", value: string }> }` (emitted by coordinator only after result is validated and merged)
- `verdict`: `{ claim: string, verdict: "verified" | "contradicted" | "not_found" | "unverified" | "partial", sources: string[] }`
- `entity`: `{ kind: string, value: string, evidence: string }` (a discovered entity)
- `round`: `{ round: number }`
- `stage`: `{ stage: string }`
- `complete`: `{}`
- `activity`: `{ entry: ActivityEntry }` (persisted activity item, 4 KB truncation, replayed by seq)

Every event enforces a 4 KB serialization limit (oversized fields are truncated; valid events are never dropped).

#### Tool Instrumentation Wrapper (`lib/trace.js`)
`instrumentTools(tools, emit, agent, round)` wraps each tool function:
- Generates a unique `callId` per invocation.
- Emits `tool_start` with sanitized/redacted input summary.
- Executes the tool function inside a try/catch boundary measuring `durationMs`.
- If the tool result indicates a cache hit (`cached: true`), emits `tool_end` with `status: "cached"`.
- If the tool returned an error or threw, emits `tool_end` with `status: "error"`. Tools never throw to callers.
- On success, maps the raw tool output into the appropriate `ToolEndDetail` shape and emits `tool_end` with `status: "ok"`.
- **Redaction Rules:** Never emit API keys, auth tokens, HTTP request headers, raw LLM system prompts, or unformatted model completions. Truncate long texts, HTML snippets, and excerpts.

#### Agent Context (`ctx`) Integration
Each agent receives `(snapshot, deps, ctx)`. Agents do not modify their core decision logic or scoring rules:
- **Message Analyst:** Has no external tools. Narrates analysis steps with `ctx.note(text)`. Quoted findings appear through the later coordinator-emitted `flag` event.
- **Classifier Client:** Emits a `classifier` tool start/end event.
- **Official Verifier:** Emits `ctx.note` when examining claims, marks which search results it reads, and emits claim outcomes via `ctx.verdict(claim, verdict, sources)`.
- **Reputation / OSINT:** Emits `ctx.note` indicating which entity or handle is being investigated and marks search results it selects for reading.
- **Website Forensics & Payment Entity:** Emit notes at key verification stages and use instrumented tools for all lookups.

### 12.3 Agent Activity Log & Live Inspection Cards

The UI check page surfaces six persistent agent cards in a fixed canonical order (`lib/config/agents.js`):
1. `message_analyst`: "Message & Offer Analyst"
2. `classifier_client`: "ML Scam Classifier"
3. `website_forensics`: "Domain & Web Forensics"
4. `payment_entity`: "Payment & UPI Verifier"
5. `official_verifier`: "Official Registry Verifier"
6. `reputation_osint`: "Community & OSINT Search"

#### Activity Entry Contract & Recorder
Each agent outcome in `AgentResult` includes:
- `summary`: One plain sentence (max 160 characters) summarizing facts, findings, and limitations.
- `activity`: An array of up to 40 `ActivityEntry` items (`{ seq, atMs, type, status, title, detail, tool, sources, flagId }`).
- Types: `"input" | "step" | "finding" | "verified" | "limit" | "manual"`.
- Statuses: `"ok" | "warn" | "failed" | "skipped" | "info"`.
- Recorder (`lib/agents/activity.js`): `createActivityRecorder({ agent, onEvent })` enforces caps, string truncations, and immediately forwards live SSE activity events (`{ type: "activity", agent, round, entry }`) to the client.
- Fallback & Skipped Rules: Skipped agents receive a plain explanation of what input would enable them; uninstrumented or failed agents have minimal structured entries generated so no card is ever empty.

#### Endpoint `GET /api/checks/:id/agents`
Returns all six cards with current status, durationMs, summary, activity, flags, verified, unchecked, and manualChecks. Works for created, running, and finished checks.

### 12.4 Entity Verification Records & Coordinator Gap Validation
Every `AgentResult` returns an `entityStatus` array tracking entity-level outcomes:
`entityStatus: Array<{ entityKind: string, entityValue: string, status: EntityStatus, reason?: string }>`
- Allowed statuses: `"verified" | "not_found" | "unverified" | "contradicted" | "partial" | "checked_no_issue" | "skipped" | "could_not_check"`.
- `reason` is required when status is `"skipped"` or `"could_not_check"`.
- **Coordinator Gap Validation:** After all agent rounds complete and prior to scoring, the coordinator validates that every confirmed entity in the case file has a status or an explicit skip reason from every agent that was eligible or skipped. Any gaps are recorded as warning events (`type: "note"`, `Warning: unverified entity gap...`).
- **UI & Report Representation:** An "Entities and what was checked" table is surfaced in both the agent inspection drawer (`components/AgentActivityDrawer.js`) and the final verification report (`app/check/[id]/page.js`), displaying `entity`, `agent`, `status`, and `reason`.

### 12.5 Official Verification Statuses & Source Link Provenance
Official registry checks in Official Verifier produce one of five canonical statuses:
- `VERIFIED`: Direct authoritative evidence from official registries or `.gov.in` portals supports the claim.
- `CONTRADICTED`: Direct authoritative evidence (such as a PIB Fact Check warning or official advisory) explicitly warns against or debunks the claimed scheme or entity.
- `NOT_FOUND`: No matching announcement or registry entry was found in the official sources searched. The searched sources must be listed. Absence of results is NEVER `CONTRADICTED`.
- `UNVERIFIED`: Insufficient evidence to establish a definitive finding through official channels.
- `PARTIAL`: Some claims verified while others remain unverified or unresolved.
- `TEST_DOMAIN`: Recognized RFC 2606/6761 reserved test domain (.example, .test, .invalid, .localhost, example.com/org/net).

**Official Source Links Provenance & Relevance Filter:**
- Every official or manual source link presented to the user must carry provenance metadata: `search_result`, `fetched`, or `curated_list` (with `source_url`).
- A search-derived link counts as an official source only if its host is authoritative (evaluated via `classifySource`) AND its title or snippet relates directly to the opportunity claim (role, internship, careers, jobs, scholarship, fellowship), not merely mentioning the company name.
- Unrelated official pages (e.g. general corporate partnerships or agricultural sensors) are dropped or noted as context only. URLs are never constructed from templates or LLM hallucinations.

### 12.6 Payment Demand Analysis & Direction
- Amount entities are classified with a `direction` (`"to_candidate"`, `"from_candidate"`, or `"unclear"`) and a canonical `purpose` (`"stipend/salary"`, `"refundable deposit"`, `"application fee"`, `"registration charge"`, `"registration fee"`, `"security deposit"`, `"document verification"`, `"processing charge"`, `"training kit"`, `"advance payment"`, `"other"`).
- **Direction Rules:**
  - `to_candidate`: Compensation, stipends, allowances, or salaries paid to the applicant ("we will pay you", "you will receive", "monthly stipend"). A stipend or salary is NEVER a payment demand.
  - `from_candidate`: Fees, deposits, registration charges, or verification payments demanded from the applicant ("pay", "send", "transfer", "refundable deposit"). Only `from_candidate` amounts constitute a payment demand.
- When a payment demand exists (an amount with `from_candidate` or fee/deposit purpose), Payment Entity executes a "payment demand analysis":
  - Analyzes the demand amount, purpose, and whether a payee identifier is present.
  - Generates the manual verification check: `"Ask where the money is to be sent. A scholarship or genuine employer does not charge a deposit."`
  - Explicitly notes in summary and activity that `"recipient cannot be verified"`.
  - Does NOT emit fee flags (fee flags are strictly owned by Message Analyst; no flag points are duplicated).
- Payment recipient details (UPI ID, phone, account) are evaluated separately from the payment demand.

### 12.7 Reserved Domains (RFC 2606 / RFC 6761)
- Domains under `.example`, `.test`, `.invalid`, `.localhost`, `example.com`, `example.org`, `example.net`, and their subdomains are recognized as reserved test domains.
- Lookups (RDAP, DNS, SSL, Wayback, fetch) are skipped.
- Entity status is recorded as `test_domain` with plain reason: `"This is a reserved test domain and cannot be a real website"`.
- No `domain_no_history` or other lookup flags are raised from the skipped lookups.
- Lookalike domain detection and brand mismatch checks still run normally.
- For testing, controlled tool results for fixture domains are supported via injected `fixtureDomains` configuration (never active in production).

### 12.8 OSINT Result States & Privacy Design
- **Deterministic OSINT States:** Every searched entity in Reputation OSINT terminates in exactly one of five states:
  1. `no_relevant_results`: Search returned no relevant public mentions after relevance filtering.
  2. `no_negative_reports_found`: Search returned results but no negative scam/fraud complaints were found.
  3. `supporting_evidence_found`: Authoritative or official source mentions found (never presented as proof of legitimacy).
  4. `search_unavailable`: Upstream search tool failed, encountered quota limits, or was unavailable.
  5. `search_timed_out`: Query or entity evaluation exceeded execution time budget.
  - States `search_unavailable` and `search_timed_out` are mapped to `unchecked`.
- **Privacy Design Invariant:** No `Person` entity kind is supported. Person names are never modeled as graph nodes or distinct entity kinds and exist only inside evidence quotes.

## 13. Scoring and evidence ledger

Pure code in `lib/scoring/score.js`, operating on the evidence ledger (`lib/evidence/ledger.js`) and configured by `lib/scoring/config.js` so weights can be tuned against the test set. Scoring is a pure function performing zero file I/O or database queries.

### 13.1 Scoring Algorithm

#### Exact Order of Operations
1. **Reconciliation and claim mapping:** Sanitized agent results are translated into evidence ledger entries. The pure `reconcile(ledger)` function discovers duplicates, corroborations, and contradictions. Each flag is mapped to a normalized `claimKey` or correlated claim group (e.g. `domain_brand_impersonation` for `lookalike_domain` and `domain_company_mismatch`; `fee_demand`, `hiring_process`, `official_standing`). Flags in the same correlated claim group count once at their highest weight, plus the existing small corroboration bonus if corroborated by independent findings. Independent evidence (`domain_age`, `personal_payment_id`, `free_email_recruiter`) stays separate.
2. **Evidence coverage computation:** Evaluate which of the 5 independent signal types completed with status `"ok"` across all agent results:
   - `message`: `message_analyst` completed `ok`.
   - `payee`: `payment_entity` completed `ok` (UPI ID, phone number, or bank details checked).
   - `website`: `website_forensics` completed `ok` (domain registration, age, DNS, SSL checked).
   - `official`: `official_verifier` completed `ok` (official registries or government portals checked).
   - `reputation`: `reputation_osint` completed `ok` (public reports, scam complaints, OSINT search checked).
   Coverage is computed into `coverage = { checked: string[], notChecked: string[] }`.
3. **Mutual exclusion:** Within the `fee_equipment` group (`fee_demand`, `equipment_advance`), keep only the highest-weight claim; others are suppressed (0 points, status `"group_suppressed"`), and `rulesFired` records `"exclusion:fee_equipment"` when both are present.
4. **Correlation caps:** `hiring_process` and `pay` groups are each capped at 20 points; `rulesFired` records `"correlation_cap:<group>"` when a cap reduces points.
5. **Corroboration bonus:** When independent methods corroborate a claim (e.g. text quote plus search result), a configurable bonus is awarded (`corroborationBonus`, default +5, capped at `maxCorroborationBonus` = 10 across the check), and `rulesFired` records `"corroboration_bonus"`.
6. **Soft cap:** Total points from `low` and `medium` severity flags combined (after correlation caps and corroboration bonuses) is capped at **45 points**; `rulesFired` records `"soft_flag_cap_applied"` when it reduces points. High-severity flags are not part of this cap.
7. **Add high-severity flag points:** Add points from counted high-severity flags to the capped soft-flag subtotal.
8. **Classifier points and non-override invariant:** `classifierPoints = Math.round(classifierMaxPoints * Math.max(0, (probability - 0.5) / 0.5))`, where `classifierMaxPoints` is an input parameter (default 25; 10 for synthetic data or real test rows < 60), added after the soft cap. If no `ok` classifier result is present, `classifierPoints = 0`.
   - **Invariant:** The classifier NEVER lowers the score and NEVER overrides evidence established by specialist agents or hard rules.
   - **Contradictions:** Contradictions (e.g. low classifier probability vs an evidence-backed fee demand) do NOT alter the numerical score, but are always recorded and explained in plain language in the reconciliation record and final report.
9. **Hard rules force High:** Evaluate rules in `config.hardRules` (`scholarship_fee_demand`, `mule_account_request`, `graph_match`). If any hard rule fires, score floor is raised to `config.thresholds.high` (60), risk level is forced to `high`, rules are recorded in `rulesFired`, and `cannot_verify` is never applied. Note: `scholarship_fee_demand` triggers the hard rule; a non-scholarship `fee_demand` does not by itself.
10. **Claimed Big Brand or Institution without Official Channel:** If a known major brand/institution (from known companies list or scheme entity) is claimed, but no official verification channel is present (no official domain supplied/found, contact is personal UPI, handle, free-mail address, or chat app), the level is forced to at least `medium` (score floor 25 if below), and `rulesFired` records `"Claimed major brand or institution without official channel (at least Medium)"`.
11. **High and Medium Flag Baselines:**
    - Any high-severity flag forces the level to at least `medium`.
    - Any medium-severity flag with no positive verified signal forces the level to at least `medium`, even if numeric score < 25.
12. **No-high-evidence cap:** If there is no high-severity flag, no hard rule, and no graph match, cap the final score (flags plus classifier) at **59**; record `"no_high_evidence_cap"` in `rulesFired` if the raw score exceeded 59.
13. **Low Risk Strict Gate (Low allowed ONLY when ALL hold):**
    A check is classified as `low` only when:
    - No flag of severity `medium` or `high` is present.
    - At least 2 independent signal types were checked successfully (`coverage.checked.length >= 2`).
    - At least one positive verified signal exists (e.g. official domain matched claimed company, valid established domain, known official source) OR at least 3 eligible checks completed with no flags.
14. **Thin Coverage Rule (Cannot Verify):**
    If no flags are found but coverage is thin (fewer than 2 signal types checked: `coverage.checked.length < 2`), the level is `cannot_verify` with reason code `"thin_coverage"` and plain-language explanation in `rulesFired`.
15. **Cannot Verify Completeness Rule:**
    If fewer than 40% of eligible checks completed (`completedCount / eligibleCount < 0.40`) AND score is below 60 AND no hard rule fired, the risk level is `cannot_verify`.
16. **Critical agents rule (default: `message_analyst`):**
    If a critical agent was eligible and has no `ok` result in any round, the level can never be low. A would-be low becomes `cannot_verify` with low confidence and reason code `critical_agent_failed`. A medium or high level is kept. Skipped critical agents (no message text) are not failures.
17. **Coverage-Based Confidence:**
    - `high`: At least 4 signal types checked (`coverage.checked.length >= 4`) AND no critical agent failed AND eligible completion ratio `>= 0.80`.
    - `medium`: 2 to 3 signal types checked (`coverage.checked.length >= 2`) AND eligible completion ratio `>= 0.50`.
    - `low`: Fewer than 2 signal types checked (`coverage.checked.length < 2`), OR completion ratio `< 0.50`, OR final risk level is `cannot_verify`.
    - Skipped agents never lower confidence; failed eligible agents lower confidence.
    - Hard rules yielding High with thin evidence still yield High.
18. **ScoreResult contract:**
   ```typescript
   type ScoreResult = {
     level: "low" | "medium" | "high" | "cannot_verify";
     score: number; // Integer 0..100
     confidence: "low" | "medium" | "high";
     completedCount: number;
     eligibleCount: number;
     completionRatio: number;
     rulesFired: string[];
     flagPoints: Array<{
       id: string;
       weight: number;
       points: number;
       status: "counted" | "group_suppressed" | "duplicate_ignored";
       agents: string[];
     }>;
     classifierPoints: number;
     coverage: {
       checked: string[];
       notChecked: string[];
     };
     corroborationBonus?: number;
     contradictions?: string[];
     corroborations?: string[];
     confidenceCapped: boolean;
     reasonCodes: string[];
     fallbackWeightFlags: string[];
   };
   ```
   Deterministic output: `flagPoints` sorted by `points` descending, then `id` ascending.

### 13.2 Weight Table and Configuration Values
- **High flags (19):**
  - `scholarship_fee_demand`: 30
  - `fee_demand`: 30
  - `equipment_advance`: 25
  - `mule_account_request`: 40
  - `bank_details_request`: 25
  - `otp_or_id_request`: 30
  - `authority_impersonation`: 25
  - `task_deposit_script`: 30
  - `crypto_payment_request`: 30
  - `paid_placement_guarantee`: 25
  - `apk_download_prompt`: 30
  - `qr_code_payment_request`: 20
  - `lookalike_domain`: 20
  - `non_gov_domain_claiming_gov`: 25
  - `personal_payment_id`: 25
  - `official_warning_found`: 40
  - `scam_reports_found`: 25
  - `graph_match`: 40
  - `url_in_threat_feed`: 40
  - `domain_company_mismatch`: 25
- **Medium flags (15):**
  - `no_interview_selection`: 15
  - `unsolicited_award`: 15
  - `chat_only_interview`: 15
  - `pay_too_high`: 15
  - `guaranteed_income`: 15
  - `free_email_recruiter`: 15
  - `domain_new`: 20
  - `raw_ip_opportunity_link`: 20
  - `not_on_official_portal`: 20
  - `review_burst`: 10
  - `copied_content`: 10
  - `data_harvest_redirects`: 15
  - `unpaid_trial_work`: 15
  - `referral_recruitment`: 15
  - `brand_handle_lookalike`: 15
  - `classifier_high`: 0
- **Low flags (7):**
  - `candidate_picks_hours`: 10
  - `unusual_pay_schedule`: 10
  - `urgency_pressure`: 10
  - `off_platform_contact`: 10
  - `domain_no_history`: 5
  - `ssl_anomaly`: 5
  - `foreign_or_voip_number`: 5
- **Severity weights fallback:** high 25, medium 15, low 5.
- **Config values:**
  - `thresholds`: `{ medium: 25, high: 60 }`
  - `cannotVerifyRatio`: 0.40
  - `softFlagCap`: 45
  - `groupCaps`: `{ hiring_process: 20, pay: 20 }`
  - `classifier`: `{ maxPoints: 25, zeroAt: 0.5, fullAt: 1.0 }`
  - `confidence`: `{ high: 0.80, medium: 0.50 }`
  - `flagGroups`: `{ fee: ["scholarship_fee_demand", "fee_demand"], fee_equipment: ["fee_demand", "equipment_advance"], hiring_process: ["chat_only_interview", "no_interview_selection", "candidate_picks_hours"], pay: ["pay_too_high", "unusual_pay_schedule"] }`
  - `hardRules`: `["scholarship_fee_demand", "mule_account_request", "graph_match"]`
  - `externalEvidenceAgents`: `["website_forensics", "official_verifier", "reputation_osint", "payment_entity"]`

## 14. Report writer

One `generate()` call. Input: the agents' evidence and the scoring result only. Output (zod-validated): summary in the chosen language, scam type guess, flags with plain-language explanations and sources, verified items, could-not-check items, a step-by-step checklist (including manual registry links), actions and disclaimer. The prompt forbids inventing facts and requires saying so when evidence is thin. For `medium` risk results, the report writer must use neutral, objective wording ("some warning signs, verify these items") and never use accusatory phrases like "likely scam".

### 14.0 Checklist Quality Rules
- **Deduplication:** Manual checks from multiple agents (same URL or target) are deduplicated into a single entry.
- **Grouped Failure Guidance:** Multiple raw tool or network errors for a single entity (e.g. DNS failure, SSL timeout, graph unavailable) are synthesized into one human-actionable item per entity (e.g. `"Could not check domain X automatically; verify it manually: registration date, certificate, archive history"`).
- **Ordering by Importance:** Critical flag guidance and entity-specific verification steps are prioritized first; standard general advice follows.
- **Item Cap:** The main report checklist is capped at 10 items; any additional items are placed under an expandable `moreChecks` list.

### 14.1 Report Schema (Contract 3.9)
```typescript
type ScamTypeGuess =
  | "scholarship"
  | "internship"
  | "task_job"
  | "mule_offer"
  | "competition"
  | "overseas_agent"
  | "unknown";

type ChecklistItem = {
  text: string;
  url?: string | null;
};

type ActionItem = {
  id: "college_email" | "fraud_help" | "copy_checklist";
  label: string;
};

type Report = {
  checkId: string;
  riskLevel: RiskLevel;
  score: number;
  confidence: ConfidenceLevel;
  scamTypeGuess: ScamTypeGuess;
  language: "en" | "hi";
  summary: string;
  flags: Flag[];
  verified: string[];
  couldNotCheck: string[];
  notApplicable: string[];
  checklist: ChecklistItem[];
  moreChecks?: ChecklistItem[];
  actions: ActionItem[];
  disclaimer: string;
  generatedAt: string;
};
```

## 15. Classifier service

- **Training:** `train.py` builds TF-IDF features (word and character n-grams), fits logistic regression on a stratified 80/20 split with a fixed seed, prints precision, recall, F1 and the confusion matrix, and saves `model.joblib` and `metrics.json`.
- **Serving:** `app.py` (FastAPI) exposes `POST /classify` (returns label, probability and top terms) and `GET /health`.
- **Client:** `lib/classifier.js` calls the service with a short timeout. If it fails, the classifier simply contributes nothing.
- **Data:** the starter dataset is synthetic and only for pipeline testing. Real, sourced data must replace it before any metric is reported.

## 16. Scam graph

- **Write policy:** only from High-risk reports, only with explicit consent, only identifiers.
- **Operations:** `upsertNode`, `link`, `lookup(identifier)` returning earlier report counts and linked identifiers.
- **Use in a check:** the Payment and Entity agent looks up every UPI ID, domain, handle and phone number. A match emits a hard-rule flag showing linked identifiers.
- **Seeding:** `scripts/seedGraph.js` loads `lib/data/seed-graph.json`, which must be filled from public advisories.

## 17. API surface

The routes and payloads are defined in PRD.md section 6. Technical notes:

- Route handlers validate input with zod and return `{ error, code }` with user-safe messages, matching `ApiErrorSchema`.
- Standardized API error codes: `BAD_REQUEST`, `NOT_FOUND`, `RATE_LIMITED`, `CHECK_EXPIRED`, `CHECK_FAILED`, `INTERNAL_ERROR`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `STATE_CONFLICT`, and `SERVICE_UNAVAILABLE`.
- Standardized Check `failureReason` codes: `extraction_error`, `coordinator_pipeline_error`, `server_restart`, `unknown_error`. All database write paths validate against `FAILURE_REASON_CODES`; read paths map legacy free-text or unlisted stored values to `unknown_error` via schema preprocessing. The API routes expose strictly fixed reason codes and never arbitrary strings.
- **Idempotent Confirmation (`POST /api/checks/:id/confirm`):**
  - Confirms reviewed text and entities and transitions status atomically from `awaiting_confirmation` to `investigating` using a conditional database update.
  - Asynchronous background execution: hands the investigation to a bounded `jobRunner`.
  - Replays while `investigating`, `scoring`, or `report_ready` return HTTP 200 with `{ checkId, status }` immediately and deduplicate background jobs, ensuring `jobRunner.run` executes exactly once per check.
- **Stale-Check Sweep:**
  - Maintenance cleanup periodically sweeps checks stuck in `investigating` or `scoring` longer than 10 minutes.
  - Atomically moves stuck checks to `failed` with failure reason `coordinator_pipeline_error` and emits a corresponding error `check_event`.
- `GET /api/checks/:id/stream` uses Server-Sent Events with `TraceEvent` records (including persisted `activity` events replayed by `seq`, superseding older progress events `agent`, `round`, `stage`, `complete`), carrying an event `id` corresponding to `seq` for `Last-Event-ID` reconnection. `mapDbEventToProgressEvent` is strictly `PROVISIONAL` for reading legacy historical rows; the system does not emit both formats. The client falls back to polling `GET /api/checks/:id/events?after=<seq>` if the stream drops.
- **Trace Event Streaming & Replay (`GET /api/checks/:id/stream`):**
  - Uses Server-Sent Events (SSE). Each event format specifies `id: <seq>\nevent: message\ndata: <json>\n\n`. Emits only `TraceEvent` objects (including granular `activity` events persisted via `appendEvent`).
  - Supports reconnection via the `Last-Event-ID` HTTP header or the `?after=<seq>` query parameter.
  - When reconnecting, replays all historical events from `check_events` where `seq > after` in strictly ascending order before streaming new live events.
  - Sends a `: keepalive\n\n` comment heartbeat every 15 seconds to prevent client, proxy, and gateway timeouts.
  - Automatically terminates when a terminal event (`complete` or check failure) is encountered.
- **Polling Fallback Endpoint (`GET /api/checks/:id/events?after=<seq>`):**
  - JSON fallback endpoint for environments where SSE or long-lived streaming connections are blocked.
  - Accepts `?after=<seq>` (default 0).
  - Returns `{ events: TraceEvent[] }` containing events with `seq > after` ordered by `seq ASC`.
- **Standalone Fraud Summary Endpoint (`POST /api/fraud-summary`):**
  - Generates a structured cybercrime complaint narrative and victim steps without referencing an existing investigation check (`checkId`).
  - Request body validated against `FraudSummaryRequestSchema` (all fields optional, language default `en`).
  - Response matches `FraudSummaryResponseSchema`.
  - Ephemeral, zero database reads or writes, nothing stored.
  - Generates the narrative with explicit notice that no check investigation evidence or case file findings are attached.
  - Bounded by the action rate limiter (`RATE_LIMIT_ACTION_MAX`).
- **Event Retention & Log Privacy:**
  - Events in `check_events` are strictly scoped to the check lifecycle and are automatically deleted alongside the check during the 24-hour cleanup job.
  - Application and access logs must NEVER record raw event payloads or user-supplied content.
- **Crawler Service Architecture & Endpoints (`/api/checks/:id/crawl`):**
  - **Read-Only Invariant:** The crawler operates strictly in read-only inspection mode. It never types into input elements, never clicks submit buttons, never executes form submissions, and rejects downloads (`acceptDownloads: false`).
  - **Pinned-IP Forward Proxy (`safeProxy.js`):** Chromium routes all network requests through an internal pinned-IP forward proxy listening on `127.0.0.1`. The proxy validates target ports (80 and 443 only), resolves DNS once, and pins the target IP address. Requests to private, loopback, link-local, carrier-grade NAT, or cloud metadata ranges return HTTP 403 Forbidden without opening an outbound connection, eliminating DNS rebinding (TOCTOU) and unintercepted redirect bypasses.
  - **Browser Sandboxing & Isolation:** Launched with args `--disable-quic` and `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"`, `serviceWorkers: 'block'`, and popup window suppression. A second defensive layer in `context.route` aborts any non-GET/HEAD method (`route.abort('blockedbyclient')`).
  - **Informational Status:** Crawl results are purely informational and are stored in `crawl_results` table. They are NEVER evaluated by the scoring engine and never emit fraud flags.
  - **Polling vs SSE:** Crawl progress is NOT sent through `TraceEvent` or Server-Sent Events (the investigation stream terminates upon `complete` when the check is already `report_ready`). The client UI polls `GET /api/checks/:id/crawl?entityId=...`.
  - **Known Operational Limits:** The target site sees our server's egress IP address and runs its own JavaScript within our headless browser context; the forward proxy limits where network traffic can go, but cannot control client-side DOM execution inside the page.
  - `POST /api/checks/:id/crawl`: Triggers a background crawl job for the check's target domain/URL entity. Accepts `{ entityId }` only. Enforces that the check is in `report_ready` state, the entity is confirmed and valid domain/url, and passes SSRF checks. Idempotent: returns 200 with current status if already running or done. If previous crawl failed, resets row and retries. Bounded by `CRAWL_MAX_CONCURRENT` (default 1) returning 503 with `Retry-After: 10` when saturated.
  - `GET /api/checks/:id/crawl?entityId=...`: Retrieves stored or in-progress crawl status: `{ status: 'not_started' | 'running' | 'done' | 'failed', result?, errorCode? }`.
  - **Stale Crawl Sweep:** Periodic maintenance cleanup (`lib/cleanup.js`) transitions crawl rows stuck in `running` for more than 5 minutes to `failed` with error code `server_restart`.
- Rate limiting:
  - If `TRUST_PROXY=false` (default): all client-supplied proxy and IP headers are ignored, and `request.ip` is not used. All clients share a single `"unknown"` bucket. Rate limits are configurable via env vars: `RATE_LIMIT_WINDOW_MS` (default 900000ms), `RATE_LIMIT_CREATE_MAX` (default 10), `RATE_LIMIT_CONFIRM_MAX` (default 10), `RATE_LIMIT_READ_MAX` (default 60), `RATE_LIMIT_STREAM_MAX` (default 10), `RATE_LIMIT_ACTION_MAX` (default 15), and `RATE_LIMIT_GUIDE_MAX` (default 60).
  - If `TRUST_PROXY=true`: extracts client IP strictly from `X-Forwarded-For` counting hops from the right by `TRUSTED_PROXY_HOPS` (default 1). Never uses the leftmost entry. Valid IPv6 addresses are grouped by their `/64` prefix. Missing, short, or invalid values fall back to the `"unknown"` bucket.
- Body limits and concurrency:
  - Multipart creation requests stream and count bytes before parsing form data. Exceeding 26 MB triggers HTTP 413 `PAYLOAD_TOO_LARGE` without reading the stream twice.
  - Concurrency is bounded by `MAX_CONCURRENT_CREATES` (default 2, configurable in `lib/env.js`) via a semaphore. Saturated slots return HTTP 503 `SERVICE_UNAVAILABLE` with `Retry-After: 10`.
- Image limits:
  - Sharp processing sets `limitInputPixels: MAX_INPUT_PIXELS` (25,000,000 pixels) and `failOn: "warning"`. Decompression bombs or corrupt images fail safely with HTTP 400 `BAD_REQUEST`.
- Database boundary isolation:
  - Only `lib/db/` executes SQLite queries, statements, or transactions. Route handlers and `lib/api/` modules interact strictly via typed repository functions (`getEventsAfter`, `listStaleChecks`, `countActiveChecks`, `markCheckFailed`, `deleteCheck`).
- A check can be read only by its id. Ids are long random strings (UUID).

## 18. Frontend

- **Status:** deferred until the backend passes its gates (section 2.7). UI code built early lives in `deferred/ui/`.
- **Pages:** as listed in PRD.md section 4. `/check/[id]` renders one of three views based on the check status: confirmation editor, live progress timeline, final report.
- **State:** server state fetched per check, SSE for progress. No global state library needed.
- **Design:** tokens for color, type scale, spacing, radius and dark mode defined once. UI work follows the skills in `.agents/` (frontend design and Apple design among them). Mobile-first, accessible, readable on low-end phones.
- **Rendering untrusted text:** user and fetched text is always rendered as plain text, never as HTML.

## 19. Security and privacy

| Threat | Control |
|---|---|
| Prompt injection from messages, screenshots or web pages | Delimited untrusted blocks, instructions to ignore embedded commands, agents have no action-taking tools, LLM does not decide the risk level |
| Planted entities from fetched pages or messages | Discovered entities are capped at 5 per agent per round (domain, handle, company only) by the discovered-entity limiter (`limitNewEntities`), normalized, deduplicated, and pass a synchronous SSRF host check before any fetch |
| SSRF through user-supplied URLs | `fetchPage` blocks private addresses and unsafe schemes, including after redirects, with timeout and size limits; Crawler service enforces a local pinned-IP forward proxy (`safeProxy.js`) with `<-loopback>` bypass mapping |
| Active crawler execution risks | Crawler is read-only (no clicks, no form submits, no file downloads, non-GET methods aborted, in-memory jobs only, 24-hour check cascade deletion) |
| Third-party lookups | URLs from user input or comments are looked up in threat feeds and never fetched or opened; discovered-entity caps and the SSRF guard still apply |
| Abuse and quota exhaustion | Rate limiting, per-run query budgets, caching |
| Data exposure | Images deleted after extraction, checks expire in 24 hours, only identifiers persist with consent, no content in logs |
| Secret leakage | Secrets only in `.env.local`, read only through `lib/env.js`, never sent to the client |
| XSS | Untrusted text rendered as text, framework escaping, no raw HTML injection |
| Defamation risk | Output is a risk assessment with sources, never a statement that a named person is a scammer |
| Misuse for tracking people | No tracing of individuals, phone numbers only validated, searched and matched in our own graph |

The design takes India's Digital Personal Data Protection Act, 2023 into account (minimum data, stated purpose, deletion). Get proper legal advice before any public launch.

## 20. Reliability and performance

- Per-agent timeout 25 seconds. Whole pipeline target under 60 seconds.
- Agents run in parallel, so total time is roughly the slowest agent.
- Cache hits make repeat checks near-instant.
- Every agent degrades independently. The report lists what could not be checked.
- Retries only for transient network errors, with a small limit.

## 21. Testing and observability

- **Unit tests:** scoring (weights across all 36 flags, fee group suppression, mutual exclusion fee_equipment, soft-flag cap 45, correlation group caps 20, classifierMaxPoints scaling, soft flags plus classifier at maximum never reach 60 without a high-severity flag, hard rule or graph match (no_high_evidence_cap), hard rules score floor 60 and High level, thresholds 25/60, cannot_verify 40% ratio rule, confidence calculation, external-evidence confidence cap, fallback severity weights, deterministic flagPoints ordering), entity regex extraction, UPI and phone validators, SSRF guard, state machine, L4 base-runner (25-second timeout, error wrapping to could_not_check, schema and registry canEmit validation, quoteInText whitespace-collapsed substring verification), discovered-entity limiter (capped at 5, domain/handle/company kinds only, SSRF host check, deduplication).
- **Agent tests:** mocked tools and mocked `generate()` with fixed fixtures, checking that flags always include evidence and that `canRun` is correct on every fixture.
- **Coordinator tests:** eligibility selection, skipped versus failed handling, merge validation (invalid results are rejected), discovered-entity caps, the round limit and progress events.
- **Smoke test:** `scripts/smoke.js` creates a check, fetches it, and calls `generate()` if keys are set.
- **Evaluation:** `scripts/evaluate.js` runs labeled cases through the full pipeline and prints agreement, a confusion table and failures.
- **Logging:** structured logs with check id, stage, agent, duration and status. No user content, no secrets.
- **Layer gates:** no layer is complete until its tests pass and a runnable script demonstrates it (section 2.5).

## 22. Configuration

| Variable | Required | Purpose |
|---|---|---|
| `LLM_PROVIDER` | yes | Selects the LLM adapter |
| `LLM_API_KEY` | yes | LLM credentials |
| `LLM_MODEL` | yes | Model name (vision-capable) |
| `SEARCH_PROVIDER` | later | Search adapter (`serper` to start) |
| `SEARCH_API_KEY` | later | Serper API key |
| `YOUTUBE_API_KEY` | optional | YouTube comment analysis |
| `URLHAUS_AUTH_KEY` | optional | URLhaus feed lookup (abuse.ch Auth-Key) |
| `URLSCAN_API_KEY` | optional | urlscan.io search of existing public scans |
| `CLASSIFIER_URL` | later | Python classifier service address |
| `DB_PATH` | optional | SQLite file, default `./data/app.db` |

## 23. Extension points

- New agent: one file in `lib/agents/` plus a registry entry.
- New LLM or search provider: one adapter behind the existing interface.
- Better classifier: replace the model inside the Python service, keeping the same `/classify` contract.
- Later channels: browser extension or WhatsApp bot calling the same API.
- Moving to Postgres: reimplement `lib/db` and `lib/cache.js` only.

## 24. Open decisions

- LLM provider and model for the first build.
- Search provider and its free quota.
- Which regional languages to support after Hindi.
- Owner of classifier data collection and the 50 to 100 case test set.
- Hosting target (persistent disk for SQLite, or Postgres).