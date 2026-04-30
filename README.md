# eJay Mix Reader

A tool to extract and browse audio samples from eJay music software
(late 1990s and early 2000s).

## What it does

- Converts audio samples from eJay product CDs to standard WAV files.
- Lets you search, filter by BPM, and click to preview samples in a web app.
- Shows the `.mix` project files from the original eJay software with
  metadata and tooltips.
- Organises samples into categories such as Bass, Drum, Loop, and Voice.

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

For the channel lists for each product, see
[docs/file-formats.md — Channel Mapping](docs/file-formats.md#channel-mapping-per-product).

## How to Run

This app must run locally. It cannot run as a hosted web page because it
needs to read files from your computer.

### Step 1 — Clone and install

```bash
git clone https://github.com/satyrlord/ejay-mix-reader.git
cd ejay-mix-reader
npm install
```

### Step 2 — Copy your eJay files into `archive/`

For each product you own, copy the **entire install folder from the CD**
into the matching sub-folder under `archive/`. The folder names must be
spelled exactly as shown.

See [docs/rebuild-output.md — Product Source Map](docs/rebuild-output.md#product-source-map)
for the exact folder name and the sub-folders the tool needs for each product.

### Step 3 — Build the sample library

```bash
npm run setup   # detects your products, extracts everything, builds the index
```

The setup script finds every product in `archive/`, converts the audio
files, and builds `output/` automatically. Products you have not copied
are skipped. Run it again after adding more products.

> **Tip** — Already extracted a product in a previous run? The script
> skips it automatically. Use `npm run setup -- --force` to re-extract.

### Step 4 — Start the app

```bash
npm run serve   # opens http://127.0.0.1:3000
```

Click **Choose output folder** and point it at the `output/` folder.
The app loads your samples, and the Mix Archive panel lists any `.mix`
project files found in the products you copied.

## Requirements

- Node.js 20 or newer.
- Your own legally-owned copies of the eJay products you want to use.

> **Important**: This tool does not include any eJay software or audio
> content. You must own the original products. Extracting samples from
> software you do not own may break copyright law in your country.

## Common commands

```bash
npm run serve              # start the browser app
npm run setup              # (re)build output/ after adding products
npm run setup -- --force   # re-extract even products already done
npm run build              # regenerate data/index.json only
npm run mix:meta           # rescan archive/ for .mix file metadata
npm run mix:dump-cd -- --product Dance_eJay3  # dump Format C/D track records for one product
npm test                   # run Playwright tests
npm run test:unit          # run unit tests
npm run typecheck          # check TypeScript types
```

`npm run mix:dump-cd` is a reverse-engineering helper for Format C/D record
analysis only. It writes diagnostics to `logs/format-cd/` and is not part of
the normal extraction/index build pipeline.

## More information

| Document | What it covers |
| --- | --- |
| [docs/rebuild-output.md](docs/rebuild-output.md) | Full manual pipeline, all script flags, deduplication, recovery |
| [docs/file-formats.md](docs/file-formats.md) | PXD/INF format specs, channel mapping per product |
| [docs/mix-format-analysis.md](docs/mix-format-analysis.md) | `.mix` file format families and parser notes |
| [docs/architecture-notes.md](docs/architecture-notes.md) | Source layout, browser UI details, build flow |

## License

MIT — see [LICENSE](LICENSE).
The eJay name and all associated audio content are the property of their
respective copyright holders.
