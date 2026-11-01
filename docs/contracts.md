# Contracts Specification: Student Opportunity Verifier

Companion to `ARCHITECTURE.md` and `PRD.md` · Layer L1 Specification

This document defines every shared data shape, type constraint, validation rule, state machine transition, fixed flag registry, and database table mapping for the Student Opportunity Verifier. All shared shapes are implemented as Zod schemas in `lib/contracts/` and verified with fixtures in `lib/contracts/fixtures/`.

---

## 1. Global Validation Rules & Limits

1. **Submission Limits & Rules (`CheckSubmission`):**
   - The user submission request is multipart form data.
   - `text`: User-submitted message text, optional, maximum 10,000 characters.
   - `images`: Optional array of uploaded screenshot metadata: `{ filename: string, mimeType: "image/png" | "image/jpeg", sizeBytes: number }`. Maximum 5 images, maximum 5 MB (5 * 1024 * 1024 bytes) per image. Binary image bytes are streamed to disk and verified by magic numbers in L5.
   - `url`: Optional website link, valid HTTP/HTTPS URL.
   - `upiId`: Optional UPI identifier string.
   - `company`: Optional company or organization name.
   - `handle`: Optional social or messaging handle.
   - `phone`: Optional contact number.
   - `youtubeUrl`: Optional YouTube video or channel URL.
   - `language`: Required, `"en"` (English) or `"hi"` (Hindi), default `"en"`.
   - `consent`: Required boolean, must be strictly `true` acknowledging that the output is a risk assessment, not a legal verdict.
   - **At-least-one rule:** At least one of `text`, `images` (length > 0), or `url` is strictly required.

2. **Entity Normalization & Formatting Rules:**
   - `domain`: Converted to ASCII (punycode), lowercased, stripped of protocol (`http://`, `https://`), userinfo, port, path, trailing slash, trailing dot, and leading `www.` (e.g. `scholarship-portal.org`).
   - `url`: Valid HTTP or HTTPS URL (no javascript, file, or other non-HTTP schemes).
   - `upi`: Lowercase string matching regex `^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{2,64}$`. Disambiguation rule: a string `"x@y"` with no dot (`.`) after the `@` is classified as `upi`; if it contains a dot after the `@`, it is classified as `email`.
   - `email`: Valid lowercase email format.
   - `phone`: Validated E.164 string format matching regex `^\+[1-9]\d{6,14}$`. (Deep parsing via `libphonenumber-js` occurs in L2 tools).
   - `company`: Trimmed string, consecutive whitespace collapsed to single space, maximum 200 characters.
   - `handle`: Lowercase string with leading `@` removed (e.g. `@career_portal` -> `career_portal`).
   - `amount`: Cleaned digits-only string representing integer amount in INR. A trailing ".00" is accepted and dropped.
   - `youtube_url`: Valid HTTP/HTTPS YouTube link.

3. **Entity Creation & Sources:**
   - A submitted `url` in the form creates both a `url` entity and a derived `domain` entity.
   - Fields submitted in the initial form (`upiId`, `company`, `handle`, `phone`, `youtubeUrl`) create entities with source `"user"` and round 0.
   - Website-related agents key their processed lists on the `domain` entity.
   - Sources:
     - `"extracted"`: Found by extraction pipeline (regex or vision model).
     - `"user"`: Added or confirmed/edited by user during confirmation.
     - `"discovered"`: Discovered by specialist agents during investigation rounds.
   - **Discovery Constraints:** Agents may discover at most 5 entities per agent per round. Discovery kinds are strictly restricted to `"domain"`, `"handle"`, and `"company"`. Every discovered entity requires verifiable `evidence`.

4. **Evidence & Content String Limits:**
   - `Evidence.quote`: Verbatim quote, maximum 300 characters.
   - `Evidence.url`: Valid HTTP or HTTPS URL.
   - `Evidence Policy for Code-Derived Flags:` Flags produced by deterministic tools (such as `domain_new`, `domain_no_history`, `ssl_anomaly`, `lookalike_domain`, `foreign_or_voip_number`, and `graph_match`) must attach either a public verification URL that the user can open (for example RDAP, Wayback Machine, or crt.sh for the domain) or a quote of the identifier exactly as the user supplied it.
   - `L5 Quote Verification Rule:` Quotes are compared after collapsing whitespace and ignoring case against all input values, entity values, and message text stored in the case file. The coordinator rejects any quote evidence that is not a match.
   - `Flag.title`: Maximum 120 characters. Unique per flag ID within one `AgentResult`.
   - `Flag.explanation`: Maximum 500 characters.
   - `Flag.evidence`: Array of `Evidence` with at least 1 item.
   - `Flag.severity`: Must strictly equal the registry default for that flag ID.
   - Maximum 20 flags per `AgentResult`.

---

## 2. Check Lifecycle & State Machine

A check moves deterministically through these states. `created` is the initial state; `report_ready` and `failed` are terminal states. Any state may transition to `failed` upon unrecoverable error.

```
       created
          │
          ▼
      extracting
          │
          ▼
 awaiting_confirmation
          │
          ▼
    investigating
          │
          ▼
       scoring
          │
          ▼
    report_ready   (terminal)

[ Any State ] ──────► failed   (terminal)
```

### Transition Table

| Current State (`from`) | Allowed Next States (`to`) | Trigger Condition |
|---|---|---|
| `created` | `extracting`, `failed` | Inputs stored in SQLite |
| `extracting` | `awaiting_confirmation`, `failed` | Extraction (regex + vision) completed |
| `awaiting_confirmation` | `investigating`, `failed` | User confirms/edits entities |
| `investigating` | `scoring`, `failed` | All eligible agents finish or time out |
| `scoring` | `report_ready`, `failed` | Score and report generated and stored |
| `report_ready` | *(none - terminal)* | Check investigation completed |
| `failed` | *(none - terminal)* | Unrecoverable error encountered |

---

## 3. Core Contract Schemas

### 3.1 Check & CheckStatus
Represents the core investigation record.

```typescript
type CheckStatus =
  | "created"
  | "extracting"
  | "awaiting_confirmation"
  | "investigating"
  | "scoring"
  | "report_ready"
  | "failed";

type FailureReasonCode =
  | "extraction_error"
  | "coordinator_pipeline_error"
  | "server_restart"
  | "unknown_error";

type Check = {
  id: string; // UUID (crypto.randomUUID)
  status: CheckStatus;
  currentRound: number; // Integer, default 0
  language: "en" | "hi";
  riskLevel?: "low" | "medium" | "high" | "cannot_verify" | null;
  score?: number | null; // Integer, CHECK 0..100
  confidence?: "low" | "medium" | "high" | null;
  failureReason?: FailureReasonCode | null; // Explanatory fixed reason code if status === "failed"
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  expiresAt: string; // ISO 8601 (createdAt + 24 hours)
};
```

### 3.2 CheckSubmission & CheckInputRow
Distinguishes the incoming multipart API submission metadata from the persistent input row.

```typescript
// Incoming API request (POST /api/checks)
type CheckSubmission = {
  text?: string; // Max 10,000 chars
  userNotes?: string; // Max 5,000 chars
  images?: Array<{
    filename: string;
    mimeType: "image/png" | "image/jpeg";
    sizeBytes: number; // Max 5 MB
  }>; // Max 5 images
  url?: string;
  upiId?: string;
  company?: string;
  handle?: string;
  handlePlatform?: "instagram" | "telegram" | "youtube" | "reddit" | "x" | "other";
  phone?: string;
  youtubeUrl?: string;
  language: "en" | "hi";
  consent: true; // Must be true
  // Enforces: at least one of text, images, or url must be present
};

// Stored row in check_inputs table
type CheckInputRow = {
  id: number; // Integer primary key
  checkId: string; // UUID
  type: "text" | "image" | "url" | "upi" | "company" | "handle" | "phone" | "youtube_url" | "user_notes";
  value: string | null;
  filePath?: string | null; // Temporary image file path (deleted after extraction)
  mimeType?: string | null;
  sizeBytes?: number | null;
  createdAt: string; // ISO 8601
};
```

### 3.3 Evidence
Verifiable foundation attached to every flag and discovered entity.

```typescript
type Evidence = {
  type: "quote" | "url";
  value: string; // Max 300 chars for quote; valid http(s) URL for url
};
```

### 3.4 Entity
Structured identifier in the case file.

