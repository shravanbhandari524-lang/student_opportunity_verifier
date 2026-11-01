# UI Specification: Home (`/`) and New Check (`/check`)

## 1. References Examined
- Home Reference: `.agents/design/home/code.html` and `.agents/design/home/home.png` (matching user upload `media_1793552726518_8e19e939.png`).
- New Check Reference: `.agents/design/newcheck/code.html` and `.agents/design/newcheck/newcheck.png` (matching user upload `media_1793552749450_73d7f35f.png`).
- Shared System Tokens: `.agents/design/precision_technical_minimal/DESIGN.md`.

## 2. Layout Shell & Navigation
- **Desktop (>= 1024px)**:
  - Left Sidebar Rail: fixed width 256px (`w-64`), border-right `1px solid #E5E7EB`, background `#FFFFFF`, sticky top 0, height 100vh.
  - Sidebar Header: 64px height (`h-16`), px-6, brand title "Verifier" (or "Aegis Core / Forensic OS v2.4").
  - Sidebar Navigation Items: Home (`/`), New check (`/check` with Cmd+N badge), Guides (`/guides`), Report fraud (`/report-fraud`), About (`/about`). Active state: `#F9FAFB` surface, `1px solid #E5E7EB` border, text `#0A0A0A` font-semibold.
  - Sidebar Bottom: Operational telemetry (`NODE MUM-01 STABLE` with 6px pulsing emerald dot) and Analyst/Session badge.
  - Top Utility Bar: 64px height (`h-16`), border-bottom `1px solid #E5E7EB`, px-8, breadcrumbs (`DASHBOARD / OVERVIEW` or workspace switcher) and user icon.
- **Mobile (< 1024px, tested at 390px)**:
  - Strict vertical single-column stack. Sidebar converts to top header with logo, operational dot, and mobile navigation drawer. Main canvas padding adjusts to `16px` (`px-4`), table converts to horizontal scroll or stacked ledger cards with zero horizontal overflow.

## 3. Home Page (`/`) Section Order & Specifications
1. **Top Greeting**:
   - `H1`: "Good morning, Shreyas" (30px/36px Geist font-extrabold, tight tracking `-0.035em`, metallic gradient `linear-gradient(135deg, #0A0A0A 0%, #374151 70%, #4B5563 100%)`).
   - Subtitle: "System operational • All security checks up to date" (14px Geist text `#6B7280`).
2. **System Metrics (4 Connected Stat Blocks)**:
   - Grid: `grid-cols-1 md:grid-cols-4`, border `1px solid #E5E7EB`, background `#FFFFFF`, inner dividers `1px solid #E5E7EB`, rounded `4px`.
   - Block 1 (Total Checks): Label "Total Checks", metric `14` (30px bold), badge `+100%` (`#10B981` JetBrains Mono).
   - Block 2 (Threats Neutralized): Label "Threats Neutralized", metric `3` (30px bold), rate `21.4%`, badge `HIGH RISK` (bg `#FEF2F2`, text `#991B1B`).
   - Block 3 (Legitimate Verified): Label "Legitimate Verified", metric `10` (30px bold), rate `71.4%`, badge `CLEARED` (bg `#ECFDF5`, text `#065F46`).
   - Block 4 (Pending Audits): Label "Pending Audits", metric `1` (30px bold), badge `Queued` (text `#9CA3AF`).
3. **Run New Verification Action Banner**:
   - Container: border `1px solid #E5E7EB`, rounded `4px`, p-5, flex justify-between items-center.
   - Text: "Run New Verification" (16px bold) + description (12px text `#6B7280`).
   - Action: `+ New Check` button (bg `#0A0A0A`, text `#FFFFFF`, 14px font-medium, rounded `4px`, px-5 py-2.5).
4. **Recent Forensic Checks Table**:
   - Header: "Recent Forensic Checks" (18px bold metallic) + "LEDGER ENTRIES" (11px JetBrains Mono text `#9CA3AF`) + "View Complete Ledger >".
   - Table: border `1px solid #E5E7EB`, rounded `4px`, thead bg `#F9FAFB` (`text-[11px] font-mono text-[#6B7280] uppercase tracking-wider`).
   - Columns: `TARGET DOSSIER` | `THREAT CATEGORY` | `TIMESTAMP` | `VERDICT` | `ACTION`.
   - 4 Canonical Rows: ONGC Graduate Trainee Selection (HIGH RISK), Tata Trusts Grant (CLEARED), Cognizant Off-Campus Recruiter (MEDIUM RISK), NSP Pre-Matric Fee Demand (HIGH RISK).
5. **Footer Telemetry**:
   - `AEGIS TELEMETRY CORE • REVISION 24.8.1-PROD` (left) | `FEDERATED CONSENSUS STATUS: NORMAL` (right) in 11px JetBrains Mono text `#9CA3AF`.

## 4. New Check Page (`/check`) Section Order & Specifications
1. **Top Stepper / Demo Switcher**:
   - Stepper: `01 New check form` (active bold) | `02 Confirm details (OCR extract)` (inactive).
   - Demo States: `Empty` | `Filled` | `Error`.
2. **Form Header**:
   - Title: "New check" (24px font-semibold text `#0A0A0A`), badge `INTEL-v4.1` (11px JetBrains Mono bg `#F3F4F6`), Language toggle `EN / हि`.
3. **Card 1: Message / Transcript Box (Required)**:
   - Outer border: stark `1px solid #0A0A0A`, rounded `12px` (`rounded-xl`).
   - Header bar: bg `#F9FAFB`, border-b `1px solid #E5E7EB`, label "Message, chat transcript or email body" (14px text `#0A0A0A`), badge "REQUIRED" (11px font-mono).
   - Textarea: 7 rows, 14px Geist, focus:outline-none, auto-sanitized note + character counter `1,420 / 10,000` at bottom right.
4. **Card 2: Screenshots & Evidence**:
   - Header: "Screenshots & evidence" (14px font-semibold) + "2 of 5 screenshots" (11px font-mono).
   - Dropzone: border dashed `1px solid #E5E7EB`, bg `#F9FAFB/40`, rounded `12px`.
   - Preview Chips: 2-column grid showing thumbnail, file name, size, OCR ready tag, remove `x` button.
5. **Card 3: More Details (Collapsible Structured Anchors)**:
   - Header: "More details" + badge "5 contextual anchors" + chevron toggle.
   - Subtext: "Optional structured parameters allow direct heuristic matching against the National Threat Registry."
   - Fields:
     - Link / Domain URL (with link icon)
     - UPI Handle / ID (with wallet icon) | Phone / Sender MSISDN (with call icon)
     - Claimed Entity / Organization (with corporate icon) | Social Channel / Handle (with @ icon)
     - Added per Prompt: Handle Platform field (`handlePlatform`) & Other Information / Notes box (`userNotes`).
6. **Card 4: Statutory Disclaimer Checkbox**:
   - bg `#F9FAFB`, border `1px solid #E5E7EB`, rounded `8px`, checked checkbox with mandatory non-verdict notice.
7. **Action Footer**:
   - Left: "Clear form" button.
   - Right: "Inspect OCR" (secondary outline) and "Start check ->" (primary black button, submits form to `/api/checks` and redirects to `/check/[id]`).
