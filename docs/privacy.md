# Privacy and Data Retention Specification

## 1. Data Inventory

The Opportunity Verifier system manages strictly bounded data lifecycles across its database tables, filesystem artifacts, runtime logs, and external service calls.

| Asset / Location | Data Elements Stored | Retention Period | Deletion Mechanism | Access Control |
|---|---|---|---|---|
| **`checks` table** | `id` (UUID), `status`, `language`, `risk_level`, `score`, `confidence`, `created_at`, `expires_at` | 24 hours | Hard delete via `deleteExpired` in `lib/db/index.js` invoked by periodic/ops cleanup `lib/cleanup.js` | Backend API / internal jobs only |
| **`check_inputs` table** | User text, submitted URLs, handles, phones, UPI IDs, file paths | 24 hours | Foreign key cascade deletion (`ON DELETE CASCADE`) when parent check row is deleted | Backend API / internal jobs only |
| **`entities` table** | Normalized entities (domains, handles, UPIs, phones, emails, amounts) | 24 hours | Foreign key cascade deletion (`ON DELETE CASCADE`) when parent check row is deleted | Coordinator and internal agents |
| **`agent_results` table** | Findings, evidence quotes, execution traces, notes, classifier outputs | 24 hours | Foreign key cascade deletion (`ON DELETE CASCADE`) when parent check row is deleted | Coordinator and scoring engine |
| **`reports` table** | Structured risk report (score, level, confidence, summary, flags, checklist) | 24 hours | Foreign key cascade deletion (`ON DELETE CASCADE`) when parent check row is deleted | Read via `GET /api/checks/:id/report` with check ID |
| **`feedback` table** | Anonymous feedback (`verdict`, redacted comment, timestamp, `check_id`) | Indefinite (anonymized) | On 24h check expiration, `check_id` is set to `NULL` via `ON DELETE SET NULL`. PII in comments is redacted on ingestion. | Operations and evaluation audit |
| **`graph_nodes` & `graph_edges`** | Verified scam identifiers (`upi`, `phone`, `domain`, `bank_account`), co-occurrence edges | Indefinite | Retained across check expirations; purged only upon verified false positive dispute | Scoring and graph lookup tool |
| **`uploads/` directory** | Transient screenshot files (`.png`, `.jpg`) with mode `0o600` | Transient (<1 hour, max 24h) | Unlinked immediately after OCR extraction or purged by cleanup routine | Local server process only |
| **`.recordings/` directory** | Deterministic session recordings for testing and offline evaluation | Development/test duration (gitignored) | Manual purge or test directory teardown | Local test runner only |
| **`data/eval/reports/`** | Evaluation summaries, confusion matrices, aggregate accuracy metrics | Indefinite (committed/archived) | Manual deletion | Project maintainers |
| **Runtime Logs (Pino)** | `requestId`, `route`, `status`, `durationMs`, `errorName` | Ephemeral (standard container stdout) | Stream rotation | System administrator |

---

## 2. Retention Rules

1. **24-Hour Check Expiration**:
   - Every submitted check is timestamped with `expires_at = created_at + 24 hours`.
   - The automated cleanup runner `runCleanup({ db, uploadDir })` calls `deleteExpired(now, db)`.
   - SQLite enforces `PRAGMA foreign_keys = ON;`, ensuring that deleting a check row cascades atomically to delete all associated records in `check_inputs`, `entities`, `agent_results`, and `reports`.
2. **Transient Upload Removal**:
   - Uploaded screenshot files are stored under unguessable UUID names with strict `0o600` file permissions.
   - After vision/OCR extraction completes, image files are unlinked.
   - Any orphaned image file older than 1 hour is automatically purged by `cleanupUploads(uploadDir, maxAgeMs)`.
