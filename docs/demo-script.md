# Demonstration Script & Judge FAQ: Student Opportunity Verifier

## 1. Overview and Timing (5–6 Minutes Flow)

This document provides a guided walkthrough for live demonstrations, technical presentations, and competition judging.

| Timestamp | Stage | Action / Focus | Scenario / Mode |
|---|---|---|---|
| **0:00 – 1:00** | Problem Statement & Architecture | Introduce student vulnerability to task-scams, fake scholarships, and mule accounts; highlight deterministic fact-checking vs. LLM interpretation. | Slides / CLI Overview |
| **1:00 – 2:30** | Scenario A: Clear Scam | Run high-risk scholarship offer demanding UPI fee and using lookalike domain; showcase evidence-backed flags. | Scenario A (`node scripts/demo.js --scenario A`) |
| **2:30 – 3:45** | Scenario B: Genuine Notice | Run low-risk official fellowship notice; demonstrate that benign offers score 0 with clean evidence. | Scenario B (`node scripts/demo.js --scenario B`) |
| **3:45 – 4:45** | Scenario C: Ambiguous Thin Evidence | Run ambiguous offer; demonstrate safe fallback to `cannot_verify` rather than false safety assurances. | Scenario C (`node scripts/demo.js --scenario C`) |
| **4:45 – 5:30** | Privacy & Retention | Highlight the 24-hour expiration cascade, graph identifier retention, and DPDP safeguards. | `node scripts/privacy-check.js` |
| **5:30 – 6:00** | Q&A with Judges | Technical defense referencing the 12 Judge FAQ points below. | Codebase References |

---

## 2. Walkthrough Scenarios & Live Outputs

The demonstration relies on the canonical test fixtures in `lib/contracts/fixtures/scenarios/`.

> [!NOTE] Runner Stubs and Scoring Differences
> Different runners use different stub sets for different evaluation and execution purposes:
> - `node scripts/run-check.js` (`npm run check:run`): Uses full multi-round scenario fixtures with 9 flags across 2 rounds, reaching a capped score of `100 / 100` for Scenario A.
> - `node scripts/demo.js` (`demo.js`) & `api:e2e`: Use runtime single-round scenario deps emitting 4 flags (upfront fee [30], personal payment [25], new domain [20], classifier_high [0]) plus 22 points from the ML classifier probability (0.94), totaling a score of `97 / 100` for Scenario A.
> Both runners correctly reach the identical final `high` risk level.

### Scenario A: High-Risk Clear Scam
- **Input Text**:
  > *"Dear student, you have been shortlisted for the PM National Merit Scholarship 2026 of Rs 50,000. To release your sanction letter, pay an upfront verification fee of Rs 750 to director-scholarship@okhdfcbank within 24 hours. Verify your details at http://scholarships-gov.in/apply"*
- **Entities**:
  - `upi`: `director-scholarship@okhdfcbank`
  - `domain`: `scholarships-gov.in`
- **Output Assessment**:
  - **Risk Level**: `high`
  - **Score**:
    - `97` / 100 (when run via `node scripts/demo.js --scenario A` or `npm run api:e2e`)
    - `100` / 100 (when run via `node scripts/run-check.js` / `npm run check:run`)
  - **Confidence**: `high`
  - **Flags Emitted**:
    - Under `demo.js`: 4 flags (`scholarship_fee_demand`, `personal_payment_id`, `domain_new`, `classifier_high`)
    - Under `run-check.js`: 6 flags presented in report (`scholarship_fee_demand`, `urgency_pressure`, `personal_payment_id`, `lookalike_domain`, `domain_new`, `not_on_official_portal`)
  - **Action Checklist Items**: 9 items (`demo.js`) / 12 items (`run-check.js`)

### Scenario B: Low-Risk Genuine Notice
- **Input Text**:
  > *"National Science Foundation Fellowship 2026: Applications are invited from postgraduate students. No application fee is charged at any stage. Submit your research proposal directly on our official portal: https://www.nsf.gov/fellowships"*
- **Entities**:
  - `domain`: `nsf.gov`
  - `url`: `https://www.nsf.gov/fellowships`
