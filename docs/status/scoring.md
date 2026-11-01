IDENTITY
task: scoring
branch: main
worktree: /home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM
HEAD: 3d9a132
git status clean: yes
commits:
3d9a132 fix(test): align mock search and coverage expectations in e2e and coordinator tests
ccbabad SHARED: scoring: calibrate coverage-based confidence on agent failure
6f8e5aa fix(cli): print evidence coverage in run-check and align scenario B search portal mock
1aa2973 feat(ui): add evidence coverage and improve-check card to report view
3fe1fa4 fix(report): add coverage and improveCheck to report writer and translations
31d97fe SHARED: scoring: implement evidence coverage, strict low gates, and brand channel rules
e5c72db SHARED: contracts: add coverage to ScoreResult and coverage plus improveCheck to Report
9806922 docs(architecture): update section 13 scoring order of operations and coverage contract
de1484f docs(prd): specify evidence coverage, strict low risk gates, and improveCheck in sections 10 and 11

REQUIREMENTS
1. Evidence coverage: DONE (de1484f, 9806922, e5c72db, 31d97fe; 5 signal types: message, payee, website, official sources, reputation; returned as coverage in ScoreResult and Report).
2. Strict Low Gate: DONE (31d97fe; Low allowed ONLY with no medium/high flag, >= 2 signal types checked, and positive verified signal or >= 3 checks completed with zero flags).
3. High/Medium Flag Baseline: DONE (31d97fe; any high flag -> at least Medium; any medium flag without positive verified signal -> at least Medium even if score < 25).
4. Thin Coverage: DONE (31d97fe; 0 flags with < 2 signal types checked -> cannot_verify with reason thin_coverage).
5. Big Brand / Institution Channel Safeguard: DONE (31d97fe; claimed known brand or scheme without official domain or with personal contact -> at least Medium via big_brand_no_official_channel).
6. Coverage-based Confidence: DONE (31d97fe, ccbabad; High only when >= 4 signal types checked and none failed; Medium for 2-3; Low for < 2 or critical failure; skipped never reduces confidence; failed agents reduce it; cannot_verify -> Low).
7. Rules Fired: DONE (31d97fe, 3fe1fa4; plain-language explanations for all scoring safeguards).
8. Report Contract & Writer: DONE (e5c72db, 3fe1fa4; added coverage & improveCheck in English and Hindi).
9. Report UI: DONE (1aa2973; app/check/[id]/page.js: "Evidence Coverage & Scope" card with checked/not-checked badges, action tips, and "Nothing found is not the same as safe" disclaimer).

DEVIATIONS
None. All rules implemented as pure, zero-I/O deterministic code in lib/scoring/ adhering to layer boundaries and contract-first workflows.

VERIFICATION
lint: npm run lint (passed, 0 errors, 0 warnings)
unit & integration tests: npm test (passed: 1013, failed: 0, skipped: 1)
scoring tests: node --test tests/scoring.test.js (passed: 43, failed: 0)
report tests: node --test tests/report.test.js (passed: 31, failed: 0)
coordinator tests: node --test tests/coordinator.test.js (passed: 38, failed: 0)
evaluation tests: node --test tests/evaluate.test.js (passed: 20, failed: 0)
build: npm run build (passed, compiled successfully in 6.2s, 15/15 static pages)

EVALUATION & LIVE RESULTS
1. Google-only sentence ("Congratulations, you are selected for an internship at Google."):
   - Level: MEDIUM (prevents false Low)
   - Score: 15/100, Confidence: medium
   - Coverage: checked: ["message", "official sources", "reputation"], notChecked: ["payee", "website"]
   - Rules Fired: ["big_brand_no_official_channel"]
   - Safeguard: Claimed big brand without official channel requires Medium risk.
2. Full Google case (with notes & personal UPI rahul.hr@oksbi):
   - Level: HIGH, Score: 100/100, Confidence: high
   - Flags: fee_demand, personal_payment_id, brand_handle_lookalike, no_interview_selection, off_platform_contact, scam_reports_found
   - Rules Fired: ["big_brand_no_official_channel"]
3. Offer letter text only with no flags:
   - Level: CANNOT_VERIFY, Score: 0/100, Confidence: low
   - Reason: thin_coverage (< 2 signal types checked)
4. Genuine notice with official domain (.gov.in):
   - Level: LOW, Score: 0/100, Confidence: high
   - Coverage: 4 signal types checked, verified official announcement confirmed
