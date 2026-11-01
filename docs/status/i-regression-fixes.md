IDENTITY
task: i-regression-fixes
branch: main
worktree: /home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM
commits:
ac216c7 fix(eval): preserve OCR transcribed text during confirmation in regression suite
5d3968d fix(osint): protect official portals and schemes from impersonation reports unless specific identifier matches
fe48459 feat(eval): automate FP/FN detection and per-check search caching in regression suite
645a319 fix(osint): guard official bodies and portals against generic impersonation advisories
ac7b8b1 feat(ocr): add local OCR tool, multi-size benchmarks, and confirmation screen hint
f13e850 SHARED: extract: dual-reader image extraction with local OCR fine print union

OVERVIEW
Automated regression evaluation suite with dual-reader OCR (Tesseract + Sharp lanczos3 upscaling), official portal impersonation guards, automated FP/FN tracking, and per-check search budgets (cap 8 queries/check).
6 synthetic evaluation cases executed across 2 runs (Run 1 uncached, Run 2 cached).
Total budget used: 51/80 LLM calls, 35/60 uncached search calls, 35 cached hits on Run 2.

COMPACT MATRIX (6 / 6 MATCHED)
| Case ID | Expected | Run 1 Level (Score) | Run 2 Level (Score) | Flags (Run 1) | Traceable | FP | FN |
|---|---|---|---|---|---|---|---|
| gov-scholarship-2026 | High | HIGH (60) | HIGH (60) | authority_impersonation, scholarship_fee_demand | Yes | NO | NO |
| case2-genuine-scholarship-nsp | Low/CannotVerify | LOW (0) | LOW (0) | (none) | Yes | NO | NO |
| case3-fake-internship-tcs | High | HIGH (100) | HIGH (100) | fee_demand, lookalike_domain, personal_payment_id, ... | Yes | NO | NO |
| case4-telegram-task-job | High | HIGH (70) | HIGH (70) | classifier_high, task_deposit_script, off_platform_contact, pay_too_high | Yes | NO | NO |
| case5-google-no-identifiers | Medium/CannotVerify | MEDIUM (15) | MEDIUM (15) | no_interview_selection | Yes | NO | NO |
| case6-screenshot-hidden-fee | >= Medium | HIGH (65) | HIGH (65) | fee_demand, no_interview_selection, urgency_pressure, ... | Yes | NO | NO |

AGENT STATUS SUMMARY
- gov-scholarship-2026: classifier: ok, message: ok, official: ok, payment: ok, osint: ok, website: skipped
- case2-genuine-scholarship-nsp: classifier: ok, message: ok, official: ok, payment: ok, osint: ok, website: ok
- case3-fake-internship-tcs: classifier: ok, message: ok, official: ok, payment: ok, osint: ok, website: ok
- case4-telegram-task-job: classifier: ok, message: ok, official: skipped, payment: ok, osint: ok, website: skipped
- case5-google-no-identifiers: classifier: ok, message: ok, official: ok, payment: skipped, osint: ok, website: skipped
- case6-screenshot-hidden-fee: classifier: ok, message: ok, official: ok, payment: ok, osint: ok, website: skipped

LEDGER TRACEABILITY & FP / FN
- Ledger traceability: 100% traceable. Every emitted flag maps to a validated evidence ledger ID.
- False Positives: 0 (automated check: no case produced actual level above expected set).
- False Negatives: 0 (automated check: no case produced actual level below expected set).
- Mismatches: 0 / 6 (100% pass across uncached Run 1 and cached Run 2).

VERIFICATION
lint: npm run lint (passed, 0 errors, 0 warnings)
test suite: npm test (passed: 1019, failed: 0, skipped: 1)
build: npm run build (passed, 15/15 static pages, 0 errors)
benchmarks: tests/ocr-reader.test.js verified fine print capture across 24, 16, 12, 10, 8 pt & grey contrast

SHARED COMMITS
f13e850 SHARED: extract: dual-reader image extraction with local OCR fine print union (lib/extract.js)
