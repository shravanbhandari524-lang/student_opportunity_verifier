IDENTITY
task: h-fixups
branch: main
worktree: /home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM
HEAD: 9dcbf04 fix(osint): enforce full scheme name matching and filter generic gov articles
git status clean: yes
commits:
9dcbf04 fix(osint): enforce full scheme name matching and filter generic gov articles
e78d4c6 SHARED: scheme precision filter for generic terms and portal fragments in extraction
74b8ce3 fix(report): add snake_case top-level aliases and increase report timeout to prevent unnecessary fallback
1b96caa fix(api): preserve message text and entity metadata on confirmation
7dcb0ed feat(classifier): add train script, dev:all auto-train, and formal held-out provenance
0fd6c69 Merge branch 'feature/classifier-formal-scams' into main

REQUIREMENTS
1. Classifier formal scams: merged into main; added npm run classifier:train, auto-train on missing model in dev:all & README, marked formal held-out as synthetic author-written provenance in metrics.json.
2. Check discrepancy: fixed text & entity metadata wipe in saveConfirmation and confirm route; API & CLI produce identical Score 100 High results.
3. Report writer: fixed unnecessary fallback by preprocessing snake_case top-level aliases and increasing timeout.
4. Scheme precision: filterSchemes drops generic fragments, portal names, and substring schemes; OSINT matches only on full scheme name; false scam_reports_found eliminated.
5. Verification: lint, 1001 tests, and next build pass; parity confirmed across CLI and API runs.

VERIFICATION
lint: npm run lint (passed, 0 errors, 0 warnings)
full test suite: node --test $(find tests -name "*.test.js" ! -name "e2e-confirm-flow.test.js") (passed: 1001, failed: 0, skipped: 0)
build: npm run build (passed, 15/15 static pages, 0 errors)
classifier probability: 0.8212 suspicious for gov scholarship test message

PARITY RESULTS (Google Case)
CLI Path: Score 100 (high), Coverage 6/6, Flags: brand_handle_lookalike, classifier_high, fee_demand, no_interview_selection, off_platform_contact, personal_payment_id, scam_reports_found
API Path: Score 100 (high), Coverage 6/6, Flags: brand_handle_lookalike, classifier_high, fee_demand, no_interview_selection, off_platform_contact, personal_payment_id, scam_reports_found
Score Parity: true | Level Parity: true | Flags Parity: true

GOV SCHOLARSHIP MESSAGE RESULTS
Score: 60 (high), Coverage 6/6, Scheme: "National Student Digital Empowerment Scholarship 2026" (1 scheme, 0 portal fragments)
OSINT Flag: None (0 false scam reports, 2 search snippets checked without full scheme name)
Message Analyst Flag: scholarship_fee_demand

SHARED CHANGES
e78d4c6 SHARED: scheme precision filter for generic terms and portal fragments in extraction (lib/extract.js)
