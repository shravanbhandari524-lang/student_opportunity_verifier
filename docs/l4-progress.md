# L4 Progress Tracking: Agents Layer

| Item | Description | Commit | Status | Evidence (Test Name / Command) |
|---|---|:---:|:---:|---|
| **P0.1** | Change control order: ARCHITECTURE.md -> PRD.md -> docs/contracts.md | `8545ff7` | Complete | `git diff 8545ff7^ 8545ff7 -- ARCHITECTURE.md PRD.md docs/contracts.md` |
| **P0.2** | ARCHITECTURE.md section 12 gains Agent behavior rules block (R1-R6, deps injection), section 19 limiter, section 21 tests | `8545ff7` | Complete | `ARCHITECTURE.md` sections 12.1, 19, 21 |
| **P0.3** | PRD.md section 8 states R1-R6 rules concisely | `8545ff7` | Complete | `PRD.md` section 8 |
| **P0.4** | docs/contracts.md documents R1-R6 and Discovered Entity Limiter contract (`limitNewEntities`) | `8545ff7` | Complete | `docs/contracts.md` section 3.6 |
| **P0.5** | Grep proof of doc agreement across ARCHITECTURE.md, PRD.md, docs/contracts.md (25s, 5 entities, domain/handle/company) | `8545ff7` | Complete | Grep commands verified in Part 0 gate |
| **P1.1** | Frozen config in `lib/agents/config.js` (AGENT_TIMEOUT_MS, MAX_FLAGS_PER_AGENT, MAX_NEW_ENTITIES, ALLOWED_DISCOVERY_KINDS) | `b6fad8a` | Complete | `lib/agents/config.js` |
| **P1.2** | Base runner and helpers in `lib/agents/base.js` (`runAgent`, result builders, `getMessageText`, `getRound`, `hasResultFor`, `quoteInText`, `verifyEvidence`, `limitNewEntities`) | `b6fad8a` | Complete | `lib/agents/base.js` |
| **P1.3** | Unit tests in `tests/agents-base.test.js` covering all 18 required runner, entity limiter, and purity tests | `b6fad8a` | Complete | `node --test tests/agents-base.test.js` (18/18 passing) |
| **P1.4** | Gate checks: offline tests pass (160/160), lint clean, build clean, scope check clean | `b6fad8a` | Complete | `npm test`, `npm run lint`, `npm run build` |
| **P2.1** | Message Analyst agent in `lib/agents/message-analyst.js` (deterministic `canRun`, `run`, `wrapUntrusted`, quote verification, thinking budget, and schema validation) | `dd66489` | Complete | `lib/agents/message-analyst.js` |
| **P2.2** | Unit tests in `tests/agents-message-analyst.test.js` covering all 16 required tests | `dd66489` | Complete | `node --test tests/agents-message-analyst.test.js` (16/16 passing) |
| **P2.3** | Gate checks: offline tests pass (176/176), lint clean, build clean, scope check clean, purity verified | `dd66489` | Complete | `npm test`, `npm run lint`, `npm run build` |
| **P3.1** | Documentation of classifier_high rule (0.80 threshold and verbatim quote evidence requirement) across ARCHITECTURE.md, PRD.md, docs/contracts.md | `cdb18d1` | Complete | `grep -n "classifier_high flag is emitted only when classifier probability is at least 0.80" ARCHITECTURE.md PRD.md docs/contracts.md` |
| **P3.2** | Frozen constant `CLASSIFIER_HIGH_THRESHOLD = 0.80` added to `lib/agents/config.js` | `cdb18d1` | Complete | `lib/agents/config.js` |
| **P3.3** | Classifier client agent in `lib/agents/classifier-client.js` with deterministic `canRun`, `run`, quote verification (max 3), schema validation, and pure error handling | `cdb18d1` | Complete | `lib/agents/classifier-client.js` |
| **P3.4** | Unit tests in `tests/agents-classifier-client.test.js` covering all 16 required tests | `cdb18d1` | Complete | `node --test tests/agents-classifier-client.test.js` (16/16 passing) |
| **P3.5** | Gate checks: offline tests pass (192/192), lint clean, build clean, scope check clean, purity verified | `cdb18d1` | Complete | `npm test`, `npm run lint`, `npm run build` |

