1. IDENTITY
branch: main | HEAD: eb40a0d67b4fbd9dd1a8c4cddce18d418fea6b04 | git status: clean
worktrees:
  /home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM              eb40a0d [main]
  /home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM-a-classifier d63b9b6 [feature/activity-classifier]
  /home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM-a-domain     f14e07a [feature/activity-domain]
  /home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM-a-message    36c3536 [feature/activity-message]
  /home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM-a-official   f752f0e [feature/activity-official]
  /home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM-a-osint      92f34a8 [feature/activity-osint]
  /home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM-a-payment    041aee6 [feature/activity-payment]
branches merged to main: backup-before-secret-cleanup, backup/accidental-l3, main
last 25 commits:
  eb40a0d docs: add activity-log status report in docs/status/activity-log.md
  148d0c1 fix(api): route live activity events query through lib/db listEventsAfter
  dff8b5f feat(ui): implement six interactive agent cards, live SSE activity stream, and inspection drawer
  2111998 feat(api): add GET /api/checks/:id/agents endpoint and test suite
  03b3e1d SHARED: coordinator activity recorder integration, live SSE emit, and fallback synthesis
  8d51c4f SHARED: add activity to EVENT_TYPES and enhance activity recorder helper
  046b38b friday afternoon
  0cfdbd2 SHARED: implement createActivityRecorder helper with caps and live forwarding
  7d560ee feat(db): migration 007 add activity_json and summary to agent_results
  a4f075f SHARED: add summary and activity to AgentResult contract and trace events
  c52139b SHARED: document agent activity log contract and UI activation
  a91eaeb docs: add merge status report in docs/status/merge.md
  645c374 feat(cli): support custom input flags and detailed result breakdown in run-check live mode
  43ed48e Merge branch 'fix/official-verifier' into main
  52cf8bb Merge branch 'fix/osint' into main
  9696d5d Merge branch 'fix/payment-upi' into main
  dcf2c21 Merge branch 'fix/classifier' into main
  19cb7bd docs(audits): update domain-forensics audit with resolution details and benchmark results
  0208c38 fix(website-forensics): parallelize domain checks, handle raw IP URLs, fix URLhaus unconfigured noise, and record failed checks in unchecked
  70937ce docs(osint): document post-fix live rerun results matrix in audit report
  50c3f5f fix(official-verifier): verify curated domains, detect advisories, check ownership mismatch, and support schemes
  14d342d docs(osint): add deferred YouTube comment analysis tool ticket to README
  8ba5ff4 fix(osint): big brand relevance, budget starvation, and LLM failure fallback
  a45b01d fix(website-forensics): ensure hostHasSuccess requires real tool success for offline invariant
  7498c09 SHARED: register raw_ip_opportunity_link flag (medium, weight 20) with scoring and checklist
status files confirmation: docs/status/merge.md [exists], docs/status/activity-log.md [exists], docs/status/c1..c6 [exist in worktrees]. All report DONE on requirements (0 PARTIAL/NOT DONE).
copied KNOWN ISSUES lines:
  merge.md: During live run, official_verifier and report_generation each encountered a schema validation error on initial attempt before fallback/retry succeeded. URLhaus tool skips lookup when URLHAUS_AUTH_KEY is unconfigured. Truecaller/phone search relies on live search dorks which vary over time.
  activity-log.md: When a check is in investigating state before an uninstrumented agent finishes or emits events, its live card activity list remains empty until the round settles and coordinator fallback synthesis populates it. Mobile drawer uses standard 85vh height constraint.
  c1-c6 worktrees: classifier needs port 8000 daemon; 2 false pos/neg on heldout eval; outbound network egress restricted in sandbox; YouTube comment analysis tool unconfigured; no public NPCI lookup API.

