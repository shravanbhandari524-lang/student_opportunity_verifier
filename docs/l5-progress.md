# Layer L5 (Pipeline) Progress Log

| Step | Scope / Title | Commit | Status | Verification Command |
|---|---|---|---|---|
| **L5-A** | Audit, L5 spec, contract gap list (docs only) | `9525def` | Complete | Preflight checks & spec audit |
| **L5-B** | Extraction pipeline (`lib/extract.js`, `lib/uploads.js`) & unit tests | `54b9218` | Complete | `npm test && npm run lint && npm run build` (322/322 pass) |
| **L5-B2** | Extraction verification, false-positive guard, entity caps, and hardening | `c7d6569` | Complete | `node --test tests/extract.test.js && npm test` (326/326 pass) |
| **L5-B3** | Fix sentence-break guard in `lib/extract.js` to preserve uppercase and titlecase domains | `a2e29c4` | Complete | `node --test tests/extract.test.js && npm test` (340/340 pass) |
| **L5-C** | Report writer (`lib/report.js`, `lib/report/`), contract alignment, unit tests | `0b8358f` | Complete | `node --test tests/report.test.js && npm test` (339/339 pass) |
| **L5-C2** | Verify report writer, dynamic flag summaries, couldNotCheck merging, unverified reporting channels | `a03c19d` | Complete | `node --test tests/report.test.js && npm test` (349/349 pass) |
| **L5-F1** | Follow-up fixes: uppercase domains, free-provider email filtering, real agent trace failure shapes | `51df7c9` | Complete | `npm test && npm run lint && npm run build` (351/351 pass) |
| **L5-D** | Coordinator (`lib/coordinator.js`) & round execution | `f626ae7` | Complete | `npm test && npm run lint && npm run build && npm run agents:run` (363/363 pass) |
| **L5-D2** | Coordinator verification & hardening: budget wrapper, atomic saveRoundResults, safe events, canEmit, resume | `cbc114e` | Complete | `node --test tests/coordinator.test.js && npm test` (369/369 pass) |
| **L5-D3** | Coordinator evidence gaps: rows a-m tests, post-cap search guard, simultaneous start protection | `7c9bc5f` | Complete | `node --test tests/coordinator.test.js && npm test` (382/382 pass) |
| **L5-E** | Cleanup (`lib/cleanup.js`), CLI runner (`scripts/run-check.js`), L5 gate | `4b53991` | Complete | `npm run check:run && npm test && npm run lint` (395/395 pass) |
| **L5-E2** | Gate verification & live runs: search cap assertions, concurrency assertions, printed timeline, `--live-scenario` support | `8906678` | Complete | `npm run check:run && npm run check:live` & gate checks |

## Layer L5 Status
Complete. All components of Layer L5 (extraction, report writer, coordinator with multi-round loop and single-writer rule, cleanup service, offline fixture runner, live test runner across genuine and scam scenarios) are implemented, verified, and passing all gate criteria.

### Localization Note
Report localization strings (Hindi and English) live in `lib/report/constants.js` and `lib/report/checklist.js`.

### Notes for Layer L6 Wiring
- **Confirmation Route (`POST /api/checks/:id/confirm`):** Will call `saveConfirmation(checkId, { texts, entities })` and trigger `runInvestigation(checkId)`.
- **SSE Stream (`GET /api/checks/:id/events`):** Wire SSE event producer to coordinator's `onEvent` hook callback.
- **Cleanup Scheduling:** Periodic invocation of `runCleanup({ uploadDir })` on server startup and hourly interval belongs to L6 server initialization.
- **Rate Limiting:** Enforce submission limits at API route entrypoint.


