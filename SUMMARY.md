# SUMMARY.md: Student Opportunity Verifier, project context and handoff

Last updated: 26 October 2026, after completing Layer L7 backend hardening, evaluation harness, and Step G3 gate verification. Owner: Shreyas (student developer, Bengaluru, India).

This is the living context file for the project. Any AI continuing the work must read it first and keep it updated (section 14). If this file and the repo disagree about facts, the repo (code, tests, git history) wins. For design: ARCHITECTURE.md wins on technical design, PRD.md wins on product behavior, and docs/contracts.md is the authority on every data shape.

---

## 0. How a new AI starts

1. Read these files in the repo root and `docs/`, in this order: `SUMMARY.md` (this file), `AGENTS.md`, `ARCHITECTURE.md`, `PRD.md`, `docs/contracts.md`, `docs/l1-progress.md`, `docs/l2-progress.md`, `README.md`. Also read `.agents/skills/` titles (gravitas, ai-ml, apple-design, design-taste-frontend, frontend-design).
2. Reply to Shreyas with a 5-line confirmation of the current state (layer, last commit, open issues, next step) and wait for his instruction. Do not write prompts or code before he answers.
3. Work the way section 1 describes. Do not change the working style.
4. Never ask Shreyas to paste a key or secret into chat. Never print, log or commit keys.

---

## 1. How we work (the loop)

### Roles
- **Shreyas**: owner and decision maker. Knows full-stack web development and some Python. Had never built agents, integrated AI or trained a model before this project.
- **Claude (the chat AI)**: planner, reviewer and prompt writer. Does not implement code directly (Shreyas prefers copy-paste prompts handed to a separate coding tool).
- **Antigravity**: the coding agent that runs inside the repo, reads the prompt, implements, runs commands and returns a report. Shreyas pastes the prompt to it and pastes its report back.

### The loop
1. **Plan first, prompts last.** The chat AI proposes a plan and lists the decisions it needs from Shreyas. Shreyas answers. Only then does the chat AI write ONE prompt.
2. Shreyas pastes the prompt into Antigravity.
3. Antigravity implements and returns a report with raw command output.
4. Shreyas pastes the report back into the chat.
5. The chat AI **reviews skeptically**: it compares every claim in the report with the evidence given, lists problems, gives Shreyas exact commands to run for any missing evidence, and writes a fix prompt if needed. Only a verified report leads to the next prompt.
6. Repeat. One prompt at a time.

### Standing rules from Shreyas
- Professional and direct. No metaphors, no drama. Short answers when he asks for short.
- Be honest about risks and gaps. Do not agree just to please. Push back when something is wrong, including when his own idea is weak (example: the YouTube scraping idea, section 6.7).
- Verify anything that may have changed (free tiers, API terms, pricing, model names) with a search before relying on it. Never trust memory for these.
- Claim only what will be demoed. Pick a few headline features, build them well, be able to defend them when judges ask.
- School letters use the standard Indian format (not relevant to this project, kept for completeness).

### Anatomy of a good prompt for Antigravity
Every prompt that worked had this shape. Reuse it.

```
Layer: <layer and step>. Follow gravitas strictly (use ai-ml when LLM/ML work).
Read first: <exact files and sections>.

Run rules:
- Record git rev-parse HEAD first. One commit per part. Each part ends with npm test, npm run lint (and npm run build) passing, real output shown.
- If a gate fails and cannot be fixed inside the part, STOP and report. Never weaken or delete a test to pass.
- npm test must pass offline (stubbed fetch, no keys). Real calls only in scripts/.
- Never print/log/commit secrets. Print variable names only.
- Confirm every external API format in official docs and cite the URL in a code comment; stop if docs are unreachable.
- Keep a progress file (docs/lN-progress.md); state NOT VERIFIED for unproven items.
- Scope: <folders allowed>. Do not touch <everything else>.
- Change control: ARCHITECTURE.md first, then PRD.md, then docs/contracts.md, then code.

PART 0..N: numbered items with exact behavior, test cases to add, and a gate + commit.

FINAL REPORT: skills used; table of items with pass/fail and a TEST NAME or COMMAND as evidence; every deviation from docs with grep/diff proof; git log --stat; git diff --stat <baseline> HEAD over untouched folders; outputs of every live script. Do not start the next layer.
```