2. CHECKS
lint: npm run lint -> pass (0 errors, 0 warnings).
tests: npm test -> 882 tests, 53 suites, 881 pass, 0 fail, 1 skipped (31.9s duration).
build: npm run build -> pass (Next.js 15.5.28 compiled successfully in 7.8s, 8/8 routes generated).
migrations: fresh DB and copy of data/app.db both pass cleanly (5/5 tests in tests/migrations.test.js pass).
secrets check: scanned git history with regex; no active keys in repository; .env.local and data/app.db untracked and gitignored.

3. END-TO-END (Real LLM and search, no cache)
Run 1 (Internship text + @google_hr_careers + notes + rahul.hr@oksbi + phone):
entities: [handle] "google_hr_careers" (platform: instagram, src: user) | [upi] "rahul.hr@oksbi" (src: extracted) | [phone] "+919876543210" (src: extracted) | [amount] "500" (src: extracted) | [company] "Google" (src: extracted)
agents:
  Message & Offer Analyst: ok | - | "Identified 3 red flag(s)." | act: 3 | flags: [no_interview_selection:medium, fee_demand:high, off_platform_contact:low] | unchecked: 0 | manual: 0
  ML Scam Classifier: ok | - | "classifierMaxPoints=10. Classifier probability is an informational model output..." | act: 1 | flags: [classifier_high:medium] | unchecked: 0 | manual: 0
  Domain & Web Forensics: skipped | no_applicable_input | "Check skipped: No link or domain was found. Add a link or website to run this check." | act: 1 | flags: [] | unchecked: 0 | manual: 0
  Payment & UPI Verifier: ok | - | "Identified 1 risk factor(s) across payment and entity identifiers. Search checks returned no public complaints..." | act: 4 | flags: [personal_payment_id:high] | unchecked: 0 | manual: 0
  Official Registry Verifier: could_not_check | all_checks_failed | "all_checks_failed" | act: 1 | flags: [] | unchecked: 0 | manual: 0
  Community & OSINT Search: ok | - | "Generic public scam warnings exist regarding parties impersonating Google, but no complaints specific to this offer were corroborated" | act: 2 | flags: [] | unchecked: 0 | manual: 1
first 6 activity titles:
  Message & Offer Analyst: "No Interview Selection", "Fee Demand", "Off Platform Contact"
  ML Scam Classifier: "Classifier High"
  Domain & Web Forensics: "Check skipped"
  Payment & UPI Verifier: "Ingested 3 item(s)", "Personal Payment Id", "UPI syntax valid (oksbi)", "Phone number valid format"
  Official Registry Verifier: "Could not complete check"
  Community & OSINT Search: "Ingested 2 item(s)", "Manual check: Trustpilot review search for Google"
score: 90/100 | level: HIGH | confidence: high | rules fired: []

Run 2 (Only text: "Congratulations, you are selected for an internship at Google."):
entities: [company] "Google" (src: extracted)
agents:
  Message & Offer Analyst: ok | - | "Identified 1 red flag(s)." | act: 1 | flags: [no_interview_selection:medium] | unchecked: 0 | manual: 0
  ML Scam Classifier: ok | - | "classifierMaxPoints=10. Classifier probability is an informational model output..." | act: 1 | flags: [] | unchecked: 0 | manual: 0
  Domain & Web Forensics: skipped | no_applicable_input | "Check skipped: No link or domain was found. Add a link or website to run this check." | act: 1 | flags: [] | unchecked: 0 | manual: 0
  Payment & UPI Verifier: skipped | no_applicable_input | "Check skipped: No payment details, UPI ID, or phone number found. Add a UPI ID or phone to run this check." | act: 1 | flags: [] | unchecked: 0 | manual: 0
  Official Registry Verifier: ok | - | "No official registry red flags found; this does not mean the offer is safe (not a safety guarantee)." | act: 3 | flags: [] | unchecked: 0 | manual: 2
  Community & OSINT Search: ok | - | "Generic public scam warnings exist regarding parties impersonating Google, but no complaints specific to this offer were corroborated" | act: 2 | flags: [] | unchecked: 0 | manual: 1
