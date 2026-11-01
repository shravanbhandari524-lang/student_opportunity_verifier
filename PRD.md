# Product Requirements Document: Student Opportunity Verifier

Working title · Draft v1 · 17 October 2026 · Prepared for Shreyas and team

## 1. Overview

### 1.1 Problem

Students constantly meet scholarships, internships, jobs, freelance work, competitions, websites and messages online. Many are genuine, but others are designed to collect money or personal information. Documented patterns include fake scholarship links circulating on WhatsApp (for example the fake National Sports Scholarship 2026-27 flagged by PIB Fact Check), internship offers that demand a "registration fee", Telegram task jobs that start with small payouts and then ask for deposits, and offers to rent out a student's bank account, which turns the student into a money mule.

The challenge is not only detecting scams but helping users understand why something may be risky and what to verify before acting.

### 1.2 Product vision

A website where a student submits a suspicious offer (text, screenshot, link, payment ID) and receives a **risk level, plain-language reasons backed by sources, and a checklist of what to verify before taking action**. The system investigates like an analyst: it reads the message, inspects the website, checks official sources, searches for public reports, and links payment IDs across reports.

### 1.3 Goals

1. Give every submission one of four outcomes: Low, Medium, High, or Cannot verify.
2. Explain every flag in simple language with a source the user can open.
3. Tell the user exactly what to verify next and how.
4. Help victims act fast (reporting steps and a pre-filled complaint summary).
5. Get smarter over time through a scam intelligence graph and user feedback.

### 1.4 Non-goals

- Declaring a person or organisation "a scammer". Output is a risk assessment with evidence.
- Tracing, locating or identifying private individuals (no IP, location or name lookup from a phone number).
- Scraping Instagram, Facebook or LinkedIn.
- Guaranteeing that an offer is safe. "No reports found" is never shown as "safe".

### 1.5 Target users

- School and college students (primary), looking at scholarships, internships, jobs, competitions.
- Parents of students (secondary), who are targeted by scholarship calls.
- College placement cells and teachers (later), who can share the tool.

### 1.6 Success metrics

| Metric | Target for demo |
|---|---|
| Classifier F1 on held-out test set | Report the real number, aim above 0.85 |
| End-to-end agreement with human labels (50-100 test cases) | Above 80% |
| Time from submit to report | Under 60 seconds |
| Every flag in a report has a source or quoted evidence | 100% |

## 2. Scam types in scope

| Type | Typical pattern | Key signals the system looks for |
|---|---|---|
| Fake scholarship | WhatsApp or SMS link, call to parents, "selected" message | Fee requested, non-.gov.in domain, not listed on the official portal, APK download, QR code requests |
| Fake internship or job | Offer without interview, "registration" or "training" fee, impersonated placement cell | Free-mail recruiter, personal UPI ID, urgency, company not found in registries |
| Task or part-time job | Telegram or WhatsApp group, small early payouts, then a deposit | Off-platform contact, "like and earn", deposit for a premium task, fake earning screenshots |
| Money mule offer | "Rent your account", "receive money for a commission", currency exchange pitch | Request for bank account, ATM card or SIM, commission per transfer |
| Fake competition or certificate | Entry fee, instant certificate, borrowed brand name | Unverifiable organiser, certificate sold for a fee, copied branding |
| Overseas study or visa agent | Deposit for admission, forged confirmation letters | Direct admission claims, deposits to personal accounts |

## 3. Inputs

| Input | Format and limits | How it is used |
|---|---|---|
| Message text | Pasted text, up to 10,000 characters | Message Analyst, classifier |
| Chat screenshots | Up to 5 images, PNG or JPG, 5 MB each | Vision extraction, then same as text |
| Link or website | URL | Website Forensics, Official Verifier, Reputation |
| UPI ID or payment details | Text, validated by format | Payment and Entity checker, graph |
| Company or organisation name | Text | Official Verifier, Reputation |
| Social handle or channel link | YouTube, Reddit, public Telegram channel (no Instagram scraping) | Reputation / OSINT |
| YouTube video URL | URL | Comment analysis through the official API |
| Phone number (optional) | Text, validated with libphonenumber | Validation, scam-report search, graph match only. No tracing, no name or location lookup |
| Language preference | English, Hindi, others later | Report language |

At least one of text, image or link is required. All other fields are optional. The more the user provides, the higher the confidence of the report.

## 4. Website structure and routes

**Build scope:** backend first. The API routes and the live progress stream are built first. The pages below are specified now and built after the backend passes its gates.

| Route | Purpose |
|---|---|
| `/` | Landing page: what the tool does, example scams, a "Check an offer" button |
| `/check` | New check form: text box, image upload, optional fields (link, UPI ID, company, handle, phone), language selector, consent checkbox |
| `/check/[id]` | One page with three states: extraction confirmation, live progress, final report |
| `/guides` | List of scam types |
| `/guides/[type]` | Guide for one scam type (how it works, red flags, what to do) |
| `/report-fraud` | "I already paid or shared details" help: steps and complaint summary generator |
| `/about` | How it works, data sources, limits, privacy |
| `/feedback` | Optional page or modal for "this was right / wrong" |

Shared UI components: input form, extracted-entities editor, progress timeline, risk badge, flag card (title, explanation, evidence links), checklist, action buttons, disclaimer footer.

