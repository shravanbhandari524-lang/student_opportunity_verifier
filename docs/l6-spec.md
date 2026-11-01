# L6 API Specification & Architecture Decisions (Step L6-A)

## Overview & Scope
This document specifies the backend API architecture, routes, schemas, lifecycle, SSE streaming, rate limiting, security, and scheduling for Layer L6 (Backend API) of the Student Opportunity Verifier.
It provides exact decision records (DR-1 to DR-10), marks contract/spec changes that require approval (`[NEEDS APPROVAL]`), details contract and document gaps, and lists open technical questions.

In accordance with `AGENTS.md`, this specification is strictly backend-first. UI routes and visual elements are deferred.

---

## 1. Route Table & Endpoint Specifications (DR-1)

| Method | Path | Request Body / Query | Success Response | Status Codes | Error Codes | Notes |
|---|---|---|---|---|---|---|
| `POST` | `/api/checks` | Multipart `multipart/form-data` | `{ checkId: string, status: "created" }` | `201`, `400`, `413`, `415`, `429`, `500` | `VALIDATION_ERROR`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `RATE_LIMITED`, `INTERNAL_ERROR` | Initiates check, writes inputs, enqueues background extraction job. |
| `GET` | `/api/checks/:id` | None | `{ check: CheckSummary, entities: EntityItem[] }` | `200`, `400`, `404`, `410`, `500` | `BAD_REQUEST`, `NOT_FOUND`, `CHECK_EXPIRED`, `INTERNAL_ERROR` | Polling endpoint for check status, progress, and confirmed/extracted entities. |
| `POST` | `/api/checks/:id/confirm` | JSON `{ texts?: string[], entities?: ConfirmedEntity[] }` | `{ checkId: string, status: "investigating" }` | `200`, `400`, `404`, `409`, `410`, `429`, `500`, `503` | `BAD_REQUEST`, `VALIDATION_ERROR`, `NOT_FOUND`, `STATE_CONFLICT`, `CHECK_EXPIRED`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR` | User confirms/edits entities. Calls `saveConfirmation`, enqueues background investigation. |
| `GET` | `/api/checks/:id/stream` | Header `Last-Event-ID` (optional) | SSE Event Stream (`text/event-stream`) | `200`, `400`, `404`, `410`, `500` | `BAD_REQUEST`, `NOT_FOUND`, `CHECK_EXPIRED`, `INTERNAL_ERROR` | Real-time progress updates with event replay and keepalive comments. |
| `GET` | `/api/checks/:id/report` | None | `{ report: Report }` | `200`, `400`, `404`, `409`, `410`, `500` | `BAD_REQUEST`, `NOT_FOUND`, `STATE_CONFLICT`, `CHECK_EXPIRED`, `INTERNAL_ERROR` | Retrieves final report. Returns 409 if status is not `report_ready`. |
| `GET` | `/api/health` | Query `?llm=1` (optional) | `{ status: "ok", timestamp: string, uptime: number, llm?: object, db?: object }` | `200`, `503` | `INTERNAL_ERROR` | Health check for server, database connection, and optional LLM connectivity. |

### Multipart Field Names & Limits for `POST /api/checks`
- **Fields**:
  - `text`: optional string, maximum 10,000 characters.
  - `url`: optional string, valid HTTP/HTTPS URL.
  - `upiId`: optional string.
  - `company`: optional string.
  - `handle`: optional string.
  - `phone`: optional string.
  - `youtubeUrl`: optional string, valid HTTP/HTTPS URL.
  - `language`: optional string enum `["en", "hi"]`, default `"en"`.
  - `consent`: required string `"true"` or `"1"`, parsed to boolean `true`.
  - `images`: optional repeated file fields (up to 5 image files).
- **Size Limits**:
  - Max image files: 5.
  - Max per-image file size: 5 MB (5,242,880 bytes).
  - Max total request body size: 26 MB (5 * 5 MB + text & fields buffer).
  - Validation: Magic byte inspection via `file-type` (`validateImageBuffer`) before saving to disk.
- **Mapping to `CheckInput` Rows**:
  - Text fields map to `{ type: "text" | "url" | "upi" | "company" | "handle" | "phone" | "youtube_url", value: string }`.
  - Image files map to `{ type: "image", mimeType: "image/png" | "image/jpeg", sizeBytes: number, filePath: string }`.
- **File Storage Rules**:
  - Random server-generated UUID names: `${crypto.randomUUID()}.${ext}`.
  - Never retain or use client-supplied filenames.
  - Saved strictly within `UPLOAD_DIR` (`./uploads` by default). Resolved path must be strictly inside `UPLOAD_DIR`.
  - File permissions: mode `0o600` (readable/writable only by the application process).
  - Deleted automatically after extraction (in `lib/extract.js` `finally` block) and cleared by periodic `runCleanup`.

---

## 2. Response Shaping, Caching & Error Behavior (DR-2)

### Exposed Fields vs Forbidden Fields
- **Exposed in `GET /api/checks/:id`**:
  - `check`: `{ id, status, currentRound, language, riskLevel, score, confidence, createdAt, updatedAt, expiresAt }`
  - `entities`: `Array<{ id, kind, value, source }>`
- **Exposed in `GET /api/checks/:id/report`**:
  - The complete `ReportSchema` object (`checkId`, `riskLevel`, `score`, `confidence`, `scamTypeGuess`, `language`, `summary`, `flags`, `verified`, `couldNotCheck`, `notApplicable`, `checklist`, `actions`, `disclaimer`, `generatedAt`).
- **Strictly Forbidden Fields (Never Expose to Clients)**:
  - `filePath` / image file storage paths.
  - Internal database IDs of `check_inputs` or raw SQL sequence values.
  - Raw `failure_reason` strings that might contain user text or internal error stacks.
  - Server stack traces, host paths, or raw provider exception messages.

### Caching Headers
- All API routes must send non-cacheable headers to avoid leaking or caching dynamic investigation state:
  ```http
  Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
  Pragma: no-cache
  Expires: 0
  ```

### HTTP Error Mapping
- **Malformed ID**: HTTP 400 with `{ code: "BAD_REQUEST", message: "Invalid check ID format (must be UUID)" }`.
- **Unknown ID**: HTTP 404 with `{ code: "NOT_FOUND", message: "Check not found" }`.
- **Expired Check** (`expiresAt < now`): HTTP 410 with `{ code: "CHECK_EXPIRED", message: "Check has expired" }`.
- **Premature Report Request** (status != `"report_ready"`): HTTP 409 with `{ code: "STATE_CONFLICT", message: "Report not ready for this check", status: currentStatus }` `[NEEDS APPROVAL: add STATE_CONFLICT to API_ERROR_CODES]`.
- **Failed Check Investigation**: HTTP 409 or returned in `check.status = "failed"` with standard failure code.

---

## 3. Confirm Route Specification (`POST /api/checks/:id/confirm`) (DR-3)

### Request Schema
```typescript
{
  texts?: string[];               // Max 10 items, max 10,000 chars each
  entities?: Array<{             // Max 30 items
    kind: "domain" | "url" | "upi" | "email" | "phone" | "company" | "handle" | "amount" | "youtube_url";
    value: string;
  }>;
}
```

### Execution Lifecycle & Idempotency
1. Validate `id` format (UUID).
2. Fetch `check = getCheck(id)`.
   - If not found -> 404 `NOT_FOUND`.
   - If `check.expiresAt < now` -> 410 `CHECK_EXPIRED`.
   - If `check.status !== "awaiting_confirmation"`:
     - If `check.status === "investigating"` or `"scoring"` or `"report_ready"` -> 409 `STATE_CONFLICT` ("Confirmation already processed").
     - Otherwise -> 409 `STATE_CONFLICT` ("Check is not awaiting confirmation").
3. Validate request payload against `ConfirmationSubmissionSchema` (`.strict()`).
4. Invoke `saveConfirmation(id, { texts, entities }, db)`:
   - Atomic SQLite transaction replacing text inputs and entities with `source = 'user'`.
   - Transitions check status to `investigating` and appends confirmation event.
5. Launch background investigation via the Background Job Runner (`jobRunner.startInvestigation(id)`).
6. Return HTTP 200 with `{ checkId: id, status: "investigating" }`.

---

## 4. In-Process Background Job Runner (DR-4)

### Concurrency & Lifecycle
- **Architecture**: In-process asynchronous queue bounded by an explicit concurrency semaphore. Designed specifically for single long-running Node.js server deployments (`next start` or dedicated container); not for serverless/edge environments.
- **Concurrency Cap**:
  - Default: `MAX_CONCURRENT_INVESTIGATIONS = 4` (configurable via `env.MAX_CONCURRENT_INVESTIGATIONS`).
  - Active jobs tracked in-memory by `Set<string>` (active `checkId`s).
  - If concurrency cap is reached, new job requests are rejected immediately with HTTP 503 `SERVICE_UNAVAILABLE` and `Retry-After: 10`.
- **Error Isolation**:
  - `startJob(checkId, taskFn)` wraps execution in an unhandled-rejection boundary (`try ... catch`).
  - Any unhandled throw updates the check in the database to `failed` with reason code `internal_error` and emits an `error` progress event.
- **Server Restart Recovery**:
  - On startup (invoked by `instrumentation.js`), the runner executes a recovery sweep:
  - Queries all checks in `extracting`, `investigating`, or `scoring` statuses.
  - Updates each to `failed` with failure reason `server_restart` and appends an `error` event.

---

## 5. Server-Sent Events (SSE) Stream (`GET /api/checks/:id/stream`) (DR-5)

### Design & Mechanics
- **Database as Ground Truth**: The `check_events` SQLite table is the durable source of truth.
- **In-Memory Notification Bus**: A lightweight in-process `EventEmitter` (`eventBus`) wakes subscribers when new events are appended.
- **Headers**:
  ```http
  Content-Type: text/event-stream
  Cache-Control: no-cache, no-transform
  Connection: keep-alive
  X-Accel-Buffering: no
  ```
- **Runtime Exports**:
  ```javascript
  export const runtime = "nodejs";
  export const dynamic = "force-dynamic";
  ```
- **Last-Event-ID Replay**:
  - Reads `Last-Event-ID` request header or `?lastEventId=` query parameter.
  - Replays all historical events from `check_events` where `id > lastEventId`.
- **Wire Format**:
  - Event messages:
    ```
    id: 14
    event: message
    data: {"type":"agent","round":1,"agent":"message_analyst","status":"ok"}

    ```
  - Comment-only heartbeat keepalive sent every 15 seconds:
    ```
    : ping

    ```
- **Termination & Cleanup**:
  - Connection automatically closes upon sending a terminal event (`complete` or `error`), or when the check status is detected as `report_ready` or `failed`.
  - Max stream duration cap: 5 minutes (300,000 ms).
  - Client disconnect (`request.signal.addEventListener("abort")`) immediately unregisters the listener from `eventBus`.
- **Polling Fallback**: For clients without SSE support, `GET /api/checks/:id` returns the latest check status and confirmed entities.

---

## 6. Rate Limiting Strategy (DR-6)

### Rules & Algorithms
- **Algorithm**: In-memory Sliding Window Log with bounded memory footprint and automated eviction.
- **Limits Per IP**:
  - `POST /api/checks`: Max 10 requests per 15-minute window (strictest).
  - `POST /api/checks/:id/confirm`: Max 10 requests per 15-minute window.
  - `GET /api/checks/:id` & `/report`: Max 60 requests per 1-minute window.
  - `GET /api/checks/:id/stream`: Max 10 concurrent active streams per IP.
- **Global Quota Protection**:
  - `GLOBAL_DAILY_CHECK_CAP = 500` (configurable via `env.GLOBAL_DAILY_CHECK_CAP`).
  - Total created checks across all IPs in 24 hours capped to safeguard LLM and Search provider quotas. Returns 429 when exceeded.
- **Client IP & Proxy Policy**:
  - `TRUST_PROXY`: boolean env variable (default `false`).
  - If `TRUST_PROXY === true`: parses the leftmost valid public IP from `x-forwarded-for`.
  - If `TRUST_PROXY === false`: ignores client-supplied `x-forwarded-for` and uses direct connection IP to prevent header spoofing.
- **Rate Limit Response**:
  - HTTP 429 with headers `Retry-After: <seconds>` and standard ApiError body:
    ```json
    {
      "code": "RATE_LIMITED",
      "message": "Too many requests. Please retry in 60 seconds."
    }
    ```

---

## 7. Security Headers, Input Validation & ID Format (DR-7)

### Security Headers
Every API response includes protective HTTP headers:
```http
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
```

### Content-Type & Size Enforcement
- `POST /api/checks` requires `Content-Type: multipart/form-data; boundary=...`. Returns HTTP 415 `UNSUPPORTED_MEDIA_TYPE` if missing or invalid.
- `POST /api/checks/:id/confirm` requires `Content-Type: application/json`. Returns HTTP 415 if missing.
- Request body read uses streaming byte-counting to abort and reject requests exceeding 26 MB with HTTP 413 `PAYLOAD_TOO_LARGE`.

### ID Format & Masking
- All check IDs must strictly validate against UUID v4 format.
- Malformed IDs return HTTP 400 `BAD_REQUEST`.
- Non-existent IDs return HTTP 404 `NOT_FOUND`. Response times and error structures must never reveal internal existence differences.

---

## 8. Structured Logging Standards (DR-8)

- **Logger**: Uses central `pino` logger ([`lib/logger.js`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/logger.js)).
- **Log Payload Schema**:
  ```json
  {
    "requestId": "req_uuid",
    "route": "/api/checks",
    "method": "POST",
    "status": 201,
    "durationMs": 42,
    "checkId": "uuid"
  }
  ```
- **Privacy Enforcement**:
  - **NEVER** log raw message text, candidate email, phone numbers, UPI IDs, company names, extracted URLs, or uploaded image contents.
  - Redact all authorization headers and cookie headers.

---

## 9. Cleanup & Background Scheduling (`instrumentation.js`) (DR-9)

- **Next.js Hook**: `instrumentation.js` exporting `register()`.
- **Runtime Guard**:
  ```javascript
  export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      // Initialize background cleanup scheduler and restart recovery
    }
  }
  ```
- **Startup Actions**:
  1. Run restart recovery sweep on orphaned investigating/extracting checks.
  2. Run initial cleanup pass (`runCleanup()`).
  3. Schedule recurring hourly interval using `setInterval(..., 3600000).unref()` to prevent holding Node process open on graceful shutdown.
- **Double-Registration Guard**:
  - Store a global symbol `globalThis[Symbol.for("APP_CLEANUP_INITIALIZED")]` to prevent duplicate scheduler loops in Next.js development HMR mode.

---

## 10. Layer L6 Gate List & Verification Commands (DR-10)

To pass the Layer L6 gate, all of the following commands must execute cleanly with zero errors:

1. **Unit & Route Tests**:
   `npm test`
   - Covers all route handlers (POST /checks, GET /checks/:id, POST /confirm, GET /stream, GET /report, GET /health), SSE formatting, rate limiter, background job runner, and security guards.
2. **Lint Cleanliness**:
   `npm run lint`
   - Must pass with 0 errors and 0 warnings.
3. **Production Build**:
   `npm run build`
   - All App Router API routes compile and generate static/dynamic endpoints cleanly.
4. **End-to-End API Scenario Runner**:
   `node scripts/smoke.js` or `node scripts/test-api.js`
   - Runnable script that sends HTTP/mock requests through the entire lifecycle: create -> extract -> confirm -> stream -> report.
5. **Layer Boundary Purity**:
   `git diff PRE HEAD -- lib/llm lib/scoring lib/tools lib/agents`
   - Must show zero unauthorized edits to completed lower layers.

---

## Contract and Doc Gaps (`[NEEDS APPROVAL]`)

1. **New `ApiError` Codes (`lib/contracts/enums.js`)** `[NEEDS APPROVAL: proposed change]`:
   - `PAYLOAD_TOO_LARGE`: Needed for 413 body size limit violations.
   - `UNSUPPORTED_MEDIA_TYPE`: Needed for 415 content-type violations.
   - `STATE_CONFLICT`: Needed for 409 status mismatch (e.g. confirming already confirmed check, or requesting report before `report_ready`).
   - `SERVICE_UNAVAILABLE`: Needed for 503 capacity / concurrency limit reached.
2. **ProgressEvent ID (`lib/contracts/events.js`)** `[NEEDS APPROVAL: proposed change]`:
   - `ProgressEventSchema` does not include an `id` field, whereas SQLite `check_events` table assigns an autoincrement `id`. For SSE `Last-Event-ID` support, the event wire shape needs `id: number`.
3. **Database L1 Repository Functions (`lib/db/index.js`)** `[NEEDS APPROVAL: proposed change]`:
   - `getEventsAfter(checkId, afterId)`: Needed for efficient SSE `Last-Event-ID` event replay without fetching the entire history.
   - `listStaleChecks(statuses, maxAgeMs)`: Needed for server restart recovery to query checks stuck in `extracting`, `investigating`, or `scoring`.
   - `countActiveChecks(statuses)`: Needed for concurrency tracking and global daily quota enforcement.
4. **Environment Variables (`lib/env.js`)** `[NEEDS APPROVAL: proposed change]`:
   - `TRUST_PROXY`: boolean (default `false`).
   - `MAX_CONCURRENT_INVESTIGATIONS`: number (default `4`).
   - `GLOBAL_DAILY_CHECK_CAP`: number (default `500`).
5. **`next.config.mjs` External Packages**:
   - Add `serverExternalPackages: ["better-sqlite3", "sharp"]` to prevent bundling issues during production build.

---

## Open Technical Questions

1. **Multipart Body Parsing in Next.js 15 App Router**:
   - Next.js 15 native `request.formData()` buffers file uploads in memory. For up to 5 images (25 MB total), is in-memory buffering acceptable for standard Node deployments, or should raw body streaming with `busboy` directly to disk be mandated?
   - *Recommendation*: Use `request.formData()` for standard simplicity, enforcing a strict 26 MB body limit prior to reading.
2. **Event Stream Bus Persistence across Multiple Instances**:
   - The proposed `eventBus` is in-process memory. If the user later scales to multi-instance Node containers, SSE events will require SQLite WAL polling or Redis pub/sub.
   - *Recommendation*: As stated in architecture section 20, the app is a single long-running Node server. In-process event bus with database replay satisfies all current requirements.

---

## 11. Spec Corrections (Step A2 Decisions C1 to C8)

### Decision C1: Sanitized `failureReason` Allowlist & Error Obfuscation
- **Context & Rule**: Stored `failure_reason` in the database historically contained raw strings like `"Extraction failed due to an internal system error"` (`lib/extract.js:579`) or `"coordinator_pipeline_error"` (`lib/coordinator.js:710`). The API in `GET /api/checks/:id` must **never** leak arbitrary strings or internal exception messages outward.
- **Fixed Allowlist**: When `check.status === "failed"`, `failureReason` returned in the HTTP response body must be mapped strictly to one of the following fixed enum tokens:
  1. `extraction_error` (image/text extraction pipeline failure)
  2. `coordinator_pipeline_error` (unrecoverable pipeline/agent orchestration failure)
  3. `server_restart` (stale check recovered during server startup)
  4. `unknown_error` (fallback for any unmapped, legacy, or unexpected stored value)
- **Sanitization Invariant**: If the database stores any string outside this allowlist (including free text or internal diagnostics), the API handler MUST return `"unknown_error"`. Failure details, stack traces, and system error messages NEVER reach public client responses.

### Decision C2: Strict Member Alignment with `API_ERROR_CODES` & Validation Path Limiting
- **Context & Rule**: Every HTTP error response emitted by route handlers and `toResponse()` MUST use a `code` belonging to `API_ERROR_CODES` defined in `lib/contracts/enums.js`:
  `["BAD_REQUEST", "NOT_FOUND", "RATE_LIMITED", "CHECK_EXPIRED", "CHECK_FAILED", "INTERNAL_ERROR", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "STATE_CONFLICT", "SERVICE_UNAVAILABLE"]`.
- **Validation Errors (`ZodError`)**:
  - Mapped strictly to `BAD_REQUEST` (HTTP 400). Generic codes like `VALIDATION_ERROR` that are not members of `API_ERROR_CODES` are prohibited.
  - The `details.issues` array is strictly sanitized: each issue exposes only `path` (dot-separated field name) and user-safe rule `message`.
  - Issue objects MUST NEVER echo or include the user's submitted values, inputs, or raw payload text.
- **Exact Error Mapping Table**:
  | Condition / Source Error | Status Code | ApiErrorCode | Response Message | Details / Headers Policy |
  |---|---|---|---|---|
  | Schema validation failure (`ZodError`) | 400 | `BAD_REQUEST` | `"Input validation failed"` | `details.issues`: `[{ path, message }]` (paths only, no values) |
  | Malformed JSON body | 400 | `BAD_REQUEST` | `"Malformed JSON body"` | No details |
  | Malformed multipart form data | 400 | `BAD_REQUEST` | `"Malformed multipart form data"` | No details |
  | Invalid Check UUID format | 400 | `BAD_REQUEST` | `"Invalid check ID format (must be UUID v4)"` | No details |
  | Unexpected / excess form field | 400 | `BAD_REQUEST` | `"Unexpected form field: <fieldName>"` | Field name only |
  | Image corrupted / magic mismatch | 400 | `BAD_REQUEST` | `"Invalid image upload: ..."` | User-safe reason |
  | Check ID not found | 404 | `NOT_FOUND` | `"Check not found"` | No details |
  | Check TTL expired (`expiresAt < now`) | 410 | `CHECK_EXPIRED` | `"Check has expired"` | No details |
  | Body / file exceeds byte cap | 413 | `PAYLOAD_TOO_LARGE` | `"Request body exceeds maximum size ..."` | Byte limit stated |
  | Content-Type missing or invalid | 415 | `UNSUPPORTED_MEDIA_TYPE` | `"Content-Type must be ..."` | Required MIME type |
  | State transition mismatch | 409 | `STATE_CONFLICT` | `"Confirmation not allowed for check in status ..."` | Safe status identifier |
  | Premature report request | 409 | `STATE_CONFLICT` | `"Report not ready for this check"` | Current status identifier |
  | Rate limit exceeded | 429 | `RATE_LIMITED` | `"Too many requests. Please retry in ..."` | `Retry-After: <sec>` header |
  | Concurrency cap saturated | 503 | `SERVICE_UNAVAILABLE` | `"Server is busy processing other checks ..."` | `Retry-After: 10` header |
  | Uncaught internal exception | 500 | `INTERNAL_ERROR` | `"Internal server error"` | Generic message, no stack or details |

### Decision C3: Client Key Extraction, Proxy Hopping & Configurable Rate Limit Envs `[APPROVED]`
- **Part 0 Probe Findings**: Under standalone Node `next start`, `request.ip` is always `null`. Direct requests receive no peer IP property on the standard `Request` object. `x-forwarded-for` is populated with `"::1"` only when loopback headers exist.
- **`TRUST_PROXY=false` (Default)**:
  - Route handlers cannot learn the client IP from connection sockets under standard App Router handlers without an upstream reverse proxy.
  - Every client-supplied proxy or IP header (`X-Client-IP`, `X-Real-IP`, `Forwarded`, `X-Forwarded-For`, `CF-Connecting-IP`) is strictly ignored, and `request.ip` is not used.
  - All requests share one single `"unknown"` bucket.
  - Rate limits are individually configurable via environment variables.
- **Configurable Rate Limit Envs** `[APPROVED]`:
  - `RATE_LIMIT_WINDOW_MS`: Window size in ms (default `900000` = 15 minutes).
  - `RATE_LIMIT_CREATE_MAX`: Max check creations per window (default `10`).
  - `RATE_LIMIT_CONFIRM_MAX`: Max check confirmations per window (default `10`).
  - `RATE_LIMIT_READ_MAX`: Max poll / report reads per window (default `60`).
  - `RATE_LIMIT_STREAM_MAX`: Max stream connections per window (default `10`).
- **`TRUST_PROXY=true` and `TRUSTED_PROXY_HOPS`** `[APPROVED]`:
  - Env variable: `TRUSTED_PROXY_HOPS` (integer, default `1`).
  - When `TRUST_PROXY=true`, parse `X-Forwarded-For` by splitting on commas, trimming each entry.
  - Count hops strictly from the **right**: select `parts[parts.length - TRUSTED_PROXY_HOPS]`.
  - **Security Rule**: NEVER take the leftmost entry (the client can prepend arbitrary spoofed IP addresses).
  - If `X-Forwarded-For` is missing, contains fewer entries than `TRUSTED_PROXY_HOPS`, or the parsed address is not a valid IPv4/IPv6, fall back to `"unknown"`.
  - **IPv6 Grouping**: Valid IPv6 client addresses are grouped by their `/64` prefix to prevent single-device prefix rotation attacks.

### Decision C4: Pre-Parsing Body Size Streaming Enforcement & Concurrency Memory Bounding `[APPROVED]`
- **Streaming Byte Counting**:
  - `request.formData()` buffers in memory. If a client transmits chunked transfer-encoding or lies about `Content-Length`, `request.formData()` could consume unbounded heap before timing out.
  - Solution: In `parseMultipart`, count bytes via a pass-through streaming reader (`request.body.getReader()`) checking total received bytes against `MAX_TOTAL_SIZE` (26 MB) *before* invoking `request.formData()` or reassembling. If chunked or missing `Content-Length` exceeds 26 MB, cancel reader and throw 413 `PAYLOAD_TOO_LARGE`.
  - Reassemble and build `FormData` from the bytes already read without reading the request body twice.
- **Peak Memory Bounding & Max Concurrent Creates** `[APPROVED]`:
  - Peak upload memory is bounded by: `MAX_CONCURRENT_CREATES * 26 MB`.
  - Introduce `MAX_CONCURRENT_CREATES` (default `2`, configurable in `lib/env.js`).
  - With a cap of 2 concurrent creates, maximum multipart in-flight heap buffer is strictly capped at `2 * 26 MB = 52 MB`. Creates exceeding the semaphore return 503 `SERVICE_UNAVAILABLE` with `Retry-After: 10`.

### Decision C5: Sharp Decompression-Bomb Protection (`MAX_INPUT_PIXELS` & `failOn`) `[APPROVED]`
- **Vulnerability**: Decompression-bomb images (e.g. 10 KB file with header declaring 50,000 x 50,000 pixels) cause sharp/libvips to attempt allocating gigabytes of RAM during decode.
- **Protection Parameters**:
  - Add constant `MAX_INPUT_PIXELS = 25_000_000` (25 million pixels = 5000 x 5000 max canvas) in `lib/uploads.js`.
  - Instantiate `sharp` with explicit defensive options:
    ```javascript
    sharp(buffer, {
      failOnError: true,
      failOn: "warning",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
    ```
  - Any image exceeding `limitInputPixels` or having truncated/corrupt streams is immediately rejected with typed error `{ ok: false, error: { code: "CORRUPTED_IMAGE", message: "Image exceeds pixel limit or is corrupted" } }`, which maps to 400 `BAD_REQUEST` in `createCheck`.

### Decision C6: SSE Wire Format & Payload Normalization
- **Strict Wire Specification**:
  - Initial connection handshake:
    ```
    retry: 3000
    data: {"type":"connected"}

    ```
  - Intermediate event frames:
    ```
    id: <integer>
    event: message
    data: {"type":"stage","stage":"Extraction started"}

    ```
    ```
    id: <integer>
    event: message
    data: {"type":"round","round":1,"status":"started"}

    ```
    ```
    id: <integer>
    event: message
    data: {"type":"agent","round":1,"agent":"message_analyst","status":"ok"}

    ```
  - Periodic keepalive frame (every 15s):
    ```
    : ping

    ```
  - Terminal event frame:
    ```
    id: <integer>
    event: message
    data: {"type":"complete","riskLevel":"high"}

    ```
- **Information Boundary**: Events carry fixed codes, round numbers, and status tokens only. Summary fields in SSE never reflect user message text, entity values, or local file paths.

### Decision C7: Route File Separation & Orchestration Delegation
- **Architectural Boundary**: App Router route files (`app/api/**/route.js`) MUST remain thin wrappers:
  1. Validate URL params and parse request payload through `lib/api/validate.js`.
  2. Call pure or service functions in `lib/api/` or `lib/db/`.
  3. Shape and return standard responses with `applySecurityHeaders()` and `noStoreHeaders()`.
- **Wiring Isolation**: Direct orchestration of `jobRunner`, `eventBus`, and coordinator event dispatching belongs in `lib/api/runtime.js` and `lib/api/jobs.js`. Route files must not wire ad-hoc event loops or internal coordinator listeners directly.

### Decision C8: Live HTTP Route Validation with Real Keys & Verification Table
- **Requirement for L6 Final Gate**:
  - In step `F2`, the gate must include a real live HTTP runner against the running App Router server with live API keys (using a defined budget limit).
  - The evaluation must output a structured table of `VERIFIED` and `NOT VERIFIED` items covering every route, status code, header, and rate limit.

