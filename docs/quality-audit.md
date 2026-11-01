# Repository Quality Audit & Assessment (Step Q-A)

**Date**: 2026-10-26  
**Commit Audited**: `c780608` (HEAD)  
**Branch**: `main`  
**Methodology**: Read-only static analysis, dependency graph inspection, coverage analysis, offline hermetic testing, and contract verification following `AGENTS.md` and `gravitas`.

---

## 1. Inventory & Codebase Metrics

### 1.1 Tracked File & Line Totals
**Command**: `git ls-files | wc -l`  
**Output**: `272` tracked files.

| Folder | Files | Total Lines | Description |
|---|:---:|:---:|---|
| `lib` (all nested) | 92 | 21,679 | Core application logic, agents, tools, db, contracts |
| ├─ `lib` (top-level only) | 12 | 4,213 | Coordinator, extraction, reporting, env, logger, graph |
| ├─ `lib/agents` | 10 | 4,152 | 6 investigation agents, base runner, registry, config |
| ├─ `lib/tools` | 11 | 2,501 | OSINT tools, SSRF guard, fetchPage, lookalike, payments |
| ├─ `lib/db` | 6 | 1,980 | SQLite migrations, repositories, state machine |
| ├─ `lib/contracts` | 29 | 5,198 | Zod schemas, enum registries, and 137 fixtures |
| ├─ `lib/scoring` | 2 | 465 | Pure decision engine and rules configuration |
| ├─ `lib/llm` | 1 | 484 | Multimodal generate adapter with retries |
| ├─ `lib/report` | 2 | 278 | Report constants, checklist definitions |
| ├─ `lib/api` | 11 | 1,595 | SSE loop, rate limiter, errors, logging, headers, jobs |
| `app` | 18 | 1,359 | App Router route handlers (`app/api/`) and landing stub |
| `scripts` | 26 | 8,374 | CLI tools, evaluation harness, smoke tests, demo runners |
| `tests` | 55 | 23,419 | 42 test suites, unit tests, integration tests, fixtures |
| `docs` | 17 | 3,107 | Architectural specs, progress reports, evaluation docs |
| `services` | 7 | 401 | Classifier FastAPI service, scikit-learn training script |
| `deferred` | 6 | 844 | Deferred UI layouts and pages (`deferred/ui/`) |

---

### 1.2 Top 25 Largest Files
**Command**: Node script sorting tracked files by line count.

| Rank | File | Line Count | Purpose |
|:---:|---|:---:|---|
| 1 | `package-lock.json` | 6,518 | Dependency lockfile |
| 2 | `tests/coordinator.test.js` | 1,831 | Comprehensive coordinator orchestration & error tests |
| 3 | `lib/db/index.js` | 1,378 | Main database repository & query logic |
| 4 | `lib/contracts/fixtures/invalid/invalid-fixtures.js` | 1,363 | Zod negative fixture definitions |
| 5 | `tests/agents-website-forensics.test.js` | 1,223 | Website forensics unit tests |
| 6 | `.agents/skills/design-taste-frontend/SKILL.md` | 1,207 | Design skill documentation |
| 7 | `tests/report.test.js` | 1,071 | Report generation and formatting tests |
| 8 | `scripts/run-check.js` | 1,026 | Full CLI check execution runner |
| 9 | `tests/record-replay.test.js` | 1,017 | Record and replay subsystem tests |
| 10 | `lib/contracts/fixtures/valid/valid-fixtures.js` | 954 | Zod positive fixture definitions |
| 11 | `docs/contracts.md` | 926 | Authoritative contract specification |
| 12 | `tests/agents-official-verifier.test.js` | 908 | Official verifier unit tests |
| 13 | `tests/agents-payment-entity.test.js` | 901 | Payment entity agent unit tests |
| 14 | `scripts/eval/runner.js` | 883 | Evaluation harness execution engine |
| 15 | `tests/scoring.test.js` | 822 | Pure scoring engine unit tests |
| 16 | `tests/api-actions.test.js` | 808 | Action route tests (college-email, fraud-summary) |
| 17 | `tests/agents-reputation-osint.test.js` | 789 | Reputation & OSINT agent tests |
| 18 | `tests/agents-message-analyst.test.js` | 781 | Message analyst agent tests |
| 19 | `tests/api-routes.test.js` | 767 | API route handlers unit & security tests |
| 20 | `lib/agents/official-verifier.js` | 745 | Official verifier agent implementation |
| 21 | `lib/report.js` | 739 | Report generation and checklist generator |
| 22 | `lib/coordinator.js` | 735 | Investigation coordinator orchestrator |
| 23 | `scripts/run-agents.js` | 704 | Specialist agents offline runner |
| 24 | `lib/agents/website-forensics.js` | 682 | Website forensics agent implementation |
| 25 | `ARCHITECTURE.md` | 664 | Technical architecture documentation |

