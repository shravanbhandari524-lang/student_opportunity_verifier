---
name: Monochrome Investigation Feed
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f3f3'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#444748'
  inverse-surface: '#2f3131'
  inverse-on-surface: '#f1f1f1'
  outline: '#747878'
  outline-variant: '#c4c7c7'
  surface-tint: '#5f5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1c1b1b'
  on-primary-container: '#858383'
  inverse-primary: '#c8c6c5'
  secondary: '#5e5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e3e2e2'
  on-secondary-container: '#646464'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1c1b1a'
  on-tertiary-container: '#868382'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e5e2e1'
  primary-fixed-dim: '#c8c6c5'
  on-primary-fixed: '#1c1b1b'
  on-primary-fixed-variant: '#474746'
  secondary-fixed: '#e3e2e2'
  secondary-fixed-dim: '#c7c6c6'
  on-secondary-fixed: '#1b1c1c'
  on-secondary-fixed-variant: '#464747'
  tertiary-fixed: '#e6e2df'
  tertiary-fixed-dim: '#cac6c4'
  on-tertiary-fixed: '#1c1b1a'
  on-tertiary-fixed-variant: '#484645'
  background: '#f9f9f9'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: -0.005em
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0em
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: -0.02em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style
The design system establishes a high-density, analytical workspace engineered for forensic inquiry, security triage, and system observation. Drawing from Scandinavian minimalism, early Swiss informational design, and the disciplined utility of Linear and Notion, the interface avoids all decorative noise. 

The emotional signature is austere, objective, and surgically precise. It treats information as architecture: clarity is derived through precise typographic contrast, strict baseline adherence, and fine-line geometry rather than heavy surfaces or dimensionality. The interface recedes completely, directing all perceptual bandwidth toward the investigation log, audit trails, and technical metadata.

## Colors
The system employs an uncompromising monochrome palette supported by binary status accents.

- **Canvas & Surfaces:** Primary surface is stark `#FFFFFF`. Expanded code panels, sub-layers, and contextual drawers rest on `#FAFAFA`.
- **Text & Foregrounds:** Critical titles, identifiers, and primary text render in `#171717`. Secondary metadata, inactive states, and timestamps resolve to `#737373`. Placeholder text uses `#A3A3A3`.
- **Dividers & Borders:** All spatial delineations, row separators, and field boundaries are strictly rendered in hairline 1px `#E5E5E5`.
- **Status Semantic Accents:** Reserved strictly for semantic indicators (e.g., live health status, alert urgency, execution state). Positive/Resolved operations use `#16A34A`; critical/breached anomalies use `#DC2626`. Gradients, glows, and tinted backgrounds are forbidden.

## Typography
Typography carries the organizational weight of the entire interface. The typographic hierarchy utilizes `Inter` for structural and narrative text, paired with `JetBrains Mono` for precise computational syntax, hashes, timestamps, domains, and queries.

- **Titles & Headings:** Investigation titles and stream headers use `Inter` 20px Semibold (`headline-lg`) with tight negative tracking (`-0.015em`) for a focused, editorial register.
- **Row & Log Content:** Primary events and stream items run on `Inter` 14px Regular (`body-md`) with neutral tabular numbers enabled via OpenType feature `tnum`.
- **System Metadata:** Timestamps, breadcrumbs, and structural markers rely on `Inter` 12px Regular (`label-md`) colored `#737373`.
- **Technical Payload:** Raw queries, network domains, file signatures, and terminal fragments utilize `JetBrains Mono` at 12px or 13px (`code-sm` / `label-mono`).

## Layout & Spacing
The layout follows a rigid structural rail anchored to a 4px/8px incremental grid.

- **Grid Architecture:** Fixed-fluid hybrid layout. An investigation feed container spans up to a maximum width of 1440px with a persistent 280px left rail for query filters and session controls.
- **Feed Rhythm:** Dense vertical cadencing. Rows in the investigation feed use exact 36px or 40px bounding heights, providing immediate visual scannability across hundreds of lines of event telemetry.
- **Responsive Adaptations:**
  - *Desktop (≥1024px):* Split feed and inspection panel with a fixed 1px `#E5E5E5` vertical divider. Gutters set to 24px (`space-xl`).
  - *Tablet (768px - 1023px):* Single unified feed; side panels transform into full-height sliding drawers docked to the right edge.
  - *Mobile (<768px):* Stacked presentation. Technical metadata drops below primary descriptions; monospace tags condense horizontally using micro-scroll strips. Canvas margin scales down to 16px (`gutter`).

