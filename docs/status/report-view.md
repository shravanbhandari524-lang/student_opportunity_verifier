IDENTITY: task report-view, branch main, worktree /home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM, HEAD aa8a06a, git status clean yes.
Commits for this task:
  95a64ce feat(report): add score breakdown and coverage grid to report endpoint and view
  aa8a06a fix(ui): add defensive null checks for report and score breakdown rendering

REQUIREMENTS:
1. Reproduce and report: final status in checks (report_ready, score 40, medium), row in reports exists, GET /api/checks/:id/report returns 200 with report & scoreBreakdown, check_events recorded cleanly: DONE.
2. Root cause identification: missing `const data = await res.json()` in fetchReport caught silently leaving report=null, combined with unguarded `report.flags`, `report.checklist`, and `report.riskLevel` accesses throwing TypeError during Next.js client hydration: DONE.
3. Fix root cause with test that reproduces it: DONE (tests/report-view.test.js with 8 unit & state tests).
4. Make report view impossible to be blank:
   - Score, level and confidence display fallback to check row even when report is missing or generating.
   - Deterministic fallback report built with [Automatic summary] saved to reports table on report writer failure.
   - Three explicit UI states implemented: generating (with progress indicator), failed (with plain reason + Retry button), and ready (full narrative report).
   - Defensive optional chaining (`report?.flags`, `report?.checklist`, etc.) prevents render crashes if any field is omitted: DONE.
5. Verification & Tests:
   - Unit tests for ready (200), fallback marked automatic summary (200), missing row (404), POST retry (200), and all 3 UI states.
   - dev server & headless verification of Google case: verified score (40/100), level (MEDIUM RISK), summary, 2 evidence flags, and 22-item checklist render with zero blank fields.

VERIFICATION:
lint: npm run lint -> pass (0 errors, 0 warnings).
unit tests: node --test tests/report-view.test.js -> 8 passed, 0 failed.
e2e tests: node --test tests/e2e-confirm-flow.test.js -> 1 passed, 0 failed.
build: npm run build -> pass (Next.js 15.5.28 optimized production build, 8 static/dynamic routes compiled).

EVIDENCE (Google Case: 0a6a6a82-ce30-4807-a87d-14abf843c9d2):
Status in checks: report_ready (Score: 40, Risk Level: medium, Confidence: high)
Reports table row: exists (5,753 bytes)
GET /api/checks/:id/report: 200 OK, keys: ['report', 'scoreBreakdown']
UI Rendered Output:
- Assessed Risk Level: MEDIUM RISK (40/100)
- Badge: 🤖 AUTOMATIC SUMMARY
- Summary: "[Automatic summary] Cautionary indicators were identified in this opportunity..."
- Flags (2): scam_reports_found (HIGH), brand_handle_lookalike (MEDIUM)
- Verified (2): UPI syntax valid (oksbi), Phone number valid format
- Action Checklist: 0 / 22 Completed with Copy Verification Checklist button

SHARED CHANGES:
- lib/report.js: support level fallback and automatic summary prefix in buildFallbackReport.
- lib/coordinator.js: pass checkId to generateReport.
- lib/db/index.js: preserve checkId foreign key in saveReport.

SECRETS CHECK:
- git diff and status clean; 0 secrets staged or committed; .env.local and data/app.db gitignored.