*Files over 400 lines count*: **57** files.

---

### 1.3 Tracked Temporary or Generated Files
**Command**: Regex scan across `git ls-files` matching `.log`, `.db`, `uploads/`, `.DS_Store`, `.bak`, `.coverage`, `.env*`.  
**Output**:
- `.env.example`: Expected template file.
- **Zero** tracked database files (`.db`, `.db-wal`, `.db-shm`).
- **Zero** tracked log files or upload files.
- **Zero** OS metadata files (`.DS_Store`, `Thumbs.db`).

---

### 1.4 Empty and Placeholder Files
**Command**: Scan for 0-byte or stub files.  
**Output**: 11 `.gitkeep` directory placeholder files:
1. `app/about/.gitkeep` (0 bytes)
2. `app/guides/.gitkeep` (0 bytes)
3. `app/guides/[type]/.gitkeep` (0 bytes)
4. `app/report-fraud/.gitkeep` (0 bytes)
5. `data/.gitkeep` (0 bytes)
6. `docs/.gitkeep` (0 bytes)
7. `lib/contracts/.gitkeep` (0 bytes)
8. `lib/contracts/fixtures/.gitkeep` (0 bytes)
9. `lib/data/.gitkeep` (0 bytes)
10. `lib/tools/.gitkeep` (0 bytes)
11. `services/classifier/data/.gitkeep` (0 bytes)

---

### 1.5 Code Annotations (TODO, FIXME, HACK, PROVISIONAL, XXX)
**Command**: `git grep -n -E '\b(TODO|FIXME|HACK|PROVISIONAL|XXX)\b'`  
**Output**:
- `lib/report/checklist.js:24`: `// TODO: Verify https://cybercrime.gov.in before enabling as manual link`
- `lib/report/constants.js:89`: `// TODO: Verify https://cybercrime.gov.in and helpline 1930 against official advisories before enabling as confirmed contact`
- `lib/report/constants.js:98`: `// TODO: Verify https://sancharsaathi.gov.in against DoT advisories before enabling as confirmed contact`
- Zero `FIXME`, zero `HACK`, zero `PROVISIONAL` (all provisional headers successfully audited in L2/L6/L7), zero `XXX`.

---

### 1.6 Console Usage Outside Scripts
**Command**: `git grep -n -E 'console\.(log|error|warn|info)' ':!scripts/**'`  
**Output**:
- `instrumentation.js:27`: `console.warn(JSON.stringify({ level: "warn", code: "INSTRUMENTATION_INIT_SKIPPED", message: ... }))`
  - *Context*: Next.js server initialization lifecycle fallback before logger/env singleton is loaded during static builds.
- `tests/tools-fetch.test.js:166`: `<script>console.log('malicious script');</script>`
  - *Context*: Literal string inside test HTML payload testing XSS stripping.
- **Zero** `console.log` or `console.error` calls in production source code.

---

### 1.7 Commented-Out Code Blocks
**Command**: Multi-line comment parser checking for commented code declarations (`const`, `let`, `function`, `import`, `return`, `if`).  
**Output**: **Zero** commented-out code blocks across the repository.

