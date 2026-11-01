---
name: Precision Technical Minimal
colors:
  surface: '#fbf8ff'
  surface-dim: '#dad9e3'
  surface-bright: '#fbf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f2fd'
  surface-container: '#eeedf7'
  surface-container-high: '#e8e7f1'
  surface-container-highest: '#e3e1ec'
  on-surface: '#1a1b22'
  on-surface-variant: '#444748'
  inverse-surface: '#2f3038'
  inverse-on-surface: '#f1effa'
  outline: '#747878'
  outline-variant: '#c4c7c7'
  surface-tint: '#5f5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1c1b1b'
  on-primary-container: '#858383'
  inverse-primary: '#c9c6c5'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#40000c'
  on-tertiary-container: '#f83256'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e5e2e1'
  primary-fixed-dim: '#c9c6c5'
  on-primary-fixed: '#1c1b1b'
  on-primary-fixed-variant: '#474646'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffdada'
  tertiary-fixed-dim: '#ffb3b6'
  on-tertiary-fixed: '#40000c'
  on-tertiary-fixed-variant: '#920028'
  background: '#fbf8ff'
  on-background: '#1a1b22'
  surface-variant: '#e3e1ec'
typography:
  display-hero:
    fontFamily: Geist
    fontSize: 48px
    fontWeight: '600'
    lineHeight: 52px
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 38px
    letterSpacing: -0.03em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.025em
  headline-md:
    fontFamily: Geist
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.02em
  headline-sm:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: -0.015em
  body-default:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: -0.01em
  body-strong:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: -0.01em
  body-muted:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: -0.005em
  code-base:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: -0.01em
  label-mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
  label-mono-xs:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 12px
    letterSpacing: 0.04em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-lg: 1.5rem
  margin: 1rem
  margin-md: 1.5rem
  margin-lg: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

This design system delivers an ultra-clean, mission-critical workspace engineered for high-assurance AI verification, runtime security, and automated fraud analysis. It targets technical operators, security engineers, and infrastructure architects who demand immediate signal clarity, instant feedback loops, and zero decorative noise.