## 5. End-to-end user flow

A check moves through these states: `created`, `extracting`, `awaiting_confirmation`, `investigating`, `scoring`, `report_ready` (or `failed`).

1. **Submit.** The user opens `/check`, adds inputs and ticks the consent box ("I understand this is a risk assessment, not a legal verdict"). The frontend calls `POST /api/checks`.
2. **Extraction.** The backend stores the inputs and starts extraction: a vision model reads each screenshot (messages, sender label, timestamps, links, amounts, payment IDs) and regex finds URLs, UPI IDs, emails, amounts and phone numbers in all text.
3. **Confirm.** The user lands on `/check/[id]` in the `awaiting_confirmation` state and sees what was read: the conversation text and a list of detected entities (domains, UPI IDs, company names, handles). They can edit, delete or add items. This prevents wrong readings from corrupting the report. They click "Start check".
4. **Investigation.** The frontend calls `POST /api/checks/:id/confirm`. The main agent (coordinator) reads the case file, runs every specialist agent that has something to check in parallel, and skips the others with a reason. If an agent discovers new items (for example a linked domain), a second round runs for the agents they make eligible. The page shows a live timeline (for example "Checking website... done", "Payment check... skipped: no payment ID") using server-sent events or polling.
5. **Scoring.** When agents finish or time out, the scoring engine combines flags and the classifier output into a risk level.
6. **Report.** The report writer produces the explanation, checklist and recommended actions in the chosen language.
7. **Act.** The user can open any source link, copy the checklist, generate a draft email to the college or placement cell, open the "I already paid" help, or mark the report as right or wrong.
8. **Optional save.** If the user agrees, identifiers (UPI ID, domain, handle) from a High-risk report are saved to the scam graph. Screenshots and message text are not saved.

## 6. Backend API

All routes are JSON unless stated. Base path `/api`.

| Method and route | Purpose | Request | Response |
|---|---|---|---|
| `POST /checks` | Create a check and start extraction | multipart: text, images, url, upiId, company, handle, phone, language | checkId, status |
| `GET /checks/:id` | Read state and extracted entities | none | status, extracted text and entities |
| `POST /checks/:id/confirm` | Confirm or edit entities and start the investigation asynchronously | entities, text | status: investigating (idempotent 200 on replay with current status) |
| `GET /checks/:id/stream` | Live progress (server-sent events) | none | trace events with seq, agent, tool, status, activity, summary |
| `GET /checks/:id/report` | Final report | none | report object (section 11) |
| `POST /checks/:id/feedback` | User feedback | verdict (right or wrong), optional comment | ok |
| `POST /checks/:id/save-to-graph` | Save identifiers with consent | consent: true | number saved |
| `POST /checks/:id/college-email` | Draft an email to the college or placement cell | recipientType | subject, body |
| `POST /checks/:id/fraud-summary` | Pre-filled complaint summary | optional amount, date, paymentMethod | text |
| `POST /fraud-summary` | Standalone complaint summary (no check ID) | optional amount, date, paymentMethod, language | title, narrative, victimSteps, reportingChannels |
| `GET /guides/:type` | Guide content | none | guide content |

Internal service (not public): `POST classifier/classify` takes the message text and returns a label, a probability and the top contributing terms.

Conventions: every check has an id, expires after 24 hours, and can be fetched only with its id. Errors return an error message and code with user-safe wording. Confirming a check is idempotent: replays while `investigating`, `scoring`, or `report_ready` return HTTP 200 with the check's current status and never launch duplicate investigations. The coordinator runs asynchronously via a bounded background job runner. Stale checks stuck in `investigating` or `scoring` longer than 10 minutes are swept by the maintenance cleanup job, moved to `failed` with failure reason `coordinator_pipeline_error`, and emit a `check_event`.

## 7. Processing pipeline: what runs, when, and which model

The design principle is **deterministic code for facts, LLM for reading and explaining**. The LLM never decides the final risk level.

| Stage | When | What runs | Model or tool type | Output |
|---|---|---|---|---|
| 0. Validation | On submit | Input checks, file type and size limits, regex entity extraction | Code | Validated inputs, raw entities |
| 1. Screenshot extraction | On submit, per image | Read messages, sender, links, payment IDs, amounts | Vision-capable LLM | Text and entities |
| 2. Confirmation | After extraction | User edits entities | UI | Confirmed inputs |
| 3a. Classifier | After confirm, parallel | Score message text | Trained ML model (Python service) | Scam probability, top terms |
| 3b. Message Analyst | After confirm, parallel | Find red-flag patterns in the conversation | LLM, no tools | Flags with quoted evidence |
| 3c. Website Forensics | After confirm, parallel, if a domain exists | Domain age, DNS, SSL, lookalike check, Wayback, Safe Browsing, URLScan, copied-text check | Code tools only, no LLM; report writer summarizes | Flags with evidence |
| 3d. Official Verifier | After confirm, parallel | Check .gov.in, official portal or PIB mentions, company registry claims | Search API plus LLM reading results | Verified, unverified or contradicted claims |
| 3e. Reputation / OSINT | After confirm, parallel | Dorks, Trustpilot single lookup, Reddit, YouTube comments, public Telegram content | Search API, official APIs, LLM judging | Flags with source links |
| 3f. Payment and Entity | After confirm, parallel | Search UPI ID, domain or handle; query the scam graph | Code plus search | Matches and flags |
| 4. Scoring | When 3a-3f finish or after timeout | Weighted flags and hard rules | Code | Risk level, score, confidence |
| 5. Report writer | After scoring | Explanation, checklist, actions, translation | LLM | Final report |
| 6. Persistence | After report | Store report, optionally save to graph | Code | Database rows |