## Elevation & Depth
This design system operates on absolute flatness. Drop shadows, directional blurs, ambient halos, and layered z-index elevations are entirely prohibited.

- **Separation Mechanism:** Structural depth is achieved purely through 1px `#E5E5E5` border outlines and planar tonal shifts (transitioning from `#FFFFFF` canvas to `#FAFAFA` sub-containers).
- **Overlays & Modals:** Slide-outs and floating palettes do not use drop shadows. Instead, they rely on a sharp 1px `#E5E5E5` perimeter border and an unblurred, clean backdrop wash of `#000000` at 10% opacity.
- **Hover & Active States:** States are signaled through clean color transitions: text jumps from `#737373` to `#171717`, or surface fills shift subtly from `#FFFFFF` to `#FAFAFA`.

## Shapes
Geometry is disciplined and restrained. The baseline roundedness is soft (`0.25rem` / `4px`), delivering a modern, utilitarian finish without playful curves.

- **Containers & Code Blocks:** Strict 4px corner radius.
- **Input Fields & Buttons:** 4px corner radius matching internal container bounds.
- **Status Dots:** Pure circles (`border-radius: 9999px`) sized at precisely 6px by 6px.
- **Pills & Bulky Tags:** Strictly avoided. No pill-shaped containers (`roundedness: 3`) are permitted.

## Components

### Investigation Feed Rows
- **Layout:** Flex row with fixed-width timestamp (monospace, 12px, `#737373`), a 6px status indicator dot, an `Inter` 14px event summary, and right-aligned metadata tags.
- **Dividers:** 1px solid `#E5E5E5` horizontal border bottom. Zero margins between rows.
- **Interaction:** Hover triggers a background transition to `#FAFAFA`. Selected row remains `#FAFAFA` with a 2px left border accent in `#171717`.

### Code Blocks & Query Inspectors
- **Surface:** Solid `#FAFAFA` with a continuous 1px `#E5E5E5` boundary and 4px radius.
- **Typography:** `JetBrains Mono` 13px with 20px line-height. Syntax highlighting is strictly grayscale: comments in `#737373`, strings and keywords differentiated solely by weight (Regular vs. Medium).
- **Padding:** 12px vertical, 16px horizontal (`space-md` to `space-lg`).

### Status Indicators
- **Form Factor:** 6px × 6px geometric circles, unadorned. No pulse rings, no glow effects.
- **States:**
  - *Healthy / Validated:* `#16A34A`
  - *Alert / Failed / Interrupted:* `#DC2626`
  - *Idle / Pending:* `#A3A3A3`

### Metadata Chips (Subtle Labels)
- **Geometry:** Rectangular with a 2px radius, unpadded or padded micro (2px vertical, 6px horizontal).
- **Styling:** No background pill containers. Rendered as raw `#737373` text in `JetBrains Mono` 12px, optionally framed by a hairline 1px `#E5E5E5` border when actionable.

### Buttons & Inputs
- **Buttons (Primary):** Solid `#171717` fill, white `#FFFFFF` text, 4px radius, 32px height, 13px `Inter` Medium. No shadow.
- **Buttons (Secondary / Ghost):** `#FFFFFF` fill, 1px `#E5E5E5` border, `#171717` text. Hover state switches background to `#FAFAFA`.
- **Inputs:** 1px `#E5E5E5` border, `#FFFFFF` background, 4px radius, 32px height. Focus state swaps border to 1px `#171717` with zero outer ring glow.

### Selection Controls (Checkboxes & Radios)
- **Checkboxes:** 14px × 14px square, 2px radius, 1px `#E5E5E5` border. When active, `#171717` solid fill with a 1px white stroke check icon.
- **Radio Buttons:** 14px diameter circular frame, 1px `#E5E5E5` border. Checked state displays a solid 6px `#171717` inner circle.