---

### 1.8 Duplicate Helper Functions
**Command**: Global AST and symbol pattern matcher.  
Identified candidates:
1. `formatFlagTitle(flagId)`: Byte-identical across 5 files:
   - `lib/agents/message-analyst.js:254`
   - `lib/agents/official-verifier.js:87`
   - `lib/agents/payment-entity.js:165`
   - `lib/agents/reputation-osint.js:85`
   - `lib/agents/website-forensics.js:200`
2. `getProcessedEntityKeys(snapshot)`: Byte-identical logic across 4 files:
   - `lib/agents/official-verifier.js:124`
   - `lib/agents/payment-entity.js:66`
   - `lib/agents/reputation-osint.js:148`
   - `lib/agents/website-forensics.js:88`
3. `getEligibleUnprocessedEntities(snapshot)`: Structural duplicate pattern across 4 files:
   - `lib/agents/official-verifier.js:163`
   - `lib/agents/payment-entity.js:102`
   - `lib/agents/reputation-osint.js:183`
   - `lib/agents/website-forensics.js:124`
4. Server setup helpers in testing scripts:
   - `findFreePort()`: Identical in `scripts/api-live.js:42` and `scripts/ops-smoke.js:49`
   - `waitForServer()`: Identical in `scripts/api-live.js:53` and `scripts/ops-smoke.js:60`

---

## 2. Dead Code & Dependencies

Analysis executed using `depcheck` and `knip` in a throwaway worktree (`/tmp/audit-worktree`) without mutating the repository.

### 2.1 Dependency Usage & Vulnerability Audit
**Commands**: `depcheck`, `npm ls --all | head`, `npm audit --json`.

- **Unused Dependencies**: **0**
- **Unused DevDependencies**: **0**
- **Missing Dependencies**: **0**
- **Extraneous / Optional Packages**:
  - `@img/sharp-wasm32` (extraneous optional native fallback for `sharp`)
  - `@emnapi/runtime` (transitive helper of sharp wasm)
- **Direct Imports of `sharp`**:
  - `lib/uploads.js:17`
  - `scripts/api-e2e.js:35`, `scripts/api-live.js:29`, `scripts/privacy-check.js:39`
  - `tests/api-e2e.test.js`, `tests/api-routes.test.js`, `tests/api-security.test.js`, `tests/extract.test.js`, `tests/record-replay.test.js`
- **npm audit Vulnerabilities**:
  - Moderate: **1** (`next` affected via transitive `postcss`)
  - High: **2** (`postcss` path traversal/XSS, `zod` regex/memory exhaustion in constrained collections)
  - Critical: **0**
  - Low: **0**
  - Total: **3**

---

### 2.2 Knip Unused Files & Exports Report
**Command**: `npx knip --reporter json` (in throwaway worktree)

#### Unused Files (15 files identified by Knip):
All 15 reported files fall into expected architectural categories:
- **11 Standalone CLI scripts**:
  `scripts/classifier-live.js`, `scripts/diagnose-gemini.js`, `scripts/diagnose-urlhaus.js`, `scripts/diagnose-urlscan.js`, `scripts/l2-live.js`, `scripts/llm-live.js`, `scripts/ops-smoke.js`, `scripts/replay-tools.js`, `scripts/smoke.js`, `scripts/tools-live.js`, `scripts/validate-contracts.js`.  
  *Reason*: Executed via `node scripts/...` or `npm run ...`; never imported by code.
- **4 Deferred UI files**:
  `deferred/ui/layout.js`, `deferred/ui/page.check-id.js`, `deferred/ui/page.check.js`, `deferred/ui/page.landing.js`.  
  *Reason*: Intentionally quarantined in `deferred/ui/` per `AGENTS.md` current scope.