| **PD.1** | Documentation of Payment and Entity partial failure processing across ARCHITECTURE.md, PRD.md, docs/contracts.md | `3428c2e` | Complete | `git diff 3428c2e^ 3428c2e -- ARCHITECTURE.md PRD.md docs/contracts.md` |
| **PD.2** | Payment and Entity specialist agent in `lib/agents/payment-entity.js` (independent per-item checks, graph lookup, upi facts, phone facts, scam search with budget, no newEntities) | `3c6c02a` | Complete | `lib/agents/payment-entity.js` |
| **PD.3** | Unit tests in `tests/agents-payment-entity.test.js` covering 18 tests (canRun per kind, quote verification, foreign number, search budget, graph match scoring hard rule, scenario fixtures) | `098a6cf` | Complete | `node --test tests/agents-payment-entity.test.js` (18/18 passing) |
| **PD.4** | Gate checks: offline tests pass (210/210), lint clean, build clean, scope check clean, purity verified | `098a6cf` | Complete | `npm test`, `npm run lint`, `npm run build` |

| **PE.1** | Documentation update: Website Forensics domain tools only (no LLM) and generalized multi-item partial failure rule across ARCHITECTURE.md, PRD.md, docs/contracts.md | `f36e2a9` | Complete | `git diff f36e2a9^ f36e2a9 -- ARCHITECTURE.md PRD.md docs/contracts.md` |
| **PE.2** | Website Forensics agent in `lib/agents/website-forensics.js` (independent lookups: RDAP, DNS, SSL, Wayback, lookalike, URLhaus threat feed, non-gov claiming gov, link discovery with budget, no LLM) and config constants | `5afb55b` | Complete | `lib/agents/website-forensics.js` |
| **PE.3** | Unit tests in `tests/agents-website-forensics.test.js` covering all 23 tests (canRun per kind, age thresholds, empty/failed wayback, ssl expired, lookalike naming target, threat feed URL rule, partial failure, fetch budget, prompt injection immunity, scenario fixtures) | `e2d8e05` | Complete | `node --test tests/agents-website-forensics.test.js` (23/23 passing) |
| **PE.4** | Gate checks: offline tests pass (233/233), lint clean, build clean, scope check clean, purity verified | `cf4b75c` | Complete | `npm test`, `npm run lint`, `npm run build` |

| **PF.1** | Documentation update: Official Verifier manual check registry rules, non-gov domain claiming gov, not_on_official_portal bounded search ("not found in a limited search"), and OFFICIAL_CLAIM_TERMS across ARCHITECTURE.md, PRD.md, docs/contracts.md | `61759fd` | Complete | `git diff 61759fd^ 61759fd -- ARCHITECTURE.md PRD.md docs/contracts.md` |
| **PF.2** | Official Verifier agent in `lib/agents/official-verifier.js` and `lib/agents/manual-links.js` (domain facts, non-gov domain claiming gov, site queries, single LLM call with wrapUntrusted and zod schema, quote/host verification, not_on_official_portal bounded search, manual_check trace entries, no newEntities) and config constants | `b59627f` | Complete | `lib/agents/official-verifier.js`, `lib/agents/manual-links.js` |
| **PF.3** | Unit tests in `tests/agents-official-verifier.test.js` covering all 19 tests (canRun cases, .gov.in verified fact, non_gov_domain_claiming_gov quote verified, benign message, unverified quote dropped, unreturned sourceUrl dropped, non-official host dropped, gov.in warning kept, not_on_official_portal limited search, failed search no flag, search & fetch budget enforced, manual_check in trace, prompt injection wrapped, LLM failure in trace, could_not_check on all failure, no company names in failure reasons, AgentResultSchema, scoreCase firing 40 points, scenario fixtures) | `bc1f9cb` | Complete | `node --test tests/agents-official-verifier.test.js` (19/19 passing) |
| **PF.4** | Gate checks: offline tests pass (252/252), lint clean, build clean, scope check clean, purity verified | `b4da716` | Complete | `npm test`, `npm run lint`, `npm run build` |