Timeouts: each agent has a 25-second limit. A timed-out agent returns a could_not_check status and lowers confidence instead of failing the whole check.

**Case file and eligibility:** everything known about a check lives in one case file (inputs, entities, findings, events). The main agent runs only the agents whose input exists in the case file. For example, if the user submits only a chat screenshot, extraction runs first, and agents wake up only for what the screenshot contained. An agent with nothing to check returns skipped, which does not lower confidence; an agent that fails or times out returns could_not_check, which does. Agents never write to the case file; the main agent validates and merges their results. Up to 2 rounds run, so entities discovered in round 1 can trigger agents in round 2. See ARCHITECTURE.md section 3.

## 8. Agent specifications

Every agent returns the same structure: agent name, status (`ok`, `skipped` or `could_not_check`) with a reason, a list of flags, a list of verified items, any newly discovered entities, and notes. When status is not `ok`, arrays must be empty. When agent is `classifier_client` and status is `ok`, it may additionally include an optional `classifierResult` object. Each flag has an id from a fixed 36-flag registry, a title, severity, explanation and evidence (a quoted snippet from user input or a source URL).

**Agent behavior rules:**
- **R1 Eligibility:** Cheap deterministic, synchronous `canRun(snapshot)` check (no I/O, no LLM). If nothing to check, returns `skipped` with a reason.
- **R2 Single writer:** Agents only return findings. Only the coordinator writes to the case file.
- **R3 Execution safety:** 25-second timeout. Agents never throw; uncaught errors become `could_not_check`. Discovered entities are capped at 5 per agent per round, restricted to `domain`, `handle`, and `company` kinds with evidence, normalized, deduplicated, and domains pass a synchronous SSRF host check before being returned. Maximum 2 rounds.
- **R4 Registry flags only:** Agents emit only from the 36 registered flag IDs authorized by `canEmit`. Severity and title come strictly from the registry.
- **R5 Result rules:** `ok` returns findings; `skipped` when `canRun` is false; `could_not_check` on timeout, error or invalid result. "No red flags found" notes state that the offer is not guaranteed safe.
- **R6 Language:** Agent explanations are generated in English; the L5 report writer handles translation.
- **Dependency injection:** Agents receive dependencies (`{ generate, classify, now }`) with production defaults, allowing deterministic offline testing.

### 8.1 Coordinator (main agent)

Owns the case file. Runs extraction, then rounds: it evaluates which agents can run, starts them in parallel with `Promise.allSettled`, enforces timeouts, validates and merges their results, streams progress, and passes the merged findings to the scoring engine and then the report writer. It is plain code; the LLM is used only in extraction, inside agents that need language understanding, and in the report writer. Discovered entities are capped (5 per agent per round), normalized and marked as discovered, and the number of rounds is limited to 2.

### 8.2 Message Analyst

- **Input:** conversation text.
- **Looks for:** fee or deposit demands at any stage (including after offer), equipment advances to company-approved vendors, unsolicited awards, chat-only interviews, arbitrary hours with high pay claims, pay too high for unskilled tasks, unusual daily/per-task pay schedules, urgency or deadlines, pressure to move to WhatsApp or Telegram, selection without interview, guaranteed income, early requests for bank details or OTPs/Aadhaar before selection, impersonation of an authority, task-and-deposit scripts, mule-style requests (account rental, commission per transfer).
- **Tools:** none.
- **Rules:** Evaluates pay relative to role complexity and skill level, never with fixed salary cutoffs. Executive outreach (`exec_dm_outreach`) is routed to the manual checklist, not emitted as an automated flag.
- **Note:** spelling mistakes are a weak signal, used only as a minor input.

### 8.3 Website Forensics

- **Input:** domain or URL.
- **Checks:** domain age and registrar (RDAP), DNS records, SSL certificate, lookalike distance to well-known organisations, certificate transparency for sibling domains (crt.sh), Wayback history, URLhaus feed lookup and urlscan.io search of existing scans, copied About-page text via quoted search, data-harvest redirect chains, missing contact or legal pages. A URL not in a feed is never presented as safe.
- **TLD Invariant:** A `.org` (or any generic TLD) domain is NEVER placed into verified on the TLD alone.
- **Tools:** domain tools only, no LLM: every fact comes from a tool; the report writer summarizes.
- **Website Forensics check rules:** Website Forensics does not emit non_gov_domain_claiming_gov (Official Verifier is the sole emitter in agent code).

### 8.4 Official Verifier

