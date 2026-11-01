# Crawler Service Integration Progress

## Baseline
- **Git HEAD Baseline**: `79a18ca5b75b3065d366201158ab75e7885090d5`
- **Part 1 Commit**: `a2d0eeab601cd3fe42aa182181e10e53a4181f90` ("chore: import crawler source unmodified")

---

## Part 1: Move, Verify, Delete
- [x] Copy source files directly into `services/crawler/` (excluding `.git`, `node_modules`, `.env*`, `output`, `assets`, `storage`, `dist`, `*.log`, `prd.md`, `summary.md`).
- [x] Place `AGENTS.md`, `architecture.md`, `PRD.md`, `SUMMARY.md` in `services/crawler/docs-origin/` with disclaimer README.
- [x] Verify copy with `diff -rq` (empty diff on `src` and `scripts`).
- [x] Verified file counts (11 in `src`, 2 in `scripts`) and sizes (112 KB `src`, 20 KB `scripts`).
- [x] Confirm no `.env*` or secret file staged.
- [x] Stage only `services/crawler/` and commit: `chore: import crawler source unmodified`.
- [x] List items remaining in `scrappyscrappy/` that were not copied.
- [x] User requested to skip deletion of `scrappyscrappy/` for now and migrated variables to `.env.local`.

---

## Part 2: Security Changes to Copied Crawler (services/crawler/)
- [x] Remove LLM form filling (`src/llm.js` deleted, `openai` removed from dependencies, all `LLM_*` and `OPENAI_*` env configurations removed, form-filling code paths removed).
- [x] Crawl is strictly read-only: never types into or submits any form.
- [x] Remove screenshots, image saving, zip archiving, download endpoint (`archiver` removed, `acceptDownloads: false` configured, screenshots and downloads removed).
- [x] Audit `src/urlGuard.js` against `lib/tools/ssrf.js`:
  - Upgraded IP parser with `ipaddr.js` supporting decimal, hex, octal, IPv4-mapped IPv6, carrier-grade NAT, and cloud metadata.
  - Social domains blocked: `instagram.com`, `facebook.com`, `linkedin.com` and all subdomains.
  - Robots.txt parsing and disallow compliance verified.
  - DNS resolution resolving to private/loopback IP verified and blocked.
