# Phase 5b Pipeline Audit

**Date:** 2026-10-29  
**Scope:** Pipeline (`lib/extract.js`, `lib/coordinator.js`, report writer, cleanup job).

---

## 1. Audit Summary Table

| Item | Requirement | Status | File & Line Reference | Notes / Findings |
|---|---|---|---|---|
| 1 | **Coordinator:** Round loop (max 2), `canRun` eligibility, skipped vs `could_not_check`, 25s timeout, `Promise.allSettled`, single-writer, invalid results rejected | **DONE** | [`lib/coordinator.js:432`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/coordinator.js#L432), [`lib/coordinator.js:457`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/coordinator.js#L457), [`lib/coordinator.js:499-532`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/coordinator.js#L499), [`lib/coordinator.js:552`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/coordinator.js#L552), [`lib/coordinator.js:741`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/coordinator.js#L741), [`lib/coordinator.js:650`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/coordinator.js#L650), [`lib/coordinator.js:84-223`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/coordinator.js#L84) | Fully implemented: max 2 rounds; `canRun` per agent; skipped in round 1; `could_not_check` on failure; 25s per-agent cap; atomic `saveRoundResults`; schema and evidence verification in `sanitizeAgentResult`. |
| 2 | **Discovered entities:** Cap of 5 per agent per round, domain/handle/company only, evidence required, normalization & deduplication, source "discovered", SSRF guard | **DONE** | [`lib/agents/base.js:159-245`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/agents/base.js#L159), [`lib/coordinator.js:174-177`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/coordinator.js#L174), [`lib/coordinator.js:638-646`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/coordinator.js#L638) | Fully implemented in `limitNewEntities` and coordinator save logic. Strict SSRF host unwrapping and filter for allowed kinds. |
| 3 | **Classifier cap wiring:** Reads `data_provenance` and `real_row_count` from `/health`, passes `classifierMaxPoints` (10 if synthetic/mixed or real rows < 60, else 25) into scoring; `could_not_check` when service down | **PARTIAL** | [`lib/agents/classifier-client.js:75-108`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/agents/classifier-client.js#L75), [`lib/coordinator.js:761`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/coordinator.js#L761) | **Gap:** `classifier-client.js` calls `classifyFn` but does not check `/health` to inspect `data_provenance` and `real_row_count` or attach `classifierMaxPoints` to result trace. Coordinator calls `scoreCase(postRoundSnapshot)` without passing `{ classifierMaxPoints }`. |
| 4 | **Scoring integration:** `rulesFired` values (`exclusion:fee_equipment`, `correlation_cap:hiring_process`, `correlation_cap:pay`, `soft_flag_cap_applied`, `no_high_evidence_cap`) reach the saved report and are shown in plain language | **PARTIAL** | [`lib/report.js:244`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/report.js#L244), [`lib/report.js:267-324`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/report.js#L267), [`lib/report.js:536-575`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/report.js#L536) | **Gap:** `buildEvidencePack` captures `rulesFired` on `pack.rulesFired`, but neither `buildFallbackReport` nor `generateReport` translates these safeguard codes into plain language or includes them in the report summary. |
| 5 | **Report writer:** One `generate()` call; evidence & scoring result only; neutral wording for Medium ("some warning signs, verify these items", never "likely scam"); states when evidence is thin; "no reports found" never shown safe; zod-validated; risk level from scoring | **PARTIAL** | [`lib/report.js:584`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/report.js#L584), [`lib/report.js:282-294`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/report.js#L282), [`lib/report.js:440-492`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/report.js#L440), [`lib/report.js:540-575`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/report.js#L540) | **Gap:** `validateGeneratedText` does not reject "likely scam" if produced by LLM for Medium risk, and `generateReport` prompt does not explicitly instruct the model never to use "likely scam" for Medium risk. |
| 6 | **Checklist:** Contains manual items for `exec_dm_outreach`, `no_past_winners`, `no_video_contact`, `no_footprint`, `stale_site`, plus registry links (MCA, campus placement cell, public Reddit search); checklist items, never flags | **PARTIAL** | [`lib/report/checklist.js:10-192`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/report/checklist.js#L10), [`lib/report.js:325-358`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/report.js#L325), [`lib/report.js:614-637`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/report.js#L614) | **Gap:** `checklist.js` only contains flag-triggered items in `FLAG_CHECKLIST_MAP`. Manual items (`exec_dm_outreach`, `no_past_winners`, `no_video_contact`, `no_footprint`, `stale_site`) and registry links (MCA, placement cell, Reddit search) are missing from the checklist assembly. |
| 7 | **Extraction:** Regex entities, vision extraction per image, magic-byte check, resize, images deleted after extraction (also on failure), max 5 images of 5 MB | **DONE** | [`lib/extract.js:81-220`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/extract.js#L81), [`lib/extract.js:364-440`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/extract.js#L364), [`lib/uploads.js:78-90`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/uploads.js#L78), [`lib/uploads.js:107-133`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/uploads.js#L107), [`lib/extract.js:588-604`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/extract.js#L588), [`lib/contracts/submission.js:9,16`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/contracts/submission.js#L9) | Fully implemented: regex entity extraction, Sharp resize to 1600px, magic-bytes detection via `file-type`, `finally` unlinking and `clearInputFile`, 5 images x 5MB cap. |
| 8 | **Cleanup job:** Runs on startup and hourly; deletes expired checks & cascading children; graph rows & feedback persist | **DONE** | [`lib/api/startup.js:75-112`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/api/startup.js#L75), [`lib/cleanup.js:39-176`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/cleanup.js#L39), [`lib/db/index.js:1449-1495`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/db/index.js#L1449) | Fully implemented: `startBackgroundTasks` runs cleanup on startup and hourly with unref'd timer; `deleteExpired` cascades to inputs, entities, results, events, reports, and unlinks files while graph nodes/edges persist and feedback is disassociated. |
| 9 | **Progress events:** Round, stage, agent, and trace events emitted in order with monotonic seq | **DONE** | [`lib/coordinator.js:340-391`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/coordinator.js#L340), [`lib/db/index.js:928-936`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/db/index.js#L928) | Fully implemented: monotonic `seq` atomically assigned per check inside SQLite transaction in `appendEvent`; events emitted in strict order. |
| 10 | **Prompt injection:** Scam text with instructions, delimiters or "ignore previous instructions" cannot alter risk level, report fields, or case file | **DONE** | [`lib/llm/generate.js:wrapUntrusted`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/llm/generate.js#L31), [`lib/agents/message-analyst.js:253-275`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/agents/message-analyst.js#L253), [`lib/report.js:440-492`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/report.js#L440), [`lib/coordinator.js:761`](file:///home/shreyas_95/Documents/PROJECTS/MY%20PROJECTS/DEM/lib/coordinator.js#L761) | Fully implemented: delimiter escaping, deterministic scoring establishing facts, strict Zod schemas, untrusted wrappers, and safety checks. |

---

## 2. Identified Gaps & Remediation Plan

### Gap A: Classifier Cap Wiring (Item 3)
1. In `lib/agents/classifier-client.js`:
   - Query `classifierHealth(options)` (or `deps.classifierHealth`) prior to classification or as part of execution.
   - If `/health` is unreachable or returns `{ ok: false }`, return status `could_not_check` with reason `classifier_service_unavailable`.
   - Inspect `data_provenance` (or `datasetProvenance`) and `real_row_count` (or `real_test_metrics.row_count`).
   - Determine `classifierMaxPoints`: `10` if `provenance === "synthetic"` or `provenance === "mixed_synthetic_and_public"` or `real_row_count < 60`; otherwise `25`.
   - Record `{ check: "health", data_provenance, real_row_count, classifierMaxPoints }` in `trace[]`.
2. In `lib/coordinator.js`:
   - Prior to calling `scoreCase(postRoundSnapshot)`, inspect `classifier_client`'s ok finding trace for `classifierMaxPoints`.
   - Pass `{ classifierMaxPoints }` to `scoreCase(postRoundSnapshot, { classifierMaxPoints })`.

### Gap B: Scoring Integration & Explainable Safeguards in Report (Item 4)
1. In `lib/report.js`:
   - Create a helper mapping `rulesFired` codes to human-readable plain language explanations:
     - `"exclusion:fee_equipment"` -> `"Fee demand and equipment advance flags were mutually exclusive; only the higher-weighted fee demand was scored."`
     - `"correlation_cap:hiring_process"` -> `"Hiring process flags (chat interview, selection without interview, flexible hours) were correlated and capped at 20 points."`
     - `"correlation_cap:pay"` -> `"Compensation flags (unusually high pay, non-standard pay schedule) were correlated and capped at 20 points."`
     - `"soft_flag_cap_applied"` -> `"Total points from low and medium severity warning flags were capped at 45 points."`
     - `"no_high_evidence_cap"` -> `"Score was capped at 59 (Medium risk) because no high-severity flag, hard rule, or graph match was established."`
   - Incorporate these plain-language explanations into `summary` (both in `buildFallbackReport` and in `generateReport`).

### Gap C: Report Writer Neutral Wording for Medium Risk (Item 5)
1. In `lib/report.js`:
   - Add a safety check in `validateGeneratedText`: if `level === "medium"` and text contains `/likely\s+scam|probable\s+scam/i`, reject text and fall back to deterministic report.
   - Add prompt instruction in `generateReport`: for Medium risk, use neutral wording ("some warning signs were detected; verify these items before proceeding"), never "likely scam".

### Gap D: Manual Checklist Items & Registry Links (Item 6)
1. In `lib/report/checklist.js`:
   - Export `MANUAL_VERIFICATION_CHECKLIST`:
     - `exec_dm_outreach`: Executive/recruiter outreach verification on LinkedIn/corporate directory.
     - `no_video_contact`: Request verifiable video/in-person meeting before sharing documents.
     - `no_past_winners`: Verify past scholarship/competition recipients in institutional circulars.
     - `no_footprint`: Check corporate CIN and active status on MCA portal (`https://www.mca.gov.in/mcafoportal/viewCompanyMasterData.do`).
     - `stale_site`: Inspect website freshness, landline numbers, and grievance contacts.
     - Campus placement cell: Check with college placement cell regarding authorization.
     - Public Reddit search: Search student discussion forums and Reddit (`https://www.reddit.com/search`).
2. In `lib/report.js`:
   - Integrate these manual checklist items into `buildFallbackReport` and `generateReport` checklist assembly.