first 6 activity titles:
  Message & Offer Analyst: "No Interview Selection"
  ML Scam Classifier: "Analysis completed"
  Domain & Web Forensics: "Check skipped"
  Payment & UPI Verifier: "Check skipped"
  Official Registry Verifier: "Ingested 1 item(s)", "Manual check: Ministry of Corporate Affairs (MCA) Portal", "Manual check: PIB Fact Check Portal"
  Community & OSINT Search: "Ingested 1 item(s)", "Manual check: Trustpilot review search for Google"
score: 15/100 | level: LOW | confidence: high | rules fired: []

4. API AND UI
GET /api/checks/:id/agents response keys: agents -> [agent, name, status, rawStatus, durationMs, summary, activity, flags, verified, unchecked, manualChecks, trace]. activity -> [seq, atMs, type, status, title, detail, tool, sources, flagId].
SSE event types seen: stage, round, agent_status, note, tool_start, tool_end, activity, flag, entity, complete.
UI files: components/AgentCards.js, components/AgentActivityDrawer.js, app/check/[id]/page.js.
verified states & evidence:
  waiting: tests/api-agents.test.js ("GET /api/checks/:id/agents - returns six agent cards in fixed order for awaiting_confirmation check")
  running: tests/api-agents.test.js & tests/coordinator-activity.test.js (live streaming agent_status=started and live onEvent emit)
  done: tests/api-agents.test.js ("maps completed results, skipped, and found_issues statuses correctly")
  issues found: tests/api-agents.test.js ("maps completed results, skipped, and found_issues statuses correctly")
  not applicable: tests/api-agents.test.js ("maps completed results, skipped, and found_issues statuses correctly")
  could not check: tests/api-agents.test.js ("maps completed results, skipped, and found_issues statuses correctly")

5. INVARIANTS (all tools fail gives could_not_check, never ok)
message_analyst: tests/agents-message-analyst.test.js -> "a generate that throws gives could_not_check"
classifier_client: tests/agents-classifier-client.test.js -> "service failure gives could_not_check and no classifierResult"
website_forensics: tests/agents-website-forensics.test.js -> "offline invariant: when all network tools fail or time out, result is could_not_check even with real lookalikeCheck"
payment_entity: tests/agents-payment-entity.test.js -> "offline invariant: when graph and search tools fail or time out, network-dependent entities give could_not_check"
official_verifier: tests/agents-official-verifier.test.js -> "offline invariant: when all tools fail or time out, result is could_not_check with reason all_checks_failed"
reputation_osint: tests/agents-reputation-osint.test.js -> "offline invariant: when all search tools fail or time out, result is could_not_check"
agents without test: none (all 6 pass).

6. LIMITS AND RISKS
still failing / untested: 0 test failures. YouTube comment scraper unconfigured (clean limit logged). NPCI UPI has no public API (format/vpa heuristics).
UI copy audit:
  "verified": app/check/[id]/page.js:1362 ("6 Agents Verified" header - suggests authentic check completion), page.js:1341 ("Verified Signals"), page.js:1741 ("Verified Authentic Signals"), app/page.js:30 ("instant verified prestige certificates" in scam description).
  "safe": app/about/page.js:83 ("public safety graph"), page.js:250 ("Verify the offer safely"), app/check/[id]/page.js:188 ("safely completed"), components/AgentActivityDrawer.js:486,538,555 ("Nothing found is not the same as safe").
  "merchant": 0 uses in UI copy.
  "real": app/about/page.js:26 ("checking real-world facts"), app/page.js:31 ("no real judging" in scam description).

7. DECISIONS NEEDED FROM ME
- Replace UI header "6 Agents Verified" with "6 Agents Checked" in app/check/[id]/page.js to strictly adhere to "no safe/verified guarantees".
- Confirm whether to merge the 6 parallel activity-instrumentation branches (feature/activity-*) into main.
- Confirm whether to remove old merged worktrees (DEM-classifier, DEM-domain, DEM-osint, DEM-payment).
- Confirm readiness to push main to origin/main.