- **Output Assessment (both `demo.js` and `run-check.js`)**:
  - **Risk Level**: `low`
  - **Score**: `0` / 100
  - **Confidence**: `high`
  - **Flags Emitted**: None (`0` flags)
  - **Verified Findings**: Trusted .gov registry, valid SSL, domain age > 10 years, Wayback history established.
  - **Action Checklist Items**: 4 items

### Scenario C: Ambiguous / Thin Evidence
- **Input Text**:
  > *"Part-time research assistant needed. Flexible hours, good stipend. Reach out on telegram @remote_work_desk for details."*
- **Entities**:
  - `handle`: `remote_work_desk`
- **Output Assessment (both `demo.js` and `run-check.js`)**:
  - **Risk Level**: `cannot_verify`
  - **Score**: `10` / 100
  - **Confidence**: `low`
  - **Flags Emitted**: 1 flag (`off_platform_contact`, severity medium, weight 10)
  - **Action Checklist Items**: 4 items
  - **Principle**: Non-negotiable product rule #3 — *No result is ever shown as "safe". Missing evidence means cannot_verify.*

---

## 3. Pre-Demo Checklist ("Verify Before Demo")

> [!IMPORTANT] Verify Before Demo
> 1. Run `node scripts/secrets-scan.js` to ensure working tree and git history have no exposed API keys.
> 2. Run `node scripts/replay-tools.js verify` if you plan to demonstrate using pre-recorded sessions.
> 3. Verify `.env.local` contains valid API keys if conducting live internet lookups.
> 4. Run `npm test` to verify all 686 unit and integration tests pass cleanly.

---

## 4. Fallback Plan (Offline Resilience)

If internet connectivity fails or API rate limits are encountered during a live presentation:

1. **Replay Mode**:
   Set `RECORD_REPLAY_MODE=replay` in environment:
   ```bash
   RECORD_REPLAY_MODE=replay node scripts/demo.js
   ```
   The system will replay pre-recorded model responses from `.recordings/` with 0 network calls.
2. **Offline Fixtures Mode**:
   Execute the evaluation fixture harness directly:
   ```bash
   npm run eval:fixtures
   ```
   Runs completely offline against deterministic snapshot fixtures in < 2 seconds.

---

## 5. UI & API Explanation Guide

When explaining the system architecture to technical reviewers:
- **Timeline & SSE Streams (`/api/checks/:id/stream`)**:
  - Show how SSE events stream live progress across stages: `extracting` → `awaiting_confirmation` → `investigating` → `scoring` → `report_ready`.
- **Status Distinctions (`skipped` vs `could_not_check`)**:
  - `skipped`: Agent was not eligible (e.g., no phone number provided; `canRun` returned `false`). Not counted against confidence.
  - `could_not_check`: Agent had data to verify, but external upstream lookup timed out or failed. Penalizes confidence score.
- **Rounds (Max 2)**:
  - Round 1 checks user-confirmed entities. Discovered entities (e.g. redirected domain or handle in text) pass SSRF guards and are investigated in Round 2.
- **Evidence Backing**:
  - Every flag strictly cites an exact quotation from user input or an authoritative external verification source.

---

## 6. Judge FAQ (12 Key Questions Answered)

#### Q1: "How do you prevent defamatory statements about named individuals or companies?"
**Answer:** Non-negotiable product rule #1 strictly enforces that outputs are objective risk assessments evaluating the specific opportunity text and infrastructure, never naming individuals as "scammers". All flag explanations are validated by Zod schemas in `lib/contracts/report.js` to ensure neutral, evidence-based descriptions.

#### Q2: "Can an attacker trick your LLM with prompt injection in the submitted text or screenshot?"
**Answer:** All untrusted user text, OCR transcriptions, and fetched web content are encapsulated within delimited, sandboxed blocks with strict instructions for the LLM to ignore inline commands (see `lib/llm/generate.js`). Furthermore, the LLM only generates explanatory text; final risk levels and scores are computed by 100% deterministic code in `lib/scoring/score.js`.

#### Q3: "What prevents Server-Side Request Forgery (SSRF) when your crawler visits links found in offers?"
**Answer:** The HTTP fetcher in `lib/tools/fetch-page.js` utilizes `assertPublicUrl` from `lib/tools/ssrf.js`. It resolves DNS hostnames, parses all IPv4/IPv6 addresses using `ipaddr.js`, blocks loopback, private RFC-1918 ranges, link-local, and AWS/cloud metadata IPs, pins the resolved IP for socket connection, and validates redirect destinations up to 3 hops.

