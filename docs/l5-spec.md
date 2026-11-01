# L5 Specification: Pipeline & Orchestration

This document serves as the architectural decision record and design specification for **Layer L5 (Pipeline)** of the Student Opportunity Verifier. It details extraction, the coordinator, the report writer, cleanup, the CLI runner, gate criteria, and contract/document gaps.

---

## 1. Architectural Decisions (Decision Record)

### Decision 1: Image Upload Validation, Storage & Safe Deletion
- **Inputs & Limits:** Up to 5 image inputs per check, maximum 5 MB per file.
- **Magic-Byte Validation:** Verify uploaded buffers using `file-type`. Allow only `"image/png"` and `"image/jpeg"`. Reject SVG, GIF, WebP, executables, or corrupted files with `INVALID_INPUT` / `VALIDATION_ERROR`.
- **Image Resizing with Sharp:** Before sending images to the vision LLM, pass them through `sharp` to normalize and resize large screenshots (e.g. max dimension 1600px, preserve aspect ratio, convert to high-quality JPEG/PNG buffer). This minimizes network payload and LLM latency while maintaining legibility of chat text and logos.
- **Safe Storage & Deterministic Deletion:** Images are saved temporarily in `UPLOAD_DIR` (`./uploads` by default). In `runExtraction(checkId, deps)`, a `try ... finally` block ensures that all files referenced in `check_inputs` are unlinked via `fs.promises.unlink` or `fs.unlinkSync` once vision extraction completes (or fails). Upon deletion, the database row's `file_path` is set to `NULL` to prevent dangling references.

