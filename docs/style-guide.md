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
| `--color-accent` | `#7c3aed` | — | Tertiary violet, decorative glow, alt-highlights |
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
| Xtra / Hyper | `#b8d8b0` | `--channel-xtra` | Light green blocks |
| Wave / Groove | `#b8d8b0` | `--channel-wave` | Light green blocks |

These are drawn directly from the four sample-block color families visible in
the original eJay interface: tan/orange (rhythmic), pink/salmon (tonal/vocal),
light blue (melodic/harmonic), and light green (atmospheric/textural).

## Typography

Use system font stacks via Tailwind defaults. No custom web fonts are loaded.

| Utility | Use |
|---------|-----|
| `font-sans` | Body copy, card text, labels |
| `font-mono` | Sample metadata, beat counts, durations, technical details |

- Sample names use the default sans stack at normal weight.
- Metadata values (BPM, beats, category) use `font-mono` for tabular alignment.
- Page headings use `font-bold` or `font-semibold` at appropriate scale.

## Component Anatomy

### Product Card

Each of the 14 products is displayed as a DaisyUI `card` on the home/browse view.

- Card surface uses `bg-base-200` with a subtle border or shadow.
- Product name is the card title.
- Genre and sample count appear as DaisyUI `badge` elements.
- Channel list is shown as small colored pills using the channel color palette.

### Sample Row / Tile

Individual samples are displayed in a list or grid within a product view.

- Each sample shows: display name, channel badge (colored), beat count, and a
  play button.
- The play button uses DaisyUI `btn btn-circle btn-sm` with a play/pause icon.
- Active/playing state highlights the row with `primary` accent.
- Channel badge color comes from the channel color palette above.

### Transport / Playback Bar

Inspired by the original eJay metallic transport strip (visible in both screenshots
as the centered play/stop/record bar).

- Fixed to the bottom of the viewport.
- Uses `bg-base-300` with a subtle top border.
- Contains: current sample name, play/pause, stop, progress indicator.
- Progress uses a custom thin bar or DaisyUI `progress` component.

### Sample Browser Panel

Mirrors the bottom panel of the original eJay UI where category buttons filter
the visible sample tiles.

- Channel filter buttons use DaisyUI `btn` with channel-specific accent colors.
- Active filter state uses `btn-active` or a filled variant.
- Sample tiles inside the panel show the display alias and are clickable.

### Volume Mixer

Inspired by the 16-channel mixer visible in screenshot 2.

- Per-channel vertical sliders when applicable (future milestone).
- Uses DaisyUI `range` inputs styled vertically.
- Channel numbers labeled at bottom, matching the original 1-16 layout.

## Layout

- The app is a single-page application with a single HTML entry point.
- Top-level layout: header (product selector / search), main content area
  (sample list/grid), and fixed bottom transport bar.
- Main content scrolls independently; header and transport bar remain fixed.
- On desktop (≥1024px): sidebar for channel filters + main sample grid.
- On tablet/mobile (<1024px): channel filters collapse to horizontal scroll
  pills above the sample list; transport bar remains fixed at bottom.

## Responsive Behavior

- Product grid collapses from multi-column to single-column naturally via CSS
  grid and card sizing.
- Sample list switches from a dense grid to a vertical stack on narrow screens.
- Transport bar adapts: full layout on desktop, condensed on mobile with
  essential controls only.
- Channel filter buttons wrap or scroll horizontally on small viewports.

## Editing Guidance

- When changing markup, prefer adding DaisyUI classes in the renderer rather
  than re-implementing component visuals in custom CSS.
- When a visual rule is needed across multiple components, add it to
  [src/app.css](../src/app.css) instead of duplicating utility strings.
- If you remove or rename any stable hook classes mentioned in this guide,
  update the Playwright tests in the same change.
- The live source of truth is the code. If this guide drifts, update the guide.
