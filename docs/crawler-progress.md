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
- [x] Update ARCHITECTURE.md (layer table in section 2; external services table in section 11; crawler service architecture in section 17; migration 012 in section 19 & data model section 9).
- [x] Update PRD.md (deep web crawler feature, informational read-only user flow step 8, API routes `POST /api/checks/:id/crawl` and `GET /api/checks/:id/crawl`).
- [x] Update docs/contracts.md (section 11: `CrawlResultSchema`, `CrawlPageSchema`, `CrawlFormSchema`, `CrawlLimitsUsedSchema`, error codes, `crawl_results` table).
- [x] Define `CrawlResultSchema` in `lib/contracts/crawl.js` and re-export in `lib/contracts/index.js`.
- [x] Add migration 012 (`lib/db/migrations/012_create_crawl_results.js` and `.sql`) creating `crawl_results` table with `ON DELETE CASCADE` and index definitions.
- [x] Add `CRAWLER_URL` (default `http://127.0.0.1:3001`) and `CRAWLER_API_KEY` (optional) in `lib/env.js`.
- [x] Add error codes `CRAWLER_UNAVAILABLE` (503) and `CRAWL_NOT_ALLOWED` (400) to `API_ERROR_CODES` in `lib/contracts/enums.js`.
- [x] Service adapter `services/crawler/src/adapter.js` implemented without importing from root `lib/`.
- [x] Generated and committed real JSON fixture in `services/crawler/tests/fixtures/real-crawl-result.json`.
- [x] Root test in `tests/crawler-contracts.test.js` validating fixture with `CrawlResultSchema`, error codes, env vars, and migration 012 up/down/cascade.
- [x] All 20 tests pass in `services/crawler`, 1047 tests pass in root, lint and build pass.

---

## Part 4: Client, DB, API Route
- [x] Read `services/crawler/src/routes/crawl.js` and document exact microservice routes and shapes:
  - `GET /api/health` (or `/health`): Returns 200 `{ status: 'ok', service: 'crawler', chromium: true, uptime: number, timestamp: string }` or 503 if Chromium fails to launch.
  - `POST /api/crawl`: Headers: `x-api-key: <key>`, `Content-Type: application/json`. Body: `{ url: string, maxDepth?: number, maxPages?: number, concurrency?: number, maxScrolls?: number, scrollPage?: boolean, sameHostOnly?: boolean, timeoutMs?: number }`. Returns 202 `{ message: 'Crawl job queued', jobId: string, status: 'queued' | 'running' }` (or 400 on invalid URL/caps, 401 on missing/wrong API key).
  - `GET /api/crawl/:jobId`: Headers: `x-api-key: <key>`. Returns 200 `{ jobId: string, status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled', pagesVisited: number, pending: number, failed: number, startedAt: string | null, finishedAt: string | null, errors: string[], result: CrawlResult | null }`. Returns 404 if job expired or not found.
  - `GET /api/crawl/:jobId/result`: Headers: `x-api-key: <key>`. Returns 200 with completed `CrawlResult` object; 409 if still queued/running; 404 if not found; 500 if failed.
  - `DELETE /api/crawl/:jobId`: Headers: `x-api-key: <key>`. Returns 200 `{ message: 'Job cancellation requested', jobId: string, status: 'cancelled' }`.
- [x] Implement `lib/crawler.js` (POST to `/api/crawl`, poll 1s, DELETE on timeout, `CrawlResultSchema` validation, `x-api-key`, typed errors).
- [x] Repository functions in `lib/db/` (`createCrawl`, `markCrawlDone`, `markCrawlFailed`, `getCrawl`, `markStaleCrawlsFailed` wired into `runCleanup`).
- [x] Implement `POST /api/checks/:id/crawl` with entity check, SSRF guard, idempotency, retry, rate limit, concurrency saturation 503.
- [x] Implement `GET /api/checks/:id/crawl` returning `not_started`, `running`, `done`, `failed`.
- [x] Integration tests in `tests/crawler-integration.test.js` covering 19 requirements offline with mocked fetch and SQLite DB.
- [x] Create and verify `scripts/crawler-live.js` against running crawler service (example.com exactly 1 page; quotes.toscrape.com depth 1 observations; non-zero exit on errors).

---

## Part 5: UI Button
- [x] Audit and list reused elements:
  - Live page is `app/check/[id]/page.js` (not `deferred/ui/`).
  - Reused global design tokens (`--bg-primary`, `--text-primary`, `--border-primary`, `--status-*`, `--radius-md`).
  - Reused standard classes: `.panel`, `.panel-header`, `.panel-subtle`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-sm`, `.badge`, `.status-dot`.
- [x] Add extraction card in `/check/[id]` report view (`components/LinkExtractionCard.js` mounted in `app/check/[id]/page.js` for each confirmed domain/url entity).
- [x] Host only displayed, never full URL (path, credentials, and query parameters stripped).
- [x] Read-only initial fetch on mount (`GET /api/checks/:id/crawl?entityId=...`), nothing runs until "Yes, extract" is clicked.
- [x] Polling every 2s, stopping on done or failed, unmount cleanup, and 3-minute timeout ("taking longer than expected").
- [x] "No, skip" collapses to skipped state with "Extract anyway" link, sending no network requests.
- [x] Plain text rendering of results (pages list, form highlights with text labels + colors, external domains, truncated note, mandatory PRD information-only disclaimer).
- [x] All states handled: running (polite aria-live), failed with Retry button, busy (503), unavailable (`CRAWLER_UNAVAILABLE`), not allowed (`CRAWL_NOT_ALLOWED`), expired (`CHECK_EXPIRED`).
- [x] Bilingual support (en/hi) through `EXTRACTION_STRINGS` responding to `summaryLang` toggle.
- [x] Accessible 44px touch targets, mobile-first responsive layout, zero layout shift.
- [x] Component unit tests in `tests/ui-components.test.js` (card states, security escaping, host sanitization).

### Interactive Browser Manual Verification Script:
1. Start crawler API server: `npm run server --prefix services/crawler` (port 3001).
2. Start dev server: `npm run dev` (port 3000).
3. Open `http://localhost:3000/check` and submit a test offer containing a link, e.g.:
   "PM Scholarship Scheme: Apply at https://example.com/apply for Rs 50,000 grant."
4. Confirm extracted entities.
5. In the final report view, verify the card appears:
   - Header shows "example.com" (not full URL).
   - "Do you want to extract the content of this link?"
   - Mandatory note: "We open the link from our server, read the pages, and delete the result after 24 hours. Nothing is saved to the scam graph."
   - Test "No, skip": Card collapses to "Link content extraction skipped for example.com." with "Extract anyway".
   - Click "Extract anyway": Card returns to initial prompt.
   - Click "Yes, extract": State changes to running with live status dot.
   - On completion: Results show inspected pages, text excerpt toggle, form highlights, and "This is information only. It does not change the risk level."
   - Toggle English / हिंदी in Assessment Summary: Verify extraction card text switches to Hindi seamlessly.
   - Refresh page: Verify state remains displayed without restarting or losing results.
