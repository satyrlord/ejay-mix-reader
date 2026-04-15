# eJay Mix Reader

A tool for extracting and browsing audio samples from **eJay** music software titles
released in the late 1990s and early 2000s.

## What it does

eJay products ship hundreds of audio samples in a proprietary compressed format (`.PXD`)
and packed archive bundles. This project reverse-engineers those formats and provides:

- **`tools/pxd-parser.ts`** — Decodes PXD-compressed samples and packed archives to
  standard WAV files, and generates a JSON metadata catalog for each product.
- **Sound Browser** — A Vite-powered web app with DaisyUI that lets you search, filter,
  sort, and play extracted samples in the browser.

## Sound Browser Notes

- Product pages use the selected product name as the top-bar title instead of a
  fixed app title.
- The sample table uses five columns: play control, `Name`, `Category`,
  `Beats`, and `Duration`.
- The `Name` cell merges the sample category and display name as
  `<Category> - <Name>` when a category is present.
- `Name` and `Category` sort alphabetically; `Beats` and `Duration` sort
  numerically with ascending/descending toggles.
- The browser UI uses the term `Category` for sample-group classification.
  This avoids confusion with audio channel count, where `channels` still means
  mono/stereo metadata.

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
extraction, `tools/reorganize.ts` sorts WAV files into channel folders using
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

**Clone and run locally** — this is the only supported way to use the Sound Browser.

The app needs to serve your extracted WAV files alongside the web assets.
Running it from a hosted static page (e.g. GitHub Pages) is not possible because
there is no way to expose a local sample library folder to a remote static server.

```bash
git clone https://github.com/satyrlord/ejay-mix-reader.git
cd ejay-mix-reader
npm install
npm run serve   # opens http://127.0.0.1:3000
```

Then click **Choose output folder** and point the picker at your `output/` directory.

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
tsx tools/pxd-parser.ts archive/Dance_eJay1/dance --output output/Dance_eJay1

# Extract from a packed archive (INF catalog auto-detected)
tsx tools/pxd-parser.ts archive/Dance_eJay3/eJay/pxd/dance30 --output output/Dance_eJay3

# Extract a single PXD file
tsx tools/pxd-parser.ts path/to/sample.pxd --output output/test

# Organize output into named subfolders using metadata
tsx tools/pxd-parser.ts archive/Dance_eJay1/dance --output output/Dance_eJay1 \
    --format "{category}/{alias}"
```

Output: a folder of `.wav` files and a `metadata.json` catalog.

### Sound Browser

```bash
# Install dependencies
npm install

# Start the dev server
npm run serve

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type-check
npm run typecheck

# Build for production
npm run build
```

## License

MIT — see [LICENSE](LICENSE).
The eJay name and all associated audio content are the property of their
respective copyright holders.