```typescript
type EntityKind =
  | "domain"
  | "url"
  | "upi"
  | "email"
  | "phone"
  | "company"
  | "handle"
  | "amount"
  | "youtube_url"
  | "scheme";

type EntitySource = "extracted" | "user" | "discovered";

type OrgType = "government" | "education" | "bank" | "company" | "unknown";
type AmountPurpose =
  | "application fee"
  | "registration fee"
  | "refundable deposit"
  | "document verification"
  | "processing charge"
  | "training kit"
  | "advance payment"
  | "security deposit";

type Entity = {
  id: number; // Integer primary key
  checkId: string; // UUID
  kind: EntityKind;
  value: string; // Normalized representation
  source: EntitySource;
  platform?: string | null; // Platform name (e.g. instagram, telegram) for handles
  orgType?: OrgType | null; // Optional classification for company entities (government, education, bank, company, unknown)
  purpose?: AmountPurpose | null; // Purpose for amount entities
  discoveredBy?: string | null; // Agent name if source === "discovered"
  round: number; // 0 for extracted/user; 1 or 2 for discovered
  confirmed: boolean;
  evidence?: Evidence | null; // Required when source === "discovered", optional otherwise
};
```

### 3.5 Flag
Specific risk factor detected by an agent.

```typescript
type Severity = "low" | "medium" | "high";

type Flag = {
  id: FlagId; // Must match an ID from the fixed Flag Registry
  title: string; // Max 120 chars
  severity: Severity; // MUST strictly equal the registry default for this flag id
  explanation: string; // Max 500 chars
  evidence: [Evidence, ...Evidence[]]; // At least one verifiable evidence item
};
```

### 3.6 AgentResult
Standard output returned by every specialist agent for a given round.

```typescript
type AgentKind = "check" | "llm_call" | "agent";
type AgentStatus = "ok" | "skipped" | "could_not_check";

type NewEntity = {
  kind: "domain" | "handle" | "company"; // Restricted discovery kinds
  value: string;
  evidence: Evidence; // Required source evidence for discovery
};

type ActivityType = "input" | "step" | "finding" | "verified" | "limit" | "manual";
type ActivityStatus = "ok" | "warn" | "failed" | "skipped" | "info";
type ActivityTool =
  | "rdap"
  | "dns"
  | "ssl"
  | "wayback"
  | "search"
  | "llm"
  | "graph"
  | "classifier"
  | "fetch"
  | "rules";

type ActivitySource = {
  label: string; // Max 120 chars
  url: string;   // Valid HTTP or HTTPS URL
};

type ActivityEntry = {
  seq: number;
  atMs: number;
  type: ActivityType;
  status: ActivityStatus;
  title: string; // Max 120 chars, plain language
  detail?: string; // Optional, max 400 chars, plain text
  tool?: ActivityTool;
  sources?: ActivitySource[]; // Max 5
  flagId?: string;
};

type EntityStatus =
  | "verified"
  | "not_found"
  | "unverified"
  | "contradicted"
  | "partial"
  | "checked_no_issue"
  | "skipped"
  | "could_not_check";

type EntityVerificationStatus = {
  entityKind: string;
  entityValue: string;
  status: EntityStatus;
  reason?: string; // Required when status is "skipped" or "could_not_check"
};

type AgentResult = {
  id?: number; // Integer primary key in DB
  checkId: string; // UUID
  agent: string; // Registered agent name
  round: number; // 1 or 2
  kind: AgentKind;
  status: AgentStatus;
  reason?: string; // Required when status is "skipped" or "could_not_check"
  summary?: string; // Max 160 chars; plain one-sentence summary e.g. "Checked 1 domain and 1 UPI ID; 2 red flags; 1 item could not be checked."
  activity?: ActivityEntry[]; // Max 40 entries
  entityStatus?: EntityVerificationStatus[]; // Status record for every entity checked or skipped
  flags: Flag[]; // Max 20; unique flag IDs; MUST be empty when status !== "ok"
  verified: string[]; // MUST be empty when status !== "ok"
  newEntities: NewEntity[]; // Max 5; MUST be empty when status !== "ok"
  processedEntities: string[]; // "kind:value" pairs; MUST be empty when status !== "ok"
  unchecked: string[]; // Entity keys left unchecked; MUST be empty when status !== "ok"
  manualChecks: Array<{ label: string; url: string }>; // Required http/https url; MUST be empty when status !== "ok"
  trace?: unknown[]; // Optional execution trace
  notes?: string;
  durationMs: number;
  classifierResult?: ClassifierResult; // Optional; allowed ONLY when agent is "classifier_client" AND status is "ok"; absent otherwise
};
```
*Eligibility & Round Execution Rules:*
- When `status` is `"skipped"` or `"could_not_check"`: `flags`, `verified`, `newEntities`, `processedEntities`, `unchecked`, and `manualChecks` must all be empty arrays `[]`, and `classifierResult` must be absent.
- `classifierResult` is allowed ONLY when `agent === "classifier_client"` AND `status === "ok"`. For any other agent and for non-ok statuses, it must be absent.
- Message-text agents (`Message Analyst`, `Classifier client`) run in round 1 only.
- The classifier_high flag is emitted only when classifier probability is at least 0.80 and at least one top contributing term appears verbatim in the message text as quote evidence (at most 3 terms).
- In round 2, the coordinator runs and records results only for agents that became newly eligible based on newly discovered entities; it writes no skipped rows for the rest.
- For scoring, each `(agent, round)` result with status `ok` or `could_not_check` counts once toward eligibility; skipped results are not counted.
- **Agent Behavior Rules (R1–R6):**
  - **R1 Eligibility:** Synchronous, cheap `canRun(snapshot)` check (no I/O, no LLM). Returns `skipped` with a fixed reason when no work is present.
  - **R2 Single writer:** Agents return findings only. Only the coordinator writes to SQLite and the case file.
  - **R3 Execution safety:** 25-second timeout (`AGENT_TIMEOUT_MS = 25000`). Agents never throw; unhandled errors become `could_not_check`. Discovered entities are capped at 5 per agent per round, restricted to kinds `domain`, `handle`, and `company` with evidence, normalized, deduplicated, and domains pass a synchronous SSRF host check before being returned. Maximum 2 rounds.
  - **R4 Registry flags only:** Agents emit only from the 36 registered flag IDs authorized by `canEmit(flagId, agentName)`. Title and severity come strictly from registry.
  - **R5 Result rules:** `ok` returns findings; `skipped` when `canRun` is false; `could_not_check` on failure. Non-ok statuses have empty arrays and no `classifierResult`.
  - **Official Verifier check rules:** Official Verifier makes no registry claims it cannot check. Registries without a free API (MCA, GST, National Scholarship Portal listing) are returned as manual_check entries in trace and are never reported as checked or verified. not_on_official_portal is based on a bounded site-restricted search and is worded as 'not found in a limited search', never as proof of absence. In Official Verifier, the LLM is restricted to finding official_warning_found only. non_gov_domain_claiming_gov and not_on_official_portal are strictly code-decided. authority_impersonation stays unemitted by this agent.
  - **Website Forensics check rules:** Website Forensics does not emit non_gov_domain_claiming_gov (Official Verifier is the sole emitter in agent code).
  - **Multi-item partial failure rule:** Every agent that processes several items treats them independently. If some items are checked and others fail, the result is ok with per-item outcomes in trace and notes; could_not_check only when every eligible item failed.
  - **Reputation / OSINT check rules:** The agent does no automated Trustpilot, Reddit, Telegram or Instagram access; Reddit and review sites are reached only through site-restricted search results, and a Trustpilot manual_check link goes in trace for company and domain items. The LLM is used only to judge whether a search result is about the same entity. The agent returns no newEntities in L4 (`newEntities: []`). "No reports found" is never a flag, a verified item or a safety claim.
  - **R6 Language:** Explanations generated in English; L5 report writer handles translation.
  - **Dependency injection:** Second argument `deps` defaults to `{ generate, classify, now }` for offline test isolation.

*Discovered Entity Limiter Contract (`limitNewEntities`):*
- **Input:**
  - `candidates`: `Array<{ kind: string, value: string, evidence: Evidence }>`
  - `options`: `{ agentName: string, existingEntityKeys?: Set<string> | string[] }`
- **Output:**
  - `{ accepted: Array<{ kind: "domain" | "handle" | "company", value: string, evidence: Evidence }>, droppedCount: number }`
