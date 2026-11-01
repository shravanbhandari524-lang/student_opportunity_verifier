# UI Phase 1 — Step 0 Audit

## 1. Design Files & Pages
- `precision_technical_minimal/DESIGN.md`: Primary design system (Geist + JetBrains Mono, hairline grid `#e5e7eb`, zero diffuse shadows, binary status dots: emerald `#10b981`, crimson `#e11d48`, amber `#f59e0b`).
- `monochrome_precision/DESIGN.md` & `monochrome_investigation_feed/DESIGN.md`: Feed specification (Inter/Geist, JetBrains Mono, 36/40px row cadence, 6px dots).
- `verifier_home_white_tech_ai/`: Landing page (`/`) — hero, system health, scam archetypes, check CTA.
- `verifier_new_check_confirm_desktop/` & `_mobile/`:
  - View 1: New check form (`/check`) — message text, screenshot upload, identifier fields, language selector, consent.
  - View 2: Entity confirmation (`/check/[id]` state `awaiting_confirmation`) — editable text, entity chips, add/remove entity.
- `monochrome_investigation_feed/`: Live progress (`/check/[id]` state `investigating` & `scoring`) — 6 agent cards, SSE feed, activity log drawer.
- `verifier_final_report_desktop/` & `_mobile/`: Final report (`/check/[id]` state `report_ready`) — risk badge, confidence, coverage, flags, verified/couldNotCheck/notApplicable, checklist, modals.
- `verifier_guides_desktop/` & `_mobile/`: Guides index (`/guides`) and details (`/guides/[type]`).
- `verifier_report_fraud_desktop/` & `_mobile/`: Fraud mitigation triage & complaint drafting (`/report-fraud`).
- `verifier_about_desktop/` & `_mobile/`: Architecture, methodology, privacy & DPDP guidelines (`/about`).
- `verifier_history_desktop/` & `_mobile/`: Historical checks view (localStorage on device; see conflicts).
- `verifier_log_in_google_oauth/`: OAuth prototype (see conflicts).

## 2. Existing Code & Reusability
- `deferred/ui/`:
  - `page.landing.js`: Hero copy and scam archetype data are reusable; layout and tokens to be updated.
  - `page.check.js`: Form submission state, sample offer presets, and image handler are reusable.
  - `layout.js` & `globals.css`: Header shell and dark mode media query foundations are reusable.
- `app/` & `components/`:
  - `components/AgentCards.js`: 6 canonical agent cards with live chips (`waiting`, `running`, `done`, `found_issues`, `not_applicable`, `could_not_check`). 100% reusable.
  - `components/AgentActivityDrawer.js`: Slide-over drawer / bottom sheet for per-agent activity logs, tool traces, queries, and manual checks. 100% reusable.
  - `app/check/[id]/page.js`: Implements full SSE lifecycle (`/stream`), Last-Event-ID resume, and polling fallback (`/events?after=`). State orchestration is reusable; styles will be updated to precision tokens.
  - `app/api/checks/...`: Complete, verified Next.js App Router backend routes ready for UI consumption.

## 3. Real API Contract Alignment
- `POST /api/checks`: Accepts multipart payload (`text`, `userNotes`, `images` <=5, `url`, `upiId`, `company`, `handle`, `handlePlatform`, `phone`, `youtubeUrl`, `language`, `consent: true`). Returns `{ checkId, status }`.
- `GET /api/checks/:id`: Returns `{ check: CheckSummary, entities: Entity[], text: string }`.
- `POST /api/checks/:id/confirm`: Accepts `{ texts: string[], entities: ConfirmedEntity[] }`. Idempotent 200 on replay.
- `GET /api/checks/:id/stream`: SSE feed streaming `TraceEvent` records (max 4 KB each, seq monotonic).
- `GET /api/checks/:id/events?after=<seq>`: Polling fallback returning `{ events: TraceEvent[] }`.
- `GET /api/checks/:id/agents`: Returns all 6 agents in canonical order with full activities and tool traces.
- `GET /api/checks/:id/report`: Returns `ReportSchema` (`riskLevel`, `score`, `confidence`, `summary`, `flags`, `verified`, `couldNotCheck`, `notApplicable`, `checklist`, `moreChecks`, `actions`, `whereDisagreed`, `coverage`, `improveCheck`, `disclaimer`).
- Action routes: `POST /api/checks/:id/feedback`, `POST /api/checks/:id/college-email`, `POST /api/checks/:id/fraud-summary`, `POST /api/checks/:id/save-to-graph`.

## 4. Conflicts Between Design and PRD / ARCHITECTURE
- **Authentication**: Design includes Google OAuth and user login (`operator@verifier.internal`). PRD §4/§13 mandates an anonymous, unauthenticated tool with 24h check expiration.
  *Resolution*: PRD wins on behavior. No auth wall. Header provides public navigation (`/`, `/check`, `/guides`, `/report-fraud`, `/about`) and language switch (EN/हि).
- **Public History**: Design shows a central server-synced 42-check history. PRD §13/§19 strictly protects privacy (checks accessible only via UUID, expired after 24h, no central index).
  *Resolution*: PRD wins on behavior. Any check history is purely client-side via device `localStorage` of previously visited check IDs.
- **Input Fields**: Design prototypes omit `userNotes` and `handlePlatform`.
  *Resolution*: PRD wins on behavior. Form includes `userNotes` ("Other relevant context", max 5,000 chars) and `handlePlatform` dropdown.
- **Report Structure**: Design prototypes group items into generic cards. PRD §11 requires distinct presentation for `flags` (with exact quotes/source badges), `verified`, `couldNotCheck`, `notApplicable`, `coverage` card, and `whereDisagreed`.
  *Resolution*: PRD wins on data presentation; design wins on typography, hairline borders, and token palette.
- **Untrusted Content**: User and fetched text must be rendered strictly as plain text (react text nodes), never `dangerouslySetInnerHTML`.
