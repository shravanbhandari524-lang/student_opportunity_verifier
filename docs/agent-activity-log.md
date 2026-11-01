# Agent Activity Log Standard & Specification

## 1. Overview & Goal

The Agent Activity Log system makes every specialist agent transparent and observable in real time. On the check page, all six specialist agents are displayed as dedicated cards in a deterministic order. Clicking an agent card opens an inspection panel (bottom sheet on mobile, side panel / modal on desktop) revealing:
1. **What it received**: Input texts, entities, identifiers, and parameters passed to this agent.
2. **What it did**: Step-by-step chronological timeline of actions, tools executed, and observations.
3. **What it found**: Evidence-backed flags discovered, with quotes and source links.
4. **What checked out**: Deterministic verified facts and positive findings (with safety caveat).
5. **What it could not check and why**: Items left unchecked, skipped tools, or failed queries with plain-language explanations.
6. **What you should check yourself**: Recommended manual verification actions for sources lacking automated public APIs.
7. **Technical details**: Raw diagnostic execution trace for debugging.

---

## 2. Agent Order & Display Names

Agent display names are centralized in a single configuration file (`lib/config/agents.js`) imported by both the API routes and frontend components:

| Internal Identifier | Display Name | Order | Role / Purpose |
|---|---|:---:|---|
| `message_analyst` | **Message & Offer Analyst** | 1 | Ingests message text and user notes; analyzes coercive patterns, selection claims, and fee demands |
| `classifier_client` | **ML Scam Classifier** | 2 | Evaluates message text with calibrated TF-IDF + Logistic Regression opportunity model |
| `website_forensics` | **Domain & Web Forensics** | 3 | Checks domain registration, RDAP age, DNS records, SSL/TLS certificates, and lookalikes |
| `payment_entity` | **Payment & UPI Verifier** | 4 | Verifies UPI handles, phone numbers, banking PSPs, and scam intelligence graph matches |
| `official_verifier` | **Official Registry Verifier** | 5 | Checks authentic organization domains, government advisory portals, and program registries |
| `reputation_osint` | **Community & OSINT Search** | 6 | Conducts scoped web intelligence queries across consumer complaints and security forums |

---

## 3. Contract Additions (AgentResult)

`AgentResultSchema` in `lib/contracts/agent-result.js` defines two additional fields:
- `summary`: One plain sentence (max 160 characters), summarizing the agent's actions and outcomes. Example: `"Checked 1 domain and 1 UPI ID; 2 red flags; 1 item could not be checked."`
- `activity`: Array of up to 40 chronological `ActivityEntry` items.

### Activity Entry Schema

```typescript
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
  seq: number;                     // 0-based monotonic sequence within the agent run
  atMs: number;                    // Milliseconds elapsed since agent execution started
  type: ActivityType;              // Category of activity entry
  status: ActivityStatus;          // Status outcome indicator
  title: string;                   // Max 120 chars, plain language
  detail?: string;                 // Optional, max 400 chars, plain text
  tool?: ActivityTool;             // Optional tool identifier
  sources?: ActivitySource[];      // Max 5 source attribution links
  flagId?: string;                 // Optional associated flag ID
};
```

### Safety & Integrity Rules
1. **Facts even when benign**: Always record concrete facts even when nothing is suspicious (e.g. `"Registered 2005-01-06, about 21 years old"`).
2. **Plain-language failures**: Explain all errors, network timeouts, or unconfigured tools in human terms without cryptic code identifiers.
3. **Never claim safe**: Never state or imply that an offer or entity is "safe", "legitimate", or "guaranteed". If no flags are found, state `"No suspicious signals detected (not a safety guarantee)"`.
4. **No sensitive data**: Never include API keys, internal credentials, raw system prompts, raw model completion tokens, or full HTML page dumps.
5. **Plain-text rendering**: All title, detail, and summary strings are strictly rendered as plain text in the UI to prevent XSS.