- **Invariants:**
  - Restricted to kinds `domain`, `handle`, `company` only.
  - Non-empty evidence required.
  - Normalization via `normalizeDomain`, `normalizeHandle`, `normalizeCompany`.
  - Deduplication across candidate list and against `existingEntityKeys` (`<kind>:<normalizedValue>`).
  - Synchronous SSRF host check: drops IP literals (`127.0.0.1`, `10.0.0.5`, `192.168.1.1`, `169.254.169.254`), `localhost`, and internal hostnames.
  - Capped at 5 (`MAX_NEW_ENTITIES = 5`); input order preserved.

### 3.7 ClassifierResult
Output from the ML classifier service (`services/classifier/` and `lib/classifier.js`).

```typescript
type ClassifierResult = {
  probability: number; // Float between 0.0 and 1.0 (P(scam); NaN rejected)
  label: "suspicious" | "benign";
  topTerms: string[];
  scamType?: string; // Informational string, not used by scoring
};
```

### 3.8 ScoreResult
Pure code scoring engine output (`lib/scoring/score.js`).

```typescript
type RiskLevel = "low" | "medium" | "high" | "cannot_verify";
type ConfidenceLevel = "low" | "medium" | "high";
type FlagPointStatus = "counted" | "group_suppressed" | "duplicate_ignored";

type FlagPointItem = {
  id: string;
  weight: number;
  points: number;
  status: FlagPointStatus;
  agents: string[];
};

type ScoreResult = {
  level: RiskLevel;
  score: number; // Integer 0 to 100
  confidence: ConfidenceLevel;
  completedCount: number;
  eligibleCount: number;
  completionRatio: number; // completedCount / eligibleCount (0 if eligibleCount is 0)
  rulesFired: string[]; // Hard rules fired
  flagPoints: FlagPointItem[]; // Deterministic: sorted by points desc then id asc
  classifierPoints: number; // 0..25 from probability per D4
  corroborationBonus?: number; // 0..10 bonus from independent method corroboration
  contradictions?: string[]; // Plain-language contradiction descriptions
  corroborations?: string[]; // Plain-language corroboration descriptions
  confidenceCapped: boolean; // true if capped at medium by external-evidence rule
  reasonCodes: string[]; // e.g. ["no_eligible_agents"]
  fallbackWeightFlags: string[]; // flags that used severity fallback weights
};
```

*Scoring Invariants & Rules:*
1. **Eligibility:** Each `(agent, round)` result with status `ok` or `could_not_check` counts toward `eligibleCount`. Skipped results are not counted. `completedCount` counts `ok` results.
2. **Zero eligible:** When `eligibleCount === 0`, result is `level: "cannot_verify"`, `score: 0`, `confidence: "low"`, `reasonCodes: ["no_eligible_agents"]`.
3. **Flag deduplication & groups (D1):**
   - Flags collected only from `ok` results.
   - Deduplicated across agents and rounds by `id`. Additional instances marked `duplicate_ignored`.
   - **Fee group (`fee`):** `scholarship_fee_demand` and `fee_demand` form group `fee`. Only the highest weight among present members counts toward score; other group members receive 0 points with status `group_suppressed`.
   - **Fee / Equipment mutual exclusion (`fee_equipment`):** `fee_demand` and `equipment_advance` form exclusion group `fee_equipment`. Only the highest-weight flag from this group counts; others are suppressed (0 points, status `"group_suppressed"`), and `rulesFired` records `"exclusion:fee_equipment"`.
   - **Correlation groups (per-group cap of 20 points):**
     - `hiring_process`: `chat_only_interview`, `no_interview_selection`, and `candidate_picks_hours` form group `hiring_process`. Their combined contribution is capped at 20 points; when the cap is applied, `rulesFired` records `"correlation_cap:hiring_process"`.
     - `pay`: `pay_too_high` and `unusual_pay_schedule` form group `pay`. Their combined contribution is capped at 20 points; when the cap is applied, `rulesFired` records `"correlation_cap:pay"`.
   - **Soft-flag cap (45 points):** Total points from all `low` and `medium` severity flags combined (after correlation caps) is capped at **45 points**. When applied, `rulesFired` records `"soft_flag_cap_applied"`.
   - **No-high-evidence cap (59 points):** If the result has no high-severity flag, no hard rule, and no graph match, the final score (flags plus classifier) is capped at **59**. When this cap applies, `rulesFired` records `"no_high_evidence_cap"`.
   - Weights come from `config.flagWeights[id]`, falling back to `config.severityWeights[severity]` if missing (populating `fallbackWeightFlags`).
4. **Classifier points (D4):**
   - Scoring takes `classifierMaxPoints` as an input parameter (default 25; set to 10 when classifier data provenance is synthetic or real test rows < 60).
   - Scaled from `classifierResult.probability` (P(scam)) when `classifier_client` status is `ok`:
     `classifierPoints = Math.round(classifierMaxPoints * Math.max(0, (probability - 0.5) / 0.5))`
   - 0 points when probability <= 0.5; `classifierMaxPoints` points at probability 1.0. No ok classifier result means 0 points.
   - Total score: `clamp(Math.round(sum of flag points + classifierPoints), 0, 100)`. If no high-severity flag, hard rule, or graph match is present, the final score is capped at 59 (`Math.min(score, 59)`), and `rulesFired` records `"no_high_evidence_cap"`.
5. **Hard rules (D5):**
   - Hard rules in `config.hardRules`: `scholarship_fee_demand`, `mule_account_request`, `graph_match` (from `ok` results).
   - If any hard rule fires: `level` is `"high"`, `score = Math.max(score, config.thresholds.high)` (floor 60 by default), rule listed in `rulesFired`, and `cannot_verify` is never applied.
   - `scholarship_fee_demand` hard rule triggers even if suppressed in the fee group for points.
6. **Thresholds:**
   - Below 25: `low`.
   - 25 up to below 60: `medium`.
   - 60 and above: `high`.
7. **Cannot verify rule:**
   - If `(completedCount / eligibleCount) < 0.40` AND `score < 60` AND no hard rule fired: level is `cannot_verify`.
8. **Critical agents rule (default: `message_analyst`):**
   - Critical agents (default: `message_analyst`). If a critical agent was eligible and has no ok result in any round, the level can never be low. A would-be low becomes cannot_verify with low confidence and reason code critical_agent_failed. A medium or high level is kept (more suspicious evidence is never downgraded). Skipped critical agents (no message text) are not failures.
9. **Confidence & cap (D2):**
   - Base confidence: `>= 0.80` is `high`, `>= 0.50` is `medium`, else `low`.
   - Cap: Capped at `medium` (`confidenceCapped = true`) unless at least one external-evidence agent (`website_forensics`, `official_verifier`, `reputation_osint`, `payment_entity`) completed with status `ok`. A text-only Low result stays Low; the cap only affects confidence.
   - If `level` is `cannot_verify`, confidence is `low`.

### 3.8.1 Starting Weight Table & Config Values
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
  - `raw_ip_opportunity_link`: 20
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
- **Severity fallback weights:** high 25, medium 15, low 5.
- **Config shape:**
  ```javascript
  {
    thresholds: { medium: 25, high: 60 },
    cannotVerifyRatio: 0.40,
    classifier: { maxPoints: 25, zeroAt: 0.5, fullAt: 1.0 },
    confidence: { high: 0.80, medium: 0.50 },
    softFlagCap: 45,
    groupCaps: {
      hiring_process: 20,
      pay: 20,
    },
    flagGroups: {
      fee: ["scholarship_fee_demand", "fee_demand"],
      fee_equipment: ["fee_demand", "equipment_advance"],
      hiring_process: ["chat_only_interview", "no_interview_selection", "candidate_picks_hours"],
      pay: ["pay_too_high", "unusual_pay_schedule"],
    },
    hardRules: ["scholarship_fee_demand", "mule_account_request", "graph_match"],
    externalEvidenceAgents: ["website_forensics", "official_verifier", "reputation_osint", "payment_entity"],
    criticalAgents: ["message_analyst"],
  }
  ```

### 3.9 Report
The user-facing report.

