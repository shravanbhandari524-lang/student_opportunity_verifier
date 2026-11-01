# Agent audit protocol (read-only phase)

Scope rules
- Audit only. Do not edit any file except writing your report to docs/audits/<agent>.md.
- Shared files (lib/contracts, lib/scoring/config.js, lib/agents/base.js, lib/coordinator.js, lib/extract.js, flag registry): never edit. Report needed changes as proposals.
- Cap live external calls: at most 30 search API queries and 40 LLM calls for the whole audit. Use the cache. Space live runs out to avoid 429 errors.
- Never fabricate data. Label synthetic test data as synthetic.

Report sections (use this order, cite file and line for every claim)
1. Contract and wiring: the AgentResult shape and every path where a result or finding is silently dropped, downgraded or turned into could_not_check or skipped.
2. canRun: exact rule, and what happens with each input kind (main text, userNotes, OCR text, each entity kind, empty input).
3. Inputs and prompts: what the agent actually receives; print any LLM prompt in full; confirm untrusted content is wrapped.
4. Tools and external calls: each tool, timeout, retry, cache TTL, failure result shape. Which failures become could_not_check, which are swallowed?
5. Flags: ids this agent can emit, severity, scoring weight, and patterns in the PRD for this agent that have no flag id.
6. Evidence: every flag must carry a quote or a source URL. Show how evidence is validated and where valid findings could be lost.
7. Semantics check: can the agent return ok with no findings when it did not actually check (silent failure)? Is "checked, nothing found" distinguishable from "could not check"? Never present "no reports found" as safe.
8. Live behavior with REAL services on a test set of at least 8 cases (benign, clearly bad, ambiguous, adversarial, missing input). Run each 2 times; report status, flags, evidence, duration, and any inconsistency.
9. Test coverage: what the existing tests do and do not cover (mocked versus live).
10. Ranked defect list (severity, evidence, suggested fix, shared-file changes needed) and a proposed test plan. Do not fix anything.