| **PG.1** | Documentation update: Reputation / OSINT no automated Trustpilot/Reddit/Telegram/Instagram scraping, LLM same-entity disambiguation only, no newEntities in L4, no-reports-found notes rule across ARCHITECTURE.md, PRD.md, docs/contracts.md | `687d263` | Complete | `git diff 687d263^ 687d263 -- ARCHITECTURE.md PRD.md docs/contracts.md` |
| **PG.2** | Reputation / OSINT agent in `lib/agents/reputation-osint.js` (dork building with sanitized input, budget 6, scam words proximity check, single LLM disambiguation call wrapped in wrapUntrusted, neutral explanation, YouTube burst heuristic, Trustpilot manual check in trace, no newEntities) and config constants | `408ecc4` | Complete | `lib/agents/reputation-osint.js` |
| **PG.3** | Unit tests in `tests/agents-reputation-osint.test.js` covering all 18 tests (canRun per kind, scam wording near entity, far wording dropped, missing entity dropped, LLM no/unclear dropped, LLM failure in trace, no reports note, search budget enforced, operators escaped, injection wrapped, youtube tool missing, youtube burst, could_not_check on all failure, no entity leaked in reason, AgentResultSchema, scoreCase firing 25 points, scenario fixtures) | `4dda95a` | Complete | `node --test tests/agents-reputation-osint.test.js` (18/18 passing) |
| **PG.4** | Gate checks: offline tests pass (270/270), lint clean, build clean, scope check clean, purity verified | `2cdfd38` | Complete | `npm test`, `npm run lint`, `npm run build` |

| **PEF.1** | Step EF Reconciliation: restricted Official Verifier LLM flagId to official_warning_found only; removed non_gov_domain_claiming_gov emission from Website Forensics; documented agent injected dependency keys | `7d105a7` | Complete | `npm test`, `npm run lint`, `npm run build` |
| **PEF.2** | Step EF Part 2 Tool Conformance: tool result Zod schemas (`tests/helpers/tool-result-schemas.js`), offline tool tests (`tests/agent-tool-conformance.test.js`), and test mock routing (`routeMock`) | `1fabda5` | Complete | `node --test tests/agent-tool-conformance.test.js` (13/13 passing) |

### Agent Injected Dependency Keys
The source-text purity test (`tests/agents-base.test.js` Test 18) forbids forbidden tokens in `lib/agents/*.js`. To maintain strict purity while permitting test injection, page-reading dependencies use `readPage`:
- `message_analyst`: `{ generate, now }`
- `classifier_client`: `{ classify, now }`
- `payment_entity`: `{ search, graphLookup, now }`
- `website_forensics`: `{ rdapLookup, dnsRecords, sslInfo, waybackFirstSeen, lookalikeCheck, urlhaus, urlscanSearch, readPage, now }`
- `official_verifier`: `{ search, readPage, generate, now }`
- `reputation_osint`: `{ search, generate, youtubeComments, now }`