```typescript
type ScamTypeGuess =
  | "scholarship"
  | "internship"
  | "task_job"
  | "mule_offer"
  | "competition"
  | "overseas_agent"
  | "unknown";

type ChecklistItem = {
  text: string;
  url?: string; // Optional direct registry or verification link
};

type ActionItem = {
  id: "college_email" | "fraud_help" | "copy_checklist";
  label: string;
};

type Report = {
  checkId: string; // UUID
  riskLevel: RiskLevel;
  score: number; // Integer 0 to 100
  confidence: ConfidenceLevel;
  scamTypeGuess: ScamTypeGuess;
  language: "en" | "hi";
  summary: string;
  flags: Flag[];
  verified: string[];
  couldNotCheck: string[]; // Checks that failed or timed out
  notApplicable: string[]; // Checks that were skipped
  checklist: ChecklistItem[]; // Array of { text, url? }
  actions: ActionItem[];
  disclaimer: string;
  generatedAt: string; // ISO 8601
};
```

### 3.10 ProgressEvent
Server-Sent Events (SSE) union for `/api/checks/:id/stream`.

```typescript
type ProgressEventType = "stage" | "round" | "agent" | "complete" | "error";

type AgentProgressEvent = {
  type: "agent";
  agent: string;
  round: number;
  status: "started" | "done" | "skipped" | "could_not_check";
  summary?: string | null;
};

type RoundProgressEvent = {
  type: "round";
  round: number; // 1 or 2
};

type StageProgressEvent = {
  type: "stage";
  stage: "extracting" | "investigating" | "scoring" | "writing_report";
};

type CompleteProgressEvent = {
  type: "complete";
  checkId: string;
  riskLevel: RiskLevel;
};

type ErrorProgressEvent = {
  type: "error";
  code: ApiErrorCode; // Strictly uses ApiErrorCode enum
  message: string;
};

type ProgressEvent = (
  | AgentProgressEvent
  | RoundProgressEvent
  | StageProgressEvent
  | CompleteProgressEvent
  | ErrorProgressEvent
) & {
  id?: number; // Optional database check_events row id for SSE Last-Event-ID replay
};
```

### 3.10.1 TraceEvent
Fine-grained real-time agent trace events emitted during investigation and persisted to `check_events` with monotonic `seq`. Enforces a strict 4 KB serialization limit (oversized fields are truncated; valid events are never dropped).

```typescript
type TraceEventType =
  | "agent_status"
  | "tool_start"
  | "tool_end"
  | "note"
  | "flag"
  | "verdict"
  | "entity"
  | "round"
  | "stage"
  | "complete"
  | "activity";

type CommonTraceFields = {
  seq: number;
  checkId: string;
  ts: string;
  round: number;
  agent: string | null;
};

type ActivityTraceEvent = CommonTraceFields & {
  type: "activity";
  entry: ActivityEntry;
};
```

### 3.11 ApiError
Standardized error response.

```typescript
type ApiErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "CHECK_EXPIRED"
  | "CHECK_FAILED"
  | "INTERNAL_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "STATE_CONFLICT"
  | "SERVICE_UNAVAILABLE";

type ApiError = {
  code: ApiErrorCode;
  message: string; // User-safe message
  details?: unknown; // MUST NEVER echo user content, file paths or internal stack traces
};
```

### 3.12 Feedback
User feedback surviving check deletion.

```typescript
type FeedbackVerdict = "right" | "wrong";

type FeedbackOutcome =
  | "confirmed_scam"
  | "confirmed_genuine"
  | "lost_money"
  | "not_sure";

type Feedback = {
  id: number; // Integer primary key
  checkId: string | null; // Nullable; SET NULL when check is deleted
  verdict: FeedbackVerdict; // Strictly "right" or "wrong"
  outcome?: FeedbackOutcome | null; // Optional user-reported real-world outcome
  riskLevelShown: RiskLevel;
  comment: string | null; // Max 500 characters
  createdAt: string; // ISO 8601
};

type FeedbackRequest = {
  verdict: FeedbackVerdict;
  outcome?: FeedbackOutcome;
  comment?: string | null;
};

type SaveToGraphRequest = {
  consent: true; // Strictly boolean true required
};

type SaveToGraphResponse = {
  saved: number;
  checkRef?: string;
  reason?: string;
};

#### Save-to-Graph Identifier Exclusion Rules
When saving identifiers from a high-risk check into the scam intelligence graph (`POST /api/checks/:id/save-to-graph`), candidates must be confirmed (`confirmed: true`), non-discovered (`source !== "discovered"`), and pass the kind-specific validation and anti-poisoning exclusion rules below:

| Entity Kind | Normalisation & Filtering Rule | Exclusion Criteria |
|---|---|---|
| `domain` | `normalizeDomain(value)` | Excluded if in `known-domains.json`, official suffix (`.gov.in`, `.nic.in`, `.ac.in`, `.edu.in`, `.mil.in`), or `free-email-domains.json`. |
| `upi` | `normalizeUpi(value)` (trimmed, lowercase) | Valid UPI format only. Excluded if whole value or its handle/domain part (`after @`) is an excluded domain (e.g. `someone@gmail.com`, `name@ugc.ac.in`). Normal bank PSP handles (e.g. `okaxis`, `ybl`, `okhdfcbank`, `paytm`) are **NOT** excluded. Invalid shape or empty local part excluded. |
| `handle` | Normalised (strip leading `@`, scheme `https?://`, `www.`, path `/...`, query `?...`; lowercase) | Excluded if equal to or subdomain of an excluded domain or official suffix (`gmail.com`, `sub.ugc.ac.in`, `scholarships.gov.in`). Exact domain dot boundaries are respected (e.g. `evilgmail.com` is not `gmail.com`). |
| `phone` | `isValidE164` / E.164 normalization | No domain rule (discovered and unconfirmed are already excluded). |
| `company`, `email`, `url`, `youtube_url`, `amount` | N/A | **Not allowed kinds**: strictly excluded from graph recording. |

Per-check cap is 5 identifiers. All exclusions happen inside a single atomic database transaction; if an identifier is excluded, remaining valid identifiers are still saved.
```

### 3.13 GraphMatch & GraphNode
Scam intelligence graph lookup result.

```typescript
type GraphNode = {
  id: number; // Integer primary key
  kind: "upi" | "domain" | "handle" | "phone" | "company";
  value: string;
  firstSeen: string; // ISO 8601
  lastSeen: string; // ISO 8601, NOT NULL
  reportCount: number;
};

type GraphMatch = {
  matched: boolean;
  node?: GraphNode;
  linkedNodes: GraphNode[];
  earlierReportCount: number;
};
```

### 3.14 CaseFile (Snapshot)
The shared blackboard representing everything known about a check.

```typescript
type CaseFileEvent = {
  id: number; // Integer ID
  round: number;
  type: "stage" | "round" | "agent" | "complete" | "error";
  agent?: string | null;
  status?: string | null;
  summary?: string | null;
  createdAt: string;
};

type CaseFile = {
  check: {
    id: string; // UUID
    status: CheckStatus;
    currentRound: number; // Integer, 0, 1, or 2
    language: "en" | "hi";
    riskLevel?: RiskLevel | null;
    score?: number | null; // Integer, 0..100
    confidence?: ConfidenceLevel | null;
    failureReason?: string | null;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
  };
  inputs: CheckInputRow[];
  entities: Entity[];
  findings: AgentResult[];
  events: CaseFileEvent[];
  control: {
    processedEntitiesByAgent: Record<string, string[]>; // agentName -> ["kind:value"]
  };
};
```

### 3.15 ToolResult
Standardized result contract for all external and internal tool operations in L2.

```typescript
type ToolErrorCode =
  | "TIMEOUT"
  | "NETWORK"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "INVALID_INPUT"
  | "BLOCKED"
  | "NO_KEY"
  | "AUTH"
  | "BUDGET_EXCEEDED"
  | "PARSE_ERROR";

type ToolResult<T = unknown> =
  | {
      ok: true;
      data: T;
      cached: boolean;
      fetchedAt: string; // ISO 8601
    }
  | {
      ok: false;
      error: {
        code: ToolErrorCode;
        message: string; // Must NEVER contain secrets, request URLs with keys, or response bodies
      };
    };