#### Unused Exports (Selected Categories):
- **Contract & Schema Helpers**: `ACTION_ITEM_IDS`, `ChecklistItemSchema`, `ActionItemSchema` (`lib/contracts/report.js`), `ToolErrorCodeSchema`, `ToolResultSuccessSchema` (`lib/contracts/tool-result.js`), `FlagPointItemSchema` (`lib/contracts/score-result.js`), `ReportingChannelSchema` (`lib/contracts/actions.js`).
- **Coordinator & Agent Constants**: `MAX_ROUNDS`, `CHECK_SEARCH_BUDGET` (`lib/coordinator.js`), `MAX_ENTITIES_PER_CHECK` (`lib/extract.js`), `ELIGIBLE_KINDS`, `LLM_ALLOWED_FLAGS` (`lib/agents/official-verifier.js`).
- **Test Helpers**: `makeToolSuccessSchema`, `ToolFailureSchema`, `makeToolResultSchema` (`tests/helpers/tool-result-schemas.js`).
- **Evaluation Utilities**: `normalizeTextForHashing`, `loadClassifierHashes` (`scripts/eval/loader.js`), `RISK_LEVEL_ORDER`, `createMulberry32` (`scripts/eval/metrics.js`).

---

## 3. Structure, Boundaries & Invariants

### 3.1 Verification of ARCHITECTURE Section 2.3 Rules

| Rule | Requirement | Command / Evidence | Result | Violations |
|:---:|---|---|:---:|---|
| **1** | Layers import only downward | AST import resolution by folder layer | **PASS with notes** | Static reference data (`lib/data/*.json`) imported by L2/L5 (downward); `lib/uploads.js` & `lib/cleanup.js` are L5 components. |
| **2** | Only `lib/db` touches database | `git grep -n -E '(\.prepare\(|\.transaction\()' ':!lib/db/**'` | **FAIL (Leak)** | `lib/cache.js` (lines 12, 25, 49, 71, 83), `lib/cleanup.js` (line 83), `lib/graph.js` (lines 139, 186, 196, 272, 475, 526) call `db.prepare()` directly. |
| **3** | Only `lib/llm` calls LLM provider | `git grep -n -E '(@google|openai|anthropic|generativelanguage)'` | **PASS** | Only `lib/llm/generate.js:75` connects to Gemini endpoint. |
| **4** | Only `lib/tools` call external services | `git grep -n '\bfetch(' ':!lib/tools/**'` | **PASS** | Only `lib/llm/generate.js` (LLM) and `lib/classifier.js` (local FastAPI service) call `fetch` outside `lib/tools/`. |
| **5** | Agents never import each other or `lib/db` | `git grep -n -E '(from "\./|from "\.\./db)' lib/agents/` | **PASS** | Agents only import `./base.js`, `./config.js`, `./manual-links.js`. Zero DB or peer imports. |
| **6** | Scoring has no I/O | `git grep -n 'import' lib/scoring/` | **PASS** | Imports only `zod` and `lib/contracts/`. Pure deterministic calculation. |
| **7** | `app/` imports only allowed modules | `git grep -n 'import' app/` | **PASS** | Route handlers import from `lib/api/`, `lib/contracts/`, `lib/db/`, `lib/actions/`, `lib/guides/`, `lib/coordinator.js`, `lib/env.js`. |
| **8** | `process.env` read only in `lib/env.js` | `git grep -n 'process\.env' ':!lib/env.js'` | **FAIL (Leak)** | 11 occurrences in runtime code outside `lib/env.js`: `instrumentation.js`, `lib/coordinator.js`, `lib/db/index.js`, `lib/llm/generate.js`, `lib/logger.js`, `lib/record-replay.js`. |

---

### 3.2 Circular Dependency Analysis
**Command**: `npx madge --circular --extensions js lib/ app/` (in throwaway worktree)  
**Output**: **1 circular dependency detected**:
```
lib/db/index.js -> lib/cache.js -> lib/db/index.js
```
- **Cause**:
  - `lib/cache.js:1`: `import { getDb } from "./db/index.js";`
  - `lib/db/index.js:16`: `import { purge } from "../cache.js";` (used in `export function purgeCache(db = getDb()) { return purge(db); }`).

