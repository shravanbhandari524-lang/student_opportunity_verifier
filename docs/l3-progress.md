# L3 Progress Tracking: Decision Layer

| Item | Description | Commit | Status | Evidence (Test Name / Command) |
|---|---|:---:|:---:|---|
| **P0.1** | Change control order: ARCHITECTURE -> PRD -> docs/contracts.md | `b6eeb5e` | Complete | `git diff b6eeb5e^ b6eeb5e -- ARCHITECTURE.md PRD.md docs/contracts.md` |
| **P0.2** | ARCHITECTURE.md section 12: AgentResult optional `classifierResult` (classifier_client + ok only) | `b6eeb5e` | Complete | Grep check: `grep -A 10 "classifierResult\?:" ARCHITECTURE.md` |
| **P0.3** | ARCHITECTURE.md section 13: rewritten to exact scoring algorithm, D1-D5, weight table, config shape | `b6eeb5e` | Complete | Doc review: `ARCHITECTURE.md` section 13 |
| **P0.4** | ARCHITECTURE.md section 21: mentions L3 unit tests | `b6eeb5e` | Complete | Grep check: `grep "scoring (weights" ARCHITECTURE.md` |
| **P0.5** | PRD.md sections 8, 9, 10: updated consistently (fee group, confidence cap, classifier scaling, hard rule floor 60, D6 classifier contract) | `b6eeb5e` | Complete | Doc review: `PRD.md` sections 8, 9, 10 |
| **P0.6** | docs/contracts.md: AgentResult, ClassifierResult (per D6), ScoreResult, config shape, weight table | `b6eeb5e` | Complete | Doc review: `docs/contracts.md` sections 3.6, 3.7, 3.8 |
| **P0.7** | Grep proof of doc agreement: weights table, 25/60 thresholds, 40% rule, 25 classifier points, cap rule, D6 wording | `b6eeb5e` | Complete | Grep commands verified in Part 0 gate |
| **P1.1** | AgentResult schema in `lib/contracts/agent-result.js`: optional `classifierResult` with superRefine (classifier_client + ok only) | `b63171c` | Complete | Test: `classifierResult accepted for classifier_client ok`, `rejected for message_analyst`, `rejected for classifier_client could_not_check` in `tests/contracts.test.js` |
| **P1.2** | ClassifierResult schema in `lib/contracts/classifier-result.js`: probability 0..1, NaN rejected, label suspicious/benign, topTerms string[], optional scamType | `b63171c` | Complete | Test: `probability 1.2 rejected` in `tests/contracts.test.js` |
| **P1.3** | Migration 003 in `lib/db/migrations/003_add_classifier_result_to_agent_results.js`: nullable column `classifier_result_json` | `b63171c` | Complete | Test: `lib/db: initializes tables and enforces state machine` in `tests/migrations.test.js` |
| **P1.4** | Agent results repository in `lib/db/index.js`: write and read with validation on write and JSON read | `b63171c` | Complete | Test: `AgentResults: save and retrieve AgentResult with optional classifierResult` in `tests/repositories.test.js` |
| **P1.5** | `lib/caseFile.js`: markdown rendering shows classifier probability line only | `b63171c` | Complete | Test: `CaseFile markdown rendering: shows classifier probability line and no terms/scamType` in `tests/repositories.test.js` |
| **P1.6** | ScoreResult schema and fixtures in `lib/contracts/score-result.js` and `lib/contracts/fixtures/`: 1 valid fixture and invalid fixtures (bad level, score 101, negative points) | `b63171c` | Complete | Test: `ScoreResult valid fixture passes and each invalid fixture is rejected` in `tests/contracts.test.js` |
| **P1.7** | Tests added and passing (specific names required in prompt) | `b63171c` | Complete | `npm test` (119 passing tests) |
| **P2.1** | Config in `lib/scoring/config.js`: 29 registry flag weights, groups, hardRules, thresholds 25/60, externalEvidenceAgents, deeply frozen and schema validated | `c295e05` | Complete | Unit tests in `tests/scoring-config.test.js` |
| **P2.2** | Config tests in `tests/scoring-config.test.js`: 6 named unit tests passing | `c295e05` | Complete | Tests: `scoring config validates against schema and equals defaultConfig`, `scoring config keys equal the registry ids exactly in both directions`, `every weight in config is a non-negative integer and classifier_high is 0`, `scoring config group members exist in the registry`, `scoring config hard rule ids exist in the registry`, `scoring config is deeply frozen (mutation throws in strict mode)` |
| **P3.1** | Pure scoring engine in `lib/scoring/score.js`: `scoreCase(snapshot, config = defaultConfig)`, pure code, zero matches for `60` literal, zero impure tokens | `a74ee9c` | Complete | `grep -rn "60" lib/scoring/score.js` (exit code 1); `grep -En "(fs|node:fs|fetch|process\.env|Date|Math\.random|lib/db)" lib/scoring/*.js` (exit code 1) |
| **P3.2** | Exhaustive scoring test suite in `tests/scoring.test.js`: all 17 named tests implemented and passing | `a74ee9c` | Complete | Tests 1-17 in `tests/scoring.test.js` (all 17 pass) |
| **P3.3** | Gate checks: offline tests pass (142/142), lint clean, build clean, scope check clean | `a74ee9c` | Complete | `npm test`, `npm run lint`, `npm run build` |
| **P4.1** | Runnable script `scripts/score-fixtures.js` with table, assertions, and `--expect` override | Current | Complete | `npm run score:fixtures; echo "exit=$?"` (exit=0); `node scripts/score-fixtures.js --expect A=low,B=low,C=cannot_verify; echo "exit=$?"` (exit=1) |
| **P4.2** | Package script `"score:fixtures"` added to `package.json` | Current | Complete | `npm run score:fixtures` |
| **P4.3** | Documentation status updated: `README.md` and `AGENTS.md` (L3 marked complete) | Current | Complete | `README.md`, `AGENTS.md` |
| **P4.4** | Layer gate verification: items 3.a through 3.l executed and passing | Current | Complete | Gate outputs verified below |
