# eJay Mix Reader

A tool for extracting, browsing, and inspecting audio samples and archived
`.mix` project files from **eJay** music software titles released in the late
1990s and early 2000s.

## What it does

eJay products ship hundreds of audio samples in a proprietary compressed format (`.PXD`)
and packed archive bundles. This project reverse-engineers those formats and provides:

- **`scripts/pxd-parser.ts`** — Decodes PXD-compressed samples and packed archives to
  standard WAV files, and generates a JSON metadata catalog for each product.
- **Sound Browser** — A Vite-powered web app with DaisyUI that lets you browse
  extracted samples as beat-scaled blocks, filter by BPM, search across names
  and metadata, zoom sample bubbles, and preview audio in the browser.
- **Category Config** — The browser reads `output/categories.json` when present
  to define subcategory tabs. In the dev-server library flow, user-created
  subcategories can be written back to that file.
- **MIX Runtime Foundation** — `data/index.json` inventories archived `.mix`
  files, the Vite dev server exposes allow-listed `/mix/<product>/<filename>`
  URLs, and browser-side parser/player modules live under `src/`. The current
  UI shell still shows archive and sequencer placeholders rather than a full
  mix browser/editor.

## Current Browser UI

- The home page shows a centered hero, a `Choose output folder` picker, an
  optional development-library shortcut in dev builds, and a BPM filter.
- After loading a library, the app renders three stacked work areas:
  a top editor shell (`Mix Archive` placeholder plus sequencer placeholder), a
  middle context strip (mix status, subcategory tabs, search, zoom, BPM), and a
  bottom browser area (category sidebar plus sample-block grid).
- Samples render as lane-based blocks rather than a table. Block width reflects
  beat length; block metadata can include product, BPM, beat count, and detail.
- Sample search is term-based: whitespace-separated terms are matched against
  the display name and the metadata line.
- Sample blocks are ordered by descending beat length and then by display name.
- Picked folders are read-only. Subcategory editing is only available in the
  dev-server library flow where `output/categories.json` can be saved.
- The `Load JSON` sidebar action is currently a placeholder; external JSON
  library loading is not wired yet.

## Supported products

| Product | Genre |
| --- | --- |
| Dance eJay 1 / 2 / 3 / 4 | Dance |
| Dance SuperPack | Dance |
| Generation Pack 1 | Multi |
| HipHop eJay 2 / 3 / 4 | Hip-Hop |
| House eJay | House |
| Rave eJay | Rave |
| Techno eJay / Techno eJay 3 | Techno |
| Xtreme eJay | Xtreme |

## Channel Mapping (per product)

Each product's UI arranges samples into named "sound group" tabs (channels). After
extraction, `scripts/reorganize.ts` sorts WAV files into channel folders using
internal-name sub-codes.

| Product | Channels |
|---------|----------|
| Dance eJay 1 | Bass, Drum, Effect, Keys, Loop, Voice, Xtra |
| Dance eJay 2 | Bass, Drum, Effect, Guitar, Keys, Loop, Voice, Xtra |
| Dance eJay 3 | Bass, Drum, Effect, Guitar, Keys, Loop, Voice, Xtra |
| Dance eJay 4 | Bass, Drum, Effect, Guitar, Keys, Loop, Voice, Xtra, Groove, Wave |
| Dance SuperPack | Bass, Drum, Effect, Keys, Loop, Voice, Xtra |
| Generation Pack 1 | (Dance/Rave: same as Dance 1) |
| HipHop eJay 2 | Bass, Drum, Effect, Guitar, Keys, Loop, Scratch, Voice, Xtra |
| HipHop eJay 3 | Bass, Drum, Effect, Guitar, Keys, Loop, Scratch, Voice, Xtra |
| HipHop eJay 4 | Bass, Drum, Effect, Fellas, Guitar, Keys, Ladies, Loop, Scratch, Xtra |
| House eJay | Bass, Drum, Effect, Groove, Guitar, Keys, Loop, Voice, Xtra |
| Rave eJay | Bass, Drum, Effect, Keys, Loop, Voice, Xtra |
| Techno eJay | Bass, Drum, Effect, Guitar, Keys, Loop, Voice, Xtra |
| Techno eJay 3 | Bass, Drum, Effect, Hyper, Keys, Loop, Sphere, Voice, Wave, Xtra |
| Xtreme eJay | Bass, Effect, Guitar, Loop, Seq, Voice, Xtra |

## How to Run

**Clone and run locally** — this is the only supported way to use the browser UI.

The app needs to serve your extracted WAV files and archived `.mix` files
alongside the web assets.
Running it from a hosted static page (e.g. GitHub Pages) is not possible because
there is no way to expose local sample-library or archive folders to a remote
static server.

```bash
git clone https://github.com/satyrlord/ejay-mix-reader.git
cd ejay-mix-reader
npm install
npm run serve   # opens http://127.0.0.1:3000
```

Then click **Choose output folder** and point the picker at your `output/`
directory. The browser reads `output/metadata.json` and optional
`output/categories.json` when present, and otherwise falls back to scanning the
category folders for WAV files.

## Requirements

- Node.js 20 or newer
- Your own legally-owned copies of the eJay products you wish to extract

> **Important**: This tool does not include, distribute, or provide access to any eJay
> software or audio content. You must own the original product(s) to use this tool.
> Extracting samples from software you do not own may violate copyright law in your
> jurisdiction.

## Usage

### Extraction

```bash
# Extract individual PXD files from a directory tree
tsx scripts/pxd-parser.ts archive/Dance_eJay1/dance --output output/Dance_eJay1

# Extract from a packed archive (INF catalog auto-detected)
tsx scripts/pxd-parser.ts archive/Dance_eJay3/eJay/pxd/dance30 --output output/Dance_eJay3

# Extract a single PXD file
tsx scripts/pxd-parser.ts path/to/sample.pxd --output output/test

# Organize output into named subfolders using metadata
tsx scripts/pxd-parser.ts archive/Dance_eJay1/dance --output output/Dance_eJay1 \
    --format "{category}/{alias}"
```

Output: a folder of `.wav` files and a `metadata.json` catalog.

### Sound Browser

```bash
# Install dependencies
npm install

# Start the dev server
npm run serve

# Run Playwright tests
npm test

# Run Vitest unit tests
npm run test:unit

# Run tests with browser coverage
npm run test:coverage

# Run unit tests with coverage
npm run test:unit:coverage

# Type-check
npm run typecheck

# Lint Markdown
npm run lint:md

# Run the combined validation step
npm run validate

# Build for production (also regenerates data/index.json)
npm run build
```

## License

MIT — see [LICENSE](LICENSE).
The eJay name and all associated audio content are the property of their
respective copyright holders.
