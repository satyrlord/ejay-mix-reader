# Rebuilding the `output/` Folder From Scratch

This guide walks through every step required to regenerate a complete,
fully-featured `output/` folder — the consolidated browser library that
powers the Sound Browser — from a populated `archive/` tree containing
one or more eJay product installs.

## Automated setup (recommended)

Run `npm run setup` after copying your product files into `archive/`. It
detects every product that is present, runs all the steps below
automatically, and prints a progress line for each one:

```bash
npm run setup        # detect, extract, enrich, normalise, rename, build
npm run setup --dry-run   # preview what would run without writing files
npm run setup --force     # re-extract products that were already extracted
```

When the script finishes, run `npm run serve` and click **Choose output
folder** → point it at `output/`.

Use the manual steps below when you need finer control: to run a single
step in isolation, add a product to an existing library, or debug a
specific stage.

Use this doc when:

- The `output/` folder was deleted, partially corrupted, or you want to
  verify that the pipeline still produces an identical library.
- You added a new product to `archive/` and want to extend the existing
  browser library with its samples.
- You want to understand what every script does and in what order.

> **Read-only inputs** — `archive/` is treated as immutable input. The
> pipeline never modifies files under `archive/`. Everything is written
> under `output/` and `data/`.

## Prerequisites

- Node.js 20 or newer
- A clone of this repository with `npm install` already run
- One or more eJay product installs copied into `archive/` using the
  canonical folder names from the [product source map](#product-source-map)

If you only own one or two products, follow the
[Quick start (1–2 products)](../README.md#quick-start--build-the-browser-library-from-12-products)
section in the README first. This document covers the full 14-product flow.

## Pipeline Overview

```text
archive/<Product>/                       (read-only inputs you provide)
        │
        │ 1. pxd-parser.ts            (per product)
        ▼
output/<Product>/                        (raw extraction: WAVs + metadata.json)
        │
        │ 2. reorganize.ts            (per product)
        ▼
output/<Product>/<Channel>/*.wav         (sorted into channel folders)
        │
        │ 3. enrich-metadata.ts       (all products)
        ▼
output/<Product>/metadata.json           (BPM, beats, category backfilled)
        │
        │ 4. normalize.ts             (all products → flat taxonomy)
        ▼
output/_normalized/<Category>[/<Sub>]/   (consolidated library + metadata.json)
        │
        │ 5. promote _normalized → output  (move files, drop staging dir)
        ▼
output/<Category>[/<Subcategory>]/*.wav  ← browser-facing layout
output/metadata.json                     ← consolidated catalog
output/categories.json                   ← subcategory tab config
        │
        │ 6. rename-samples.ts --apply (filename normalisation)
        │ 7. find-duplicates.ts        (optional cleanup)
        │ 8. mix:extract-embedded      (optional: recover audio from oversized .mix)
        │ 9. samples:recover           (optional: pull in missing referenced samples)
        ▼
        │ 10. npm run mix:meta         (regenerate data/mix-metadata.json)
        │ 11. npm run build            (regenerate data/index.json)
        ▼
data/index.json + data/mix-metadata.json (browser bootstrap data)
```

## 1. Extract every product (`pxd-parser.ts`)

Run the extractor once per product, sending output to a per-product
staging folder under `output/`. Each command writes a folder of `.wav`
files plus a top-level `output/<Product>/metadata.json` catalog.

| Product | Source path | Command |
| --- | --- | --- |
| Dance_eJay1 | `archive/Dance_eJay1/dance` | `npx tsx scripts/pxd-parser.ts archive/Dance_eJay1/dance --output output/Dance_eJay1` |
| Dance_eJay2 | `archive/Dance_eJay2/D_ejay2/PXD/DANCE20` | `npx tsx scripts/pxd-parser.ts archive/Dance_eJay2/D_ejay2/PXD/DANCE20 --output output/Dance_eJay2` |
| Dance_eJay3 | `archive/Dance_eJay3/eJay/pxd/dance30` | `npx tsx scripts/pxd-parser.ts archive/Dance_eJay3/eJay/pxd/dance30 --output output/Dance_eJay3` |
| Dance_eJay4 | `archive/Dance_eJay4/ejay/PXD/DANCE40` | `npx tsx scripts/pxd-parser.ts archive/Dance_eJay4/ejay/PXD/DANCE40 --output output/Dance_eJay4` |
| Dance_SuperPack | `archive/Dance_SuperPack/dance` | `npx tsx scripts/pxd-parser.ts archive/Dance_SuperPack/dance --output output/Dance_SuperPack` |
| GenerationPack1_Dance | `archive/GenerationPack1/Dance/dance` | `npx tsx scripts/pxd-parser.ts archive/GenerationPack1/Dance/dance --output output/GenerationPack1_Dance` |
| GenerationPack1_Rave | `archive/GenerationPack1/Rave/RAVE` | `npx tsx scripts/pxd-parser.ts archive/GenerationPack1/Rave/RAVE --output output/GenerationPack1_Rave` |
| GenerationPack1_HipHop | `archive/GenerationPack1/HipHop/HIPHOP` | `npx tsx scripts/pxd-parser.ts archive/GenerationPack1/HipHop/HIPHOP --output output/GenerationPack1_HipHop` |
| HipHop_eJay2 | `archive/HipHop 2/eJay/pxd/HipHop20` | `npx tsx scripts/pxd-parser.ts "archive/HipHop 2/eJay/pxd/HipHop20" --output output/HipHop_eJay2` |
| HipHop_eJay3 | `archive/HipHop 3/eJay/pxd/hiphop30` | `npx tsx scripts/pxd-parser.ts "archive/HipHop 3/eJay/pxd/hiphop30" --output output/HipHop_eJay3` |
| HipHop_eJay4 | `archive/HipHop 4/eJay/pxd/HipHop40` | `npx tsx scripts/pxd-parser.ts "archive/HipHop 4/eJay/pxd/HipHop40" --output output/HipHop_eJay4` |
| House_eJay | `archive/House_eJay/ejay/PXD/House10` | `npx tsx scripts/pxd-parser.ts archive/House_eJay/ejay/PXD/House10 --output output/House_eJay` |
| Rave | `archive/Rave/RAVE` | `npx tsx scripts/pxd-parser.ts archive/Rave/RAVE --output output/Rave` |
| Techno_eJay | `archive/TECHNO_EJAY/EJAY/PXD/RAVE20` | `npx tsx scripts/pxd-parser.ts archive/TECHNO_EJAY/EJAY/PXD/RAVE20 --output output/Techno_eJay` |
| Techno_eJay3 | `archive/Techno 3/eJay/pxd/rave30` | `npx tsx scripts/pxd-parser.ts "archive/Techno 3/eJay/pxd/rave30" --output output/Techno_eJay3` |
| Xtreme_eJay | `archive/Xtreme_eJay/eJay/PXD/xejay10` | `npx tsx scripts/pxd-parser.ts archive/Xtreme_eJay/eJay/PXD/xejay10 --output output/Xtreme_eJay` |

Notes:

- Gen 2 and Gen 3 source paths point at the *base name* of a packed
  archive (e.g. `dance30`). The parser auto-detects the `.inf` companion
  next to it.
- Gen 1 source paths point at a directory containing two-letter bank
  folders (`AA/`, `AB/`, …). The parser walks the tree recursively.
- Wrap any path with a space (the `HipHop 2/3/4`, `Techno 3` and
  `_userdata` trees) in quotes.
- `Dance_SuperPack` ships several optional sample-kit folders
  (`eJay SampleKit/DMKIT1`, `…/DMKIT2`, `…/SpaceSounds`) under
  `archive/Dance_SuperPack/`. They are picked up by the same extraction
  pass when present.

## 2. Reorganise into channel folders (`reorganize.ts`)

The raw extraction puts every WAV in the product root. `reorganize.ts`
reads the per-product `metadata.json` and moves WAVs into channel
sub-folders matching the original eJay UI tabs (Bass, Drum, Loop,
Voice, …).

```bash
# Run once per product extracted in step 1
npx tsx scripts/reorganize.ts output/<Product>
```

Add `--dry-run` first if you want to preview the moves.

## 3. Enrich metadata (`enrich-metadata.ts`)

Backfill missing BPM, category, and beat counts using the per-product
defaults and Pxddance/INF catalogs that ship with the source media.

```bash
# Process every product under output/ that has a metadata.json
npx tsx scripts/enrich-metadata.ts

# Or limit to a single product
npx tsx scripts/enrich-metadata.ts output/Rave
```

After this step each `output/<Product>/metadata.json` has consistent
`bpm`, `beats`, `category`, and `channel` fields.

## 4. Normalise into the consolidated library (`normalize.ts`)

Flatten every per-product tree into the canonical taxonomy
(`Loop`, `Drum`, `Bass`, `Guitar`, `Keys`, `Sequence`, `Voice`,
`Effect`, `Scratch`, `Orchestral`, `Pads`, `Extra`, `Unsorted`) and
write a single consolidated `metadata.json` plus a seed
`categories.json`.

```bash
# Default: read every product under output/, write output/_normalized
npx tsx scripts/normalize.ts

# Move files instead of copying (saves disk space; destroys per-product trees)
npx tsx scripts/normalize.ts --move
```

This produces:

- `output/_normalized/<Category>[/<Subcategory>]/*.wav`
- `output/_normalized/metadata.json` — consolidated catalog
- `output/_normalized/categories.json` — default subcategory tab config

## 5. Promote `_normalized/` to the browser-facing root

The browser reads `output/metadata.json`, `output/categories.json`, and
`output/<Category>/...` directly — not the `_normalized` staging dir.

After verifying the normalised tree, replace the contents of `output/`
with the staged result. PowerShell:

```powershell
# WARNING: this removes any leftover per-product folders and previous
# browser library files. Make a backup first if you are unsure.
Remove-Item output/Dance_eJay1, output/Dance_eJay2, output/Dance_eJay3, `
            output/Dance_eJay4, output/Dance_SuperPack, `
            output/GenerationPack1_Dance, output/GenerationPack1_Rave, `
            output/GenerationPack1_HipHop, `
            output/HipHop_eJay2, output/HipHop_eJay3, output/HipHop_eJay4, `
            output/House_eJay, output/Rave, `
            output/Techno_eJay, output/Techno_eJay3, output/Xtreme_eJay `
            -Recurse -Force -ErrorAction SilentlyContinue

Move-Item output/_normalized/* output/ -Force
Remove-Item output/_normalized -Recurse -Force
```

After this step `output/` contains only:

- One folder per canonical category (with optional subcategory folders)
- `metadata.json` — consolidated catalog
- `categories.json` — subcategory tab config

## 6. Normalise filenames (`rename-samples.ts`)

Lowercase filenames, collapse stray characters, and renumber duplicate
basenames (`kick.wav`, `kick-2.wav`, …) consistently.

```bash
# Preview the changes first
npx tsx scripts/rename-samples.ts

# Apply them
npx tsx scripts/rename-samples.ts --apply
```

This rewrites both the `.wav` filenames on disk and the `filename`
field of every entry in `output/metadata.json`. All other metadata
fields are preserved.

## 7. Deduplicate (optional but recommended)

Detect WAV files whose PCM payload is byte-identical (regardless of
filename or product) and remove redundant copies.

```bash
# Cross-product duplicates (same PCM in two different products)
npx tsx scripts/find-duplicates.ts --output-dir output --cross-product

# Same-product duplicates (same PCM under two different filenames)
npx tsx scripts/find-duplicates.ts --output-dir output --same-product
```

Both runs write a CSV report under `logs/` for review. The
[`deduplicate` skill](../.github/skills/deduplicate/SKILL.md) describes
the recommended retention rules.

## 8. Recover embedded MIX audio (optional)

Some `_userdata` `.mix` files embed raw WAV payloads of user-recorded
content. Extract them so they appear in the browser as
`Unsorted/embedded mix` entries.

```bash
npm run mix:extract-embedded
```

This writes recovered WAVs to `output/Unsorted/embedded mix/` and a
provenance manifest to
`output/Unsorted/embedded-mix-audio-manifest.json`.

## 9. Recover missing referenced samples (optional)

If you have an external sample library (eJay Sound Collection, MAGIX
SoundPool, etc.), pull in any samples that the archived `.mix` files
reference but that are not in `output/`.

```bash
# 1) Generate the missing-sample report
npm run samples:missing

# 2) Search output/ + the default external roots and copy matches in
npm run samples:recover
```

The default external roots are `F:\_samples\eJay` and
`F:\_samples\Magix`. Override them with
`--external "<path1>,<path2>"`.

## 10. Regenerate browser bootstrap data

```bash
# Refresh data/mix-metadata.json from every .mix under archive/
npm run mix:meta

# Refresh data/index.json (and produce a production dist/)
npm run build
```

`npm run build` reads:

- `output/metadata.json`
- `output/categories.json`
- `output/Unsorted/embedded-mix-audio-manifest.json` (when present)
- `data/mix-metadata.json`
- Every `.mix` file under `archive/<Product>/MIX/` (case varies per
  product — see `ARCHIVE_MIX_DIRS` in
  [scripts/build-index.ts](../scripts/build-index.ts))

…and emits `data/index.json`, the file the dev-server browser loads on
startup.

## 11. Smoke-test in the browser

```bash
npm run serve
```

Open <http://127.0.0.1:3000/> in VS Code Simple Browser. Confirm:

- The category sidebar lists every expected category.
- Sample blocks render in the grid and play when clicked.
- The `Mix Archive` panel in the top-left lists the products you have
  under `archive/`, and clicking a `.mix` file opens its metadata
  popup.

## Product Source Map

To populate `archive/` from a product CD or install directory, copy the
*entire* install tree into the matching folder below. The pipeline
discovers everything else from there.

| Product | Folder under `archive/` | Required subtree (used by extraction) |
| --- | --- | --- |
| Dance eJay 1 | `Dance_eJay1/` | `dance/`, `MIX/` |
| Dance eJay 2 | `Dance_eJay2/` | `D_ejay2/PXD/DANCE20[.INF]`, `D_ejay2/PXD/DANCESK4..6[.INF]`, `MIX/` |
| Dance eJay 3 | `Dance_eJay3/` | `eJay/pxd/dance30[.inf]`, `MIX/` |
| Dance eJay 4 | `Dance_eJay4/` | `ejay/PXD/DANCE40[.inf]`, `Mix/` |
| Dance SuperPack | `Dance_SuperPack/` | `dance/`, `eJay SampleKit/`, `MIX/` |
| Generation Pack 1 | `GenerationPack1/` | `Dance/dance/`, `Rave/RAVE/`, `HipHop/HIPHOP/` |
| HipHop eJay 2 | `HipHop 2/` | `eJay/pxd/HipHop20[.inf]`, `MIX/` |
| HipHop eJay 3 | `HipHop 3/` | `eJay/pxd/hiphop30[.inf]`, `MIX/` |
| HipHop eJay 4 | `HipHop 4/` | `eJay/pxd/HipHop40[.inf]`, `MIX/` |
| House eJay | `House_eJay/` | `ejay/PXD/House10[.inf]`, `Mix/` |
| Rave eJay | `Rave/` | `RAVE/` (bank folders), `MIX/` |
| Techno eJay | `TECHNO_EJAY/` | `EJAY/PXD/RAVE20[.INF]`, `MIX/` |
| Techno eJay 3 | `Techno 3/` | `eJay/pxd/rave30[.inf]`, `MIX/` |
| Xtreme eJay | `Xtreme_eJay/` | `eJay/PXD/xejay10[.inf]`, `mix/` |

The folder names above are case-sensitive on Linux/macOS. The MIX
sub-folder casing matches what the original eJay installer ships and is
what `scripts/build-index.ts` looks for.

## Troubleshooting

- **Browser shows no samples** — Confirm `output/metadata.json` exists
  and `total_samples > 0`. Re-run steps 4–5 if it is missing.
- **`Mix Archive` panel is empty** — Make sure `data/index.json`
  contains a `mixLibrary` section. Re-run steps 10 (`npm run mix:meta`
  then `npm run build`).
- **Pipeline fails on a Gen 2/3 product** — Verify that both the packed
  archive (e.g. `DANCE40`) *and* its `.inf` companion live in the same
  folder. Without the catalog the parser cannot recover sample names.
- **Filenames look mangled** — Re-run `rename-samples.ts --apply` and
  rebuild. Always rebuild (`npm run build`) after touching any file
  under `output/`.

## Reference

- [`docs/file-formats.md`](file-formats.md) — PXD/INF/Pxddance format
  specs and channel mapping
- [`docs/mix-format-analysis.md`](mix-format-analysis.md) — `.mix` file
  format families and parser notes
- [`.github/copilot-instructions.md`](../.github/copilot-instructions.md)
  — project conventions and milestones