The aesthetic fuses extreme reductionist minimalism with high-performance utility—reminiscent of low-latency developer environments like Linear and Stripe Radar. Rather than relying on simulated depth or artificial container cards, structural clarity is achieved through disciplined hairline grid frameworks, dense micro-typography, surgical metric alignments, and authentic data densities. The interface prioritizes rapid visual scanning: passive surfaces remain absolute pure white (#ffffff) or muted mist (#fafafa), while telemetry states communicate through razor-sharp binary indicators (active emerald vs. critical crimson).

## Colors

The palette operates on high-contrast monochromatic purity punctuated solely by operational signals:

- **Base Canvas & Surfaces**: 
  - Root viewport: `#ffffff`
  - Sub-surface / Canvas Underlay: `#fafafa`
  - Subtle interactive hover surface: `#f4f4f5`
- **Hairline Structural Borders**: 
  - Primary boundary & structural rule: `#e5e7eb` (1px solid)
  - Nested divider & subtle inner track: `#f3f4f6` (1px solid)
- **Typographic Hierarchy**:
  - Ink Primary: `#0a0a0a`
  - Ink Secondary / Supporting: `#52525b`
  - Ink Tertiary / Muted telemetry: `#a1a1aa`
  - Heading Display Accent: Subtle linear gradient from `#0a0a0a` to `#334155` applied via background-clip for high-impact metric headers.
- **Operational Status Accents**:
  - Precision Emerald (`#10b981` / Dark text contrast variant `#059669`): Indicates validated state, passing assertions, active agents, and sub-millisecond uptime.
  - Crimson Alert (`#e11d48` / Dark text contrast variant `#be123c`): Indicates high-risk anomalies, failed assertions, security breaches, and blocked executions.
  - Ambient Amber (`#f59e0b`): Reserved strictly for degradation alerts or latency warnings.

Heavy drop shadows, saturated box-shadow glows, neon gradients, and dark theme inversion are strictly prohibited.

## Typography

The type hierarchy couples the geometric precision of `Geist` for rapid human reading with the technical cadence of `JetBrains Mono` for machine state verification.

- **Primary Display & Headings**: Set in `Geist` (SemiBold, 600 weight) with aggressive tight tracking (`-0.03em` to `-0.04em`). Major display titles utilize a razor-sharp linear fill (`linear-gradient(180deg, #0a0a0a 0%, #334155 100%)`) providing subtle depth without blur or dimensional styling.
- **Body & Data Tables**: Standardized on 14px/20px and 13px/18px `Geist` in neutral dark `#171717` and `#52525b`, optimized for dense multi-line verification logs.
- **Monospace Telemetry Layer**: Latency readings (`42ms`), cryptographic hashes (`0x7f...a9b`), agent models (`gpt-4o-mini-verified`), and status badges are strictly displayed in `JetBrains Mono`. Micro-labels at 10px and 11px enforce subtle uppercase styling with relaxed tracking (`+0.04em`) to ensure legibility across dense data displays.

## Layout & Spacing

The layout philosophy follows a rigid 12-column fluid grid bound within strict tabular constraints. Spacing is strictly arithmetic, adhering to a 4px baseline rhythm.

- **Grid Alignment**: 12-column fluid configuration on desktop viewports (`>= 1024px`) with a fixed maximum container width of `1440px`. Column separation is dictated by `gutter` (16px) or hairline cell separation lines rather than empty negative margins.
- **Inner Padding**: Standard component padding leverages `space-xs` (4px) and `space-sm` (8px) for compact rows, and `space-md` (12px) for control headers. Panels scale between `space-lg` (20px) and `space-xl` (32px).
- **Responsive Adaptations**:
  - **Desktop (1024px+)**: Split master-detail arrangements; persistent left utility rail (48px or 200px collapsed), dynamic verification table center, diagnostic sidebar right.
  - **Tablet (768px - 1023px)**: Main panel spans 12 columns; contextual inspection panels collapse into full-width sliding drawers. Gutters lock to `16px`.
  - **Mobile (< 768px)**: Strict vertical stacking; columns collapse to 1. Monospace indicators convert into condensed horizontal scrollers; table rows transform into stacked hairline list items. Margin locks to `16px`.

## Elevation & Depth

This system eliminates artificial drop shadows, colored halos, and blurred surfaces. Depth is purely architectural, conveyed via hairpins, borders, and microscopic white-to-neutral offsets:

- **Zero Diffusion Shadows**: Floating elements (such as command palettes, popovers, and context menus) feature zero heavy blur. They rely on an ultra-crisp hairline stroke (`1px solid #e5e7eb`) accompanied only by an imperceptible micro-shadow: `0 1px 2px 0 rgba(0, 0, 0, 0.05)`.
- **Structural Partitioning (Hairline Rule)**: Cards and surfaces share the same plane as the canvas. Layering is conveyed by `1px solid #e5e7eb` structural borders, dividing panels with surgical boundaries.
- **State Feedback via Micro-Surface Shift**: Hoverable rows and actionable items change background strictly from `#ffffff` to `#f4f4f5` or `#fafafa`. No physical elevation or transformation (Y-axis translation) is permitted.

## Shapes

The interface adopts a restrained, precise shape profile (`roundedness: 1`). Soft curves are constrained to prevent an overly casual or cartoonish look, sustaining an exact software engineering feel:

- **Default Form Elements & Buttons**: Bound to `4px` (`rounded`, 0.25rem).
- **Cards, Modals, and Main Framework Panels**: Bound to `6px` or `8px` (`rounded-lg`, max 0.5rem).
- **Status Pills & Metric Tokens**: Bound strictly to `3px` or `4px` micro-rectangles, never full pill geometries (`9999px`), ensuring metrics present as calibrated mechanical instruments rather than consumer chips.
- **Icon Enclosures**: Icons must float purely inline without enclosing squircle, circular, or colored badge frames.

## Components

### Buttons
- **Primary Action**: Solid `#0a0a0a` background with `#ffffff` text, 1px border `#0a0a0a`, 4px border-radius. Padding: `6px 12px` (compact) or `8px 16px` (standard). Typography: 13px Medium. Active state: `#27272a`.
- **Secondary / Outline**: `#ffffff` background with `#0a0a0a` text, 1px solid `#e5e7eb` border. Hover: `#f4f4f5`, border color `#d4d4d8`.
- **Ghost / Minimal**: Transparent background, `#52525b` text. Hover: `#f4f4f5`, text `#0a0a0a`.

### Status Indicators & Badges (Chips)
- **Agent Active**: Background `#ecfdf5`, border `1px solid #a7f3d0`, text `#065f46`, font `JetBrains Mono` 11px uppercase. Includes a static 5px solid `#10b981` dot (no pulsars or glows).
- **Threat Detected**: Background `#fff1f2`, border `1px solid #fecdd3`, text `#9f1239`, font `JetBrains Mono` 11px uppercase. Includes a 5px solid `#e11d48` dot.
- **Telemetry Hash / Model**: Background `#fafafa`, border `1px solid #e5e7eb`, text `#3f3f46`, font `JetBrains Mono` 11px.

### Input Fields & Controls
- **Inputs**: Base white `#ffffff`, 1px solid `#e5e7eb`, 4px radius, height 36px (compact 32px), typography 13px `Geist`. Focus state: border turns `#0a0a0a` with zero outer ring glow.
- **Checkboxes & Radios**: 14px × 14px square/circle, 1px solid `#d4d4d8`. Checked: solid `#0a0a0a` fill with pure white tick icon.

### Data Tables & Log Lists
- Strict hairline grid architecture.
- **Header Row**: `#fafafa` background, height 32px, text `#71717a`, `JetBrains Mono` 11px uppercase tracking `0.04em`, bottom border `1px solid #e5e7eb`.
- **Data Rows**: `#ffffff` background, height 40px, bottom border `1px solid #f3f4f6`, hover transition to `#fafafa`. All numerical columns and hashes right-aligned in `JetBrains Mono`.

### Cards & Panels
- Canvas-flush panels constructed with `1px solid #e5e7eb` boundaries, `#ffffff` fill, and no drop shadows. Header segments within panels are separated by continuous horizontal hairline dividers.