#### Q4: "Why don't you scrape LinkedIn, Facebook, or Instagram to verify recruiters?"
**Answer:** Per product rule #5 and platform Terms of Service, we do not scrape authenticated or rate-restricted social platforms. Doing so introduces legal risk, unreliable bot-detection hurdles, and privacy violations. We focus on public domain registrars (RDAP), DNS records, SSL certificates, threat databases (URLhaus, URLscan), and search dorks.

#### Q5: "How does the system distinguish a genuine new startup from a scammer's fresh domain?"
**Answer:** A fresh domain (< 30 days old) triggers the medium-severity `domain_new` flag, not an automatic `high` scam rating. If the domain has valid DNS, legitimate SSL, no lookalike characteristics, and demands no upfront payment, the case receives a moderate or low score, with advice to verify the offer through official channels.

#### Q6: "What happens if an external threat intelligence API goes down during a check?"
**Answer:** All tool invocations use safe wrappers in `lib/tools/` with strict 10-second timeouts. If an upstream service fails or times out, the tool returns an error code (e.g. `UPSTREAM_ERROR`, `TIMEOUT`). The agent records status `could_not_check`, which lowers overall assessment confidence without crashing the pipeline.

#### Q7: "How is the final risk score computed? Does the LLM decide it?"
**Answer:** The LLM NEVER decides the final risk score. The scoring engine in `lib/scoring/score.js` is pure deterministic code that tallies base severity points, applies compounding risk penalties, checks for hard rules (e.g., upfront scholarship fees or mule accounts), and bounds the final score between 0 and 100.

#### Q8: "How does your system protect student privacy and comply with data retention limits?"
**Answer:** Checks and uploaded screenshots have a strict 24-hour lifetime. `runCleanup` (`lib/cleanup.js`) permanently deletes expired checks, which cascades across all input and finding tables. Uploaded images are removed immediately after extraction or within 1 hour. Only verified identifiers from high-risk checks are stored long-term in the intelligence graph.

#### Q9: "Why does Scenario C result in 'cannot_verify' instead of 'safe'?"
**Answer:** Per product rule #3, no result is ever shown as "safe". An offer with thin evidence or missing identifiers cannot be confirmed genuine. Displaying "safe" creates a dangerous false sense of security; hence, missing evidence deterministically produces `cannot_verify`.

#### Q10: "How do you test and evaluate accuracy without leaking real student conversations?"
**Answer:** During development and evaluation, the project strictly uses synthetic or paraphrased public notices (see `data/eval/sample-cases.json`). The evaluation suite (`scripts/evaluate.js`) measures calibration, confusion matrices, and dangerous misses without storing or transmitting personal messages.

#### Q11: "Can a user claim your assessment caused them business damage?"
**Answer:** All API responses and reports include an explicit disclaimer stating that findings are automated, evidence-backed risk indicators for educational self-defense, not definitive legal or defamatory determinations. See `docs/l7-spec.md` and `lib/contracts/report.js`.

#### Q12: "How does the coordinator handle entity discovery and prevent infinite crawl loops?"
**Answer:** The coordinator (`lib/coordinator.js`) enforces a deterministic maximum of 2 rounds. In Round 1, agents may return up to 5 newly discovered entities of kind `domain`, `handle`, or `company`. These entities are validated, deduplicated, and checked against SSRF rules before being queried in Round 2. Round 2 never spawns a Round 3.

---

## 7. What We Do NOT Claim

In keeping with engineering integrity:
1. **No Absolute Accuracy Claim**: We do not claim 99%+ accuracy based on synthetic test sets; our evaluation metrics explicitly disclose confidence intervals and synthetic boundaries (`docs/evaluation.md`).
2. **Not a Safety Guarantee**: A score of 0 or level `low` indicates absence of detected scam indicators in submitted materials, not a guarantee of employer trustworthiness.
3. **Not a Background Check Service**: We do not trace, dox, or identify individual persons behind phone numbers or bank accounts.