```

---

## 4. Fixed Flag Registry (36 Flags)

Flag IDs and severities are strictly fixed. Agents must emit exact IDs, and flag severities must strictly equal the registry default.

| Flag ID | Default Severity | Emitted By | Evidence Requirement & Trigger Description |
|---|---|---|---|
| `scholarship_fee_demand` | `high` | Message Analyst | Upfront application, registration, or processing fee demanded for a scholarship. Evidence: quoted message text. (Hard rule) |
| `fee_demand` | `high` | Message Analyst | Registration, training, certificate, or security deposit fee demanded before or after selection. Evidence: quoted message text. |
| `equipment_advance` | `high` | Message Analyst | Fake check or direct demand for home-office/laptop equipment purchase advance. Evidence: quoted message text. |
| `mule_account_request` | `high` | Message Analyst | Soliciting bank account rental, SIM card handover, or ATM card forwarding. Evidence: quoted message text. (Hard rule) |
| `bank_details_request` | `high` | Message Analyst | Requesting bank password, net banking credentials, ATM PIN, or card details. Evidence: quoted message text. |
| `otp_or_id_request` | `high` | Message Analyst | Soliciting OTP, Aadhaar, PAN, or personal credentials for "verification". Evidence: quoted message text. |
| `authority_impersonation` | `high` | Message Analyst / Official Verifier | Posing as an official ministry, government authority, or reputable institution. Evidence: quoted message text or official URL. |
| `task_deposit_script` | `high` | Message Analyst | Small payout followed by mandatory deposit for VIP/premium tasks. Evidence: quoted message text. |
| `apk_download_prompt` | `high` | Message Analyst | Prompting user to download or install an out-of-store Android APK. Evidence: quoted message text or link. |
| `url_in_threat_feed` | `high` | Website Forensics / Reputation | URL or host confirmed in a threat feed (URLhaus, urlscan). Evidence: threat feed lookup URL or reference. (A miss is not a flag) |
| `qr_code_payment_request` | `high` | Message Analyst | Sending a QR code to "receive" funds (reverse UPI collection fraud). Evidence: quoted message text. |
| `lookalike_domain` | `high` | Website Forensics | Domain visually or phonetically impersonating a legitimate institution. Evidence: verification URL or quoted domain identifier. |
| `non_gov_domain_claiming_gov` | `high` | Official Verifier / Website Forensics | Claiming to be an official Indian government scheme on a non-`.gov.in` domain. Evidence: quoted domain identifier or official portal URL. |
| `personal_payment_id` | `high` | Payment & Entity | Payment requested to a personal UPI handle or individual bank account. Evidence: quoted payment identifier. |
| `official_warning_found` | `high` | Official Verifier / Reputation | PIB Fact Check or institution advisory warning against this specific offer. Evidence: official source URL. |
| `scam_reports_found` | `high` | Reputation / OSINT / Payment & Entity | Multiple corroborated public scam complaints on forums, Reddit, or consumer sites. Evidence: complaint source URL. |
| `graph_match` | `high` | Payment & Entity | Identifier matches known scam entity in the scam intelligence graph. Evidence: quoted identifier matching graph node. (Hard rule) |
| `domain_company_mismatch` | `high` | Official Verifier | Domain contains claimed company brand but is not the company's verified official domain. Evidence: quoted domain or company identifier. |
| `no_interview_selection` | `medium` | Message Analyst | Direct selection or job offer letter issued without interview or application. Evidence: quoted message text. |
| `unsolicited_award` | `medium` | Message Analyst | Winning a competition or scholarship never entered, requiring claiming fee or details. Evidence: quoted message text. |
| `chat_only_interview` | `medium` | Message Analyst | Hiring interview conducted entirely via Telegram, WhatsApp, or text chat. Evidence: quoted message text. |
| `pay_too_high` | `medium` | Message Analyst | Compensation disproportionately high relative to unskilled or basic task complexity. Evidence: quoted message text. |
| `guaranteed_income` | `medium` | Message Analyst | Unrealistic promises of guaranteed daily/weekly earnings for minimal effort. Evidence: quoted message text. |
| `free_email_recruiter` | `medium` | Payment & Entity | Recruiter contacting from free webmail (gmail/yahoo/outlook) claiming enterprise identity. Evidence: quoted email identifier. |
| `domain_new` | `medium` | Website Forensics | Website domain registered fewer than 30 days ago. Evidence: RDAP lookup URL or quoted domain identifier. |
| `raw_ip_opportunity_link` | `medium` | Website Forensics | Opportunity, application, or portal link uses a raw IP address instead of a registered domain. Evidence: quoted IP URL or link identifier. |
| `not_on_official_portal` | `medium` | Official Verifier | Claimed scholarship or program absent from official portal (e.g. NSP). Evidence: official registry search URL. |
| `review_burst` | `medium` | Reputation / OSINT | Suspicious temporal cluster of identical 5-star reviews on Trustpilot/YouTube. Evidence: review page URL. |
| `copied_content` | `medium` | Website Forensics / Reputation | Verbatim about-us or policy text copied from another established organization. Evidence: source comparison URL or quote. |
| `data_harvest_redirects` | `medium` | Website Forensics | Excessive redirects to ad networks, affiliate links, or external data collection forms. Evidence: redirect chain URL or destination link. |
| `classifier_high` | `medium` | Classifier Client | ML classifier scam probability > 0.80. Weight is 0 in scoring (informational only). Evidence: quoted top contributing terms present in message text. |
| `candidate_picks_hours` | `low` | Message Analyst | Complete freedom over work hours and workload with guaranteed fixed compensation. Evidence: quoted message text. |
| `unusual_pay_schedule` | `low` | Message Analyst | Daily, hourly, or instant UPI disbursement offered to lure student commitment. Evidence: quoted message text. |
| `urgency_pressure` | `low` | Message Analyst | Artificial countdown or deadline pressure to act before verifying. Evidence: quoted message text. |
| `off_platform_contact` | `low` | Message Analyst | Pressure to move communication to personal Telegram or WhatsApp channels. Evidence: quoted message text. |
| `domain_no_history` | `low` | Website Forensics | Domain has no prior archived snapshot records in the Wayback Machine. Evidence: Wayback Machine check URL or quoted domain identifier. |
| `ssl_anomaly` | `low` | Website Forensics | Missing, self-signed, invalid, or mismatched SSL/TLS certificate. Evidence: crt.sh/SSL verification URL or quoted domain identifier. |
| `foreign_or_voip_number` | `low` | Payment & Entity | Non-Indian country code or a number type reported as VoIP or unknown. Evidence: quoted phone number identifier. |

### 4.1 Flag Groups & Safeguard Caps

To prevent multiple correlated flags from inflating the risk score:
- **Fee group (`fee`):** `scholarship_fee_demand` (30) and `fee_demand` (30). Only highest weight counts; others are suppressed (0 points, status `"group_suppressed"`).
- **Fee / Equipment mutual exclusion (`fee_equipment`):** `fee_demand` (30) and `equipment_advance` (25). Only highest weight counts; others are suppressed (0 points, status `"group_suppressed"`), and `rulesFired` records `"exclusion:fee_equipment"`.
- **Hiring process correlation group (`hiring_process`):** `chat_only_interview` (15), `no_interview_selection` (15), and `candidate_picks_hours` (10). Combined contribution capped at **20 points**. When applied, `rulesFired` records `"correlation_cap:hiring_process"`.
- **Pay correlation group (`pay`):** `pay_too_high` (15) and `unusual_pay_schedule` (10). Combined contribution capped at **20 points**. When applied, `rulesFired` records `"correlation_cap:pay"`.
- **Soft-flag cap (45 points):** Combined points from all `low` and `medium` severity flags (after correlation group caps) cannot exceed **45 points**. When applied, `rulesFired` records `"soft_flag_cap_applied"`.
- **No-high-evidence cap (59 points):** If no high-severity flag, hard rule, or graph match fired, the final score (flags + classifier) cannot exceed **59 points** (Medium). When applied, `rulesFired` records `"no_high_evidence_cap"`.

---

## 5. Database Mapping & L0 Gap Analysis

Every contract field maps to target SQLite tables and columns. Below is the full mapping specification:

| Contract | Field | SQLite Table | SQLite Column | Target Type / Constraint | L0 Provisional Code Status / Conflict |
|---|---|---|---|---|---|
| `Check` | `id` | `checks` | `id` | `TEXT PRIMARY KEY` | Conforms (UUID string) |
| `Check` | `status` | `checks` | `status` | `TEXT NOT NULL` | Conforms |
| `Check` | `currentRound` | `checks` | `current_round` | `INTEGER NOT NULL DEFAULT 0` | **Missing in L0** (`checks` has no `current_round`) |
| `Check` | `language` | `checks` | `language` | `TEXT NOT NULL DEFAULT 'en'` | Conforms |
| `Check` | `riskLevel` | `checks` | `risk_level` | `TEXT` | Conforms |
| `Check` | `score` | `checks` | `score` | `INTEGER CHECK (score >= 0 AND score <= 100)` | **Conflict in L0** (L0 defines `score REAL` without `CHECK` constraint) |
| `Check` | `confidence` | `checks` | `confidence` | `TEXT` | Conforms |
| `Check` | `failureReason`| `checks` | `failure_reason`| `TEXT` | **Missing in L0** (`checks` has no `failure_reason`) |
| `Check` | `createdAt` | `checks` | `created_at` | `TEXT NOT NULL` | Conforms |
| `Check` | `updatedAt` | `checks` | `updated_at` | `TEXT NOT NULL` | **Missing in L0** (`checks` has no `updated_at`) |
| `Check` | `expiresAt` | `checks` | `expires_at` | `TEXT NOT NULL` | Conforms |
| `CheckInputRow` | `id` | `check_inputs` | `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | **Conflict in L0** (L0 defines `id TEXT PRIMARY KEY`) |
| `CheckInputRow` | `checkId` | `check_inputs` | `check_id` | `TEXT NOT NULL` | Conforms (`FK -> checks(id) ON DELETE CASCADE`) |
| `CheckInputRow` | `type` | `check_inputs` | `type` | `TEXT NOT NULL` | **Conflict in L0** (L0 missing `"youtube_url"` in types) |
| `CheckInputRow` | `value` | `check_inputs` | `value` | `TEXT` | Conforms |
| `CheckInputRow` | `filePath` | `check_inputs` | `file_path` | `TEXT` | Conforms |
| `CheckInputRow` | `mimeType` | `check_inputs` | `mime_type` | `TEXT` | **Missing in L0** (`check_inputs` has no `mime_type`) |
| `CheckInputRow` | `sizeBytes` | `check_inputs` | `size_bytes` | `INTEGER` | **Missing in L0** (`check_inputs` has no `size_bytes`) |
| `CheckInputRow` | `createdAt` | `check_inputs` | `created_at` | `TEXT NOT NULL` | **Missing in L0** (`check_inputs` has no `created_at`) |
| `Entity` | `id` | `entities` | `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | **Conflict in L0** (L0 defines `id TEXT PRIMARY KEY`) |
| `Entity` | `checkId` | `entities` | `check_id` | `TEXT NOT NULL` | Conforms (`FK -> checks(id) ON DELETE CASCADE`) |
| `Entity` | `kind` | `entities` | `kind` | `TEXT NOT NULL` | Conforms |
| `Entity` | `value` | `entities` | `value` | `TEXT NOT NULL` | Conforms |
| `Entity` | `source` | `entities` | `source` | `TEXT NOT NULL` | Conforms |
| `Entity` | `discoveredBy` | `entities` | `discovered_by` | `TEXT` | **Missing in L0** (`entities` has no `discovered_by`) |
| `Entity` | `round` | `entities` | `round` | `INTEGER NOT NULL DEFAULT 0` | **Missing in L0** (`entities` has no `round`) |
| `Entity` | `confirmed` | `entities` | `confirmed` | `INTEGER NOT NULL DEFAULT 0` | Conforms |
| `Entity` | `evidence` | `entities` | `evidence_json` | `TEXT` | **Missing in L0** (`entities` has no `evidence_json`) |
| *(Constraint)* | | `entities` | | `UNIQUE(check_id, kind, value)` | **Missing in L0** (`entities` lacks unique index) |
| `AgentResult` | `id` | `agent_results` | `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | **Conflict in L0** (L0 defines `id TEXT PRIMARY KEY`) |
| `AgentResult` | `checkId` | `agent_results` | `check_id` | `TEXT NOT NULL` | Conforms (`FK -> checks(id) ON DELETE CASCADE`) |
| `AgentResult` | `agent` | `agent_results` | `agent` | `TEXT NOT NULL` | Conforms |
| `AgentResult` | `round` | `agent_results` | `round` | `INTEGER NOT NULL` | **Missing in L0** (`agent_results` has no `round`) |
| `AgentResult` | `kind` | `agent_results` | `kind` | `TEXT NOT NULL` | **Missing in L0** (`agent_results` has no `kind`) |
| `AgentResult` | `status` | `agent_results` | `status` | `TEXT NOT NULL` | Conforms |
| `AgentResult` | `reason` | `agent_results` | `reason` | `TEXT` | **Missing in L0** (`agent_results` has no `reason`) |
| `AgentResult` | `flags` | `agent_results` | `flags_json` | `TEXT NOT NULL DEFAULT '[]'` | Conforms |
| `AgentResult` | `verified` | `agent_results` | `verified_json` | `TEXT NOT NULL DEFAULT '[]'` | Conforms |
| `AgentResult` | `newEntities` | `agent_results` | `new_entities_json` | `TEXT NOT NULL DEFAULT '[]'` | **Missing in L0** (`agent_results` has no `new_entities_json`) |
| `AgentResult` | `processedEntities` | `agent_results` | `processed_json` | `TEXT NOT NULL DEFAULT '[]'` | **Missing in L0** (`agent_results` has no `processed_json`) |
| `AgentResult` | `unchecked` | `agent_results` | `unchecked_json` | `TEXT NOT NULL DEFAULT '[]'` | **Missing in L0** (`agent_results` has no `unchecked_json`) |
| `AgentResult` | `manualChecks` | `agent_results` | `manual_checks_json` | `TEXT NOT NULL DEFAULT '[]'` | **Missing in L0** (`agent_results` has no `manual_checks_json`) |
| `AgentResult` | `trace` | `agent_results` | `trace_json` | `TEXT` | **Missing in L0** (`agent_results` has no `trace_json`) |
| `AgentResult` | `notes` | `agent_results` | `notes` | `TEXT` | Conforms |
| `AgentResult` | `durationMs` | `agent_results` | `duration_ms` | `INTEGER` | Conforms |
| *(Constraint)* | | `agent_results` | | `UNIQUE(check_id, agent, round)` | **Missing in L0** (`agent_results` lacks unique index) |
| `CaseFileEvent` | `id` | `check_events` | `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | **Missing in L0** (`check_events` table does not exist) |
| `CaseFileEvent` | `checkId` | `check_events` | `check_id` | `TEXT NOT NULL` | **Missing in L0** |
| `CaseFileEvent` | `round` | `check_events` | `round` | `INTEGER NOT NULL` | **Missing in L0** |
| `CaseFileEvent` | `type` | `check_events` | `type` | `TEXT NOT NULL` | **Missing in L0** |
| `CaseFileEvent` | `agent` | `check_events` | `agent` | `TEXT` | **Missing in L0** |
| `CaseFileEvent` | `status` | `check_events` | `status` | `TEXT` | **Missing in L0** |
| `CaseFileEvent` | `summary` | `check_events` | `summary` | `TEXT` | **Missing in L0** |
| `CaseFileEvent` | `createdAt` | `check_events` | `created_at` | `TEXT NOT NULL` | **Missing in L0** |
| `Report` | `checkId` | `reports` | `check_id` | `TEXT PRIMARY KEY` | Conforms (`FK -> checks(id) ON DELETE CASCADE`) |
| `Report` | `*` | `reports` | `report_json` | `TEXT NOT NULL` | Conforms |
| `Report` | `generatedAt` | `reports` | `created_at` | `TEXT NOT NULL` | Conforms |
| `Feedback` | `id` | `feedback` | `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | **Conflict in L0** (L0 defines `id TEXT PRIMARY KEY`) |
| `Feedback` | `checkId` | `feedback` | `check_id` | `TEXT` | **Conflict in L0** (L0 defines `check_id TEXT NOT NULL` with no FK; target is nullable with `FK -> checks(id) ON DELETE SET NULL`) |
| `Feedback` | `verdict` | `feedback` | `verdict` | `TEXT NOT NULL` | **Conflict in L0** (L0 allows arbitrary text; target is strictly `"right" \| "wrong"`) |
| `Feedback` | `riskLevelShown` | `feedback` | `risk_level_shown` | `TEXT NOT NULL` | **Missing in L0** (`feedback` has no `risk_level_shown`) |
| `Feedback` | `comment` | `feedback` | `comment` | `TEXT CHECK (comment IS NULL OR length(comment) <= 500)` | **Conflict in L0** (L0 has unconstrained `comment`) |
| `Feedback` | `createdAt` | `feedback` | `created_at` | `TEXT NOT NULL` | Conforms |
| `GraphNode` | `id` | `graph_nodes` | `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | **Conflict in L0** (L0 defines `id TEXT PRIMARY KEY`) |
| `GraphNode` | `kind` | `graph_nodes` | `kind` | `TEXT NOT NULL` | Conforms |
| `GraphNode` | `value` | `graph_nodes` | `value` | `TEXT NOT NULL` | Conforms |
| `GraphNode` | `firstSeen` | `graph_nodes` | `first_seen` | `TEXT NOT NULL` | Conforms |
| `GraphNode` | `lastSeen` | `graph_nodes` | `last_seen` | `TEXT NOT NULL` | **Missing in L0** (`graph_nodes` has no `last_seen`) |
| `GraphNode` | `reportCount` | `graph_nodes` | `report_count` | `INTEGER NOT NULL DEFAULT 1` | Conforms |
| *(Constraint)* | | `graph_nodes` | | `UNIQUE(kind, value)` | Conforms |
| `GraphEdge` | `id` | `graph_edges` | `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | **Conflict in L0** (L0 defines `id TEXT PRIMARY KEY`) |
| `GraphEdge` | `nodeA` | `graph_edges` | `node_a` | `INTEGER NOT NULL` | **Conflict in L0** (L0 node_a matches TEXT ids; target is integer FK) |
| `GraphEdge` | `nodeB` | `graph_edges` | `node_b` | `INTEGER NOT NULL` | **Conflict in L0** (L0 node_b matches TEXT ids; target is integer FK) |
| `GraphEdge` | `checkRef` | `graph_edges` | `check_ref` | `TEXT NOT NULL` | **Conflict in L0** (L0 check_ref is nullable; target is `NOT NULL` and deliberately NOT a foreign key) |
| `GraphEdge` | `createdAt` | `graph_edges` | `created_at` | `TEXT NOT NULL` | Conforms |
| `CacheEntry` | `key` | `lookup_cache` | `key` | `TEXT PRIMARY KEY` | Conforms |
| `CacheEntry` | `value` | `lookup_cache` | `result_json` | `TEXT NOT NULL` | Conforms |
| `CacheEntry` | `fetchedAt` | `lookup_cache` | `fetched_at` | `INTEGER NOT NULL` | **Conflict in L0** (L0 stores ISO text; target is integer epoch seconds) |
| `CacheEntry` | `ttlSeconds` | `lookup_cache` | `ttl_seconds` | `INTEGER NOT NULL` | Conforms |