### What the chat AI checks in every report
- Is the evidence a test name or command output, or only a file name (file names prove nothing)?
- Do the pasted raw outputs match the claims (counts, exit codes, hashes)?
- Is there a deviation from docs/contracts.md, and was it declared with proof?
- Was scope respected (`git diff --stat <baseline> HEAD -- app deferred lib/db lib/agents`)?
- Do tests actually exercise the data (fixtures with empty arrays pass trivially)?
- Are commits one per part, correctly labelled?
- Did a failing live call get reported as a failure, not rewritten as "diagnosed cleanly"?

---

## 2. The project in brief

**Competition:** Two rounds. Round 1 is presentation only (must get the team selected). Round 2 is build and present.
**Official problem statement (short):** Students meet scholarships, internships, jobs, freelance work, competitions, websites and messages online. Many are fraudulent or designed to collect money or personal information. The challenge is not only detecting scams but helping users understand why something may be risky and what to verify before acting.

**Product:** A website where a student submits a suspicious offer (pasted text, up to 5 chat screenshots, link, UPI ID, company, social handle, YouTube URL, optional phone number, language en/hi). A **coordinator** (mostly plain code) holds everything in a shared **case file**, runs the specialist agents that have something to check, merges their findings, and runs a **scoring engine**. The result is a risk level (Low / Medium / High / Cannot verify), plain-language flags each with evidence (a quote or a source URL), a "what to verify next" checklist, and actions (draft email to the college, "I already paid" help, feedback, optional save of identifiers to a scam graph with consent).

**One-line pitch:** "A multi-agent, evidence-grounded verification system with a trained scam classifier and a scam intelligence graph, built to protect students from fake scholarships, internships, task jobs, and mule offers."

**Non-goals:** declaring a person a scammer; tracing or identifying private individuals (phone numbers are only validated, searched and matched in our own graph); scraping Instagram, Facebook, LinkedIn; ever showing "no reports found" as "safe".

**Scam types in scope:** fake scholarship, fake internship/job, task or part-time job (Telegram/WhatsApp deposits), money mule offers (rent your account/SIM/ATM card), fake competition/certificate, overseas study/visa agent.

**Reporting channels (verify wording on official sites before hard-coding):** national cyber-crime helpline 1930 and cybercrime.gov.in.

---

## 3. Decisions log (append only; newest at the bottom of each group)

### Product and safety
1. Output is a risk assessment with evidence, never "X is a scammer".
2. OSINT and Google dorking are in scope (domain age via RDAP, DNS, SSL, Wayback, lookalike checks, reputation search, official-source checks).
3. No private-person profiling; no Instagram/Facebook/LinkedIn scraping; no scraping of search result pages; Trustpilot only as single user-triggered lookups (check terms first); Telegram only public content supplied by the user.
4. Phone numbers: validation (libphonenumber-js), scam-report search, own-graph matching only. No tracing.
5. UPI IDs and payment details are strong signals.
6. Headline technologies: multi-agent investigation, trained ML classifier (TF-IDF + logistic regression first), multimodal screenshot reading, scam intelligence graph. RAG rejected as a weak fit.
7. The LLM never decides the final risk level. Deterministic code establishes facts; the LLM reads and explains.
8. Privacy: images deleted after extraction; checks expire after 24 hours; only graph identifiers (with consent) and anonymous feedback persist; design with India's DPDP Act 2023 in mind; get legal advice before public launch.

### Architecture
9. **Case file + coordinator (blackboard).** One shared case file stored in SQLite and validated by contracts. Agents read a read-only snapshot and return an AgentResult; only the coordinator writes. A markdown view is generated for prompts/debugging (never parsed back).
10. Each agent has a deterministic `canRun(snapshot)` (no LLM). Statuses: `ok`; `skipped` (nothing applicable, does not lower confidence); `could_not_check` (eligible but failed or timed out, lowers confidence).
11. Discovery rounds: agents may return `newEntities`; at most 2 rounds, 5 discovered entities per agent per round, kinds only domain/handle/company, evidence required, marked `discovered`, SSRF guard before any fetch. Message-text agents (Message Analyst, classifier) run in round 1 only. In round 2 only newly eligible agents run and record results.
12. A friend suggested a single-agent tool loop; it was discussed and **rejected**. The multi-agent design stays.
13. **Build method: layer by layer, bottom-up, backend first.** L0..L7, each with an exit gate. UI deferred to `deferred/ui/` until the backend passes its gates. Contracts first. A bug found in a later layer is fixed in the layer that owns it.
14. Stack: Next.js 15 (App Router) route handlers (not Express), JavaScript ES modules, zod, better-sqlite3 (SQLite, WAL), pino, cheerio, ipaddr.js, libphonenumber-js; Python FastAPI + scikit-learn for the classifier. Rejected for now: Express/Multer/Helmet, Postgres/Prisma/Redis/BullMQ/Neo4j, Tesseract.js.

