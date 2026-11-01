IDENTITY
task: regression
branch: main
worktree: /home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM
HEAD: d18be300585f6e80bcaaa426c19a84ba452c93d7
git status clean: yes

OVERVIEW
6 synthetic evaluation cases tested across 2 full pipeline runs with real LLM (Gemini) and real search (Serper).
Budgets used: 51/80 LLM calls, 60/60 search calls. All cases labeled synthetic.

COMPACT MATRIX
| Case ID | Expected | Run 1 Level (Score) | Run 2 Level (Score) | Run 1 Flags | Run 2 Flags | Traceable | FP | FN | Diffs |
|---|---|---|---|---|---|---|---|---|---|
| gov-scholarship-2026 | High | HIGH (60) | HIGH (60) | scholarship_fee_demand, scam_reports_found | scholarship_fee_demand, scam_reports_found | Yes | No | No | None |
| case2-genuine-scholarship-nsp | Low/CannotVerify | MEDIUM (25) | MEDIUM (25) | scam_reports_found | scam_reports_found | Yes | No | No | None |
| case3-fake-internship-tcs | High | HIGH (100) | HIGH (100) | fee_demand, domain_company_mismatch, domain_no_history, lookalike_domain, personal_payment_id, classifier_high | equipment_advance, domain_company_mismatch, domain_no_history, lookalike_domain, personal_payment_id, classifier_high | Yes | No | No | fee_demand vs equipment_advance |
| case4-telegram-task-job | High | HIGH (70) | HIGH (60) | task_deposit_script, pay_too_high, off_platform_contact, classifier_high | task_deposit_script, pay_too_high, classifier_high | Yes | No | No | Score 70 vs 60; off_platform_contact |
| case5-google-no-identifiers | Medium/CannotVerify | LOW (15) | LOW (15) | no_interview_selection | no_interview_selection | Yes | No | YES | None |
| case6-screenshot-hidden-fee | >= Medium | LOW (0) | LOW (0) | (none) | (none) | Yes | No | YES | None |

AGENT STATUS SUMMARY
- gov-scholarship-2026: classifier_client: ok, message_analyst: ok, official_verifier: ok, payment_entity: ok, reputation_osint: ok, website_forensics: skipped
- case2-genuine-scholarship-nsp: classifier_client: ok, message_analyst: ok, official_verifier: ok, payment_entity: ok, reputation_osint: ok, website_forensics: ok
- case3-fake-internship-tcs: classifier_client: ok, message_analyst: ok, official_verifier: ok, payment_entity: ok, reputation_osint: ok, website_forensics: ok
- case4-telegram-task-job: classifier_client: ok, message_analyst: ok, official_verifier: skipped, payment_entity: ok, reputation_osint: ok/could_not_check, website_forensics: skipped
- case5-google-no-identifiers: classifier_client: ok, message_analyst: ok, official_verifier: ok/could_not_check, payment_entity: skipped, reputation_osint: ok/could_not_check, website_forensics: skipped
- case6-screenshot-hidden-fee: classifier_client: ok, message_analyst: ok, official_verifier: ok/could_not_check, payment_entity: ok, reputation_osint: ok/could_not_check, website_forensics: skipped

LEDGER TRACEABILITY
Every flag emitted in both runs mapped to a validated entry in the evidence ledger with a stable evidence ID (100% traceable).

FALSE POSITIVES & FALSE NEGATIVES
- False Positives: 0. Case 2 (genuine NSP scholarship) evaluated at Medium (25 points), avoiding High.
- False Negatives: 2 (Cases 5 and 6).

FAILURES & LIKELY CAUSES
1. Case 5 (Opportunity with no domain or payment identifier):
   - Result: Score 15 (LOW risk). Expected: Medium or Cannot verify, never Low.
   - Likely Cause: Only flag produced was `no_interview_selection` (15 points). Because 15 < 30, the pure score engine places it in the Low band. Eligible agents completed without error, so coverage ratio did not trigger `cannot_verify`. Missing safeguard rule: an ungrounded opportunity lacking verifier identifiers (domain, email, payment ID) should not clear as Low risk.
2. Case 6 (Screenshot containing hidden fee demand in small text):
   - Result: Score 0 (LOW risk). Expected: >= Medium.
   - Likely Cause: Vision extraction (`purpose: "vision_extraction"`) transcribed the main body but failed to transcribe the faint fine print at the bottom ("A refundable document verification fee of Rs 850..."). Without OCR transcription in input text, neither entity sweep nor Message Analyst could detect the fee.
3. Case 2 Over-caution (Genuine NSP Scholarship scored 25/MEDIUM):
   - Result: OSINT search on "National Scholarship Portal" returned public advisories discussing scam warnings targeting NSP, causing reputation_osint to emit `scam_reports_found` (25 points).
4. Run-to-Run Variance (Case 3 & 4):
   - Case 3: Message Analyst alternated between `fee_demand` and `equipment_advance` for "equipment security deposit" (both 30 pts, total score unchanged at 100).
   - Case 4: Run 2 hit search budget limit on OSINT query for Telegram handle, omitting `off_platform_contact` and dropping score from 70 to 60.