---

## 6. Implementation Notes for Step C (Database & Migrations)

*(These notes guide Step C implementation and will not contain active code until Step C starts)*:
1. **Foreign Keys Enforcement:** Verify `PRAGMA foreign_keys = ON;` is explicitly executed on every SQLite connection, with an automated integration test verifying cascade deletion of child records.
2. **Expired Checks Deletion:** The `deleteExpired()` maintenance query must delete the file paths stored in `check_inputs.file_path` only after verifying that each path is strictly resolved within the configured upload directory (no hardcoded `uploads/`, preventing directory traversal), before deleting database rows across cascaded tables.
3. **Migration 2 Table Rebuild Pattern:** Because SQLite alters are limited, Migration 2 will upgrade table schemas (converting child row IDs to `INTEGER PRIMARY KEY AUTOINCREMENT`, adding unique constraints, and nullable cascade set null on `feedback`) using SQLite's canonical table rebuild pattern:
   - Temporarily disable foreign keys (`PRAGMA foreign_keys = OFF;`).
   - Create new target tables `_new`.
   - Copy existing records across.
   - Drop old tables and rename `_new` tables to standard names.
   - Re-enable foreign keys (`PRAGMA foreign_keys = ON;`) and check consistency with `PRAGMA foreign_key_check;`.

