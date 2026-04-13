# eJay Mix Reader

A tool for extracting and browsing audio samples from **eJay** music software titles
released in the late 1990s and early 2000s.

## What it does

eJay products ship hundreds of audio samples in a proprietary compressed format (`.PXD`)
and packed archive bundles. This project reverse-engineers those formats and provides:

- **`tools/pxd_parser.py`** — Decodes PXD-compressed samples and packed archives to
  standard WAV files, and generates a JSON metadata catalog for each product.
- **Sound Browser** — A Vite-powered web app with DaisyUI that lets you search, filter,
  and play extracted samples in the browser.

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
extraction, `tools/reorganize.py` sorts WAV files into channel folders using
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
| Techno eJay 3 | Bass, Drum, Effect, Guitar, Keys, Loop, Voice, Wave, Xtra |
| Xtreme eJay | Bass, Effect, Guitar, Loop, Seq, Voice, Xtra |

## Requirements

- Python 3.10 or newer (standard library only — for extraction tools)
- Node.js 20 or newer (for the web-based sound browser)
- Your own legally-owned copies of the eJay products you wish to extract

> **Important**: This tool does not include, distribute, or provide access to any eJay
> software or audio content. You must own the original product(s) to use this tool.
> Extracting samples from software you do not own may violate copyright law in your
> jurisdiction.

## Usage

### Extraction (Python)

```bash
# Extract individual PXD files from a directory tree
python tools/pxd_parser.py archive/Dance_eJay1/dance --output output/Dance_eJay1

# Extract from a packed archive (INF catalog auto-detected)
python tools/pxd_parser.py archive/Dance_eJay3/eJay/pxd/dance30 --output output/Dance_eJay3

# Extract a single PXD file
python tools/pxd_parser.py path/to/sample.pxd --output output/test

# Organize output into named subfolders using metadata
python tools/pxd_parser.py archive/Dance_eJay1/dance --output output/Dance_eJay1 \
    --format "{category}/{alias}"
```

Output: a folder of `.wav` files and a `metadata.json` catalog.

### Sound Browser (Node.js)

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
