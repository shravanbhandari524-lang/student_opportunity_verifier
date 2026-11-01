# L2 Progress Tracking

| Item | Description | Status | Evidence |
|---|---|:---:|---|
| **0.1** | Change control order: ARCHITECTURE -> PRD -> docs/contracts.md -> code | Complete | Commit history & diffs |
| **0.2** | ARCHITECTURE section 11, 12, 19, 22: urlhaus, urlscanSearch, threat feeds, URLHAUS_AUTH_KEY | Complete | `ARCHITECTURE.md` |
| **0.3** | PRD section 8.3 & 14: URLhaus & urlscan.io, threat feeds, never safe | Complete | `PRD.md` |
| **0.4** | Contracts: `url_in_threat_feed` (29 flags total), `ToolResult` schema, fixtures & tests | Complete | `lib/contracts/tool-result.js`, `lib/contracts/flags.js`, `tests/contracts.test.js` |
| **0.5** | `lib/env.js` and `.env.example`: add URLHAUS_AUTH_KEY, remove SAFE_BROWSING_API_KEY, keep UPLOAD_DIR | Complete | `lib/env.js`, `.env.example`, `tests/foundation.test.js` |
| **1.1** | Audit `lib/llm/generate.js`: remove PROVISIONAL, support vision/text, prompt limit (50k), image allowlist (Note: Part 1 lives in commit `eb65be7` which was mislabelled 'LAYER 1 Complete'; do not rewrite history) | Complete | `lib/llm/generate.js` in commit `eb65be7` |
| **1.2** | Dynamic provider from env; never log secrets, prompts, or response bodies | Complete | `lib/llm/generate.js` |
| **1.3** | Structured error handling: ToolResult, retry on transient HTTP 429/503 and schema failure | Complete | `lib/llm/generate.js` |
| **1.4** | Comprehensive offline unit tests in `tests/llm.test.js` | Complete | `tests/llm.test.js` (14 tests pass offline: per-minute 429 retry, per-day 429 fast-fail, thinking options, retry logging) |
| **1.5** | Live LLM script `scripts/llm-live.js` with structured output | Complete | `scripts/llm-live.js` (live text & vision calls succeeded against configured model) |
| **2.1** | Tool foundation `lib/tools/base.js`: ok, fail (typed enum check), withTimeout, cachedTool (logging on cache hit), createToolContext, logToolExecution | Complete | `lib/tools/base.js` |
| **2.2** | SSRF guard `lib/tools/ssrf.js`: assertPublicUrl, ipaddr.js, IPv4/IPv6, hex/octal/decimal unwrap, metadata | Complete | `lib/tools/ssrf.js` |
| **2.3** | Web page fetcher `lib/tools/fetchPage.js`: size limit (1MB), redirects (max 3), cheerio text/links extraction | Complete | `lib/tools/fetchPage.js` |
| **2.4** | Offline unit tests `tests/tools-fetch.test.js`: private IP blocking, DNS rebinding prevention, timeouts | Complete | `tests/tools-fetch.test.js` (11 tests pass offline) |
| **3.1** | Domain tool `lib/tools/domain.js`: isGovIn pure helper, rdapLookup (RFC 9083), dnsRecords, sslInfo, waybackFirstSeen (official CDX parameters, valid ToolResult codes) | Complete | `lib/tools/domain.js` |
| **3.2** | Lookalike tool `lib/tools/lookalike.js`: homoglyphs, visual skeleton, edit distance, brand affixes, TLD spoofing | Complete | `lib/tools/lookalike.js` |
| **3.3** | Curated data: `known-domains.json`, `upi-handles.json`, `free-email-domains.json` | Complete | `lib/data/*.json` |
| **3.4** | Payment facts `lib/tools/payments.js`: upiFacts, emailFacts, phoneFacts (libphonenumber-js) | Complete | `lib/tools/payments.js` |
| **3.5** | Offline unit tests in `tests/tools-domain.test.js` | Complete | `tests/tools-domain.test.js` (14 tests pass offline including RDAP 429/timeout/non-RDAP, SSL expired/mismatch/self-signed, Wayback 429/timeout/empty body/never archived, caching failure recovery, lookalike match/negatives) |
| **3.6** | Live script `scripts/tools-live.js` testing real external APIs | Complete | `scripts/tools-live.js` (fresh temp DB, cached flag, unarchived domain check, rdapLookup, dnsRecords, sslInfo, waybackFirstSeen) |
| **4.1** | Search tool `lib/tools/search.js`: Serper provider adapter, gl=in/hl=en, query budget enforcement, 6h cache TTL | Complete | `lib/tools/search.js` |
| **4.2** | Search dorks `lib/tools/dorks.js`: pure query builders with sanitization (scam, reddit, trustpilot, complaints, minus-site, quoted phrase, upi, gov.in, PIB fact check) | Complete | `lib/tools/dorks.js` |
| **4.3** | URLhaus tool `lib/tools/urlhaus.js`: abuse.ch lookup, Auth-Key header, 1h cache TTL, listed/unlisted, strict safety invariant (unlisted never described as safe) | Complete | `lib/tools/urlhaus.js` |
| **4.4** | URLhaus diagnostic script `scripts/diagnose-urlhaus.js`: single test lookup, Auth-Key present yes/no, safe error reporting | Complete | `scripts/diagnose-urlhaus.js` (Auth-Key present: yes, HTTP 403 / unknown_auth_key cleanly diagnosed) |
| **4.5** | urlscan tool `lib/tools/urlscan.js`: public search (/api/v1/search/), no submission, 1h cache TTL, empty result never described as safe | Complete | `lib/tools/urlscan.js` |
| **4.6** | Offline unit tests `tests/tools-search.test.js` | Complete | `tests/tools-search.test.js` (25 tests pass offline for search budget, auth/rate limits, dork sanitization, URLhaus feed lookup, and urlscan search) |
| **5.1** | Scam graph repository wrapper `lib/graph.js`: upsertNode, link, lookup (GraphMatch shape), recordReport (strictly high risk, consent === true, atomic pairwise linking) | Complete | `lib/graph.js` |
| **5.2** | Curated seed data `lib/data/seed-graph.json` and idempotent seeding script `scripts/seedGraph.js` | Complete | `lib/data/seed-graph.json`, `scripts/seedGraph.js` (run 1: 3 seeded, 0 skipped; run 2: 0 seeded, 3 skipped) |
| **6.1** | Classifier service `services/classifier/`: FastAPI endpoint `POST /classify` and `GET /health` | Complete | `services/classifier/app.py` |
| **6.2** | Classifier training `services/classifier/train.py` & synthetic dataset `services/classifier/data/dataset.csv`: TF-IDF word n-grams (1, 2) + LogisticRegression | Complete | `services/classifier/train.py`, `services/classifier/data/dataset.csv` (produces `model.joblib`, `metrics.json` on synthetic dataset) |
| **6.3** | Pytest test suite `services/classifier/tests/test_classifier.py`: health, classification shape, probability bounds, topTerms extraction | Complete | `services/classifier/tests/test_classifier.py` (4/4 tests pass) |
| **6.4** | Classifier Node.js client `lib/classifier.js`: 3s timeout, ToolResult contract, ClassifierResult validation, `logToolExecution` | Complete | `lib/classifier.js` |
| **6.5** | Offline unit tests `tests/classifier.test.js`: client contract, unreachable service, invalid payloads, timeouts | Complete | `tests/classifier.test.js` (6 tests pass offline) |
| **6.6** | Live diagnostic script `scripts/classifier-live.js` | Complete | `scripts/classifier-live.js` |
| **7.1** | Layer verification & unified live script `scripts/l2-live.js`: runs single test call against all configured external lookups, reports formatted summary table, zero secret leaks | Complete | `scripts/l2-live.js` (verified live: RDAP PASS, DNS PASS, SSL PASS, Wayback PASS, Serper PASS, URLhaus PASS, urlscan PASS, Classifier PASS, LLM PASS; exit=0) |
| **7.2** | Documentation & Layer L2 Gate closure: `README.md`, `AGENTS.md`, `docs/l2-progress.md` updated, 112 unit tests pass offline, zero network access in test runner | Complete | `README.md`, `AGENTS.md`, `npm test` (112 tests passing), `npm run lint`, `npm run build` |
| **7.3** | Live threat feed proofs (URLhaus and urlscan): authenticated live lookups confirmed | Complete | `scripts/diagnose-urlhaus.js` (HTTP 200, query_status: ok), `scripts/diagnose-urlscan.js` (HTTP 200, total: 10000), `scripts/l2-live.js` |