---

### 3.3 Naming Consistency Audit

1. **File Casing Inconsistencies in `lib/`**:
   - Predominant convention: `kebab-case` (22 multi-word files: `case-file.js`, `record-replay.js`, `state-machine.js`, `official-verifier.js`).
   - Inconsistent `camelCase` files:
     - `lib/caseFile.js` (inconsistent with `lib/contracts/case-file.js`)
     - `lib/tools/fetchPage.js` (inconsistent with `lookalike.js`, `domain.js`, `payments.js`)
     - `scripts/seedGraph.js` (inconsistent with `scripts/run-check.js`, `scripts/score-fixtures.js`)
2. **Export Naming Inconsistencies**:
   - `lib/agents/classifier-client.js`: exports `classifierClientAgent` (has `Agent` suffix).
   - Other agents (`lib/agents/*.js`): export `messageAnalyst`, `officialVerifier`, `websiteForensics`, `paymentEntity`, `reputationOsint` (no `Agent` suffix).

---

## 4. Comments & Documentation Gaps

### 4.1 Folder Documentation Coverage Table
**Criteria**:
- Module header: Top comment block stating layer, responsibility, and constraints.
- Function JSDoc: Purpose, `@param`, `@returns`, and error behavior.

| Folder | Files | With Header | Total Exported Fns | Documented | Undocumented | % Documented |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `lib/actions` | 1 | 1 | 2 | 2 | 0 | 100.0% |
| `lib/agents` | 10 | 6 | 56 | 56 | 0 | 100.0% |
| `lib/api` | 11 | 5 | 28 | 28 | 0 | 100.0% |
| `lib/cache.js` | 1 | 0 | 4 | 4 | 0 | 100.0% |
| `lib/caseFile.js` | 1 | 0 | 2 | 2 | 0 | 100.0% |
| `lib/classifier.js` | 1 | 1 | 2 | 2 | 0 | 100.0% |
| `lib/cleanup.js` | 1 | 1 | 1 | 1 | 0 | 100.0% |
| `lib/contracts` | 27 | 6 | 18 | 18 | 0 | 100.0% |
| `lib/coordinator.js` | 1 | 1 | 3 | 3 | 0 | 100.0% |
| `lib/db` | 6 | 3 | 37 | 34 | 3 | 91.9% |
| `lib/env.js` | 1 | 0 | 1 | 1 | 0 | 100.0% |
| `lib/extract.js` | 1 | 1 | 2 | 2 | 0 | 100.0% |
| `lib/graph.js` | 1 | 1 | 9 | 9 | 0 | 100.0% |
| `lib/guides` | 2 | 2 | 3 | 3 | 0 | 100.0% |
| `lib/llm` | 1 | 1 | 2 | 2 | 0 | 100.0% |
| `lib/logger.js` | 1 | 0 | 0 | 0 | 0 | N/A |
| `lib/record-replay.js` | 1 | 1 | 9 | 9 | 0 | 100.0% |
| `lib/report.js` | 1 | 1 | 3 | 3 | 0 | 100.0% |
| `lib/report` | 2 | 2 | 0 | 0 | 0 | N/A |
| `lib/scoring` | 2 | 1 | 1 | 1 | 0 | 100.0% |
| `lib/tools` | 10 | 7 | 36 | 36 | 0 | 100.0% |
| `lib/uploads.js` | 1 | 1 | 1 | 1 | 0 | 100.0% |
| `scripts/eval` | 5 | 5 | 24 | 24 | 0 | 100.0% |
| `scripts` (other) | 21 | 6 | 16 | 11 | 5 | 68.8% |

---