- **Input:** claimed scheme, organisation or registration.
- **Checks:** whether the link is a .gov.in domain, whether the scheme appears on the official scholarship portal or the sponsoring ministry site, whether PIB Fact Check or the institution has published a warning, whether a claimed company registration can be found.
- **Method:** site-restricted searches such as `site:gov.in "scheme name"`. Registry lookups that have no free API (for example MCA or GST) are shown as "verify manually" links in the checklist rather than claimed as checked.
- **Official Verifier check rules:** Official Verifier makes no registry claims it cannot check. Registries without a free API (MCA, GST, National Scholarship Portal listing) are returned as manual_check entries in trace and are never reported as checked or verified. not_on_official_portal is based on a bounded site-restricted search and is worded as 'not found in a limited search', never as proof of absence. In Official Verifier, the LLM is restricted to finding official_warning_found only. non_gov_domain_claiming_gov and not_on_official_portal are strictly code-decided. authority_impersonation stays unemitted by this agent.

### 8.5 Reputation / OSINT

- **Input:** brand, domain, handle, link.
- **Dorks (generated by the agent, executed by code):** scam or fraud keywords with the brand, `site:reddit.com`, `site:trustpilot.com`, complaint sites, a minus-site search to see what others say about a domain, and quoted distinctive text to find copying.
- **Trustpilot:** locate the company page through search, then read the public page for review count, rating spread, dates and reply behaviour. Single user-triggered lookups only, and the current terms of service must be checked first. A missing page is reported as "no reputation history found".
- **Review patterns:** bursts of five-star reviews on nearby dates, near-identical wording, reviewers with one review.
- **Comments (YouTube):** official YouTube Data API, with heuristics (duplicate and near-duplicate ratio, generic praise, emoji-only comments, posting bursts) plus LLM judgement on a sample.
- **Reddit:** through site-restricted search, or the official API subject to current terms.
- **Telegram:** public channel content supplied by the user as a link, pasted text or screenshot. Automated access only where the platform's terms allow it.
- **Reputation / OSINT check rules:** The agent does no automated Trustpilot, Reddit, Telegram or Instagram access; Reddit and review sites are reached only through site-restricted search results, and a Trustpilot manual_check link goes in trace for company and domain items. The LLM is used only to judge whether a search result is about the same entity. The agent returns no newEntities in L4 (`newEntities: []`). "No reports found" is never a flag, a verified item or a safety claim.

### 8.6 Payment and Entity Checker

- **Input:** UPI IDs, domains, handles, phone number.
- **Checks:** scam-report search on each identifier, graph lookup for earlier reports, phone validation and classification (libphonenumber), consistency checks (for example a government scheme asking for payment to a personal-looking ID).
- **Phone numbers:** never traced. Used only for validation, report search and graph matching.
- **Email recruiting check:** When an email entity is processed and `emailFacts` reports it is from a free provider (`isFreeProvider === true`), the agent checks if the message text contains a recruitment context term (`RECRUITMENT_CONTEXT_TERMS`). If matched with a code-verified quote, it emits `free_email_recruiter` with quote evidence.
- **Check failure counting:** payment_entity counts each check (graph lookup, validation, scam-report search) separately. The result is could_not_check only when every check on every item failed. An item with at least one successful check is ok; a failed search is recorded in trace and notes and never reported as 'no reports found'.
- **Multi-item partial failure rule:** Every agent that processes several items treats them independently. If some items are checked and others fail, the result is ok with per-item outcomes in trace and notes; could_not_check only when every eligible item failed.
- **Default graph dependency:** The default graph dependency is a no-op failure; the coordinator injects the real lookup.

### 8.7 Classifier Client

- **Input:** conversation text.
- **Role:** calls the ML classifier microservice in round 1; on success attaches `classifierResult` to the agent result for scoring.
- **Rule:** The classifier_high flag is emitted only when classifier probability is at least 0.80 and at least one top contributing term appears verbatim in the message text as quote evidence (at most 3 terms).

## 9. ML classifier

- **Task:** classify message text as suspicious or benign (`label: "suspicious" | "benign"`), with a probability (P(scam), a float between 0.0 and 1.0), top contributing terms as a string list (`topTerms: string[]`), and an optional informational scam classification (`scamType?: string`, not used by scoring).
- **Data:** a labeled set built from public scam advisories and news reports, Reddit scam posts, and genuine notices from official career pages and scholarship portals. Target 500 or more examples across the scam types, with a fixed test split (20%) never used for training. Note: the starter dataset is synthetic for pipeline validation only, so no performance claim may cite starter metrics.
- **Models:** baseline of TF-IDF plus logistic regression (scikit-learn). Stretch goal: fine-tune a multilingual transformer for Hindi and English.
- **Serving:** small Python FastAPI service called by the Node backend.
- **Reporting:** precision, recall and F1 on the test split, a confusion matrix, and a list of failure cases shown honestly in the presentation.
- **Role in the product:** one input to the score. It does not override evidence from agents.

## 10. Scoring engine and evidence ledger

Plain code, fully explainable. Built on an evidence ledger (`lib/evidence/ledger.js`) derived from sanitized agent results, and configured via `lib/scoring/config.js` with weights tuned against the test set. Scoring is a pure function performing zero file I/O or network requests.

### 10.1 Algorithm
1. **Evidence ledger reconciliation:** Sanitized agent results are transformed into structured ledger entries `{ id, agent, round, kind, flagId, claimKey, quoteOrUrl, evidenceType, verificationStatus, confidence, supportingSource, timestamp }`. A pure `reconcile(ledger)` step detects:
   - Duplicates: identical `claimKey` with overlapping evidence across agents.
   - Corroboration: independent methods supporting the same claim (e.g. LLM quote from text plus a search result or payment demand analysis).
   - Contradictions: classifier low vs rule/LLM finding of a fee; official verified vs warning; official-domain curated list vs mismatch flag. Contradictions do not alter the score but are surfaced in the report under "Where the checks disagreed".
