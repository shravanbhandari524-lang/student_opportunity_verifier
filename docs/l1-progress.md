# L1 Progress Tracking

| Item | Description | Status | Evidence |
|---|---|:---:|---|
| **0.1** | `normalizeDomain` strict order, protocol-relative, IP-literal rejection, punycode | Complete | `tests/contracts.test.js` |
| **0.2** | `isValidE164` exactly `^\+[1-9]\d{6,14}$` & comments matching docs/contracts.md | Complete | `tests/contracts.test.js`, exact grep match |
| **0.3** | `normalizeAmount` digits-only integer string, decimals rejected, `normalizeCompany` no truncation | Complete | `tests/contracts.test.js` |
| **0.4** | `enums.js`: `AGENT_NAMES`, frozen `FLAG_REGISTRY`, `canEmit(flagId, agent)` | Complete | `tests/contracts.test.js` |
| **0.5** | `entity.js`: value validation per kind, `confirmed` required boolean, `discoveredBy` rules | Complete | `tests/contracts.test.js` |
| **0.6** | `agent-result.js`: `agent` in `AGENT_NAMES`, `kind` in `("check"\|"llm_call"\|"agent")`, `canEmit`, required checkId/durationMs/arrays | Complete | `tests/contracts.test.js` |
| **0.7** | `case-file.js`: control only `processedEntitiesByAgent`, 6 relational refinements | Complete | `tests/contracts.test.js` |
| **0.8** | Fixtures & Scenarios (A, B, C): kind, caseFile builder, discovered entity URL evidence, eligibility matching 3.5, lookalike_domain quote, provisional confidence, L5 quote check | Complete | `tests/contracts.test.js` |
| **0.9** | Invalid fixtures: specific error causes asserted | Complete | `tests/contracts.test.js` |
| **1.1** | L0 schema vs docs/contracts.md section 5 audit and decisions | Complete | Table in report, mapped in migration 002 |
| **1.2** | Migrations: migration 1 (L0), migration 2 (target schema rebuild), `schema_migrations` | Complete | `lib/db/migrations/` (001, 002, runner) |
| **1.3** | Foreign keys ON, WAL, busy timeout, cascade deletion test | Complete | `tests/migrations.test.js` |
| **1.4** | Enum CHECK constraints match enums.js test | Complete | `tests/migrations.test.js` |
| **1.5** | L0 to L1 migration test with seeded data, idempotency test | Complete | `tests/migrations.test.js` |
| **2.1** | State machine: terminal states, fail transitions, full matrix test | Complete | `lib/db/state-machine.js`, `tests/state-machine.test.js` |
| **2.2** | Repositories in `lib/db/`: contract validation on read/write, JSON validation, transactions | Complete | `lib/db/index.js`, `tests/repositories.test.js` |
| **2.3** | `deleteExpired` cascade deletion, path verification inside upload directory | Complete | `lib/db/index.js`, `tests/repositories.test.js` |
| **2.4** | Repository round-trips, bad data rejection, feedback/graph survival tests | Complete | `tests/repositories.test.js` |
| **3.1** | `lib/caseFile.js`: `getCaseFile(checkId)` and `renderMarkdown(snapshot, options)` | Complete | `lib/caseFile.js` |
| **3.2** | Case file persistence, assembly, and markdown rendering tests for 3 scenarios | Complete | `tests/case-file.test.js` |
| **4.1** | `lib/logger.js` with pino: structured logs, secret/content redaction test | Complete | `lib/logger.js`, `tests/logger.test.js` |
| **4.2** | `POST /api/checks` route validation against `CheckSubmission`, `ApiError` responses, route tests | Complete | `app/api/checks/route.js`, `tests/api.test.js` |
| **4.3** | `scripts/validate-contracts.js` contract validator script | Complete | `scripts/validate-contracts.js` (100 fixtures & scenarios pass) |
| **4.4** | Full L1 gate execution: test, lint, build, validate-contracts, smoke | Complete | All 5 commands exit 0 |
| **4.5** | README, AGENTS.md update, PROVISIONAL header audit & removal | Complete | `AGENTS.md`, `README.md`, provisional removed from `lib/db`, `lib/cache` |
| **4.6** | Final report with proof, commit logs, and L2 handoff summary | Complete | Final summary report |
| **Fixes** | L1 Closing Fixes: DuplicateAgentResultError, normalizeAmount decimal rules, graph node & edge tests | Complete | `tests/contracts.test.js`, `tests/repositories.test.js` |
| **Final** | L1 Final Fix: normalizeAmount rules (.00 dropped, other decimals rejected, non-zero), company validation tests, contracts.md doc sentence | Complete | `tests/contracts.test.js`, `lib/contracts/normalize.js`, `docs/contracts.md` |
| **Migration fix** | Migration 002 fix: non-UUID checks deletion & cascade, graph_edges MIN/MAX order, self-loop exclusion, deduplication, explicit verdict mapping & unknown exclusion | Complete | `Database Migrations: L0 seed data preserves graph, feedback, and cache across migration 2, and migrations are idempotent` in `tests/migrations.test.js` |
| **Step X** | Repository additions for L5: `addEntities`, `clearInputFile`, `replaceTextInputs`, `saveConfirmation`, `saveRoundResults` | Complete | `tests/db-repository.test.js` (6/6 pass, 316/316 total) |