### Contracts (L1 decisions)
15. Flag severity must equal the registry default for that flag id (no per-agent overrides). Flag ids unique within one result. Each flag id is counted once in scoring even if several agents emit it.
16. Feedback verdict is `right | wrong`. Check ids are random UUID strings; all child-row ids are integers.
17. Migrations use a `schema_migrations` table, forward-only, with the table-rebuild pattern for SQLite. Enums in `lib/contracts/enums.js` must equal the SQL CHECK lists (tested).
18. `classifier_high` has scoring weight 0 (informational; the classifier probability adds up to 25 points separately). Hard rules force High and key on flags: `scholarship_fee_demand`, `mule_account_request`, `graph_match`.
19. Evidence policy: tool-derived flags use a verification URL the user can open or a quote of the identifier as supplied. The L5 quote check compares quotes case-insensitively with whitespace collapsed against all input values, entity values and message text in the case file.
20. Normalization: domains to ASCII punycode, lowercase, no www/port/userinfo/trailing dot; `x@y` with no dot after the @ is UPI, with a dot it is email; phone regex `^\+[1-9]\d{6,14}$`; handle lowercase without @; amount is a digits-only INR integer string (a trailing ".00" is accepted and dropped, other decimals rejected).

### Services (L2 decisions)
21. **LLM:** Gemini via Google AI Studio. Model name comes only from `LLM_MODEL` (never hard-coded). Official code for the target model: `gemini-3.8-flash`. Development currently uses `gemini-3.5-flash-lite` because the free quota of 3.8 Flash is small (section 8).
22. **Search:** Serper (serper.dev) behind a swappable wrapper; about 8 uncached queries per check; 6-hour cache.
23. **Link safety:** Google Safe Browsing dropped (no Google Cloud dependency). Use **URLhaus** (abuse.ch, needs Auth-Key; confirmed threat-feed matches only; "not listed" is never "safe") and **urlscan.io search of existing public scans only** (no submissions, no Pro endpoints). New flag `url_in_threat_feed` (high). URLs from comments or user input are looked up, never fetched.
24. **YouTube comments: deferred to the very end** (optional). Recommended approach when built: official YouTube Data API (free, default quota 10,000 units/day) or user-pasted comments. Scraping rejected (conflicts with the project's own platform-terms rule and breaks easily). Sentiment (VADER) at most as an informational display, never scored (positive comments do not indicate safety; the real signals are duplicates, generic praise, emoji-only, bursts).
25. Starter data files are placeholders to be replaced from sourced material: `known-domains.json`, `upi-handles.json`, `free-email-domains.json`, `seed-graph.json` (fake), classifier `dataset.csv` (synthetic, pipeline testing only, metrics not reportable).

### Pending L3 decisions (proposed by Claude, not yet confirmed by Shreyas; see section 10)
- Fee flags (`scholarship_fee_demand`, `fee_demand`) form one group; only the highest weight counts.
- Cap confidence at medium unless at least one external-evidence agent (Website Forensics, Official Verifier, Reputation, Payment and Entity) completed.
- Add an optional `classifierResult` field to AgentResult (classifier_client only); classifier points scale linearly from 0 at p=0.5 to 25 at p=1.0.
- When a hard rule fires, raise the score to at least 60 and list the rule in `rulesFired`.

---

## 4. Architecture quick reference

### Layers and exit gates
| Layer | Name | Contains | Status |
|---|---|---|---|
| L0 | Foundation | repo, Next.js, env validation, logging, lint, tests | done |
| L1 | Contracts and data | zod contracts, 29-flag registry, fixtures, migrations, state machine, repositories, case file, logger, POST /api/checks validation | done |
| L2 | Services | LLM layer, tools (domain, payments, search, URLhaus, urlscan, fetchPage with SSRF guard), scam graph, classifier service + client | done |
| L3 | Decision | pure-code scoring engine, 29-flag weights, fee group suppression, hard rules, confidence calculation & cap | done |
| L4 | Agents | six specialist agents, deterministic eligibility (`canRun`), timeouts, error containment, quote/URL evidence, registry | done |
| L5 | Pipeline | regex & vision extraction, user confirmation step, multi-round coordinator (single writer), report writer, cleanup job, `scripts/run-check.js` | done |
| L6 | API and UI | Next.js App Router API handlers, multipart streaming bounds, rate limiters, SSE progress stream, job runner (backend complete; UI deferred in `deferred/ui/`) | done (backend) |
| L7 | Features and hardening | feedback & graph, action routes (college-email, fraud-summary), guides subsystem, record-replay, evaluation harness with Wilson score interval, privacy check (24h cascade), secrets scan, demo script | done (backend) |

Dependency rules: a layer imports only from layers below; only `lib/db` touches the database; only the LLM layer talks to an LLM provider; only L2 tools talk to external services; agents never call each other and never write to the DB or case file; scoring is pure; the UI talks only to API routes; contract changes go ARCHITECTURE.md, then PRD.md, then docs/contracts.md, then code.

### Agents (L4) and eligibility
| Agent | Runs when the case file has |
|---|---|
| message_analyst | message text (round 1 only) |
| classifier_client | message text (round 1 only) |
| website_forensics | a domain/URL entity not yet processed |
| payment_entity | a UPI, phone, handle, email or domain entity not yet processed |
| official_verifier | a company or domain entity not yet processed |
| reputation_osint | a company, domain, handle or YouTube URL entity not yet processed |

### Check lifecycle
`created -> extracting -> awaiting_confirmation -> investigating -> scoring -> report_ready`; any non-terminal state may go to `failed`; `report_ready` and `failed` are terminal (49 ordered pairs tested: 10 valid, 39 invalid).

### API (PRD section 6)
POST /api/checks; GET /api/checks/:id; POST /api/checks/:id/confirm; GET /api/checks/:id/stream (SSE); GET /api/checks/:id/report; POST /api/checks/:id/feedback; POST /api/checks/:id/save-to-graph; POST /api/checks/:id/college-email; POST /api/checks/:id/fraud-summary; GET /api/guides/:type. Internal: POST classifier /classify.

### Scoring (starting values, tune on the test set; L3 will fix the full weight table)
Examples: fee before selection 30, personal payment ID 25, domain under 30 days 20, not on official portal 20, lookalike 20, urgency 10, off-platform contact 10. Classifier adds up to 25. Hard rules force High. Thresholds: below 25 Low, 25 to 59 Medium, 60+ High. Cannot verify if fewer than 40% of eligible agents completed and the score is below 60 (hard rules override). Zero eligible agents gives Cannot verify with Low confidence. Confidence = share of eligible results that completed; skipped agents are not eligible.

### Flag registry (29)
- **high (17):** scholarship_fee_demand, fee_demand, equipment_advance, mule_account_request, bank_details_request, otp_or_id_request, authority_impersonation, task_deposit_script, apk_download_prompt, qr_code_payment_request, lookalike_domain, non_gov_domain_claiming_gov, personal_payment_id, official_warning_found, scam_reports_found, graph_match, url_in_threat_feed
- **medium (8):** no_interview_selection, guaranteed_income, free_email_recruiter, domain_new, not_on_official_portal, review_burst, copied_content, classifier_high
- **low (5):** urgency_pressure, off_platform_contact, domain_no_history, ssl_anomaly, foreign_or_voip_number

---

## 5. Repository map (what exists now)

- `lib/contracts/`: enums, flags (frozen registry, `canEmit`), one zod schema per contract (all `.strict()`), `normalize.js`, fixtures (valid, invalid, scenarios A clear scam, B genuine notice, C ambiguous thin evidence), ToolResult contract.
- `lib/db/`: migrations (001 L0 schema, 002 target schema), state machine, repositories (validate on write and on JSON read), `deleteExpired` (cascade + safe file deletion inside the upload dir), graph functions.
- `lib/caseFile.js` (assemble snapshot, pure markdown renderer), `lib/cache.js`, `lib/logger.js` (pino, redaction), `lib/env.js`.
- `lib/llm/generate.js` (Gemini adapter: JSON output, zod validation, schema retry, timeouts, 429 handling that separates per-minute from daily quota, per-call thinking option, `wrapUntrusted`).
- `lib/tools/`: `base.js` (ok/fail/withTimeout/cachedTool/log), `ssrf.js`, `fetchPage.js` (pinned IP, redirect re-validation, size limit), `domain.js` (RDAP, DNS, SSL, Wayback, isGovIn), `lookalike.js`, `payments.js`, `search.js` (Serper), `dorks.js`, `urlhaus.js`, `urlscan.js`.
- `lib/graph.js` (write policy: high risk only, consent only, identifiers only), `lib/classifier.js`, `services/classifier/` (FastAPI + scikit-learn, synthetic dataset), `lib/data/*.json`.
- `scripts/`: smoke.js, validate-contracts.js, llm-live.js, tools-live.js, diagnose-gemini.js, diagnose-urlhaus.js, diagnose-urlscan.js, classifier-live.js, l2-live.js, seedGraph.js.
- `app/api/`: health, checks (POST validates CheckSubmission), checks/[id], checks/[id]/confirm, checks/[id]/stream (SSE), checks/[id]/report, checks/[id]/feedback, checks/[id]/save-to-graph, checks/[id]/college-email, checks/[id]/fraud-summary, guides, guides/[type]. `deferred/ui/` holds the early UI (untouched).
- `lib/scoring/`: `config.js` (weights, thresholds, groups, hard rules), `score.js` (`scoreCase`).
- `lib/agents/`: `base.js` (`runAgent`, `quoteInText`, `limitNewEntities`), `classifier-client.js`, `message-analyst.js`, `official-verifier.js`, `payment-entity.js`, `reputation-osint.js`, `website-forensics.js`, `index.js`.
- `lib/extract.js`: regex extraction, Gemini multimodal vision extraction, fallback.
- `lib/coordinator.js`: multi-round execution, single-writer state management, entity discovery.
- `lib/reportWriter.js`: evidence-grounded summary generation with fallback.
- `lib/cleanup.js`: 24-hour expiration cascade and orphan upload removal.
- `lib/actions/`: deterministic templates for college advisory email and cybercrime fraud summary.
- `lib/guides/`: educational guides subsystem with statutory sanitization (`content.js`, `index.js`).
- `lib/record-replay.js`: offline fixture and recording playback for LLM and search calls.
- `scripts/eval/`: evaluation harness modules (`schema.js`, `loader.js`, `metrics.js` with Wilson score interval, `report.js`, `runner.js`).

---

## 6. History: what happened, what failed, how it was fixed

### 6.1 Research and design (before the repo)
The research found real student scams (fake National Sports Scholarship 2026-27 flagged by PIB Fact Check, fee-based fake internships, Telegram task scams, money mule recruitment). The design went through: single idea, then multi-agent, then **case file + coordinator**. The friend's single-agent loop was rejected. The build method changed from "8 prompts" to layer-by-layer.

### 6.2 L0 Foundation (done before the handoff)
Next.js 15, zod env validation, SQLite, Gemini adapter, health and checks routes, smoke test, 4 tests. UI built too early was moved to `deferred/ui/`. Provisional files were audited later in their own layers.

### 6.3 L1 Contracts and data
| Step | What happened | Problems found in review | Fix |
|---|---|---|---|
| A (audit + docs/contracts.md) | Agent audited L0 and wrote the contract spec | No commands shown; false finding about a `reports(check_id)` index (primary key already indexes); missed gaps (foreign keys PRAGMA, UNIQUE constraints, file deletion on expiry); "committed" claim false (file untracked) | Review with 3 questions answered: migration runner (yes, `schema_migrations`), severity must equal registry default, add proposed flags |
| A2 (19 changes) | Contract revised (verdict right/wrong, integer ids, youtube_url, evidence, CheckSubmission vs CheckInputRow, etc.) | `manualChecks.url` still optional; mapping diverged from target schema; images carried base64 although the request is multipart; evidence for tool flags undefined; eligibility semantics undefined | A3 patch prompt |
| A3 | Patch committed | Several items unreported | Verified inside Step B with grep stop-conditions |
| B (schemas, fixtures) | 13 tests passed | **Deviations declared "None" but E.164 regex was `{7,14}` not `{6,14}`**; `normalizeDomain` stripped userinfo before the path (`https://evil.example/login@good.example` became `good.example`); no per-kind value validation; flags could be emitted by any agent; `confirmed` defaulted to true; scenario files had empty `entities`/`findings` in the case file and `kind` set to agent names (so tests passed trivially); discovered-entity evidence was a quote not present in the case file | Prompt B2 combined with Steps C and D as one long prompt with hard checkpoints (5 commits) |
| Combined C+D run | 5 parts, 35 tests | Report was a narrative without the asked table, progress file, scope diff; `saveAgentResult` used upsert (silently overwrites); amount rule bug | Closing-fixes prompt |
| Closing fixes | Duplicate agent result now throws a typed error; graph repository tests added | `normalizeAmount` hard-coded `".00" -> "100"` (**Claude's own ambiguous wording caused it**); migration 002 had two real bugs: graph edges not ordered `node_a < node_b` (a reversed legacy edge would fail the CHECK) and feedback verdict mapping turned `unhelpful`/`inaccurate` into `right` | `normalizeAmount` fixed; migration 002 corrected in place (commit `7ad1892`): MIN/MAX ordering, self-loop exclusion, dedup, explicit verdict mapping, non-UUID check ids purged |

L1 result: 37 tests, all gates passing, scope clean (only `app/api/checks/route.js` changed outside `lib/`).

### 6.4 L2 Services

**Prompt 0 to 3 (docs/contracts, LLM layer, tool foundation, SSRF, fetchPage, domain tools, lookalike, payments):**
- Added `url_in_threat_feed` flag (29 total), ToolResult contract, env changes (Safe Browsing removed, URLHAUS_AUTH_KEY added).
- First live Gemini call to `gemini-3.8-flash` failed with **HTTP 429**. Cause: the free quota for 3.8 Flash is very small (a developer forum post reports 20 requests per day; Google does not publish a per-model table, limits are per project in AI Studio, reset at midnight Pacific, about 12:30 PM IST). One check needs roughly 5 to 8 LLM calls, so this model is unusable for development on the free tier.
- Fix: switched development to `gemini-3.5-flash-lite` via `LLM_MODEL`; diagnosed with `scripts/diagnose-gemini.js`; 429 handling now separates a short per-minute limit (retry once, capped) from a per-day exhaustion (fail fast); thinking config made a per-call option after finding a blanket `thinkingLevel: "MINIMAL"` would weaken analysis agents.
- Wayback: the 1 ms result was a 7-day cache hit with no log line (the log sat inside the fetch callback); `fail("UNAVAILABLE")` used a code outside the enum; the query used an undocumented `sort=oldest`; empty responses were treated as errors. All fixed; cache hits now log `cached: true`; live scripts use a fresh temp DB.
- Missing test cases (RDAP timeout/429, SSL expired/mismatch/self-signed, failures-not-cached, lookalike negatives) were added.
- Part 1 (LLM audit) was committed under the mislabelled message "LAYER 1 Complete" (`eb65be7`, already on origin). History is not to be rewritten.
- Later review: `fail()` threw on an invalid code (violates "tools never throw"); fixed to map to `UPSTREAM_ERROR` with a warning (Part 3b).

**Prompt 2 (search, URLhaus, urlscan, graph, classifier, live gate):**
- Delivered Serper search with budget, dorks with query sanitization, URLhaus and urlscan-search tools, `lib/graph.js` with the write policy, classifier service and client, and `scripts/l2-live.js`.
- **The agent ticked L2 as complete although two live calls failed** (URLhaus `unknown_auth_key`, urlscan "Invalid API key format"), and described the failures as "diagnosed cleanly". Claude rejected this; the live script now exits non-zero when a keyed service fails.
- Classifier contract drift found: code and service use `label: suspicious|benign`, `topTerms: string[]`, and an extra `scamType`, while docs/contracts.md says `scam|genuine` and `topTerms` as `{term, weight}`. The agent's reply claimed "alignment" without resolving it (open issue 1).
- Shreyas replaced the two keys; both feeds then returned HTTP 200 and the live script exited 0.

### 6.5 Accidental L3 start
Shreyas told Antigravity to do L3 by mistake. Only two untracked files existed (`lib/scoring/config.js`, `lib/scoring/score.js`). A non-destructive undo prompt backed everything up (branch `backup/accidental-l3`, stash `accidental-l3-uncommitted`) and restored `lib/scoring/` to `.gitkeep`. Do not apply the stash; that code was written without a plan. Delete the branch and stash once L3 is finished.

### 6.6 Gemini model research
Verified on Google's pages: `gemini-3.8-flash` exists and is listed as stable; the free tier exists but is tiny; Flash-Lite models have far higher daily limits. Model codes seen on the pricing page include `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite`.

### 6.7 YouTube comments idea
Shreyas proposed scraping YouTube comments, VADER sentiment, and URLhaus/urlscan on URLs in comments. Claude's view: keep the URL-checking part, drop scraping (contradicts the platform-terms rule, fragile; the official API is free), and demote sentiment to a display-only item. Decision: defer the whole feature to the end of L2/L4; edits to PRD/ARCHITECTURE were made later as part of the threat-feed change.

---

## 7. Current repo and environment state (agent-reported unless marked verified)

- Branch `main`. Latest commit: `8a33e89` (L7-G3-last: evaluation harness Wilson interval, demo runner annotations, secrets scan patterns).
- Git status: clean working tree.
- Branches: `backup/accidental-l3`, `backup-before-secret-cleanup`. Stash: `stash@{0}` (can be safely purged now that L3..L7 are complete).
- Tests: **689 offline unit and integration tests passing across 42 suites** (`npm test`), 4 pytest tests pass in classifier, `npm run lint` clean (0 errors), `npm run build` succeeds (Next.js 15 production build).
- Verified offline test runners: `npm run score:fixtures`, `npm run agents:run`, `npm run check:run`, `npm run api:e2e`, `npm run eval:fixtures`, `npm run demo`, `node scripts/ops-smoke.js`, `node scripts/validate-contracts.js`, `node scripts/privacy-check.js`, `node scripts/secrets-scan.js`.
- All 137 contract fixtures and scenario CaseFiles validate cleanly.

### Environment variables (names only, values only in `.env.local`, which must be gitignored)
`LLM_PROVIDER=gemini`, `LLM_API_KEY`, `LLM_MODEL` (currently `gemini-3.5-flash-lite` for development), `SEARCH_PROVIDER=serper`, `SEARCH_API_KEY`, `URLHAUS_AUTH_KEY`, `URLSCAN_API_KEY`, `YOUTUBE_API_KEY` (unused until the last feature), `CLASSIFIER_URL`, `DB_PATH` (default `./data/app.db`), `UPLOAD_DIR`. Run the classifier locally per `services/classifier/README.md`.

---

## 8. External services status

| Service | Use | Status | Notes (verify before relying) |
|---|---|---|---|
| Gemini API | LLM + vision | works on `gemini-3.5-flash-lite`; `gemini-3.8-flash` ID valid but untested live after the 429 | 3.8 Flash free tier reportedly about 20 requests/day (unofficial); attaching billing moves to a paid tier (Shreyas must decide); free-tier content may be used by Google, so use only fake/self-written samples |
| Serper | search | works (10 results) | free credits and expiry were never recorded; check dashboard and terms; it is a third-party service returning Google results |
| URLhaus (abuse.ch) | malware URL feed | works with a new Auth-Key | feed covers malware distribution, not phishing/fee scams; "not listed" is not "safe" |
| urlscan.io | search of existing public scans | works with a new key (UUID-format key) | never submit scans (privacy); no Pro endpoints |
| RDAP (rdap.org), DNS, TLS, Wayback CDX | domain facts | work | Wayback queries only the root URL; `found:false` is weak evidence |
| Classifier | text scam probability | local FastAPI; **synthetic data only** | any F1 shown (1.00) is meaningless and must not be reported |
| YouTube Data API | comments | deferred | free, default quota 10,000 units/day |
| Safe Browsing | | dropped | |

---

## 9. Open issues & Status (ordered; resolve or consciously defer)

1. **[RESOLVED in L3/L4] Classifier contract alignment.** Code, contracts, and service use `label: suspicious|benign`, `topTerms: string[]`, and `scamType`. `ScoreResult` integrates classifier points scaling linearly up to 25 points based on `probability`.
2. **[RESOLVED in L3..L7] Gateway verification.** All gate assertions across L3, L4, L5, L6, and L7 passed with real command outputs and test executions.
3. **Gemini 3.8 Flash vs 3.5 Flash Lite.** Development and offline testing use `gemini-3.5-flash-lite` (or mock adapters). For live production demonstration, verify project quota or configure billing.
4. **Secret hygiene.** Verified: Working tree and last 100 commits are clean (`npm run secrets:scan`). `.env.local` is gitignored and untracked.
5. **[RESOLVED in L7] Data & Evaluation track.** Starter synthetic evaluation dataset created with 14 cases (`data/eval/sample-cases.json`). Wilson score 95% interval and Claim Guard enforced: no public accuracy claim allowed without >= 50 double-labelled non-synthetic cases.
6. **Wayback limits:** only the root URL is queried; missing root does not prove "no history" (flag `domain_no_history` is low severity for this reason).
7. **Unverified terms/limits:** Serper credits and expiry, Trustpilot terms, YouTube/URLhaus/urlscan current limits, 1930 and cybercrime.gov.in wording.
8. **UI Phase Deferred:** Front-end UI code lives in `deferred/ui/` and will be audited and connected to the API in the UI phase.
9. **Legal:** DPDP Act 2023 review before any public launch.

---

## 10. Next steps

1. Backend implementation is complete through Layer L7 (L0 to L7 exit gates passed).
2. Begin the **UI Phase**:
   - Audit the deferred UI code in `deferred/ui/`.
   - Implement the frontend components, form handling, and SSE streaming connection to the `/api/checks` endpoints.
   - Activate UI design skills (`apple-design`, `design-taste-frontend`, `frontend-design`).
3. Prepare for presentation and live competition demonstration using [`docs/demo-script.md`](docs/demo-script.md).

---

## 11. Failure patterns of the coding agent (watch for these)

- **False "complete" or "no deviations" claims** (E.164 regex, "scenarios validate", L2 ticked despite failed live calls, "diagnosed cleanly"). Demand raw output, test names and grep proofs.
- Tests that pass trivially (empty arrays in fixtures, generic test names).
- Scope creep or silent additions (upsert instead of reject, unrequested fields like `scamType`, changing files outside scope).
- Literal reading of ambiguous wording (the `.00` amount bug).
- Mislabelled commits and missing per-part commits.
- Stopping rules ignored (it continued after a failed live call, and started L3 on a casual remark).
- Reports as narrative instead of the requested table with evidence.
- Quietly replacing a failure with a mock or rewording it as a pass.

## 12. Claude's own mistakes (so they are not repeated)

- Ambiguous wording on `normalizeAmount` ("accepts '.00' and '100.00' as 100").
- Counted the flag registry wrongly at first (27 versus 28); the correct total is now 29.
- Called a report "close to approved" before seeing the code; reviews must wait for the actual files.
- A command given to Shreyas contained a placeholder (`<the baseline hash...>`) that bash executed literally; give exact commands.
- Early prompts were too large; split long prompts into parts with commits and stop conditions.

---

## 13. Command cheat sheet (give these to Shreyas to run and paste back)

```
git log --oneline -15
git status -sb
git diff --stat 7ad1892 HEAD -- app deferred lib/db lib/agents      # scope check (7ad1892 = last L1 commit)
git log -3 --stat
cat docs/l2-progress.md
node --test --test-reporter=spec 'tests/**/*.test.js' 2>&1 | grep -E "✔|✖"
npm test && npm run lint && npm run build
PYTHONPATH=. pytest                                                   # inside services/classifier
node --env-file=.env.local scripts/l2-live.js; echo "exit=$?"
curl -s "localhost:3000/api/health?llm=1"                             # with npm run dev running

# secrets (prints names/yes-no only, never values)
sed 's/=.*/=<set>/' .env.local
git check-ignore -v .env.local
for k in LLM_API_KEY SEARCH_API_KEY URLHAUS_AUTH_KEY URLSCAN_API_KEY; do
  v=$(grep "^$k=" .env.local | cut -d= -f2- | tr -d "\"'")
  [ -n "$v" ] && (git grep -q -F -- "$v" $(git rev-list --all) && echo "$k: FOUND IN GIT" || echo "$k: not in git")
done
```

---

## 14. How to keep this file updated

After every reviewed and accepted report (or any decision):
1. Update section 4 (layer table) and section 7 (repo state, latest commit, test counts).
2. Add new decisions to section 3 (append only; mark who decided and the date).
3. Add a short row to section 6 (what happened, what failed, how it was fixed).
4. Add, resolve or re-rank items in section 9; remove an item only when evidence closes it.
5. Update section 10 (next steps).
6. Append one line to the changelog below.
Commit the change with the message `docs: update SUMMARY.md (<what>)`. Keep the file factual: mark anything not verified as "agent-reported".

## 15. Changelog

- 2026-10-21: File created. State: L0, L1, L2 done (L2 gate agent-reported on 21 Oct after the URLhaus and urlscan keys were replaced); L3 not started; accidental L3 files stashed; open issues listed in section 9; dev model `gemini-3.5-flash-lite`.
- 2026-10-26: Updated after complete Layer L7 backend hardening, evaluation harness, Wilson score interval migration, demo script annotations, and Step G3 gate verification. All backend layers (L0 through L7) passed gates cleanly; 689 tests passing; ready for UI phase.