---

## 4. Activity Recorder (`createActivityRecorder`)

Defined in `lib/agents/activity.js`. Instantiated per agent run and passed via `deps.activity` (or `deps.recorder`):
- `input({ title, detail, tool, sources })`: Records an input or entity received by the agent.
- `step({ title, detail, tool, status, sources })`: Records a tool call, network lookup, or decision step.
- `finding({ title, detail, flagId, tool, sources })`: Records a red flag or anomaly identified.
- `verified({ title, detail, tool, sources })`: Records an authentic or corroborated finding.
- `limit({ title, detail, tool })`: Records a budget ceiling, timeout, or lookup limitation.
- `manual({ title, detail, sources })`: Records an item requiring manual user verification.
- `setSummary(sentence)`: Sets the agent's 1-sentence plain summary.
- `getEntries()`: Returns the validated, capped array of entries (max 40).
- `getSummary()`: Returns the plain summary string (max 160 chars).

Each recorder method immediately emits a live SSE trace event `{ type: "activity", agent, round, entry }` through `onEvent` so the client UI updates in real time.

---

## 5. Backend & Coordinator Architecture

1. **Database Schema (Migration 007)**:
   - Adds `activity_json TEXT NOT NULL DEFAULT '[]'` to `agent_results`.
   - Adds `summary TEXT NOT NULL DEFAULT ''` to `agent_results`.
2. **Coordinator (`lib/coordinator.js`)**:
   - Creates and passes `activityRecorder` to each eligible agent.
   - Forwards live SSE events to clients.
   - **Skipped handling**: For an agent returning `skipped`, generates one entry explaining why it was skipped and what user input would make it run (e.g. `"No link or domain was found. Add a link to run this check."`), with a concise summary.
   - **Could not check handling**: For an agent returning `could_not_check`, generates one entry explaining the failure in plain language.
   - **Fallback generation for uninstrumented agents**: Synthesizes a clean minimal activity array from `trace`, `flags`, `verified`, `unchecked`, and `manualChecks` so that no agent card is ever blank.
   - Persists `activity_json` and `summary` in SQLite.
3. **API Endpoint (`GET /api/checks/:id/agents`)**:
   - Returns the six cards in fixed order with `agent`, `name`, `status`, `durationMs`, `summary`, `activity`, `flags`, `verified`, `unchecked`, `manualChecks`.
   - Supports both running checks (reading live state) and completed checks.
4. **Data Retention**:
   - All agent results, activity logs, and check rows cascade-delete on check expiration after 24 hours.

---

## 6. Frontend UI Specifications

Built with mobile-first responsive architecture and dark mode aesthetics using the project's existing design token system:
1. **Agent Cards (Fixed Order 1 to 6)**:
   - Displays agent icon, display name, status chip (`waiting`, `running`, `done`, `found_issues`, `not_applicable`, `could_not_check`), execution duration in milliseconds, and the 1-sentence summary.
   - Live streaming updates via Server-Sent Events (`/api/checks/:id/stream`) with periodic polling fallback (`/api/checks/:id/agents`).
2. **Inspection Drawer / Panel**:
   - Mobile: Slide-up bottom sheet with swipe dismiss.
   - Desktop: Right-hand side panel with clean overlay and keyboard dismiss (`Escape`).
   - Header: Agent display name, status chip, duration, summary.
   - Sections:
     - **What it received**: Inputs and targets provided to this agent.
     - **What it did**: Chronological step timeline with visual status indicators.
     - **What it found**: Flag cards with severity badges, evidence quotes, and external links.
     - **What checked out**: Verified items, with the mandatory warning: `"Nothing found is not the same as safe."`
     - **What it could not check and why**: Unchecked entities and tool exceptions with clear reasons.
     - **What you should check yourself**: Actionable manual verification guidance.
     - **Technical details**: Collapsible disclosure showing raw trace JSON for auditing.