2. **Evidence coverage computation:** Compute which of 5 independent signal types were successfully checked (`status === "ok"`):
   - `message`: Message & Offer text analysis completed.
   - `payee`: Payment & UPI verification completed (UPI, phone, or bank details checked).
   - `website`: Domain & Web forensics completed (domain age, DNS, SSL, web presence).
   - `official`: Official Registry / government portal verification completed.
   - `reputation`: Community complaints and OSINT search completed.
   Returns `coverage: { checked: string[], notChecked: string[] }` containing the checked and not-checked signal types.
3. **Eligible agents:** Results with status `ok` or `could_not_check`. Skipped agents are not eligible and not counted. Each `(agent, round)` counts once. If there are zero eligible agents, the outcome is `cannot_verify` with `low` confidence and reason code `no_eligible_agents`.
4. **Ledger-backed flag points, groups, and caps:** Collect flags only from `ok` results, mapped to normalized `claimKey`s. Each `claimKey` counts once at its highest weight (no double counting). Weights come from `config.flagWeights[id]`, falling back to `config.severityWeights[severity]` if missing.
   - **Fee group (D1):** `scholarship_fee_demand` and `fee_demand` form group `fee`. Only the highest weight among present members counts toward points; others are suppressed (0 points, status `group_suppressed`). The `scholarship_fee_demand` hard rule still triggers on its own flag id.
   - **Fee / Equipment mutual exclusion group:** `fee_demand` and `equipment_advance` form exclusion group `fee_equipment`. Only the highest-weight flag from this group counts; others are suppressed (0 points, status `group_suppressed`), and `rulesFired` records `"exclusion:fee_equipment"`.
   - **Correlation groups (per-group cap of 20 points):**
     - `hiring_process`: `chat_only_interview`, `no_interview_selection`, and `candidate_picks_hours` form group `hiring_process`. Their combined contribution is capped at 20 points; when the cap is applied, `rulesFired` records `"correlation_cap:hiring_process"`.
     - `pay`: `pay_too_high` and `unusual_pay_schedule` form group `pay`. Their combined contribution is capped at 20 points; when the cap is applied, `rulesFired` records `"correlation_cap:pay"`.
   - **Corroboration bonus:** When independent methods corroborate a claim (e.g. text quote and search result both pointing to scam complaints or fee demands), a configurable bonus is added (default +5 points, capped at +10 points across the check). Recorded in `rulesFired` as `"corroboration_bonus"`.
   - **Soft-flag cap (45 points):** Total points from all `low` and `medium` severity flags combined (after correlation caps and corroboration bonuses) is capped at **45 points**. When applied, `rulesFired` records `"soft_flag_cap_applied"`.
   - **No-high-evidence cap (59 points):** If the result has no high-severity flag, no hard rule, and no graph match, the final score (flags plus classifier) is capped at **59**. When this cap applies, `rulesFired` records `"no_high_evidence_cap"`. This ensures that for any `classifierMaxPoints` value (10 or 25), soft flags plus classifier points can never reach 60 (the High threshold) without high-severity corroboration.
5. **Classifier scaling and non-override invariant (D4):** Scoring takes `classifierMaxPoints` as an input parameter (default 25; 10 when provenance is synthetic or real test rows < 60). When `classifier_client` returns status `ok` with `classifierResult`, points are calculated explicitly as:
   `classifierPoints = Math.round(classifierMaxPoints * Math.max(0, (probability - 0.5) / 0.5))`
   Scaling linearly from 0 at p=0.5 to `classifierMaxPoints` at p=1.0. If no `ok` classifier result exists, classifier points are 0.
   **Non-override invariant:** The classifier never lowers the score and never overrides evidence established by agents or hard rules.
   Raw score is clamped: `score = Math.min(100, Math.max(0, Math.round(sum of flag points + corroborationBonus + classifierPoints)))`.
   If no high-severity flag, hard rule, or graph match is present, the final score is capped at 59 (`score = Math.min(score, 59)`), and `rulesFired` records `"no_high_evidence_cap"` if the raw score exceeded 59.
6. **Hard rules (D5):** `scholarship_fee_demand`, `mule_account_request`, and `graph_match` (from `ok` results). If any hard rule fires:
   - Risk level is forced to `high`.
   - Score floor is raised to the high threshold: `score = Math.max(score, config.thresholds.high)` (60 by default).
   - Rules that fired are recorded in `rulesFired`.
   - `cannot_verify` is never applied.
7. **Big Brand or Institution without Official Channel Rule:**
   If the check claims a known major organization or brand (e.g. Google, TCS, Infosys, Microsoft, Amazon, Government ministries, or known scheme) and NO official channel is supplied or verified (no official corporate/portal domain present, contact is a personal UPI ID, social handle, free-mail address, or chat app only), the level is forced to at least `medium` (score raised to at least 25 if below), and `rulesFired` records `"big_brand_no_official_channel"`.
