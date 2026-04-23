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

| Token | Hex | Origin | Use |
|-------|-----|--------|-----|
| `--color-primary` | `#00ff88` | — | Primary green accents, play state, active highlights |
| `--color-primary-content` | `#031b10` | — | Text on primary backgrounds |
| `--color-secondary` | `#ff3366` | — | Secondary pink/red accents, stop state, warnings |
| `--color-accent` | `#6f63ff` | — | Tertiary violet, decorative glow, alt-highlights |
| `--color-base-100` | `#0f0f1a` | eJay deep navy | Global page background |
| `--color-base-200` | `#1a1a2e` | eJay panel navy | Card and panel surfaces |
| `--color-base-300` | `#25253e` | eJay lighter navy | Nested surfaces, borders, hover states |
| `--color-base-content` | `#e0e0e8` | — | Default text on dark backgrounds |

Design intent:

- Backgrounds use the deep navy ramp (`base-100` → `base-200` → `base-300`)
  that echoes the original eJay navy-blue desktop.
- Primary green is a luminous electronic accent, not pastel or muted.
- Secondary pink/red provides contrast for destructive actions and
  attention-drawing UI without clashing with the green primary.

## Channel Color Palette

The original eJay UI assigns distinct colors to sample categories. The Sound
Browser preserves this by mapping channel names to accent hues for sample cards,
badges, and waveform tints.

| Channel | Reference Color | CSS Variable | Original eJay Mapping |
|---------|-----------------|--------------|----------------------|
| Loop | `#d4a574` | `--channel-loop` | Warm tan/orange blocks |
| Drum | `#d4a574` | `--channel-drum` | Warm tan/orange blocks |
| Bass | `#d4a574` | `--channel-bass` | Warm tan/orange blocks |
| Effect | `#e8a0a0` | `--channel-effect` | Pink/salmon blocks |
| Voice | `#e8a0a0` | `--channel-voice` | Pink/salmon blocks |
| Keys / Seq | `#a0c8e8` | `--channel-keys` | Light blue blocks |
| Guitar | `#a0c8e8` | `--channel-guitar` | Light blue blocks |
| Scratch | `#e8a0a0` | `--channel-scratch` | Pink/salmon blocks |
| Sphere | `#59d7ea` | `--channel-sphere` | Bright cyan pad/sphere blocks |
| Xtra / Hyper | `#b8d8b0` | `--channel-xtra` | Light green blocks |
| Wave / Groove | `#b8d8b0` | `--channel-wave` | Light green blocks |

These are drawn directly from the four sample-block color families visible in
the original eJay interface: tan/orange (rhythmic), pink/salmon (tonal/vocal),
light blue (melodic/harmonic), and light green (atmospheric/textural).

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

- Buttons use a dark navy fill (`bg-base-200` or deeper) with white text.
- Active category uses a brighter fill or border accent from the channel
  color palette.
- The sidebar is fixed-height and scrolls independently when categories
  overflow.
- Selecting a category populates the subcategory tab bar and sample grid.

### Subcategory Tab Bar

A horizontal row of tabs sits above the sample grid, scoped to the
active category.

- Tabs use a teal/primary accent background with contrasting text.
- A `+` button at the trailing end allows adding or importing new
  subcategory groupings.
- Active tab is visually distinguished (filled vs. outlined).
- Tabs scroll horizontally when they overflow.

### Sample Grid

The main content area displays samples as a sequencer-style grid of
rectangular blocks, closely matching the original eJay UI.

- Each row represents a channel/lane.
- Each block represents a sample; its width may reflect beat length.
- Blocks use a light accent fill (channel-color tinted) on a dark grid
  background.
- Clicking a block previews the sample; active/playing block shows a
  `primary` highlight or glow.
- Empty grid cells use a subtle outline to maintain the grid rhythm.

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
