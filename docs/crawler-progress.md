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