### 4.2 Top Files Lacking Module Headers or JSDoc
1. `scripts/evaluate.js`: Missing header; exports `printSummaryTable` and `main` without full JSDoc.
2. `lib/db/migrations/001_initial_l0_schema.js`: `up()` lacks JSDoc.
3. `lib/db/migrations/002_target_l1_schema.js`: `up()` lacks JSDoc.
4. `lib/db/migrations/003_add_classifier_result_to_agent_results.js`: `up()` lacks JSDoc.
5. `scripts/demo.js`: Missing module header; `runDemoScenario` lacks full JSDoc.
6. `scripts/secrets-scan.js`: Missing module header; `runSecretsScan` lacks full JSDoc.
7. `lib/cache.js`: Lacks 3-part module header (layer, responsibility, constraints).
8. `lib/caseFile.js`: Lacks 3-part module header.
9. `lib/env.js`: Lacks 3-part module header.
10. `lib/logger.js`: Lacks 3-part module header.
11. `lib/agents/classifier-client.js`: Lacks 3-part module header.
12. `lib/agents/message-analyst.js`: Lacks 3-part module header.
13. `lib/agents/official-verifier.js`: Lacks 3-part module header.
14. `lib/agents/reputation-osint.js`: Lacks 3-part module header.
15. `lib/api/errors.js`: Lacks 3-part module header.
16. `lib/api/jobs.js`: Lacks 3-part module header.
17. `lib/api/log.js`: Lacks 3-part module header.
18. `lib/api/rate-limit.js`: Lacks 3-part module header.
19. `lib/api/redaction.js`: Lacks 3-part module header.
20. `lib/api/runtime.js`: Lacks 3-part module header.

---

### 4.3 Documentation Discrepancies & Stale References
1. **`docs/l7-progress.md:19` vs `AGENTS.md:50`**:
   - `docs/l7-progress.md` line 19 marks Step G ("Final L7 layer gate verification") as `Not started`.
   - `AGENTS.md` line 50 marks L7 as `[x] L7 Features and hardening (backend complete...)`.
2. **`README.md:143`**:
   - Mentions `node scripts/replay-tools.js prune --age-days 30 --yes`. Script arguments should be validated against CLI parser.
3. **`ARCHITECTURE.md:276`**:
   - Lists `scripts/seedGraph.js` using camelCase, while file casing convention is predominantly kebab-case.

---

## 5. Test Suite & Hermeticity Audit

### 5.1 Test Coverage Metrics
**Command**: `node --test --experimental-test-coverage 'tests/**/*.test.js'`  
**Totals**:
- **Line Coverage**: `95.46%`
- **Branch Coverage**: `87.21%`
- **Function Coverage**: `88.92%`
- **Total Tests**: `689` passing across `42` suites (`0` failed, `0` skipped, `0` todo).

#### 25 Least-Covered Files (by line coverage):
1. `scripts/evaluate.js` — 31.01% lines (75.00% branches, 16.67% funcs)
2. `scripts/secrets-scan.js` — 57.59% lines (60.00% branches, 62.50% funcs)
3. `app/api/health/route.js` — 57.69% lines (40.00% branches, 100.0% funcs)
4. `lib/tools/fetchPage.js` — 72.27% lines (73.17% branches, 85.71% funcs)
5. `lib/tools/domain.js` — 74.23% lines (68.29% branches, 92.31% funcs)
6. `lib/tools/urlscan.js` — 76.19% lines (52.00% branches, 100.0% funcs)
7. `lib/tools/payments.js` — 76.67% lines (69.70% branches, 100.0% funcs)
8. `tests/agent-tool-conformance.test.js` — 78.82% lines (100.0% branches, 63.33% funcs)
9. `lib/tools/urlhaus.js` — 80.66% lines (64.71% branches, 100.0% funcs)
10. `scripts/run-check.js` — 81.37% lines (85.71% branches, 74.47% funcs)
11. `lib/llm/generate.js` — 82.40% lines (71.59% branches, 100.0% funcs)
12. `lib/scoring/config.js` — 85.00% lines (70.59% branches, 100.0% funcs)
13. `tests/helpers/mock-generate.js` — 85.34% lines (91.30% branches, 100.0% funcs)
14. `scripts/eval/runner.js` — 85.37% lines (80.00% branches, 62.86% funcs)
15. `lib/coordinator.js` — 85.83% lines (80.30% branches, 84.21% funcs)
16. `lib/report.js` — 86.42% lines (44.90% branches, 50.00% funcs)
17. `app/api/checks/[id]/report/route.js` — 87.10% lines (53.85% branches, 50.00% funcs)
18. `app/api/checks/[id]/confirm/route.js` — 88.14% lines (73.33% branches, 100.0% funcs)
19. `tests/tools-domain.test.js` — 88.16% lines (100.0% branches, 75.00% funcs)
20. `lib/agents/index.js` — 88.64% lines (54.55% branches, 100.0% funcs)
21. `lib/uploads.js` — 89.04% lines (79.17% branches, 100.0% funcs)
22. `lib/db/state-machine.js` — 89.47% lines (44.44% branches, 100.0% funcs)
23. `lib/agents/message-analyst.js` — 89.48% lines (75.73% branches, 100.0% funcs)
24. `scripts/seedGraph.js` — 89.71% lines (57.14% branches, 100.0% funcs)
25. `lib/contracts/case-file.js` — 89.89% lines (81.25% branches, 100.0% funcs)

