---
name: Monochrome Precision
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f3'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#444748'
  inverse-surface: '#2f3131'
  inverse-on-surface: '#f0f1f1'
  outline: '#747878'
  outline-variant: '#c4c7c7'
  surface-tint: '#5f5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1c1b1b'
  on-primary-container: '#858383'
  inverse-primary: '#c9c6c5'
  secondary: '#5e5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e4e2e2'
  on-secondary-container: '#646464'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1d1b1a'
  on-tertiary-container: '#868381'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e5e2e1'
  primary-fixed-dim: '#c9c6c5'
  on-primary-fixed: '#1c1b1b'
  on-primary-fixed-variant: '#474646'
  secondary-fixed: '#e4e2e2'
  secondary-fixed-dim: '#c8c6c6'
  on-secondary-fixed: '#1b1c1c'
  on-secondary-fixed-variant: '#474747'
  tertiary-fixed: '#e6e1df'
  tertiary-fixed-dim: '#cac6c3'
  on-tertiary-fixed: '#1d1b1a'
  on-tertiary-fixed-variant: '#484645'
  background: '#f9f9f9'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.035em
  headline-xl-mobile:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.03em
  headline-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.025em
  headline-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.02em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: -0.005em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0em
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.06em
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: -0.01em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 16px
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
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system embodies high-density minimalism, technical precision, and editorial restraint. Drawing direct inspiration from modern developer platforms and systematic productivity software, the aesthetic relies on structural alignment, stark contrast, and rigorous typography rather than decorative ornamentation.

The visual ethos is deliberate, quiet, and razor-sharp:
- **Atmosphere:** Utilitarian clarity, institutional calm, and uncompromising functional focus.
- **Surface Quality:** Completely flat planes, zero soft gradients, zero glowing colored halos, and absence of diffuse decorative drop shadows.
- **Chromatic Discipline:** An uncompromising black-and-white baseline where pure white canvases and deep charcoal ink establish hierarchy. Color is treated strictly as an operational telemetry signal, not visual decoration.

## Colors

The palette operates under absolute chromatic restraint. Neutral tones govern 99% of the surface area, reserving chromatic accents solely for binary state indicators.

### Neutrals and Structure
- **Canvas Base (`#FFFFFF`):** Default page background and primary card faces.
- **Subtle Surface (`#FAFAFA`):** Inset code blocks, table headers, alternating row striping, and sidebar panels.
- **Structural Border (`#E5E5E5`):** 1px mechanical perimeter borders, row dividers, and input outlines.
- **Muted Border (`#F5F5F5`):** Ultra-subtle interior divider rules.

### Typography & Content
- **Text Primary (`#0A0A0A`):** Headlines, active states, emphasized labels, high-priority telemetry metrics.
- **Text Secondary (`#525252`):** Body paragraphs, metadata, breadcrumbs, column headers, neutral status labels.
- **Text Subtle (`#A3A3A3`):** Placeholders, hotkey markers, disabled elements, inactive line numbers.

### Operational Accents (Strict Scope)
- **Positive Accent (`#16A34A`):** Permitted strictly for pass status dots, active pipeline indicators, success verdicts, and safe metrics.
- **Destructive Accent (`#DC2626`):** Permitted strictly for fatal errors, terminated processes, high-risk verdicts, and destructive actions.
- **Neutral Status Fallback (`#525252`):** Intermediate, pending, warning, or queued states must not use amber, orange, or yellow. They are rendered entirely in secondary slate grey with solid or pulsing monochrome pips.

## Typography

Typography governs information density and structural pace:
- **Inter** handles all narrative hierarchy and general interface labels. Headings demand tight letter-spacing (`-0.025em` to `-0.035em`) to eliminate visual slack and emulate modern editorial publishing.
- **Section Headers & Eyebrows:** Small uppercase titles rendered in 11px Inter (`label-caps`) with deliberate outward tracking (`0.06em`) to anchor content modules without heavy visual mass.
- **JetBrains Mono** is enforced for all domain names, raw logs, commit SHAs, database IDs, runtime statistics, and filter operators.

## Layout & Spacing

The layout model is anchored to a strict 4px/8px modular grid. Information density is prioritized over decorative negative space.

