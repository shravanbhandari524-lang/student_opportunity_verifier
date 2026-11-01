IDENTITY
task: j-quality
branch: main
worktree: /home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM
commits:
c020631 fix(eval): align recruitment context term and synthetic unverified recruiter case
f09ac88 feat(eval): add 5 quality regression cases and runner integration
a85cb37 fix(quality): enforce agent source purity without process.env and update migration tests
a7ae68b feat(report): deduplicate manual checks, group entity failures, and cap checklist at 10 items with moreChecks
14a791e SHARED: contracts: add moreChecks to Report contract and ARCHITECTURE.md
42a903f feat(official): enforce source link provenance and opportunity claim relevance filter
154001c SHARED: contracts: add provenance and sourceUrl to manual checks and report checklist
1cffa07 SHARED: score: group correlated domain and brand impersonation flags with corroboration bonus
e988a93 feat(payments): restrict payment demands to candidate fees and deposits
f029925 SHARED: extract: classify amount payment direction and detect purpose
96f543c feat(domain): add RFC 2606 reserved domain handling and test fixture domain injection
9af51d7 SHARED: contracts: add test_domain status, amount direction, and claim group types

OVERVIEW
Resolved 6 core quality issues confirmed via reproduction on Microsoft .example impersonation case:
1. Reserved domains (RFC 2606/6761) skip network lookups, emit test_domain status, preserve lookalike rules.
2. Payment direction classified as to_candidate vs from_candidate (only from_candidate counts as demand).
3. Correlated scoring merges claim groups (lookalike + mismatch) with +5 corroboration bonus.
4. Official source link provenance tracked; search results filtered to opportunity-relevant topics only.
5. Coverage / confidence kept strictly separate from score; failure summaries never claim "no reports found".
6. Checklist deduplicates items, groups network failures per entity, and caps top 10 with moreChecks.

COMPACT MATRIX (5 / 5 MATCHED)
| Case ID | Expected | Run 1 Level (Score) | Run 2 Level (Score) | Flags (Run 1) | Traceable | FP | FN |
|---|---|---|---|---|---|---|---|
| case-microsoft-impersonation | Medium | MEDIUM (45) | MEDIUM (45) | domain_company_mismatch, free_email_recruiter | Yes | NO | NO |
| case-controlled-domain | High | HIGH (65) | HIGH (65) | domain_company_mismatch, domain_new, free_email_recruiter | Yes | NO | NO |
| case-genuine-careers | Low | LOW (0) | LOW (0) | (none) | Yes | NO | NO |
| case-internship-fee-upi | High | HIGH (80) | HIGH (80) | fee_demand, personal_payment_id, no_interview, urgency | Yes | NO | NO |
| case-freemail-recruiter-unverified | Medium | MEDIUM (15) | MEDIUM (15) | free_email_recruiter | Yes | NO | NO |

REGRESSION & BUDGET STATS
- Results: 5 / 5 matched (100% pass across Run 1 uncached and Run 2 cached).
- FP: 0 | FN: 0 | Ledger Traceability: 100% | Mismatches: 0.
- Resource usage: 40/80 LLM calls, 31/60 uncached search calls, 47 cached hits on Run 2.

VERIFICATION
lint: npm run lint (passed, 0 errors, 0 warnings)
test suite: npm test (passed: 1030, failed: 0, skipped: 1)
regression: node --env-file=.env.local scripts/run-regression-suite.js (5/5 matched)

SHARED COMMITS
9af51d7 SHARED: contracts: add test_domain status, amount direction, and claim group types
f029925 SHARED: extract: classify amount payment direction and detect purpose
1cffa07 SHARED: score: group correlated domain and brand impersonation flags with corroboration bonus
154001c SHARED: contracts: add provenance and sourceUrl to manual checks and report checklist
14a791e SHARED: contracts: add moreChecks to Report contract and ARCHITECTURE.md
