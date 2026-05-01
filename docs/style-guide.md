# Style Guide

This document describes the visual design system for the eJay Sound Browser,
inspired by the original eJay 2 application interface.

The source of truth is the shipped code in
[src/app.css](../src/app.css) and the renderer modules under `src/`.
If this guide and the code disagree, update this guide to match the code.

## Related Files

- [Architecture notes](architecture-notes.md)
- [Shared stylesheet](../src/app.css)
- [Browser entry](../src/main.ts)
- [HTML shell](../index.html)

## Design Direction

The original eJay UI features a deep navy desktop aesthetic with metallic chrome transport controls,
color-coded sample blocks on a dark grid, and glossy category buttons.
The Sound Browser reinterprets this through a modern dark-first design:

- Surfaces are deep navy panels, not flat black.
- Accents are luminous and saturated, evoking the neon-on-dark palette of the
  original.
- Chrome and metallic textures are abstracted into subtle gradients and
  elevated card surfaces rather than literal skeuomorphism.
- The grid sequencer aesthetic carries over as structured, rhythmic layouts for
  sample lists and metadata.

## Core Rules

- Each individual theme, including the default theme, must be built from one
  central anchor color and its controlled variations (shades, tints, tones,
  and nearby hues). Do not mix unrelated anchor colors inside a single theme
  definition.
- Category coloring uses one shared 14-slot palette: 13 slots for the
  category buttons and one slot for the special `Load JSON` button.
  Sample bubbles and sequencer event blocks inherit colors from this same
  palette mapping.
- Subcategory tabs inherit the active category color and render as shaded
  variants of that category, rather than using a fixed global accent.
- All runtime CSS lives in [src/app.css](../src/app.css). Do not add
  page-local `<style>` blocks or extra stylesheets.
- The stylesheet starts with Tailwind CSS and DaisyUI configuration. Treat it as
  three layers: Tailwind import, DaisyUI theme definition, and custom CSS for
  bespoke pieces DaisyUI does not cover directly.
- Every HTML entry point sets `data-theme="dark"` on the root `<html>` element.
  The site is dark-theme only.
- Prefer DaisyUI component classes in renderer output: `card`, `btn`, `badge`,
  `input`, `alert`, and `kbd` are the default primitives.
- Use custom CSS only for genuinely custom UI: waveform visualizations, playback
  progress, and channel-color accents.
- When changing markup, prefer adding DaisyUI classes in the renderer rather than
  re-implementing component visuals in custom CSS.

## Theme System

The app customizes DaisyUI's `dark` theme inside
[src/app.css](../src/app.css). Color tokens are mapped to the original eJay
palette:

- **Default theme anchor color:** Emerald Green (`#00674F`)
- **Default theme rule:** The default theme is a monochromatic Emerald-Green-led
  system, with all tokens derived from Emerald Green variation families
  (shades, tints, tones, and close hue shifts) rather than independent,
  unrelated base colors.

| Token | Hex | Origin | Use |
|-------|-----|--------|-----|
| `--color-primary` | `var(--accent)` (`#00A277` by default) | Emerald variation | Primary interactive accents, play state, active highlights |
| `--color-primary-content` | `#08110E` | — | Text on primary backgrounds |
| `--color-secondary` | `color-mix(in srgb, var(--accent) 64%, #2E9878 36%)` | Emerald-led variation (default) | Secondary accents and supporting states |
| `--color-accent` | `color-mix(in srgb, var(--accent) 54%, #59C3A0 46%)` | Emerald-led variation (default) | Tertiary highlights and decorative accents |
| `--color-base-100` | `color-mix(in srgb, var(--accent) 14%, #0B0C0D 86%)` | Accent-derived dark base | Global page background |
| `--color-base-200` | `color-mix(in srgb, var(--accent) 18%, #121415 82%)` | Accent-derived dark base | Card and panel surfaces |
| `--color-base-300` | `color-mix(in srgb, var(--accent) 24%, #1B1F20 76%)` | Accent-derived dark base | Nested surfaces, borders, hover states |
| `--color-base-content` | `#E8F0EC` | — | Default text on dark backgrounds |

Design intent:

- Backgrounds use an Emerald-tinted deep-dark ramp (`base-100` → `base-200` →
  `base-300`) rather than neutral black.
- Primary and supporting accents stay in the Emerald family so one central
  color system drives the whole default theme.
- Default-shell chrome (archive header ribbon, sequencer canvas, context strip,
  transport strip, search controls, and popup/menu surfaces) uses Emerald-tinted
  dark values instead of neutral gray/blue ramps.

### Product Mode Theme Anchors

When Product Mode is set to one specific product (anything other than `All`),
the app re-anchors shell/base token derivation around that product's base color.
This affects primary accents plus derived shades/tints/tones used by panel
surfaces, borders, controls, and sequencer chrome.