- **Grid Architecture:** 12-column responsive fluid grid on desktop (max content bounds 1280px) transitioning to a single fluid column on mobile screens under 640px.
- **Section Layouts:** Outer wrappers employ clean full-bleed 1px horizontal borders rather than boxed margins to separate logical page zones.
- **Rhythm Rules:**
  - Micro gaps (meta rows, badge clusters, inline metrics): 4px to 8px (`space-xs` to `space-sm`).
  - Standard component interior padding: 12px to 16px (`space-sm` to `space-md`).
  - Section blocks and data tables: 24px to 40px (`space-lg` to `space-xl`).

## Elevation & Depth

This system operates without simulated physical light sources. Elevation is expressed entirely through tonal boundaries and hairline borders:

- **Surface Isolation:** 1px solid `#E5E5E5` hairline borders demarcate all containers, cards, dialogs, and structural columns.
- **No Drop Shadows:** Default elements carry `box-shadow: none`. Modals, popovers, and flyout dropdowns use a single razor outline (`1px solid #0A0A0A` or `1px solid #E5E5E5`) paired with a functional 1px ambient offset: `0px 4px 12px rgba(0, 0, 0, 0.04)`.
- **Nesting Hierarchy:** Primary pages sit on `#FFFFFF`. Secondary grouping containers, toolbars, and tabular headers alternate with `#FAFAFA`. Inset code blocks and interactive wells use `#FAFAFA` with an inner 1px border.

## Shapes

Corner radii are standardized by functional component type rather than uniform global application:

- **Cards and Panels:** Fixed at 8px (`rounded-md`).
- **Interactive Controls (Buttons, Inputs, Selects):** Fixed at 6px (`rounded-sm`).
- **Chips, Pills, and Verdict Badges:** 9999px (full rounded pill geometry).
- **Tooltips and Keyboard Hints:** Fixed at 4px.

## Components

### Buttons
- **Primary:** Background `#0A0A0A`, text `#FFFFFF`, border none, radius 6px. Height 32px (compact) or 36px (default). Hover state shifts to `#262626`.
- **Secondary:** Background `#FFFFFF`, text `#0A0A0A`, 1px solid `#0A0A0A` border, radius 6px. Hover state shifts background to `#FAFAFA`.
- **Ghost / Tertiary:** Background transparent, text `#525252`, border none, radius 6px. Hover state shifts text to `#0A0A0A` and background to `#FAFAFA`.

### Badges & Verdict Chips
- **Geometry:** Height 20px, full pill shape (`border-radius: 9999px`), inline-flex alignment, padding 0 8px. Font is `11px JetBrains Mono` or `11px Inter` medium weight.
- **Monochrome Neutral (Default):** Background `#FAFAFA`, text `#525252`, border 1px solid `#E5E5E5`.
- **Status Pip:** A 6px solid circular pip prefixed before the text label.
  - Safe / Passed: Pip is `#16A34A`.
  - Failed / High Risk: Pip is `#DC2626`.
  - In Progress / Queued: Pip is `#525252` (never amber).

### Input Fields & Controls
- **Text Inputs:** Background `#FFFFFF`, 1px solid `#E5E5E5`, radius 6px, text `#0A0A0A`, font `Inter` or `JetBrains Mono` at 13px. Focus state tightens border to `#0A0A0A` with no outward colored glow ring.
- **Checkboxes & Radios:** 14px boxes with 1px solid `#E5E5E5` border and 3px radius (circular for radios). Active state fills background `#0A0A0A` with crisp `#FFFFFF` tick mark.

### Cards & Panels
- **Structure:** Background `#FFFFFF`, 1px solid `#E5E5E5`, radius 8px, padding 16px to 20px. Header zones demarcated by an interior full-width 1px `#E5E5E5` hairline divider.
- **Hover State:** Optional subtle transition shifting border to `#0A0A0A` without translation or drop shadow.

### Code Blocks & Monospace Data Tables
- **Code Wells:** Background `#FAFAFA`, 1px solid `#E5E5E5`, radius 6px, padding 12px, font `JetBrains Mono` 12px/20px, text `#0A0A0A`.
- **Data Tables:** Outer border 1px solid `#E5E5E5`, headers `#FAFAFA` with text `#525252` in 11px uppercase tracking, row borders 1px solid `#E5E5E5`, interactive rows hover at `#FAFAFA`.