8. **High & Medium Flag Baselines:**
   - Any high-severity flag forces the risk level to at least `medium`.
   - Any medium-severity flag with no positive verified signal forces the risk level to at least `medium`, even if the numeric score is below 25.
9. **Low Risk Strict Gate (Low allowed ONLY when ALL hold):**
   A check is classified as `low` only when ALL of the following hold:
   - No flag of severity `medium` or `high` is present.
   - At least 2 independent signal types were checked successfully (`coverage.checked.length >= 2`).
   - At least one positive verified signal exists (e.g. official domain matched claimed company, valid established domain, known official source) OR at least 3 eligible checks completed with no flags.
10. **Thin Coverage Rule (Cannot Verify):**
   If no flags are found but evidence coverage is thin (fewer than 2 signal types checked), the risk level is `cannot_verify` with reason `"thin_coverage"` and plain-language explanation ("Insufficient evidence coverage: fewer than 2 signal types could be checked").
11. **Cannot Verify Completeness Rule:**
   If fewer than 40% of eligible checks completed (`completedCount / eligibleCount < 0.40`) AND score is below 60 AND no hard rule fired, the risk level is `cannot_verify`.
12. **Critical agents rule (default: `message_analyst`):**
   If a critical agent was eligible and has no `ok` result in any round, the level can never be low. A would-be low becomes `cannot_verify` with low confidence and reason code `critical_agent_failed`. A medium or high level is kept. Skipped critical agents (no message text) are not failures.
13. **Coverage-Based Confidence:**
   Confidence is determined by evidence coverage and completion health:
   - `high`: At least 4 signal types checked (`coverage.checked.length >= 4`) AND no critical agent failed AND eligible completion ratio `>= 0.80`.
   - `medium`: 2 to 3 signal types checked (`coverage.checked.length >= 2`) AND eligible completion ratio `>= 0.50`.
   - `low`: Fewer than 2 signal types checked (`coverage.checked.length < 2`), OR completion ratio `< 0.50`, OR final risk level is `cannot_verify`.
   - Skipped agents never lower confidence; failed eligible agents lower confidence.
   - Hard rules yielding High with thin evidence still yield High.
14. **Plain Language Explanations:** Every outcome lists the exact rules that fired in plain human-readable language in `rulesFired`.
15. **Traceability:** Every flag in the report is traceable to an evidence ledger entry (`evidenceId`, `sourceAgent`, `quoteOrLink`).

### 10.2 Weight Table
- **High flags (17):**
  - `scholarship_fee_demand`: 30
  - `fee_demand`: 30
  - `equipment_advance`: 25
  - `mule_account_request`: 40
  - `bank_details_request`: 25
  - `otp_or_id_request`: 30
  - `authority_impersonation`: 25
  - `task_deposit_script`: 30
  - `apk_download_prompt`: 30
  - `qr_code_payment_request`: 20
  - `lookalike_domain`: 20
  - `non_gov_domain_claiming_gov`: 25
  - `personal_payment_id`: 25
  - `official_warning_found`: 40
  - `scam_reports_found`: 25
  - `graph_match`: 40
  - `url_in_threat_feed`: 40
- **Medium flags (12):**
  - `no_interview_selection`: 15
  - `unsolicited_award`: 15
  - `chat_only_interview`: 15
  - `pay_too_high`: 15
  - `guaranteed_income`: 15
  - `free_email_recruiter`: 15
  - `domain_new`: 20
  - `not_on_official_portal`: 20
  - `review_burst`: 10
  - `copied_content`: 10
  - `data_harvest_redirects`: 15
  - `classifier_high`: 0
- **Low flags (7):**
  - `candidate_picks_hours`: 10
  - `unusual_pay_schedule`: 10
  - `urgency_pressure`: 10
  - `off_platform_contact`: 10
  - `domain_no_history`: 5
  - `ssl_anomaly`: 5
  - `foreign_or_voip_number`: 5
- **Severity weights fallback:** high 25, medium 15, low 5.
- **Config values:** thresholds `{ medium: 25, high: 60 }`, cannotVerifyRatio 0.40, softFlagCap 45, groupCaps `{ hiring_process: 20, pay: 20 }`, classifier `{ maxPoints: 25, zeroAt: 0.5, fullAt: 1.0 }`, confidence `{ high: 0.80, medium: 0.50 }`, flagGroups `{ fee: ["scholarship_fee_demand", "fee_demand"], fee_equipment: ["fee_demand", "equipment_advance"], hiring_process: ["chat_only_interview", "no_interview_selection", "candidate_picks_hours"], pay: ["pay_too_high", "unusual_pay_schedule"] }`, hardRules `["scholarship_fee_demand", "mule_account_request", "graph_match"]`, externalEvidenceAgents `["website_forensics", "official_verifier", "reputation_osint", "payment_entity"]`.

## 11. Report

The report returned by `GET /checks/:id/report` contains these fields:

| Field | Content |
|---|---|
| riskLevel | low, medium, high or cannot_verify |
| score and confidence | Number from 0 to 100 and a confidence label |
| scamTypeGuess | scholarship, internship, task job, mule offer, competition, overseas agent or unknown |
| summary | Plain-language summary in the chosen language |
| flags | List of flags, each with title, severity, explanation and evidence (quote or source link) |
| verified | Things that checked out (for example valid SSL or official domain match) |
| couldNotCheck | Checks that failed or timed out. Checks that did not apply (skipped) are listed separately as not applicable |
| notApplicable | Checks that did not apply given the supplied inputs |
| coverage | Evidence coverage `{ checked: string[], notChecked: string[] }` detailing signal types checked and not checked |
| improveCheck | Actionable list of inputs the user can add to strengthen the check (link, UPI ID, recruiter email, handle, official website) |
| checklist | What to verify next, step by step |
| entityChecks | "Entities and what was checked" table: (entity, agent, status, reason) covering every confirmed entity |
| whereDisagreed | Plain-language notes where specialists, rules, or the ML model differed |
| actions | Buttons to show: college email, fraud help |
| disclaimer | Risk assessment based on public information, not a legal verdict. "Nothing found is not the same as safe." |

Report page sections:
1. Risk badge with confidence banner and plain explanation of rules that fired.
2. Evidence Coverage Card: "What we looked at / What we could not look at / Add this to get a stronger result" displaying `coverage.checked`, `coverage.notChecked`, and `improveCheck`.
3. Narrative summary (bilingual: English / Hindi).
4. Flag cards (each expandable with sources and evidence quotes).
5. What we could not check and where checks disagreed.
6. "Entities and what was checked" verification table.
7. Action checklist ("What to Verify Next") with interactive checkboxes and copy button.
8. Action buttons (College Email, Fraud Help), feedback, and safety disclaimer ("Nothing found is not the same as safe").

The report writer must only use evidence supplied by the agents. If the evidence is thin, it explicitly states so.
For `medium` risk results, the report writer must use neutral, objective wording ("some warning signs, verify these items") and never use accusatory phrases like "likely scam".

## 12. Scam intelligence graph

- **Nodes:** UPI ID, domain, social handle, phone number, company name.
- **Edges:** two nodes appeared together in one reported scam.
- **Use:** on each check, look up every identifier. A match with a node from a High-risk report adds a hard-rule flag and shows linked identifiers (for example, this UPI ID was reported together with these two domains).
- **Writes:** only from High-risk reports, only with user consent, only identifiers (never screenshots or chat text).
- **Demo data:** seeded with identifiers from public scam advisories. The presentation states this clearly.
- **Implementation:** two database tables (graph_nodes and graph_edges) are enough for the demo. A graph visualisation page is optional.

## 13. Data model

| Table | Key fields |
|---|---|
| `checks` | id (UUID), status, current_round (default 0), language, risk_level, score (int 0..100), confidence, failure_reason, created_at, updated_at, expires_at |
| `check_inputs` | id (int), check_id, type (text, image, url, upi, company, handle, phone, youtube_url), value, file_path, mime_type, size_bytes, created_at |
| `entities` | id (int), check_id, kind, value, source (extracted, user-added or discovered), discovered_by, round, confirmed, evidence_json |
| `agent_results` | id (int), check_id, agent, round, kind, status (ok, skipped, could_not_check), reason, flags_json, new_entities_json, processed_json, unchecked_json, manual_checks_json, duration_ms |
| `check_events` | id (int), check_id, seq (int), round, type (including activity), agent, status, summary, payload_json, created_at |
| `reports` | check_id, report_json, created_at |
| `graph_nodes` | id (int), kind, value, first_seen, last_seen, report_count |
| `graph_edges` | id (int), node_a, node_b, check_ref (opaque string), created_at |
| `feedback` | id (int), check_id (cleared when the check is deleted), verdict ("right" \| "wrong"), risk_level_shown, comment, created_at |
| `lookup_cache` | key, result_json, fetched_at (int epoch seconds), ttl_seconds |

Retention: checks, inputs and reports are deleted after 24 hours. Uploaded images are deleted right after extraction. Only graph rows and anonymous feedback persist.

## 14. External services

| Purpose | Service | Notes |
|---|---|---|
| LLM (text and vision) | Free-tier provider to start | Behind one generate wrapper so the provider can be swapped. Check current free-tier limits |
| Web search and dorks | Serper (serper.dev), behind a swappable search wrapper | Returns Google results as JSON, so dorks can be tested directly. 2,500 free queries on signup. Do not scrape results pages ourselves. Cap queries per check and cache results |
| Domain data | RDAP, DNS, crt.sh, Wayback Machine | Free |
| Link safety | URLhaus and urlscan.io, free keys, check current terms | Free tiers, rate-limited. A URL not in a feed is never presented as safe |
| YouTube comments | YouTube Data API | Daily quota applies |
| Reddit | Site-restricted search or official API | Check current terms and limits |
| Phone validation | libphonenumber | Local library |

All limits and terms must be re-checked before the demo, since free tiers change.

## 15. Reliability

- **Caching:** every external lookup is cached by key (domain, query, ID) with a time-to-live, so repeated checks are instant and quota-friendly.
- **Rate limiting:** per-IP limits on check creation to prevent abuse.
- **Failures:** any lookup that fails returns could_not_check for that item. The report lists what could not be checked.
- **Structured outputs:** all LLM calls ask for strict JSON and are validated against a schema. Invalid output is retried once, then the agent returns could_not_check.
- **Prompt injection defence:** scam messages and fetched pages can contain instructions aimed at the model. All user and web content is passed as data inside clearly delimited blocks, the model is told to ignore any instructions inside it, and agents have no tools that can take actions on the user's behalf.