- [x] SSRF Audit of Browser:
  - Direct navigations to private IPs are intercepted and aborted (`blockedbyclient`).
  - Subframe navigations (`<iframe>`) to private IPs are intercepted and aborted.
  - **AUDIT FINDING (GATE FAILURE & STOP)**: When using standard `route.continue()`, Chromium follows HTTP 302 redirects internally in its network stack and resolves DNS independently from Node's resolver. This creates a DNS Rebinding vulnerability (TOCTOU) and allows redirect hops to bypass `context.route` on document navigations.
  - **PROPOSED FIX**: Implement a local pinned-IP forward proxy (or intercept requests using `route.fulfill()` backed by Node's SSRF-guarded pinned-IP `fetchPage`), preventing Chromium from ever performing uncontrolled DNS resolution or following redirects out-of-band.
- [x] Hard limits from env with safe defaults: max pages (10), max depth (2), total time (60s), total bytes (10 MB), same host only.
- [x] Server bound to `127.0.0.1` only. `CRAWLER_API_KEY` required on every route (401 on unauthorized).
- [x] In-memory job results only with short TTL (10 min), zero disk operations.
- [x] Offline unit tests added with `node --test` (12/12 pass in `services/crawler`).

---

## Part 2b: SSRF Fix via Pinned-IP Forward Proxy (services/crawler only)
- [x] Add `services/crawler/src/safeProxy.js`:
  - Listens on 127.0.0.1, ephemeral port.
  - Handles CONNECT (HTTPS) and plain HTTP GET/HEAD (any other method gets 405 Method Not Allowed).
  - Target ports 80 and 443 only.
  - Resolves target host once with injectable resolver; blocks private, loopback, link-local, CGNAT, metadata, and social domains (decimal, hex, octal, IPv4-mapped IPv6 included); replies 403.
  - Connects to validated, PINNED IP, never to hostname.
  - Injectable connector for test observability.
  - Timeouts and per-tunnel byte cap enforced; never logs query strings or content.
  - Self-contained implementation citing `lib/tools/ssrf.js`.
- [x] Browser launch in `services/crawler/src/crawler.js`:
  - Proxy configured: `{ server: 'http://127.0.0.1:<port>', bypass: '<-loopback>' }`.
  - Arguments: `--disable-quic` and `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"`.
  - `serviceWorkers: 'block'`, `acceptDownloads: false`, popups and new tabs blocked. No `--no-sandbox`.
  - Second layer `context.route` retained.
- [x] Tests in `services/crawler/tests/safeProxy.test.js` & `services/crawler/tests/ssrf-browser-audit.test.js`:
  - DNS Rebinding test: injected resolver returns public then loopback; connector called once with pinned IP; canary hit count = 0.
  - 302 Redirect test: stand-in public host returns 302 to loopback canary; real Chromium run records canary hit count = 0.
  - Direct navigation, iframe, and img/fetch to loopback tested with `<-loopback>`: canary hit count = 0 for all.
  - Metadata IP, decimal/hex/octal literals, IPv4-mapped IPv6, CGNAT, and social hosts return 403; connector never called.
  - Port 8080 and non-GET methods refused.
  - All 16 tests pass in `services/crawler`.

---

## Part 2c: Verify SSRF Fix and Enforce Read-Only Methods (services/crawler only)
- [x] Shared production launcher `launchCrawlBrowser` exported from `services/crawler/src/crawler.js`, accepting injected resolver, connector, byteCap, timeouts, and callbacks. Used by both production `crawl()` and security tests.
- [x] Redirect controls verified in `services/crawler/tests/ssrf-browser-audit.test.js`:
  - Positive control (A -> B across stand-in public hosts): succeeds, receives 200, destination reached.
  - Negative control (A -> Loopback canary 302): blocked with 403, canary hit count = 0. Decision log records Hop 1 allowed (200), Hop 2 refused (403).
- [x] Layer independence verified: test mode with `disableContextRoute: true` re-runs loopback navigation, iframe, img/fetch, and 302 redirect. Canary hit count is 0 with proxy alone.
- [x] Read-only method enforcement: `context.route` aborts every request whose method is not GET or HEAD (`route.abort('blockedbyclient')`). Script `fetch(..., {method: 'POST'})` and `form.submit()` recorded 0 server hits.
- [x] Proxy byte counter test added (`crawler-security.test.js` & `safeProxy.test.js`): proves `totalBytesReceived` increments accurately and terminates crawl upon exceeding limit (`stopReason: 'byteLimit'`).
- [x] Forbidden terms checked: zero occurrences of `openai`, `OPENAI`, `LLM_`, `.fill(`, `.type(`, `screenshot`, `archiver`, `--no-sandbox` (grep exit code 1), zero occurrences of `click(` (grep exit code 1).
- [x] Chromium without `--no-sandbox` in Linux/container deployment: NOT VERIFIED.
- [x] All 18 tests in `services/crawler` pass offline; root 1042 tests pass; lint and build pass.

---

## Part 3: Docs and Contracts
- [ ] Update ARCHITECTURE.md, PRD.md, docs/contracts.md (NOT VERIFIED).
- [ ] Define `CrawlResult` contract (NOT VERIFIED).
- [ ] Add `crawl_results` table migration 006 (or next forward migration) with ON DELETE CASCADE (NOT VERIFIED).
- [ ] Add `CRAWLER_URL` and `CRAWLER_API_KEY` in `lib/env.js` (NOT VERIFIED).
- [ ] Add error codes `CRAWLER_UNAVAILABLE` and `CRAWL_NOT_ALLOWED` (NOT VERIFIED).
- [ ] Service adapter mapping crawler output to `CrawlResult` (NOT VERIFIED).
- [ ] Fixtures and tests with realistic data (NOT VERIFIED).

---

## Part 4: Client, DB, API Route
- [ ] Implement `lib/crawler.js` (NOT VERIFIED).
- [ ] Repository functions in `lib/db/` (NOT VERIFIED).
- [ ] Implement `POST /api/checks/:id/crawl` with entity check, SSRF guard, idempotency, rate limit (NOT VERIFIED).
- [ ] Implement `GET /api/checks/:id/crawl` (NOT VERIFIED).
- [ ] Integration tests (NOT VERIFIED).
- [ ] Create `scripts/crawler-live.js` (NOT VERIFIED).

---

## Part 5: UI Button
- [ ] Audit and list reused elements from `deferred/ui/` (NOT VERIFIED).
- [ ] Add extraction card in `/check/[id]` report view (NOT VERIFIED).
- [ ] Bilingual support (en/hi) and accessible design tokens (NOT VERIFIED).
- [ ] Plain text rendering of results (NOT VERIFIED).
- [ ] UI tests or manual testing verification in this file (NOT VERIFIED).