---

## 6.1 L5 Repository Functions (`lib/db/index.js`)

To support the L5 extraction, confirmation, and investigation pipeline without schema migrations:
1. `addEntities(checkId, entities, db = getDb())`: Inserts entities, ignoring rows that violate `UNIQUE(check_id, kind, value)` (`INSERT OR IGNORE`); never deletes or modifies existing rows; returns `{ addedCount: number }`.
2. `clearInputFile(inputId, db = getDb())`: Sets `file_path` to `NULL` for a single `check_inputs` row by primary key `id`.
3. `replaceTextInputs(checkId, texts, db = getDb())`: Within an atomic transaction, deletes only `type = 'text'` inputs for the check and inserts the given texts; leaves image, url, and other input types untouched.
4. `saveConfirmation(checkId, { texts, entities }, db = getDb())`: Atomically replaces text inputs and entities (setting `confirmed = 1`, preserving source, setting user-added entities to source `"user"`). Allowed strictly when `checks.status === 'awaiting_confirmation'` (rejects otherwise with typed `InvalidStateTransitionError`, writing nothing).
5. `saveRoundResults(checkId, { result, newEntities, events }, db = getDb())`: Atomically saves one `AgentResult`, adds discovered entities (via `INSERT OR IGNORE`), and appends timeline events. Rolls back completely on duplicate or validation error.

---

## 6.2 L6 Environment Variables and Upload Constants

Documented configuration for L6 API operation:
1. **Environment Variables (`lib/env.js`)**:
   - `RATE_LIMIT_WINDOW_MS`: number (integer, positive), default `900000` (15 minutes).
   - `RATE_LIMIT_CREATE_MAX`: number (integer, positive), default `10`.
   - `RATE_LIMIT_CONFIRM_MAX`: number (integer, positive), default `10`.
   - `RATE_LIMIT_READ_MAX`: number (integer, positive), default `60`.
   - `RATE_LIMIT_STREAM_MAX`: number (integer, positive), default `10`.
   - `TRUSTED_PROXY_HOPS`: number (integer, positive), default `1`.
   - `MAX_CONCURRENT_CREATES`: number (integer, positive), default `2`.
   - `TRUST_PROXY`: boolean, default `false`.
   - Invalid numbers/booleans fail validation with error messages naming the invalid variable without echoing the value.

2. **Upload Constants (`lib/uploads.js`)**:
   - `MAX_INPUT_PIXELS`: constant integer `25000000` (25 million pixels) passed to Sharp as `limitInputPixels` with `failOnError: true` and `failOn: "warning"`.

---

## 6.3 L6 Repository Functions (`lib/db/index.js`)

To enforce strict database boundary isolation (zero raw SQLite statements or queries in `lib/api/` or `app/api/`):
1. `getEventsAfter(checkId, afterId = 0, limit = 100, db = getDb())`: Returns parsed `CheckEventRow[]` for `check_id = ?` with `id > afterId` ordered by `id ASC` up to `limit`. Excludes other checks.
2. `listStaleChecks(statuses = ['extracting', 'investigating', 'scoring'], olderThanMs = 300000, now = Date.now(), db = getDb())`: Returns candidate check records `{ id, status }` stuck in non-terminal statuses whose `updated_at < (now - olderThanMs)` formatted as ISO 8601. Never returns terminal checks (`report_ready`, `failed`).
3. `countActiveChecks(statuses = ['extracting', 'investigating', 'scoring'], db = getDb())`: Returns integer count of checks currently in the specified non-terminal statuses.
4. `markCheckFailed(checkId, reasonCode, { summary = "Investigation failed", db = getDb() } = {})`: Moves check to status `failed` with validated `failure_reason = reasonCode` (must be member of `FAILURE_REASON_CODES`), updating `updated_at`, and appends an error event `{ type: "error", summary }` within a single atomic transaction. Rejects invalid state transitions (e.g. from `report_ready` or `failed`) with typed `InvalidStateTransitionError`, writing nothing.
5. `deleteCheck(checkId, db = getDb())`: Deletes check row and cascaded records by ID (e.g. during creation failure rollback).

---

## 6.4 L7 Action Contracts (`lib/contracts/actions.js`)

To support deterministic student action routes without storing generated text:
1. **College Email Request & Response (`CollegeEmailRequestSchema`, `CollegeEmailResponseSchema`)**:
   - `CollegeEmailRequest`:
     - `recipientType`: enum `["placement_cell", "dean_student_welfare", "department_head", "grievance_officer"]`.
     - `language`: optional enum `["en", "hi"]`, default `"en"`.
   - `CollegeEmailResponse`:
     - `subject`: single-line string with all `\r` and `\n` stripped (max 200 chars).
     - `body`: plain text email message (max 10,000 chars), zero HTML.
     - `recipientRole`: string description of the recipient.
     - `notes`: optional array of string advisories (e.g. `"needs native review"` when language is `"hi"`).
