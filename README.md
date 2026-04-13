# eJay Mix Reader

A tool for extracting and browsing audio samples from **eJay** music software titles released in the late 1990s and early 2000s.

## What it does

eJay products ship hundreds of audio samples in a proprietary compressed format (`.PXD`) and packed archive bundles. This project reverse-engineers those formats and provides:

- **`tools/pxd_parser.py`** — Decodes PXD-compressed samples and packed archives to standard WAV files, and generates a JSON metadata catalog for each product.

A minimal web-based sound browser is planned as a second milestone.

## Supported products

| Product | Genre |
|---------|-------|
| Dance eJay 1 / 2 / 3 / 4 | Dance |
| Dance SuperPack | Dance |
| Generation Pack 1 | Multi |
| HipHop eJay 2 / 3 / 4 | Hip-Hop |
| House eJay | House |
| Rave eJay | Rave |
| Techno eJay / Techno eJay 3 | Techno |
| Xtreme eJay | Xtreme |

## Requirements

- Python 3.10 or newer (standard library only — no external dependencies)
- Your own legally-owned copies of the eJay products you wish to extract

> **Important**: This tool does not include, distribute, or provide access to any eJay software or audio content. You must own the original product(s) to use this tool. Extracting samples from software you do not own may violate copyright law in your jurisdiction.

## Usage

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

## License

MIT — see [LICENSE](LICENSE).  
The eJay name and all associated audio content are the property of their respective copyright holders.