### Real Tool Shapes (Verified from Source & Live Execution)
| Tool | Source File:Line | Signature | Return Shape (Success / Failure) |
|---|---|---|---|
| `rdapLookup` | `lib/tools/domain.js:52` | `(domain, { fetchFn, db } = {})` | `{ ok: true, data: { domain, found, registrationDate, expirationDate, ageDays, registrar, status, evidenceUrl } }` / `{ ok: false, error: { code, message } }` |
| `dnsRecords` | `lib/tools/domain.js:184` | `(domain, { dnsModule, db } = {})` | `{ ok: true, data: { domain, a, aaaa, mx, ns, txt } }` / `{ ok: false, error: { code, message } }` |
| `sslInfo` | `lib/tools/domain.js:271` | `(domain, { pinnedIp, tlsModule, db } = {})` | `{ ok: true, data: { domain, issuer, subject, validFrom, validTo, daysRemaining, authorized, authError } }` / `{ ok: false, error: { code, message } }` |
| `waybackFirstSeen` | `lib/tools/domain.js:390` | `(domain, { fetchFn, db } = {})` | `{ ok: true, data: { domain, found, firstSeen, evidenceUrl } }` / `{ ok: false, error: { code, message } }` |
| `checkDomainLookalike` | `lib/tools/lookalike.js:140` | `(domain, options = {})` | Pure synchronous fact object: `{ isMatch, targetDomain, targetName, reason, confidence, method }` |
| `urlhausLookup` | `lib/tools/urlhaus.js:53` | `(target = {}, { customEnv, fetchFn, db } = {})` | `{ ok: true, data: { listed, threat, urlStatus, dateAdded, tags, reference } }` / `{ ok: false, error: { code, message } }` |
| `urlscanSearch` | `lib/tools/urlscan.js:56` | `(target = {}, { customEnv, fetchFn, db } = {})` | `{ ok: true, data: { total, results: [{ resultUrl, scanDate, pageDomain }] } }` / `{ ok: false, error: { code, message } }` |
| `fetchPage` | `lib/tools/fetchPage.js:339` | `(url, { customEnv, fetchFn, lookupFn, maxBytes, timeoutMs, db } = {})` | `{ ok: true, data: { finalUrl, title, metaDescription, text, links } }` / Throws `ToolError` with code `INVALID_URL`, `BLOCKED`, `TOO_LARGE`, `TIMEOUT`, `UPSTREAM_ERROR` |
| `search` | `lib/tools/search.js:53` | `(query, { customEnv, fetchFn, db, context } = {})` | `{ ok: true, data: { query, total, results: [{ title, url, snippet, position }] } }` / `{ ok: false, error: { code, message } }` |
| `lookup` (graph) | `lib/graph.js:170` | `(kind, value, { db })` | Synchronous DB lookup: `{ matched: false }` or `{ matched: true, nodeId, kind, value, reportCount, connectedNodesCount }` |
| `upiFacts` | `lib/tools/payments.js:46` | `(rawUpi)` | Pure synchronous fact object: `{ valid, raw, normalized, username, handle, isKnownPsp, pspName, bankName, looksLikePhone }` |
| `emailFacts` | `lib/tools/payments.js:122` | `(rawEmail)` | Pure synchronous fact object: `{ valid, raw, normalized, localPart, domain, isFreeProvider, isEduOrGov }` |
| `phoneFacts` | `lib/tools/payments.js:185` | `(rawPhone, defaultCountry = "IN")` | Pure synchronous fact object: `{ valid, raw, e164, country, countryCallingCode, nationalNumber, possible, type }` |

| **PH.1** | Step H1: `payment_entity` adds `free_email_recruiter` check based on `emailFacts.isFreeProvider` and `RECRUITMENT_CONTEXT_TERMS` with verified quote evidence | `4022086` | Complete | `node --test tests/agents-payment-entity.test.js` |
| **PH.2** | Step H1b: harden `readPage` exception handling in `official_verifier` | `86f399b` | Complete | `node --test tests/agents-official-verifier.test.js` |
| **PH.3** | Step H2: Central Agent Registry in `lib/agents/index.js` exporting frozen `agents`, `agentNames`, and `getAgent(name)` | `3be2b8f` | Complete | `node --test tests/agents-registry.test.js` |
| **PH.4** | Step H3: Offline fixture execution runner `scripts/run-agents.js` and `npm run agents:run` script | `72acd66` | Complete | `npm run agents:run` |
| **PH.5** | Step H4: Final L4 gate verification (292/292 tests, lint, build, score:fixtures, agents:run, purity checks) | `acdaf23` | Complete | All gates verified |
| **PH.6** | Step H5: Verification of L4 gate with evidence: (1) `safeToolCall` in `lib/agents/base.js` unifying `{ ok: false }` and thrown errors across all agents; (2) `scripts/run-agents.js` upgraded with strict `routeMock` validation against authoritative schemas, dynamic `canRun` derivation, Scenario C skipped-invariance check, and `--expect-fail` testing; (3) 293/293 tests passing, zero lint/build errors. | `8106685` | Complete | `npm test && npm run lint && npm run build && npm run agents:run` |
| **PH.7** | Step H6: Remove agents' implicit database path (`payment_entity` default graph dependency converted to no-op failure stub) and verify `safeToolCall` coverage for both failure styles (thrown ToolError vs returned ok: false) across all agents (310/310 tests passing across 21 suites). | `3e92925` | Complete | `npm test && npm run lint && npm run build && npm run agents:run` |