2. **Fraud Summary Request & Response (`FraudSummaryRequestSchema`, `FraudSummaryResponseSchema`)**:
   - `FraudSummaryRequest`:
     - `amount`: optional integer, min 1, max 10,000,000 (INR).
     - `date`: optional ISO string `YYYY-MM-DD`, not in future, not older than 365 days.
     - `paymentMethod`: optional enum `["upi", "netbanking", "card", "wallet", "cash", "other"]`.
     - `language`: optional enum `["en", "hi"]`, default `"en"`.
   - `FraudSummaryResponse`:
     - `title`: string summary title (max 200 chars).
     - `narrative`: plain text complaint narrative for copying (max 10,000 chars).
     - `victimSteps`: array of actionable steps (strings, max 500 chars each).
     - `reportingChannels`: array of reporting channel objects `{ name: string, url: string | null, helpline: string | null, text: string, verified: boolean }`.
     - `notes`: optional array of string advisories (e.g. `"needs native review"` when language is `"hi"`).
3. **Standalone Fraud Summary Endpoint (`POST /api/fraud-summary`)**:
   - Uses `FraudSummaryRequestSchema` (all fields optional, language defaults to `"en"`) and returns `FraudSummaryResponseSchema`.
   - Operates independently without requiring a `checkId` or database access. Nothing is stored in SQLite.
   - States explicitly in the generated narrative that no check investigation evidence or case file findings are attached.
   - Protected by the action rate limiter (`RATE_LIMITED` error on excess requests).

---

## 6.5 L7 Guides Contracts (`lib/contracts/guides.js`)

To support structured opportunity verification guides and educational reference materials:
1. **Guide Types**:
   - `GUIDE_TYPES`: `["scholarship_scam", "internship_scam", "task_scam", "mule_account", "contest_fraud", "overseas_agent"]`.
   - Mapping to Report `ScamTypeGuess` and domain `SCAM_TYPES`:
     - `scholarship_scam` <-> `scholarship` / `scholarship_scam`
     - `internship_scam` <-> `internship` / `recruitment_fraud`
     - `task_scam` <-> `task_job` / `task_scam`
     - `mule_account` <-> `mule_offer` / `mule_solicitation`
     - `contest_fraud` <-> `competition` / `contest_fraud`
     - `overseas_agent` <-> `overseas_agent` / `generic_suspicious`
2. **Guide Claim & Source**:
   - `GuideSourceSchema`: `{ id: string, title: string, publisher: string, url: string (url or domain), publishedDate?: string, verified: boolean, retrievalNote?: string }`.
   - `GuideClaimSchema`: `{ claim: string, sourceIds: string[] }`.
3. **Guide Document (`GuideSchema`)**:
   - `type`: enum member of `GUIDE_TYPES`.
   - `title`: string (min 1, max 200).
   - `summary`: string (min 1, max 1000).
   - `howItWorks`: array of strings (min 1).
   - `redFlags`: array of strings (min 3).
   - `whatToVerify`: array of strings (min 1).
   - `whatToDo`: array of strings (min 1).
   - `alreadyPaid`: array of strings (min 1).
   - `claims`: array of `GuideClaimSchema` (min 1).
   - `sources`: array of `GuideSourceSchema` (min 1).
   - `reviewStatus`: enum `["human_reviewed", "draft_needs_review"]`.
   - `language`: enum `["en", "hi"]`, default `"en"`.
   - `lastReviewed`: string (ISO date YYYY-MM-DD).
4. **Guide Summary / List Item (`GuideSummarySchema`)**:
   - `type`: enum member of `GUIDE_TYPES`.
   - `title`: string.
   - `summary`: string.

---

## 10. Record and Replay Subsystem (L7)

To support deterministic offline test suites, scenario replay, and regression harnesses:
1. **Environment Variables**:
   - `RECORD_REPLAY_MODE`: enum `["off", "record", "replay"]`, default `"off"`.
   - `RECORD_REPLAY_DIR`: string, default `".recordings"`.
2. **Production Safety Constraint**:
   - If `process.env.NODE_ENV === "production"`, `RECORD_REPLAY_MODE === "record"` is strictly prohibited and throws an immediate startup error.
3. **Disclosure in Health**:
   - `GET /api/health` reports `{ replayMode: "off" | "record" | "replay" }` matching the active configuration.
4. **Save-to-Graph Replay Guard**:
   - When the server is operating in `"replay"` or `"record"` mode, `POST /api/checks/:id/save-to-graph` returns `409 STATE_CONFLICT` with reason `"replay_mode_active"` to prevent saving synthetic or replayed identifiers to the persistent scam intelligence graph without changing database schemas or contracts.

---

## 11. Deep Web Crawler Contracts (`CrawlResult`)

The crawler service provides an informational, read-only shallow crawl of verified domains linked to a check.

1. **`CrawlPageSchema`**:
   - `url`: string (valid HTTP/HTTPS URL).
   - `finalUrl`: string (valid HTTP/HTTPS URL after redirects).
   - `status`: integer HTTP status code or null.
   - `title`: string (trimmed, default "").
   - `textExcerpt`: string (maximum 2,000 characters).
   - `linkCount`: non-negative integer.

2. **`CrawlFormSchema`**:
   - `actionHost`: string (target domain or host).
   - `method`: string (e.g. "GET", "POST").
   - `fieldTypes`: array of strings (e.g. `["text", "password", "email"]`).
   - `hasPassword`: boolean.
   - `hasOtp`: boolean.
   - `hasUpi`: boolean.
   - `hasPayment`: boolean.

3. **`CrawlLimitsUsedSchema`**:
   - `maxPages`: integer (positive).
   - `maxDepth`: integer (non-negative).
   - `totalTimeSec`: integer (non-negative).
   - `totalBytesReceived`: integer (non-negative).
   - `sameHostOnly`: boolean.

4. **`CrawlResultSchema`**:
   - `pages`: array of `CrawlPageSchema`.
   - `forms`: array of `CrawlFormSchema`.
   - `externalDomains`: array of unique domain strings.
   - `truncated`: boolean.
   - `limitsUsed`: `CrawlLimitsUsedSchema`.
   - `errorCode`: optional enum `["TIMEOUT", "DNS_FAILED", "BLOCKED_HOST", "BYTE_LIMIT", "TOO_MANY_PAGES", "ROBOTS_DENIED", "UPSTREAM_ERROR"]`.

5. **API Error Codes**:
   - `CRAWLER_UNAVAILABLE`: HTTP 503 Service Unavailable when the crawler service cannot be reached.
   - `CRAWL_NOT_ALLOWED`: HTTP 400 Bad Request when the check has no eligible domain or the entity violates safety policies.

6. **Database Table (`crawl_results` - Migrations 012 & 013)**:
   - `id`: TEXT PRIMARY KEY (UUID).
   - `check_id`: TEXT NOT NULL REFERENCES `checks(id)` ON DELETE CASCADE.
   - `entity_id`: TEXT NOT NULL.
   - `status`: TEXT NOT NULL CHECK (`status` IN ('running', 'done', 'failed')).
   - `result_json`: TEXT (nullable while running).
   - `error_code`: TEXT (nullable, set on failure).
   - `started_at`: TEXT NOT NULL (ISO 8601).
   - `finished_at`: TEXT (nullable).
   - `created_at`: TEXT NOT NULL (ISO 8601).
   - `updated_at`: TEXT NOT NULL (ISO 8601).
   - Constraints: `UNIQUE(check_id, entity_id)`.
   - Indices: `idx_crawl_results_check_id` ON `crawl_results(check_id)`, `idx_crawl_results_entity_id` ON `crawl_results(entity_id)`.

7. **API Request & Response Contracts**:
   - `POST /api/checks/:id/crawl`:
     - Request body: `{ entityId: string }`
     - Response (accepted/running): `{ status: "running", checkId: string, entityId: string }` (HTTP 202 or 200 on replay)
     - Response (already completed): `{ status: "done", checkId: string, entityId: string, result: CrawlResult }` (HTTP 200)
   - `GET /api/checks/:id/crawl?entityId=...`:
     - Response: `{ status: "not_started" | "running" | "done" | "failed", result?: CrawlResult, errorCode?: string }`
   - Progress model: Not sent through SSE/TraceEvent; polled via `GET /api/checks/:id/crawl`.
   - Known limit: Target domain sees egress server IP and runs arbitrary scripts within sandboxed browser; forward proxy enforces network and protocol boundaries.
   - Stale threshold: Crawls in `running` status exceeding 5 minutes are transitioned to `failed` (`server_restart`) by maintenance cleanup.