| Product Mode | Base Color | Hex | Notes |
|--------------|------------|-----|-------|
| All (default) | Emerald Green | `#00674F` (anchor), `#00A277` (runtime accent) | `data-product-theme` removed |
| Rave eJay | Sapphire Blue | `#0F52BA` | — |
| Dance eJay 1 | Spanish Orange | `#E86100` | — |
| HipHop eJay 1 | Bronze | `#CE8946` | — |
| Dance eJay 2 | Red-Orange | `#FF4B33` | — |
| Techno eJay | Cobalt Blue | `#0047AB` | — |
| HipHop eJay 2 | Gold | `#EFBF04` | — |
| Dance eJay 3 | Salmon | `#FF7E70` | — |
| Dance eJay 4 | Dark Pink | `#C11C84` | — |
| HipHop eJay 3 | Wine | `#722F37` | — |
| Techno eJay 3 | Pastel Blue | `#B3EBF2` | Highlight override: `#F2BAB3` |
| Xtreme eJay | Slate Gray | `#708090` | — |
| HipHop eJay 4 | Ebony | `#506658` | — |
| House eJay | Beige | `#EDE8D0` | — |

Implementation notes:

- Product Mode sets `<html data-product-theme="...">`, and each product theme
  only overrides anchor vars (`--accent`, `--accent-rgb`,
  `--accent-darker`, and optional `--theme-highlight`).
- Shared shell/component vars in `:root` derive shades/tints/tones from those
  anchor vars, so the whole chrome retints when Product Mode changes.

## Category Color Palette

The browser uses a shared 14-slot palette for category-level color coding.
This mapping drives:

- Category sidebar buttons
- Sample bubbles in the sample grid
- Sequencer event blocks in the timeline

All 14 slots map directly to the provided palette.

| Slot | Color | Mapped Item | CSS Variable |
|------|-------|-------------|--------------|
| 1 | `#830000` | Loop | `--category-color-loop` |
| 2 | `#982A00` | Drum | `--category-color-drum` |
| 3 | `#AB4700` | Bass | `--category-color-bass` |
| 4 | `#BF6601` | Guitar | `--category-color-guitar` |
| 5 | `#D48915` | Keys | `--category-color-keys` |
| 6 | `#E6AD33` | Sequence | `--category-color-sequence` |
| 7 | `#BFAD00` | Voice | `--category-color-voice` |
| 8 | `#7DA500` | Effect | `--category-color-effect` |
| 9 | `#009C48` | Scratch | `--category-color-scratch` |
| 10 | `#008694` | Orchestral | `--category-color-orchestral` |
| 11 | `#005DAD` | Pads | `--category-color-pads` |
| 12 | `#3D3F96` | Extra | `--category-color-extra` |
| 13 | `#442E77` | Unsorted | `--category-color-unsorted` |
| 14 | `#422158` | Load JSON (non-category button) | `--category-color-system-load` |

Implementation note:

- Legacy `--channel-*` variables remain as aliases to `--category-color-*` so
  older hooks and tests keep working while visual output stays aligned.

## Typography

Two Google Fonts are loaded via `index.html`:

| Token | Family | Use |
|-------|--------|-----|
| `font-sans` / `--font-sans` | Josefin Sans | All UI text: body copy, labels, headings, transport bar |
| `font-mono` / `--font-mono` | Share Tech Mono | Utility token; reserved for tabular/technical contexts |

- All custom CSS in `app.css` uses `var(--font-sans)` exclusively.
  `var(--font-mono)` is not applied by any custom CSS rule.
- `font-mono` should **not** be applied to transport bar items (version label, build label,
  GitHub link) — these use the default sans stack.
- Page headings use `font-bold` or `font-semibold` at appropriate scale.

## Component Anatomy

### Archive Sidebar and Sequencer Shell

The top editor area is split into a left `Mix Archive` sidebar and a right
sequencer placeholder.

- The archive sidebar uses a near-black panel with a compact header and muted
  placeholder copy.
- The sequencer area uses a 32-beat ruler, a striped timeline background, and
  disabled transport buttons until real mix-loading UI is wired.
- Both panels share the same dense, metallic desktop feel as the browser area
  below.

### Context Strip

A narrow strip sits between the editor shell and the sample browser.

- The left side shows current mix status text.
- The right side groups subcategory tabs, sample search, zoom controls, and
  the BPM filter into a compact toolbar.
- Controls use condensed small-caps styling rather than large card-like UI.

### Category Sidebar

The left sidebar displays all top-level categories (Bass, Drum, Effect,
etc.) as a vertical two-column grid of buttons.

- Each category button uses its own color from the shared 14-slot palette.
- The `Load JSON` button uses slot 14 and is visually distinct from all
  category buttons.