### Decision 2: Text Extraction & Entity Parsing Rules
- **Regex Extraction:** Extract entities from all combined user text and OCR/transcribed text:
  - `url`: Valid HTTP/HTTPS links (`https?://[^\s<>"'{}|\^~`\\]+`).
  - `domain`: Derived from extracted URLs (and user URLs) via `normalizeDomain`.
  - `email`: Standard email regex matching valid user@domain patterns.
  - `upi`: Lowercase alphanumeric pattern matching `^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{2,64}$`.
  - `phone`: Extracted via regex and validated into standard E.164 (`+91...`) format using `libphonenumber-js` with default country code `"IN"`.
  - `amount`: Cleaned digits-only string representing integer INR amounts (dropping `.00`).
- **UPI vs Email Disambiguation Rule:**
  - An `@`-address whose portion after `@` has **no dot** (e.g., `user@okaxis`, `merchant@okhdfcbank`, `payee@ybl`) is classified as `upi`.
  - An `@`-address whose portion after `@` **contains a dot** (e.g., `hr@google.com`, `scholarships@gov.in`) is classified as `email`.
  - *Ambiguous Cases:* If the portion after `@` matches a known UPI PSP handle from `lib/data/upi-handles.json` (even if it were to contain a dot), it is classified as `upi`. Otherwise, any string with a dot after `@` defaults to `email`. If neither conforms to a valid email or UPI regex, it is discarded.
- **Negative Rule:** There is strictly **no regex extraction** of `handle` or `company`. Companies and handles must come either directly from user form fields (`source: "user"`) or through vision extraction / agent discovery with verifiable evidence.
- **User-Supplied Fields:** Fields submitted in the initial form (`upiId`, `company`, `handle`, `phone`, `youtubeUrl`, `url`) become entities with `source: "user"`, `round: 0`, and `confirmed: true`.

### Decision 3: Vision LLM Screenshot Extraction
- **Call Structure:** One `generate()` call per image via `deps.generate`.
- **System & Prompt Safeguards:** The prompt wraps image data with instructions to transcribe text and extract specific entity candidates. The vision prompt is wrapped with `wrapUntrusted("SCREENSHOT_METADATA", ...)` instructions treating screenshot visuals as untrusted data.
- **Strict Vision Output Schema:**
  ```typescript
  z.object({
    transcribedText: z.string().default(""),
    senderLabel: z.string().nullable().optional(),
    urls: z.array(z.string()).default([]),
    amounts: z.array(z.string()).default([]),
    paymentIds: z.array(z.string()).default([]),
    organisationNames: z.array(z.string()).max(5).default([]),
  }).strict()
  ```
- **Organization Name Pruning:** Extracted `organisationNames` are capped at 5 per image and kept **only if** they appear verbatim (case-insensitive substring with collapsed whitespace via `quoteInText`) in `transcribedText`.
- **Non-Fatal Vision Failure:** A failure or timeout of the vision model on one or all images is treated as non-fatal. An event `{ type: "stage", stage: "extracting" }` is recorded, and the check still transitions to `awaiting_confirmation` with whatever entities were extracted from plain text or user fields.
- **Entity Cap:** Maximum 30 entities per check to prevent prompt bloat and resource exhaustion.

### Decision 4: Transcribed Text Storage & User Confirmation Flow [NEEDS APPROVAL: DB / Table Usage]
- **Storage of Transcribed Text:** Transcribed text from screenshots is saved into `check_inputs` as an input row of `type: "text"` with `value: transcribedText` (or appended to existing text inputs), with a note indicating OCR origin, ensuring `getMessageText(snapshot)` seamlessly picks it up for all downstream agents.
- **Confirmation Step (`POST /api/checks/:id/confirm`):**
  - The client submits the confirmed/edited entity list and any edits to the message text.
  - The coordinator / API handler executes `replaceEntities(checkId, confirmedEntities)` (marking them `confirmed: true`, `source: "user"` or `"extracted"`, `round: 0`).
  - If text was edited, it updates or adds a `check_inputs` row with `type: "text"`.
  - The check transitions from `awaiting_confirmation` to `investigating`.

### Decision 5: Coordinator Lifecycle & Execution Loop
- **Functions:**
  - `runExtraction(checkId, deps)`: Coordinates file validation, regex extraction, vision OCR, image cleanup, input storage, entity deduplication, and transitions `created -> extracting -> awaiting_confirmation`.
  - `runInvestigation(checkId, deps)`: Coordinates the 2-round agent loop, scoring, report generation, and transitions `investigating -> scoring -> report_ready`.
- **Round Loop (Max 2 Rounds):**
  - **Round 1:** Loads case file snapshot. Evaluates `canRun(snapshot)` for all 6 registered agents. Runs all eligible agents concurrently via `Promise.allSettled`.
  - **Timeout:** Each agent executes with a 25-second timeout (`AGENT_TIMEOUT_MS = 25000`). Total investigation timeout cap: 60 seconds.
  - **Single-Writer Rule:** Agents return `AgentResult`. Only the coordinator writes to SQLite via `saveAgentResult` and `replaceEntities`.
  - **Result Validation:** Every result is validated against `AgentResultSchema`. If an agent throws or returns an invalid result, the coordinator converts it to `status: "could_not_check"`, `reason: "invalid_agent_result"`, with empty arrays.
  - **Round 2 Eligibility & Discovered Entities:**
    - Coordinator collects `newEntities` from Round 1 `ok` results (capped at 5 per agent per round, kinds `domain`, `handle`, `company` only, with evidence).
    - Checks SSRF on discovered domains via `parseAndUnwrapIp`/`isForbiddenIp`.
    - Merges deduplicated discovered entities into SQLite with `source: "discovered"`, `round: 1`, `confirmed: false`.
    - Evaluates `canRun(snapshotRound2)`. Only agents that are newly eligible based on newly discovered entities run in Round 2.
- **Dependency Injection:** The coordinator builds production dependencies once:
  - `search`: default `search` tool with query budget.
  - `readPage`: safe `fetchPage` tool.
  - `generate`: default `generate` function.
  - `classify`: `classifyText` HTTP client.
  - `graphLookup`: `(kind, value) => lookup(kind, value, { db })` bound to the database.
  - `now`: `() => Date.now()`.
- **Status Machine & Failure Rule:** `status: "failed"` is reserved strictly for unrecoverable errors (e.g. database corruption, missing check). Agent failures, tool timeouts, or thin evidence degrade gracefully to `could_not_check` and `cannot_verify`.

### Decision 6: Report Writer & Evidence Pack
- **Deterministic Input (Evidence Pack):** Built purely in code from `findings` and `ScoreResult`.
- **Division of Ownership:**
  - **Deterministic Code Owns:** `riskLevel`, `score`, `confidence`, `flags` (ordered by score points descending), `verified`, `couldNotCheck`, `notApplicable`, `checklist` base items (including `manual_check` URLs from trace), `actions`, `disclaimer`.
  - **LLM (`generate`) Owns:** `summary` in the requested language (`"en"` or `"hi"`), `scamTypeGuess` (from the enum), plain-language explanations per flag in the requested language, and up to 5 additional tailored checklist recommendations tied to specific flag IDs.
- **Fact-checked Wording for Tool Evidence:** Flags `ssl_anomaly` and `lookalike_domain` reference the inspected website itself as evidence URL. The prompt and fallback templates instruct the model to report them as verified technical facts.
- **Banned Phrases & Post-Validation:** Banned phrases (e.g. "is safe", "guaranteed genuine", "is a scammer", "criminal") trigger rejection.
- **Deterministic Fallback:** If `generate()` fails, times out, or returns invalid schema after retry, a deterministic English fallback report is assembled directly from flag titles, scoring reasons, and default checklist actions.
- **Hindi Translation:** When `language === "hi"`, the prompt instructs `generate` to produce `summary`, flag explanations, and checklist items in Hindi, while preserving URLs, technical terms, and identifier values verbatim. If Hindi generation fails, the deterministic fallback uses predefined bilingual templates.

### Decision 7: Maintenance & Cleanup Service (`lib/cleanup.js`)
- `cleanupDatabase({ uploadsDir, db })`:
  1. Calls `deleteExpired(uploadsDir, db)` to purge checks older than 24 hours and unlink associated uploads.
  2. Calls `purgeCache(db)` to remove expired `lookup_cache` rows.
  3. Scans `uploadsDir` for orphaned image files not tracked in `check_inputs` older than 1 hour and unlinks them.
- Returns `{ deletedChecks, deletedFiles, purgedCacheEntries, orphanFilesRemoved }`.

### Decision 8: Offline Test Runner (`scripts/run-check.js`)
- Runs a full end-to-end check from input to report.
- By default, runs completely offline using fixtures or local stub dependencies without making network or LLM calls.
- Supports `--live` flag for live external integration testing with a self-written fake message.
- Exits with `0` on success, `1` on validation or scoring failure.

---

## 2. L5 Gate Verification Criteria
A layer is done only when all of the following hold:
1. `npm test` passes all tests (including new extraction, coordinator, report, and cleanup tests).
2. `npm run lint` passes with 0 errors and 0 warnings.
3. `npm run build` compiles successfully.
4. `npm run score:fixtures` passes all scenarios.
5. `npm run agents:run` passes all scenarios.
6. `node scripts/run-check.js` executes successfully end-to-end and outputs a validated report.
7. README.md and AGENTS.md layer status lists are updated.

---

## 3. Contract and Documentation Gaps

### Proposed Changes [NEEDS APPROVAL]

1. **`lib/contracts/report.js` vs PRD Section 11 & docs/contracts.md:**
   - *Gap:* `ReportSchema` in `lib/contracts/report.js` currently defines:
     `{ id, checkId, riskLevel, confidence, summary, flags, verifiedFindings, whatToVerifyNext, explanation, createdAt }`.
     However, PRD Section 11 and `docs/contracts.md` (§3.9) define:
     `{ checkId, riskLevel, score, confidence, scamTypeGuess, language, summary, flags, verified, couldNotCheck, notApplicable, checklist, actions, disclaimer, generatedAt }`.
   - *Discrepancies:*
     - `score` is missing from `ReportSchema`.
     - `scamTypeGuess` is missing from `ReportSchema`.
     - `language` is missing from `ReportSchema`.
     - `couldNotCheck` and `notApplicable` are missing from `ReportSchema`.
     - `verifiedFindings` vs `verified` naming mismatch.
     - `whatToVerifyNext` vs `checklist` naming and subfield mismatch (`step`/`description` vs `text`/`url`).
     - `actions` and `disclaimer` are missing from `ReportSchema`.
     - `explanation` in schema is redundant with `summary` and per-flag explanations.
   - *Recommendation:* Align `ReportSchema` with PRD Section 11 and `docs/contracts.md` (§3.9), update fixtures in `lib/contracts/fixtures/`, and update `lib/db/index.js` `saveReport` if necessary.

2. **`lib/contracts/submission.js` vs `sharp` and Magic-Bytes:**
   - *Gap:* `CheckSubmissionSchema` accepts `images: z.array(z.object({ filename, mimeType, sizeBytes }))`. In a live HTTP multipart upload, the binary stream must be validated against `file-type` magic bytes.
   - *Recommendation:* Keep `CheckSubmissionSchema` as the contract for JSON payloads, and define `ImageUploadSchema` or extraction input validator that validates the binary buffer and magic bytes.

3. **Database Schema for Transcribed OCR Text:**
   - *Gap:* `check_inputs` has columns `(id, check_id, type, value, file_path, mime_type, size_bytes, created_at)`.
   - *Proposal:* Store OCR output as an input row with `type: "text"` and `value: transcribedText`. This requires no schema migrations and allows `getMessageText(snapshot)` to automatically include screenshot text.

---

## 4. Open Questions for User
1. **Report Schema Harmonization:** Should we update `lib/contracts/report.js` to match PRD Section 11 and `docs/contracts.md` §3.9 (`score`, `scamTypeGuess`, `language`, `couldNotCheck`, `notApplicable`, `checklist`, `actions`, `disclaimer`, `generatedAt`), or maintain the minimal provisional `ReportSchema`? (Recommended: update contract first in Step B/C with approval).
2. **Entity Cap:** We propose a hard cap of 30 entities per check across text, images, and discovery. Does this limit meet expected user workloads?
3. **OCR Text Edits:** During `awaiting_confirmation`, should users be allowed to edit the raw transcribed text in addition to editing/confirming extracted entities? (Recommended: yes, saving the edited text as the primary `text` input row).