3. **Identifier Longevity in Graph**:
   - Only verified identifiers (`upi`, `phone`, `domain`, `bank_account`) from checks that reached `high` risk, where the user provided explicit `consent: true` via `POST /api/checks/:id/save-to-graph`, are recorded into `graph_nodes` and `graph_edges`.
   - Raw user text, messages, personal names, and candidate phone numbers that are not part of an established high-risk scam cluster are NEVER added to the graph.

---

## 3. User Consent Points

The system enforces three explicit consent boundaries:

1. **Submission Consent (`POST /api/checks`)**:
   - The user must explicitly indicate `consent: true` (or form field `"true"` / `"1"`).
   - This authorizes the processing of the submission text, URLs, and screenshots for opportunity verification.
2. **Investigation Confirmation (`POST /api/checks/:id/confirm`)**:
   - After extraction, the user reviews and confirms which extracted entities and text blocks should proceed into investigation.
3. **Graph Intelligence Sharing (`POST /api/checks/:id/save-to-graph`)**:
   - Saving suspicious identifiers to the shared graph requires a separate explicit request with `{ consent: true }`.
   - This consent is strictly rejected unless the check report has status `report_ready` and reached `high` risk.

---

## 4. Third-Party Services and Privacy Considerations

The system interacts with external services solely to gather public objective evidence:

- **Model Providers (Gemini API / LLM)**:
  - Invoked for text extraction from images, message analysis, and report generation.
  - **Free Tier Warning**: Public free-tier model API endpoints may log inputs and use prompt text for model training and product improvement. Under standard enterprise or commercial API terms, data is not retained for training. **Never send real confidential user data through free-tier model API endpoints.**
- **Search Providers (SerpApi / Google Dorks)**:
  - Queries are sanitized and stripped of private user identifiers before execution.
  - Exclusively public scam keywords, brand names, and domain lookups are performed.
- **RDAP, DNS, SSL, Wayback, URLhaus, and URLscan**:
  - Only public domain names and hostnames extracted from offers are queried.
  - Personal student identity information is never passed to threat intelligence endpoints.

---

## 5. Deletion Mechanism and Verification

The deletion routine is implemented in `lib/cleanup.js` and verified by `scripts/privacy-check.js`:

```javascript
// Invoked by periodic maintenance cron or test harnesses
const summary = await runCleanup({
  db,
  uploadDir: env.UPLOAD_DIR,
  recordingsDir: env.RECORD_REPLAY_DIR,
  maxUploadAgeMs: 60 * 60 * 1000, // 1 hour
});
```

When run:
- Expired checks and all dependent relational rows are purged.
- Uploaded files older than 1 hour are unlinked from disk.
- Cache entries older than TTL are cleared.

---

## 6. What Is NOT Stored

To minimize risk and uphold user privacy:
- **No Raw Images Stored Long-Term**: Images are processed in transient memory/disk and deleted immediately.
- **No Personal Biometrics or ID Cards**: Personal identity cards (Aadhaar, PAN, voter ID) are never requested, stored, or indexed.
- **No Social Media Scraping**: The system does not scrape or crawl private Facebook, Instagram, or LinkedIn profiles.
- **No Real User PII in Logs**: The structured logger explicitly suppresses raw text, phone numbers, email addresses, and UPI IDs.
- **No Permanent Check Linkage in Feedback**: When a check expires after 24 hours, any submitted user feedback has its `check_id` set to `NULL`, dissociating the comment from the original submission.

---

## 7. India Digital Personal Data Protection (DPDP) Act 2023 Disclaimer

> [!NOTE] Regulatory Notice
> This project implements strict technical privacy safeguards, including transient data storage, automated 24-hour retention deletion, PII redaction, and multi-tier explicit consent.
> However, compliance with the India Digital Personal Data Protection Act, 2023 (DPDP Act 2023) and related data protection frameworks requires comprehensive legal review of terms of service, data fiduciary obligations, grievance redressal mechanisms, and cross-border data transfer policies before any public production deployment.
> Nothing in this document or codebase constitutes legal advice or a formal legal certification of DPDP compliance.