- Active category state brightens and outlines the same base button color,
  rather than switching to an unrelated accent.
- The sidebar is fixed-height and scrolls independently when categories
  overflow.
- Selecting a category populates the subcategory tab bar and sample grid.

### Subcategory Tab Bar

A horizontal row of tabs sits above the sample grid, scoped to the
active category.

- Tabs inherit the currently active category color and use darker/lighter
  shades of that same hue family for idle vs active states.
- A `+` button at the trailing end allows adding or importing new
  subcategory groupings; it uses the same inherited category shading model.
- Active tab is visually distinguished (filled vs. outlined).
- Tabs scroll horizontally when they overflow.

### Sample Grid

The main content area displays samples as a sequencer-style grid of
rectangular blocks, closely matching the original eJay UI.

- Each row represents a channel/lane.
- Each block represents a sample; its width may reflect beat length.
- Blocks use the same category palette mapping as the category sidebar
  buttons, so each sample bubble inherits its category color consistently.
- Sample bubbles intentionally render without border outlines or drop shadows
  to preserve text legibility across saturated category colors.
- Bubble text is white and uses a 50% gray drop shadow.
- Clicking a block previews the sample.
- Empty grid cells use a subtle outline to maintain the grid rhythm.

### Sequencer Timeline Blocks

- Sequencer event blocks inherit the same category palette mapping used by
  both the sidebar buttons and sample bubbles.
- Missing/unresolved blocks keep the warning style and do not use category
  color.

### BPM Filter

A dropdown control for filtering samples by tempo.

- Positioned at the bottom-right of the home area and persists into the
  main app view, where it lives inside the context strip.
- Uses the default sans/small-caps styling from `app.css`, not `font-mono`.

### Search and Zoom Controls

The context strip also exposes lightweight browser controls for the sample
grid.

- Search is a compact inline input with an embedded clear button.
- Focus expands the search field width to give more room for filtering.
- Zoom uses paired magnifier buttons that adjust the CSS scale applied to
  sample bubbles.

### Transport / Playback Bar

Inspired by the original eJay metallic transport strip.

- Fixed to the bottom of the viewport (`position: fixed; bottom: 0`).
- Background: `#191a22` with a subtle top border.
- Three-column grid layout (`grid-template-columns: auto 1fr auto`):
  - **Left** (`.transport-left`): stop button, current sample name, playback progress bar.
  - **Center** (`.transport-center`): dynamic build label —
    `"eJay mix reader — full version"` in DEV builds;
    `"eJay mix reader demo — clone this repo for full functionality"` in production builds.
  - **Right** (`.transport-right`): version label (e.g. `v1.14`), GitHub repository link.
- Progress uses a custom thin `<progress>` element (`.transport-progress`).
- All text in the transport bar uses the default `font-sans` stack. Do not apply `font-mono` to any transport element.

### Volume Mixer

Inspired by the 16-channel mixer visible in the original eJay UI.

- Per-channel vertical sliders when applicable (future milestone).
- Uses DaisyUI `range` inputs styled vertically.
- Channel numbers labeled at bottom, matching the original 1-16 layout.

## Layout

- The app is a single-page application with a single HTML entry point.
- **Home page**: centered hero with folder picker, BPM filter control at
  bottom-right.
- **Main app view** (after loading a library): four persistent layers —
  - **Top editor area**: archive sidebar plus sequencer shell.
  - **Context strip**: mix status, subcategory tabs, search, zoom, BPM.
  - **Bottom browser area**: category sidebar plus sample-block grid.
  - **Transport bar**: fixed footer for sample playback.
- Transport bar remains fixed at the viewport bottom.
- The sample grid scrolls independently. The archive sidebar and category
  sidebar keep their own bounded regions within the shell.

## Responsive Behavior

- On desktop: the archive sidebar and category sidebar stay visible beside
  their corresponding panels.
- On narrower layouts (<= 1100px): both sidebars shrink but remain visible.
- On mobile (<= 720px): the archive sidebar is hidden, the context strip stacks
  into a single column, the browser area becomes a single-column layout, and
  the category grid expands to three columns above the sample grid.
- Transport bar adapts: full layout on desktop, condensed on mobile with
  essential controls only.
- Subcategory tabs still scroll horizontally when they overflow on any
  viewport, and sample lanes reduce from 24 to 12 grid columns on mobile.

## Editing Guidance

- When changing markup, prefer adding DaisyUI classes in the renderer rather
  than re-implementing component visuals in custom CSS.
- When a visual rule is needed across multiple components, add it to
  [src/app.css](../src/app.css) instead of duplicating utility strings.
- If you remove or rename any stable hook classes mentioned in this guide,
  update the Playwright tests in the same change.
- The live source of truth is the code. If this guide drifts, update the guide.
