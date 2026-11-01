# UI Specification: History, Guides, and Final Report

Derived strictly from `.agents/design/history/code.html`, `.agents/design/guides/code.html`, `.agents/design/verifier_final_report_desktop/code.html`, and `.agents/design/precision_technical_minimal/DESIGN.md`.

---

## 1. Shared Design System Tokens
- **Typography**:
  - `Geist` (Inter fallback): Display Hero 48px/52px (-0.04em), Headline Lg 32px/38px, Headline Md 22px/28px, Headline Sm 16px/22px, Body Default 14px/20px, Body Muted 13px/18px.
  - `JetBrains Mono`: Code Base 13px/18px, Label Mono Sm 11px/14px, Label Mono Xs 10px/12px.
- **Colors**:
  - Surface Lowest: `#ffffff`, Surface Low: `#f4f2fd` / `#f9f9f9`, Surface High: `#e8e8e8`.
  - Borders: hairline `#e5e7eb` / `#e5e5e5` (`outline-variant/30`).
  - Status Dots: High/Crimson `#dc2626` / `#ba1a1a`, Medium/Amber `#525252` / `#f59e0b`, Low/Emerald `#16a34a` / `#10b981`.
- **Navigation Shell**:
  - Fixed 240px/256px sidebar on desktop: `Verifier` logo + version badge (`v2.8`), Navigation links (`Home`, `New check`, `History`, `Guides`, `Report fraud`), Runtime status indicator (`99.98% Runtime Operational` / Language toggle).
  - Mobile top header (56px) with brand, hamburger toggle, and drawer navigation.

---

## 2. History Page Specification (`/history`)
- **Layout & Container**: Centered column (`max-w-[760px]`), padding `px-4 py-8 md:px-6 md:py-10`.
- **Section Order**:
  1. **Header Line**: Title "History", counter (e.g. `X checks`), synced status indicator with dot.
  2. **Search and Filter Bar**:
     - Search input with search icon and clear button (`#history-search`).
     - Filter tabs with counts: `All`, `High`, `Medium`, `Low`, `Unverified` (active tab has bottom border `border-primary font-semibold`).
  3. **Grouped Feed Container**:
     - Group headers by month/time (e.g. "February 2026", "Recent Checks", uppercase mono label).
     - Card container: `border border-[#e5e5e5] rounded-xl divide-y divide-[#e5e5e5] bg-white overflow-hidden`.
     - Row layout: Status pip/dot + label (`w-[84px]`), check title / extracted text preview, timestamp, chevron right icon (`chevron_right`).
  4. **Empty States**:
     - Empty search: "No checks found - Try adjusting your search query or switching active risk filters".
     - Empty history: Clean zero-state with link to `/check`.
  5. **Footer Meta**: Pagination/count summary ("Showing X of Y checks") + Export CSV button.
- **Data Source**: Client-side `localStorage` (`aegis_recent_checks` / `ov_recent_checks`). Checks expire after 24h TTL; expired checks clearly labeled or cleaned up.

---

## 3. Guides Pages Specification (`/guides` and `/guides/[type]`)
- **Index (`/guides`)**:
  - Layout: `max-w-[1440px] px-6 py-8 space-y-6`.
  - Header: Label mono "Forensic Playbooks // Fraud Patterns & Detection", headline "Guides", subtitle description.
  - Search & Filters: Search input + category filter pills (`All Guides`, `Offer Letters`, `UPI & Banking`, `Fake Portals`, `Government Gazettes`, `Interviews`).
  - Grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`.
  - Guide Card: Category pill, read time, title, excerpt with gradient mask, doc ID (e.g. `DOC-ID: GVT-9921`), "Read guide →" link to `/guides/[type]`.
- **Detail (`/guides/[type]`)**:
  - Layout: Centered article (`max-w-[800px]`), breadcrumb "← Back to guides".
  - Sections: Archetype Overview, How the scam works (numbered stages), Warning Red Flags (with severity dots), What to do if targeted, Immediate links to `/check` and `/report-fraud`.
  - Content Source: `GET /api/guides/:type` with fallback to PRD section 2 guide archetypes.

---

## 4. Final Report State Specification (`/check/[id]`)
- **Container**: `max-w-[760px] mx-auto px-4 py-8 flex flex-col gap-6 text-[#111827]`.
- **Section Order (PRD Section 11 & Reference Parity)**:
  1. **Header & Metadata**: Case number (`Case #xxxx`), verification time, SHA-256 fingerprint, 24h TTL notice.
  2. **Risk Verdict Headline**: Large verdict text (`HIGH`, `MEDIUM`, `LOW`, `CANNOT VERIFY`), status dot, confidence level (`Confidence: High / Medium / Low`), 2px minimal score line gauge (`Score X / 100 Risk`), one-sentence summary, entity chips.
  3. **Section 1: Why · Flags Detected**: Expandable accordion items (`details/summary`) with red/amber dots, flag title, plain-text explanation, quoted snippet block (`bg-[#fafafa] border border-[#e5e5e5] p-3 font-mono`), and benchmark authority link.
  4. **Section 2: Checked Out · Verified Cleared**: Green check icons (`check`), list of corroborated claims and clean heuristics.
  5. **Section 3: Could Not Check · Unresolved & N/A**: Warning icons (`warning`), separated into degraded/timed-out tool checks and not-applicable checks.
  6. **Section 4: Verify Next (Checklist)**: Numbered actionable preservation items with checkboxes and clipboard copy button.
  7. **Section 5: Investigation Machine Runtime Log**: Collapsible autonomous agent trace showing execution steps.
  8. **Action Row**: Three side-by-side action buttons:
     - `Email my college` (opens College Email Draft modal with recipient switcher).
     - `I already paid` (links to `/report-fraud?check=:id`).
     - `Copy checklist` (copies checklist text to clipboard).
  9. **Feedback Row**: "Was this verification accurate?" with `Right` (thumbs up) and `Wrong` (thumbs down opening feedback modal).
  10. **Statutory Disclaimer**: "Verifier is an autonomous advisory tool and does not constitute statutory legal advice." + unique Report ID.
