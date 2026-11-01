IDENTITY
task: g3b
branch: main
worktree: /home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM
HEAD: e53e794 docs(status): add g3b status document
git status clean: yes
commits:
21f2c7d fix(ui): deduplicate report polling requests and handle 429 retry in check page
6a512d3 SHARED: score: preserve zero-IO purity in scam_reports_found weighting
aecb46d feat(ui): display source type labels next to evidence links in report and drawer
827a31a feat(evidence): add source classifier and evidence quality weighting for scam reports
794a7cf fix(ledger): fix mapping bugs, restrict agent signals, and enforce evidence invariants

REQUIREMENTS & IMPLEMENTATION
1. Ledger mapping: fixed entityStatus & signal mapping; message_analyst restricted from domain/official signals; amounts skipped from verification; contradicted strictly requires authoritative URL; high confidence reserved for deterministic/authoritative evidence.
2. Evidence quality (scam_reports_found): classifySource categorizes authoritative, complaint, forum, aggregator, unrelated. Full weight (25 pts) only for authoritative/complaint; forum/aggregators capped at 10 pts; unrelated dropped/0 pts.
3. Source type labels: badge labels (Authoritative, Consumer Complaint, Community Forum, Caller ID, Source) rendered next to all external evidence links in report and agent drawer.
4. Live cases: Gov Scholarship: score 60 High (hard rule), 0 false contradicted, reconciliation explains model vs fee demand. Google case: score 100 High, 12 ledger entries, truecaller low conf, phone/upi high conf.
5. Verification: E2E confirm flow passed against dev server; lint, 1007 tests, and next build passed cleanly.

VERIFICATION
lint: npm run lint (passed, 0 errors, 0 warnings)
full test suite: npm test (passed: 1007, failed: 0, skipped: 0)
e2e: node --test tests/e2e-confirm-flow.test.js (passed: 1, failed: 0, 18.1s)
build: npm run build (passed, 15/15 static pages, 0 errors)

LIVE RUN EVIDENCE & RECONCILIATION
Gov Scholarship Case:
- Ledger: ml_probability (benign, conf=low), fee_demand (flagged, conf=med), authority_impersonation (flagged, conf=med).
- Score: 60/100 (high) via hard rule scholarship_fee_demand. Classifier p: 0.0463.
- Contradiction: "The ML model rated this message 5% scam-like, but message analysis found a deposit demand. Evidence from the message text outweighs the model."
Google Case:
- Ledger: 12 entries. Truecaller low conf, UPI/phone high conf, domain/lookalike/recruitment flags present.
- Score: 100/100 (high). Classifier p: 0.9988.
- Corroboration: ML model corroborates predatory signals identified by message analyst.

DROPPED RESULTS (Gov Scholarship Case)
- "National Scholarship Portal - CBI FIR Registration Details" (Dropped: lacks full scheme name or identifier match).
- "Press Information Bureau - Fact Check on Fake PM Schemes" (Dropped: generic advisory without exact scheme match).

SHARED CHANGES
6a512d3 SHARED: score: preserve zero-IO purity in scam_reports_found weighting (lib/scoring/score.js)