---

### 5.2 Test Quality & Flakiness
- **Zero-Assertion Tests**: **0** (all 689 tests execute explicit assertions).
- **Tests Asserting ONLY doesNotThrow**: **0**.
- **Skipped or Todo Tests**: **0**.
- **Real Timers / Sleep**: **20 occurrences** in test files (e.g. `tests/api-e2e.test.js`, `tests/api-stream.test.js`, `tests/coordinator.test.js`). Used for async job polling, SSE connection settling, and rate limiter windows.
- **Flakiness Verification**:
  - Ran full test suite 3 consecutive times:
    - Run 1: 689 passed, 0 failed (27.7s)
    - Run 2: 689 passed, 0 failed (27.2s)
    - Run 3: 689 passed, 0 failed (27.7s)
  - Result: **0 flaky tests**.

---

### 5.3 Offline Network Hermeticity Test
**Method**: Ran test suite with network calls strictly blocked using `NODE_OPTIONS="--import /tmp/block-network.js"` throwing on any invocations of `fetch`, `net.Socket.connect`, `dns.lookup`, and `dns.promises.*`.  
**Output**:
- **Result**: `689 pass, 0 fail` (`100% hermetic`).
- **Conclusion**: Not a single test connects to the real internet or an external model API. All network dependencies and external services are properly mocked.

---

## 6. Actionable Plan & Recommendations

### 6.1 Proposed Changes

