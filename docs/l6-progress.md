# L6 Progress Tracking: API & Lifecycle Layer (Backend First)

### Initial Build Steps (Completed)
| Step | Description | Commit | Status | Evidence |
|:---:|---|:---:|:---:|---|
| **L6-A** | Audit existing routes, environment, Next.js runtime limits, write `docs/l6-spec.md` with numbered decision records (DR-1 to DR-10), document contract gaps, and record open questions | `f56ec32` | Complete | `docs/l6-spec.md`, preflight checks |
| **L6-B** | API infrastructure under `lib/api/` (`errors.js`, `validate.js`, `rate-limit.js`, `event-bus.js`, `jobs.js`, `headers.js`, `runtime.js`, `log.js`), contracts & env updates, unit tests | `7fc0b96` | Complete | 445 tests passing, `npm run lint`, `npm run build` |
| **L6-C** | Core API route implementations (`POST /api/checks` multipart upload, `GET /api/checks/:id`, `POST /api/checks/:id/confirm`, `GET /api/checks/:id/report`, `GET /api/health`) and unit tests | `HEAD` | Complete | 458 tests passing, `npm run lint`, `npm run build`, `npm run check:run` |
| **L6-D** | SSE Event streaming endpoint (`GET /api/checks/:id/stream`), pure `lib/api/sse.js` formatter/loop, event notification bus connection, subscriber cap, Last-Event-ID replay and stream tests | `1ea8fe3` | Complete | 472 tests passing, `npm run lint`, `npm run build` |
| **L6-E** | Operations: `instrumentation.js`, `lib/api/startup.js` background scheduler, restart recovery, security headers, rate limiting & daily cap, `scripts/ops-smoke.js` | `13df462` | Complete | 480 tests passing, `npm run lint`, `npm run build`, `node scripts/ops-smoke.js` |
| **L6-F** | End-to-end API smoke runner (`scripts/api-e2e.js`, `npm run api:e2e`), security suite (`tests/api-security.test.js`), 499 tests pass, lint pass, build pass, and initial L6 layer gate completion | `d154f28` | Complete (provisional) | `scripts/api-e2e.js`, 499 tests pass, `npm run api:e2e`, `npm run lint`, `npm run build` |

### Spec Correction & Hardening Steps (Fix Phase)
| Step | Description | Commit | Status | Evidence |
|:---:|---|:---:|:---:|---|
| **A2** | Correct L6 specification with numbered decisions C1-C8 (`docs/l6-spec.md`), document contract gaps (`docs/contracts.md`, `ARCHITECTURE.md`), mark L6 backend provisional | `b0c79ca` | Complete | `docs/l6-spec.md` Section 11, preflight & Part 0 probe outputs |
| **S4** | Cross-cutting fix: failure reason codes (`FAILURE_REASON_CODES`), write validation in `lib/db`, extract.js code, and legacy row normalization | `d3fa54e` | Complete | 502 tests passing, `scripts/validate-contracts.js`, `npm run api:e2e` |
| **X1** | Client key, body limits, image decompression limits, zero-echo error mapping, rate limiting env configuration, creation concurrency semaphore | `HEAD` | Complete | 543 tests passing, `npm test`, `npm run lint`, `npm run build`, `npm run api:e2e`, `scripts/ops-smoke.js` |
| **X2** | Unproven items closure, live HTTP run verifier (`scripts/api-live.js`), offline ops smoke test extension, strict zero DB access outside `lib/db/` | `f41f86a` | Complete | 558 tests passing, live check passes end-to-end (check ID `11d55a49`), 0 DB leaks |
| **X3** | Evidence gaps closure, `process.env` single-place invariant in `app/` and `lib/api/`, security headers on all responses, `TRUST_PROXY` isolation assertion | `HEAD` | Complete | 561 tests passing, `npm run lint`, `npm run build`, `npm run api:e2e`, `node scripts/ops-smoke.js` |

---

## Notes on Architecture & Scope Constraints
- **Scope**: Backend API only. UI components and frontend pages remain deferred in `deferred/ui/`.
- **Database Access Rule**: Only `lib/db/` executes SQLite statements; API routes and coordinators interact with the database exclusively through exported repository functions.
- **Privacy & Safety Invariants**: No user message text, entity values, or local file system paths are exposed in error responses, SSE progress payloads, or server logs.