| **PS1.1** | Step S1-1: Prompt instruction fix in `message_analyst.buildSystemPrompt()` enforcing strict JSON format, exact key names, no root array/fences, and fictional examples | `8584f65` | Complete | `node --test tests/agents-message-analyst.test.js` |
| **PS1.2** | Step S1-2: Deterministic false-positive negation guard in `lib/agents/config.js` (`FEE_FLAG_IDS`, `FEE_NEGATION_PATTERNS`) and `lib/agents/message-analyst.js` (`isFeeQuoteNegated`, `dropped_negated_fee` notes) | `ab05c64` | Complete | `node --test tests/agents-message-analyst.test.js` |
| **PS1.3** | Step S1-3: Live verification on fake scam and genuine scenarios with Gemini API (0 PARSE_ERROR, 3 flags on scam including scholarship_fee_demand, 0 flags on genuine) | `f0a0ed9` | Complete | Live test run |
| **PS1b.1**| Step S1b-1: Define frozen `PAYMENT_REQUEST_SIGNALS` and `CONTRAST_WORDS` in `lib/agents/config.js` | `3c347f0` | Complete | `lib/agents/config.js` |
| **PS1b.2**| Step S1b-2: Implement clause extraction, affirmative payment signal protection, and contrast pivot detection in `isFeeQuoteNegated()`, with 16 comprehensive unit tests | `b978721` | Complete | `node --test tests/agents-message-analyst.test.js` (34/34 passing) |
| **PS1b.3**| Step S1b-3: Document residual risk analysis in `docs/l5-live-findings.md` and complete gate verification | `b978721` | Complete | Full suite pass |
| **PS3.1** | Step S3: `payment_entity` counts failures per check instead of per check item, preventing a failed scam search from erasing a successful graph or validation check. Trace and notes record search unavailability without claiming 'no reports found'. | `40a2843` | Complete | `tests/agents-payment-entity.test.js` (33/33 passing) |

### L2 Follow-ups
- **YouTube Tool:** Does not currently exist in `lib/tools/`. In `lib/agents/reputation-osint.js`, the branch handling `youtube_url` checks `deps.youtubeComments`; when absent or null, it records a `{ item, status: "skipped", detail: "not_configured" }` trace item without failing. This branch is dormant and unverified against upstream APIs until a YouTube tool is designed and built in Layer L2.
- **Gemini Structured Output (`responseSchema`):** In `lib/llm/generate.js:146`, the Gemini API adapter passes `responseMimeType: "application/json"`, but does not convert or transmit the Zod schema as `responseSchema` (OpenAPI format) to Gemini's `generationConfig`. Structured output currently relies entirely on prompt prompting followed by local Node-side `schema.safeParse()`. Passing `responseSchema` directly in `generate.js` should be evaluated in an L2 hardening pass to provide API-level JSON schema enforcement.

## Layer L4 Gate Status: VERIFIED & PASSED
All 6 specialist agents and the central agent registry are fully built, strictly verified against Zod schemas, tested under comprehensive offline unit tests, and demonstrated on scenarios A, B, and C via `npm run agents:run`. Zero violations of layer rules or dependency boundaries.