| # | Item | Category | Reason | Evidence Command |
|:---:|---|:---:|---|---|
| 1 | **Break Circular Import** (`lib/db/index.js` <-> `lib/cache.js`) | **SAFE** | Circular dependencies can trigger initialization bugs in bundlers. In `lib/db/index.js`, move `purgeCache` to inline SQL delete on `lookup_cache` or keep cache purging in `lib/cache.js`. | `npx madge --circular --extensions js lib/ app/` |
| 2 | **Centralize `process.env` access** | **SAFE** | Section 2.3 Rule 8 mandates that environment variables are read only through `lib/env.js`. Remove fallback defaults in `lib/coordinator.js`, `lib/db/index.js`, `lib/llm/generate.js`, `lib/logger.js`, and `lib/record-replay.js`. | `git grep -n 'process\.env' ':!lib/env.js'` |
| 3 | **Extract Shared Agent Utilities** (`formatFlagTitle`, `getProcessedEntityKeys`) | **SAFE** | Identical logic is copied across 5 agent files. Move to `lib/agents/base.js` and export cleanly. | Symbol occurrence search |
| 4 | **Add Missing Module Headers** | **SAFE** | Add 3-part header (Layer, Responsibility, Constraints) to all undocumented `lib/` files. | Section 4.2 table |
| 5 | **Add Missing Migration JSDoc** | **SAFE** | Add JSDoc comments to `up()` in migrations `001`, `002`, `003`. | Section 4.2 table |
| 6 | **Synchronize `docs/l7-progress.md`** | **SAFE** | Mark Step G as complete matching `AGENTS.md` and git commit history. | `git log --grep="L7-G" --oneline` |
| 7 | **Encapsulate DB Queries in `lib/db/`** | **RISKY** | ARCHITECTURE 2.3 Rule 2 states only `lib/db` touches the database. Currently `lib/graph.js` and `lib/cache.js` directly prepare statements on `graph_nodes`, `graph_edges`, and `lookup_cache`. Moving these statements into `lib/db/` touches high-traffic repositories. | `git grep -n '\.prepare(' ':!lib/db/**'` |
| 8 | **Rename CamelCase Files to Kebab-Case** | **RISKY** | Renaming `lib/caseFile.js` -> `lib/case-file.js` and `lib/tools/fetchPage.js` -> `lib/tools/fetch-page.js` enforces naming consistency, but touches imports across dozens of files. | Section 3.3 audit |
| 9 | **Remove Unused Knip-Reported Exports** | **SAFE** | Remove unused internal helpers while strictly keeping contract schemas and fixtures intact. | Section 2.2 audit |
| 10 | **Consolidate Script Server Helpers** | **SAFE** | Move duplicate `findFreePort` and `waitForServer` to a shared helper in `scripts/`. | Section 1.8 audit |
| 11 | **Address npm audit High Vulnerabilities** | **DEFER** | Upgrading `zod` from `v3` to `v4` or `next` from `v15` to `v16` is a breaking major upgrade and out of scope for a quality pass. | `npm audit --json` |

---

### 6.2 Proposed Deletions

| File | Why It Is Unused | Proof Command |
|---|---|---|
| *None proposed for immediate deletion* | All 15 files flagged by Knip are either standalone CLI scripts (invoked via `node scripts/...`) or deferred UI files (`deferred/ui/`). No dead orphan code was found. | `git grep` on file paths shows CLI scripts in `package.json` and UI files referenced in `ARCHITECTURE.md`. |

---

### 6.3 Proposed Test Work

1. **Improve Health Route Coverage**:
   - `app/api/health/route.js` has only 57.69% line coverage because the LLM connectivity test branch and error handler branches are rarely exercised during unit runs. Add test cases exercising healthy vs degraded health checks.
2. **Improve Secrets Scanner & Evaluate Coverage**:
   - `scripts/secrets-scan.js` (57.59%) and `scripts/evaluate.js` (31.01%) CLI arguments and error paths need dedicated unit tests in `tests/privacy-secrets.test.js` and `tests/evaluate.test.js`.
3. **Replace Real Timer Sleep in Fast Tests**:
   - In `tests/api-e2e.test.js`, `tests/api-stream.test.js`, and `tests/coordinator.test.js`, evaluate replacing fixed `setTimeout(50)` / `setTimeout(200)` sleeps with deterministic event listeners or fast condition-wait helpers.

---

### 6.4 Open Questions

1. **Database Boundary Encapsulation**:
   - Should `lib/cache.js` and `lib/graph.js` be migrated into `lib/db/` (or have their SQL statements delegated through `lib/db/index.js`) to strictly satisfy ARCHITECTURE section 2.3 Rule 2 ("Only `lib/db` touches the database")?
2. **File Renaming Scope**:
   - Should `lib/caseFile.js` and `lib/tools/fetchPage.js` be renamed to kebab-case (`lib/case-file.js`, `lib/tools/fetch-page.js`) in Step Q-B, or deferred to UI phase to avoid cross-layer import churn?
3. **Agent Export Suffix**:
   - Should `classifierClientAgent` in `lib/agents/classifier-client.js` be aliased/renamed to `classifierClient` to match `messageAnalyst`, `officialVerifier`, `websiteForensics`?