## 16. Privacy, security and legal

- Output is always worded as a risk assessment with evidence. It never states that a named person is a scammer.
- No tracing or identification of individuals. Phone numbers get validation, report search and graph matching only.
- Users are told to crop out other people's private details before uploading screenshots.
- Images are deleted after extraction. Checks expire after 24 hours. Saving to the graph needs explicit consent.
- Design with India's Digital Personal Data Protection Act, 2023 in mind: collect the minimum, state the purpose, and allow deletion. Get proper legal advice before any public launch.
- Provide a "report an error" route and a visible disclaimer on every report.
- Accessibility: readable on low-end phones, simple language, Hindi output.

## 17. Evaluation plan

1. Build a test set of 50 to 100 real examples (scam and genuine, across all scam types) collected from public advisories and official notices.
2. Measure the classifier alone (precision, recall, F1, confusion matrix).
3. Measure the full pipeline: does the risk level match the human label, and where does it fail?
4. Measure latency and the share of checks with at least one could_not_check item.
5. Run a small trial with 5 to 10 students and ask whether the report told them something useful and what to do next.

Present failures honestly. It builds trust with judges.

## 18. Tech stack

- **Frontend:** Next.js with React.
- **Backend:** Node.js (Next.js API routes or a separate Express service), JavaScript throughout for the team.
- **Agents:** plain JavaScript functions around LLM API calls (no heavy framework needed), orchestrated with `Promise.allSettled`.
- **Classifier service:** Python, scikit-learn, FastAPI.
- **Database:** SQLite for the demo, with a path to Postgres (for example Supabase).
- **Hosting:** a host with a persistent disk for SQLite, or Postgres if deploying to serverless.

## 19. Build plan

**Round 1 (presentation only):** this PRD, the architecture diagram, three example walkthroughs (fake scholarship, fake internship, task job), the test-set and metrics plan, and the privacy approach.

**Round 2 is built layer by layer, bottom-up, backend first.** Each layer must pass its exit gate before the next starts. The full layer rules, dependency rules and gates are in ARCHITECTURE.md section 2. UI pages are deferred until the backend passes its gates; the API routes and the live progress stream are part of the backend.

| Layer | What it delivers | Exit gate |
|---|---|---|
| L0 Foundation | Project setup, env validation, logging, lint and test runner | Dev server, lint and tests run; missing env variables fail clearly |
| L1 Contracts and data | Shared schemas (including the case file), flag registry, fixtures, database, state machine, repositories, cache | All fixtures validate; invalid data and transitions are rejected; a case file snapshot can be assembled and rendered as markdown |
| L2 Services | LLM layer, domain and payment tools, search and page fetch (with SSRF guard), YouTube comments, scam graph, classifier service | Mocked tests plus one real call per service; failures never throw |
| L3 Decision | Scoring engine with hard rules, cannot_verify and eligible-only confidence | Fixture tests give High, Low and Cannot verify as expected; skipped agents do not lower confidence |
| L4 Agents | The six agents, each with a canRun rule, and the registry | Tests with mocked tools; canRun correct on all fixtures; every flag has evidence; failures become could_not_check; agents never write to the database |
| L5 Pipeline | Extraction, the coordinator with its round loop, report writer, progress events, cleanup job | A full check runs from the command line, skips ineligible agents, uses rounds, and produces a valid report |
| L6 API and UI | API routes and live progress stream (backend, first); pages for the whole user flow (UI, later) | Backend: routes and stream work end to end. UI: submit, confirm, progress and report work on mobile and desktop |
| L7 Features and hardening | College email, fraud help, guides, feedback, rate limits, privacy cleanup, evaluation, demo script | Evaluation script runs, privacy checks pass, demo rehearsed |

**Parallel tracks:** collecting the classifier dataset and the 50 to 100 case test set, seeding the graph and known-domains list, and (later) building the UI against fixtures once L1 exists.

If time is short, cut inside L7 and the optional parts of L4 (YouTube comments, extra OSINT), but keep L0 to L6, the classifier and the scam graph, since they carry the technical story.

## 20. Risks and open questions

| Risk | Mitigation |
|---|---|
| Free-tier API limits or terms change | Provider wrapper, caching, checking limits early |
| Trustpilot and platform terms restrict automated access | Single user-triggered lookups, official APIs, screenshot fallback |
| Not enough labeled data | Start collecting immediately, keep a simple baseline model, report test-set size honestly |
| Wrong extraction from screenshots | Mandatory confirmation step |
| False positives hurting genuine organisations | Wording as risk assessment, evidence links, feedback route, Cannot verify outcome |
| Team has little prior AI experience | Build one agent first, grow step by step |

Open questions: exact time available before round 2, which LLM provider to start with, which regional languages to support first, and who owns the classifier work.

## 21. Round 1 presentation outline

1. The problem, with real recent cases.
2. Why existing tools fall short (a verdict without evidence, no student focus).
3. The solution in one sentence.
4. Live-flow walkthrough using one example (screenshots of the planned UI).
5. Architecture: multi-agent investigation, trained classifier, official-source verification, scam intelligence graph.
6. Safety and privacy approach.
7. Evaluation plan with metrics.
8. Impact and roadmap (browser extension, WhatsApp bot, college partnerships).