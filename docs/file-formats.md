# eJay File Formats

Detailed technical documentation for the proprietary audio formats used by
eJay music software. See [copilot-instructions.md](../.github/copilot-instructions.md)
for build instructions and project conventions.

Detailed `.mix` reverse-engineering, format-family layouts, and playback
planning live in [mix-format-analysis.md](mix-format-analysis.md) and
[mix-player-prerequisites.md](mix-player-prerequisites.md). This document is
limited to the sample/archive formats and supporting catalogs they depend on.

## Products (14 titles)

All source data lives under `archive/` (read-only). The 14 product folders
below sit alongside an auxiliary `_userdata/` tree of unsorted/imported
material that is not itself a shipped eJay title.

| # | Product | Folder | Genre | Gen | Sample Formats | Catalog File(s) |
|---|---------|--------|-------|-----|----------------|-----------------|
| 1 | Dance eJay 1 | `Dance_eJay1` | Dance | 1 | Individual PXD | — |
| 2 | Dance eJay 2 | `Dance_eJay2` | Dance | 2 | Individual PXD + packed archive | `DANCE20.INF`, `DANCESK4-6.INF` |
| 3 | Dance eJay 3 | `Dance_eJay3` | Dance | 3 | Packed archive | `dance30.inf` |
| 4 | Dance eJay 4 | `Dance_eJay4` | Dance | 3 | Packed archive | `DANCE40.inf` |
| 5 | Dance SuperPack | `Dance_SuperPack` | Dance | 1+ | Individual PXD + WAV + bundled sample-kit content | — |
| 6 | Generation Pack 1 | `GenerationPack1` | Multi | 1 | PXD banks (Dance/Rave/HipHop) + WAV bonus folders | — |
| 7 | HipHop eJay 2 | `HipHop 2` | HipHop | 2 | Packed archive | `HipHop20.inf` |
| 8 | HipHop eJay 3 | `HipHop 3` | HipHop | 3 | Packed archive | `hiphop30.inf` |
| 9 | HipHop eJay 4 | `HipHop 4` | HipHop | 3 | Packed archive + WAV | `HipHop40.inf` |
| 10 | House eJay | `House_eJay` | House | 3 | Packed archive | `HOUSE10.inf` |
| 11 | Rave eJay | `Rave` | Rave | 1 | Individual PXD | — |
| 12 | Techno eJay | `TECHNO_EJAY` | Techno | 2 | Individual PXD + packed archive | `RAVE20.INF` |
| 13 | Techno eJay 3 | `Techno 3` | Techno | 3 | Packed archive | `rave30.inf` |
| 14 | Xtreme eJay | `Xtreme_eJay` | Xtreme | 3 | Packed archive | `xejay10.inf` |

**Generation key:**

- **Gen 1** — Two-letter bank directories (AA–BW) each containing individual
  PXD files. No INF catalog.
- **Gen 2** — Application tree with individual PXD files + packed archives in
  a `PXD/` directory with INF catalogs.
- **Gen 3** — Single packed archive + INF catalog; very few standalone PXD
  files.

## Extraction

```bash
# Extract individual PXD files from a directory tree
tsx tools/pxd-parser.ts archive/Dance_eJay1/dance --output output/Dance_eJay1

# Extract and organize into category folders with human-readable names
tsx tools/pxd-parser.ts archive/Dance_eJay1/dance --output output/Dance_eJay1 \
    --catalog archive/Dance_SuperPack/dance/EJAY/Pxddance \
    --format "{category}/{alias} - {detail}"

# Extract from a packed archive (auto-detects .INF companion)
tsx tools/pxd-parser.ts archive/Dance_eJay2/D_ejay2/PXD/DANCE20 --output output/Dance_eJay2

# Extract a single PXD file
tsx tools/pxd-parser.ts path/to/file.pxd --output output/test
```

### pxd-parser.ts Flags

| Flag | Description |
|------|-------------|
| `source` | Path to a PXD file, directory of PXDs, or packed archive (positional) |
| `--output`, `-o` | Output directory for WAV files and metadata.json (default: `output`) |
| `--inf` | Path to INF catalog (auto-detected for packed archives) |
| `--catalog` | Path to Pxddance catalog file for category enrichment |
| `--format`, `-f` | Rename template with placeholders: `{category}`, `{alias}`, `{detail}`, `{bank}`, `{stereo_channel}`, `{beats}` |
| `--8bit` | Output raw 8-bit unsigned DPCM delta codes (default: 16-bit signed PCM via DPCM reconstruction) |

## File Type Inventory

| Extension | Count | Description |
|-----------|------:|-------------|
| `.PXD` | ~10,623 | PXD-compressed audio samples (or plain WAV disguised as PXD) |
| (no ext) | ~4,063 | Packed sample archives, config files, etc. |
| `.WAV` | ~525 | Standard WAV audio (SuperPack Special, GP1 Special, later products) |
| `.MIX` | ~231 | eJay project/mix files; see [mix-format-analysis.md](mix-format-analysis.md) |
| `.INF` | 13 | Sample catalog files — text format (excluding DirectX INFs) |

## PXD Format (Decoded)

```text
Offset  Size  Description
------  ----  -----------
0x00    4     Magic: "tPxD" (0x74 0x50 0x78 0x44)
0x04    1     Metadata length (N)
0x05    N     Metadata text (CRLF-separated fields, null-padded)
0x05+N  1     Audio marker: "T" (0x54)
0x06+N  4     Decoded audio data size in bytes (uint32 LE)
0x0A+N  2     Unknown field (uint16 LE — values span 0x0000–0xFFFF)
0x0C+N  ...   Compressed audio data (dictionary-based codec)
```

**Audio output**: 8-bit unsigned DPCM delta codes, mono, 44100 Hz.
Center/silence value = `0x80`. All durations are multiples of 18900 samples
(1 beat at 140 BPM = 0.4286 sec).

### Compression Algorithm

Dictionary-based codec with clean control/data byte partition:

| Byte | Meaning | Consumed | Output |
|------|---------|----------|--------|
| `0xF4 KK D1` | Define dict[KK] = 1 byte, emit | 3 bytes | 1 byte |
| `0xF5 KK D1 D2` | Define dict[KK] = 2 bytes, emit | 4 bytes | 2 bytes |
| `0xF6 KK D1 D2 D3` | Define dict[KK] = 3 bytes, emit | 5 bytes | 3 bytes |
| `0xF7 KK D1..D4` | Define dict[KK] = 4 bytes, emit | 6 bytes | 4 bytes |
| `0xF8 KK D1..D5` | Define dict[KK] = 5 bytes, emit | 7 bytes | 5 bytes |
| `0xFF DD` | Literal escape — emit byte DD | 2 bytes | 1 byte |
| `0x00` | Silence — emit 5 x `0x80` | 1 byte | 5 bytes |
| `KK` (if in dict) | Back-reference — emit dict[KK] | 1 byte | 2–5 bytes |
| `KK` (not in dict) | Literal — emit KK verbatim | 1 byte | 1 byte |

- Dictionary keys use range `0x01`–`0xF3` (243 slots). Once full, old entries
  are replaced.
- Data bytes are always in range `0x01`–`0xF3`. Control bytes (`0x00`,
  `0xF4`–`0xFF`) never appear in payload.
- `0xF9`–`0xFE` are reserved/unused (zero occurrences across all files).
- Output may undershoot by 1–4 bytes — pad with `0x80`. Output may
  overshoot — truncate to `decoded_size`.

### DPCM Reconstruction

Decoded bytes are **not** absolute PCM values but DPCM delta codes. Each byte
indexes into a 244-entry nonlinear companding step table; the final 16-bit
sample is the running sum of deltas:

```text
output[n] = clamp_int16(output[n-1] + STEP_TABLE[byte[n]] * scale)
```

- The step table is symmetric around byte `0x80` (zero delta):
  `STEP_TABLE[0x80 + d] = -STEP_TABLE[0x80 - d]`.
- Small deltas (d <= 5): 2x scaling (byte `0x81` -> step +2, byte `0x85` ->
  step +10).
- Large deltas (d = 115, byte `0xF3`): step +/-16500 (~199x scaling vs the
  8-bit delta magnitude).
- The full table has 243 data entries (bytes `0x01`–`0xF3`) plus entry 0
  (silence, step=0).
- Gen 2 DLLs (`PXD32R4.DLL`, `PXD32D4.DLL`) use `scale=1`; Gen 3
  (`pxd32d5.dll`) uses `scale=2`.
- The default 16-bit output uses DPCM reconstruction with `scale=1` (safe for
  all gens).
- The `--8bit` flag outputs raw 8-bit delta codes as unsigned PCM — listenable
  but lower fidelity.

### Metadata Fields

Metadata fields vary by product version:

- Generation Pack 1 (GP1): `alias` or `alias\r\ndetails`
- Dance eJay 2:
  `product\r\ndescription\r\nproduct\r\ndescription\r\ncategory\r\nsample_count`
- Rave eJay: `alias\r\nnumber\r\nproduct\r\n\r\ncategory\r\nsample_rate_or_count`

**IMPORTANT**: Some `.PXD` files are actually plain WAV files (start with `RIFF`
magic). Always check the first 4 bytes before attempting PXD decoding.

## INF Catalog Files

`.INF` files in `*/PXD/` or `*/pxd/` directories describe packed sample
archives:

```text
[SAMPLES]
<sample_id>           — sequential index (1-based)
<unknown_flag>        — usually 0 or 1
"<internal_filename>" — e.g. "D5MA060"
<byte_offset>         — offset into packed archive
<byte_size>           — compressed sample size in bytes
"<style_category>"    — e.g. "euro", "trance"
"<display_alias>"     — human-readable name, e.g. "kick3"
<channel_id>          — UI sound-group tab index (1-based)
<unknown_int>
""
0
""
```

These map internal filenames (e.g., `D5MA060`) to display names (e.g.,
`kick3`) and categories (e.g., `euro`). The offset/size fields reference
positions within packed archives.

**Channel ID (field 8)**: The first integer after `display_alias` is the
1-based channel/tab index matching the application's sound-group tabs.
Verified by cross-referencing with the `seiten` application config file (see
[Application Config Files](#application-config-files) below). Example from
Xtreme eJay: `1`=Loop, `2`=Drum, `3`=Bass, `4`=Guitar, `5`=Sequence,
`8`=Voice, `9`=Effect, `10`=Xtra.

**Sample catalog INF files** (13 files currently present; not the
DirectX-related INFs shipped with the app):

| Product | INF Path | Packed Archive |
|---------|----------|----------------|
| Dance eJay 2 | `D_ejay2/PXD/DANCE20.INF` | `D_ejay2/PXD/DANCE20` |
| Dance eJay 2 | `D_ejay2/PXD/DANCESK4.INF` | `D_ejay2/PXD/DANCESK4` |
| Dance eJay 2 | `D_ejay2/PXD/DANCESK5.INF` | `D_ejay2/PXD/DANCESK5` |
| Dance eJay 2 | `D_ejay2/PXD/DANCESK6.INF` | `D_ejay2/PXD/DANCESK6` |
| Dance eJay 3 | `eJay/pxd/dance30.inf` | `eJay/pxd/dance30` |
| Dance eJay 4 | `ejay/PXD/DANCE40.inf` | `ejay/PXD/DANCE40` |
| TECHNO_EJAY | `EJAY/PXD/RAVE20.INF` | `EJAY/PXD/RAVE20` |
| Techno 3 | `eJay/pxd/rave30.inf` | `eJay/pxd/rave30` |
| House eJay | `ejay/PXD/HOUSE10.inf` | `ejay/PXD/House10` |
| Xtreme eJay | `eJay/PXD/xejay10.inf` | `eJay/PXD/xejay10` |
| HipHop 2 | `eJay/pxd/HipHop20.inf` | `eJay/pxd/HipHop20` |
| HipHop 3 | `eJay/pxd/hiphop30.inf` | `eJay/pxd/hiphop30` |
| HipHop 4 | `eJay/pxd/HipHop40.inf` | `eJay/pxd/HipHop40` |

Note: Techno products use `RAVE` naming internally (e.g., `RAVE20.INF` for
Techno eJay).

## Packed Archives (no extension)

Gen 2/3 products store samples in a single large binary file (no extension)
paired with an `.INF` catalog. The INF provides byte offsets and sizes to
extract individual PXD samples from within the archive.

**Multi-part archives**: Some packed archives are split into multiple part
files with letter suffixes (e.g., `DANCE20a`, `DANCE20b`, `DANCE20c`). When a
sample's byte offset resets to 0 while parsing the INF sequentially, it
indicates a switch to the next part file. The part suffix follows alphabetical
order: a -> b -> c -> ...

**Stereo samples in packed archives**: Stereo pairs are represented as two
consecutive INF records — one for the left channel and one for the right.
Detection heuristics (from eJayDecompressor):

1. Next record has an empty display name
2. Base filename matches with `L`/`R` suffix (e.g., `D5MA060L`, `D5MA060R`)
3. Display name ends with `(L)` or `(R)`

When extracting stereo, both channel offsets/sizes are passed to the
decompression function, which interleaves them into a single stereo WAV.

## Internal Name Patterns

Each product family uses a distinct naming scheme for its internal filenames
in INF catalogs. These patterns encode the sound channel (instrument category)
as a 2–3 letter sub-code:

| Pattern | Regex | Products | Example |
|---------|-------|----------|---------|
| `D<gen><CODE><seq>` | `^D\d([A-Z]{2})\d` | Dance eJay 2 | `D5MA060` -> `MA` (Loop) |
| `DA<CODE><variant><seq>` | `^DA([A-Z]{2})` | Dance eJay 4 | `DAGAX022` -> `GA` (Loop) |
| `HS<gen><pack><CODE><seq>` | `^HS\d[A-F]([A-Z]{2,})\d` | House eJay | `HS1AEX001` -> `EX` (Groove) |
| `X<pack><CODE>X<pack><seq>` | `^X[A-Z]([A-Z]{2})X` | Xtreme eJay | `XABTXA001` -> `BT` (Loop) |
| `HIPHOP_<CODE><seq>_<bpm>_<var>_<gen>` | `^HIPHOP_([A-Z]+)\d` | HipHop eJay 4 | `HIPHOP_BASS001_90_A_H6` -> `BASS` |
| `<CODE><seq>` | `^([A-Z]{2})\d` | HipHop 2/3, Dance 3, Techno 2/3 | `BS001` -> `BS` (Bass) |

**Common sub-codes** (shared across most products):

| Code | Channel | Code | Channel | Code | Channel |
|------|---------|------|---------|------|----------|
| `BS` | Bass | `BT`/`LA` | Loop | `DR`/`DA`–`DF` | Drum |
| `GT` | Guitar | `KY` | Seq | `FX` | Effect |
| `SY`/`PN`/`ON` | Keys | `VC`/`VA`/`VB` | Voice | `EX`/`SX` | Xtra |

Product-specific codes are handled by dedicated regex+map in
`tools/reorganize.ts`.

## Gen 1 Sample-ID Catalogs (`MAX`, `Pxddance`, `PXD.TXT`)

Gen 1 products (Dance eJay 1, Dance SuperPack, Rave eJay, GenerationPack 1 —
Dance / Rave / HipHop) store the authoritative `uint16 sample_id → pxd_path`
mapping used by `.mix` files in a plain-text catalog called **`MAX`**
(`MAX.TXT` on Dance eJay 1). **Line number N = sample ID N** — there is no
`bank_index × bank_size + file_index` formula; the table is a direct lookup.

This section documents the catalog files themselves. For the verified Gen 1
`.mix` grid layout, trailer structure, overflow handling, and resolver
follow-ups, use [mix-format-analysis.md](mix-format-analysis.md) and
[mix-player-prerequisites.md](mix-player-prerequisites.md) as the source of
truth.

### MAX / MAX.TXT Layout

One record per line; two on-disk dialects:

| Dialect | Products | Example line |
|---------|----------|--------------|
| Quoted (CRLF) | Dance eJay 1, Dance SuperPack, GP1-Dance | `"ba\aaaf.pxd"\r\n` |
| Unquoted (CRLF) | Rave eJay, GP1-Rave, GP1-HipHop | `ba\r1da006.pxd\r\n` |

Empty slots in the quoted dialect appear as `""`. All paths are relative to
the product's `dance/` or `RAVE/` or `HIPHOP/` sample root and may contain
multiple path segments (e.g. `dmkit2\04\fx316.pxd`).

### MAX Catalog Sizes (verified)

| Product | MAX path | IDs | Populated |
|---------|----------|----:|----------:|
| Dance eJay 1 | `dance/DMACHINE/MAX.TXT` | 1,352 | 1,352 |
| Dance SuperPack | `dance/EJAY/MAX` | 2,845 | 2,845 |
| GP1-Dance | `Dance/dance/EJAY/MAX` | 2,845 | 2,845 |
| Rave eJay | `RAVE/EJAY/MAX` | 3,146 | 3,145 |
| GP1-Rave | `Rave/RAVE/EJAY/MAX` | 3,146 | 3,145 |
| GP1-HipHop | `HipHop/HIPHOP/EJAY/MAX` | 1,381 | 1,381 |

> SuperPack and GP1-Dance MAX files are byte-identical (51,746 bytes);
> Rave and GP1-Rave MAX files are byte-identical (64,812 bytes).

### `MIN` Catalog

A parallel `MIN` / `MIN.TXT` file exists alongside every `MAX` and contains a
strict subset of the MAX paths (897 lines for Dance, 1,353 for Rave,
1,221 for GP1-HipHop — confirmed smaller in every product). Purpose is not
fully confirmed; hypothesis is that it enumerates the "minimum" starter kit
loaded by the UI, while MAX is the full addressable space. Not required for
`.mix` playback.

### `Pxddance` Enrichment (SuperPack / GP1-Dance only)

`dance/EJAY/Pxddance` is a quoted-CRLF file of **6-line records** providing
category/group metadata for the first 1,352 IDs (the Dance eJay 1 base kit):

```text
"bm\asjo.pxd"      ← path (matches a MAX entry)
""                 ← stereo / reserved flag (blank for mono)
"loop"             ← channel category
"2"                ← variant / beat-count indicator
"Grp. 1"           ← group label
"Vers1"            ← version / alias label
```

Records are **not** ordered by sample ID — join by path to enrich a MAX
catalog. Files `kit1.txt`, `kit2.txt`, `kit3.txt` in `dance/EJAY/` carry the
same per-file metadata for the DMachine kit samples (IDs ≥ 1,352).

### `PXD.TXT` Header (Dance eJay 1 fallback)

Dance eJay 1 has no `Pxddance`. Its `dance/DMACHINE/PXD.TXT` begins with
**9 pairs of `(start_id, count)` values** that define the per-tab ID ranges
in Dance 1's native tab order:

| Pair | Range | Channel |
|------|-------|---------|
| 1 | 0 – 125 | loop |
| 2 | 126 – 239 | drum |
| 3 | 240 – 354 | bass |
| 4 | 355 – 454 | guitar |
| 5 | 455 – 535 | sequence |
| 6 | 536 – 835 | voice |
| 7 | 836 – 1064 | rap |
| 8 | 1065 – 1191 | effect |
| 9 | 1192 – 1351 | xtra |

The remaining lines of PXD.TXT hold 4-field per-sample records (decoded
size, channel count, group, version/alias) and are not currently used by the
extractor.

### Parser: `tools/gen1-catalog.ts`

Parses `MAX` / `MAX.TXT` (either dialect), optionally enriches with
`Pxddance` (preferred) or `PXD.TXT` channel ranges, and emits one JSON
catalog per product at `output/<product>/gen1-catalog.json`:

```bash
# Build every known Gen 1 product catalog.
tsx tools/gen1-catalog.ts

# Or a single product.
tsx tools/gen1-catalog.ts --product Dance_SuperPack
tsx tools/gen1-catalog.ts --product Dance_eJay1 \
  --out output/Dance_eJay1/gen1-catalog.json

# Or ad-hoc against a specific MAX file.
tsx tools/gen1-catalog.ts --max path/to/MAX --pxddance path/to/Pxddance
```

Output schema (per entry):

```json
{
  "id": 1231,
  "path": "ai/bvjp.pxd",
  "bank": "AI",
  "file": "BVJP",
  "category": "loop",
  "group": "Grp. 1",
  "version": "Vers1"
}
```

### MIX Integration Note

These catalogs are consumed by the MIX parser and resolver, but the `.mix`
format rules are documented only in
[mix-format-analysis.md](mix-format-analysis.md) and
[mix-player-prerequisites.md](mix-player-prerequisites.md).

## Channel Mapping (per product)

For Gen 2/3 products that ship a `seiten` file, the names below come from the
archive's `Soundgruppe` tab definitions. For Gen 1 products and later products
without `seiten`, the names below reflect the verified project channel groups
used by the catalogs and extraction tooling. Extracted `output/` folders may
normalize some labels further (for example `sequence` → `Seq`) via
`tools/reorganize.ts`.

| Product | Channels |
|---------|----------|
| Dance eJay 1 | Loop, Drum, Bass, Guitar, Sequence, Voice, Rap, Effect, Xtra |
| Dance eJay 2 | Loop, Drum, Bass, Guitar, Sequence, Layer, Rap, Voice, Effect, Xtra, Groove, Wave |
| Dance eJay 3 | Loop, Drum, Bass, Guitar, Sequence, Groove, Rap, Voice, Effect, Xtra, Layer, Wave |
| Dance eJay 4 | Loop, Drum, Bass, Guitar, Sequence, Groove, Rap, Voice, Effect, Xtra, Layer, Wave |
| Dance SuperPack | Loop, Drum, Bass, Guitar, Sequence, Voice, Rap, Effect, Xtra |
| Generation Pack 1 | Dance: same as Dance eJay 1; HipHop: Loop, Drum, Bass, Guitar, Sequence, Layer, Rap, Voice, Effect, Xtra, Scratch; Rave: same as Rave eJay |
| HipHop eJay 2 | Loop, Drum, Bass, Guitar, Sequence, Layer, Rap, Voice, Effect, Xtra, Groove, Wave |
| HipHop eJay 3 | Loop, Drum, Bass, Guitar, Sequence, Groove, Rap, Voice, Effect, Xtra, Layer, Wave |
| HipHop eJay 4 | Loop, Drum, Bass, Guitar, Keys, Ladies, Fellas, Effect, Scratch, Xtra |
| House eJay | Loop, Drum, Bass, Guitar, Keys, Voice, Effect, Groove, Xtra |
| Rave eJay | Loop, Drum, Bass, Keys, Voice, Effect, Xtra |
| Techno eJay | Loop, Drum, Bass, Guitar, Sequence, Layer, Rap, Voice, Effect, Xtra |
| Techno eJay 3 | Loop, Drum, Bass, Keys, Hyper, Voice, Effect, Xtra, Sphere, Wave |
| Xtreme eJay | Loop, Drum, Bass, Guitar, Sequence, Layer, Rap, Voice, Effect, Xtra, Groove, Wave |

**Product-specific notes**:

- Dance eJay 1 channel ranges are verified from `dance/DMACHINE/PXD.TXT` rather
  than a `seiten` file.
- HipHop eJay 2 and HipHop eJay 3 expose the main `Soundgruppe` tabs above in
  `seiten`, but scratch-generator controls also exist elsewhere in the UI;
  `tools/reorganize.ts` still normalizes scratch-coded stems into `Scratch`
  folders in `output/`.
- House eJay maps `EX` internal names to `Groove` in `tools/reorganize.ts`.
- HipHop eJay 4 uses `Ladies` (FEMALE) and `Fellas` (MALE) instead of a single
  generic voice channel.
- Techno eJay 3 defines `Sphere` and `Hyper` in `seiten`; the `SRC*` bank in
  `rave30.inf` belongs to `Sphere`, not `Scratch`.
- Xtreme eJay ships additional UI controls such as `G_PREVIEW` and
  `B_FULLSCREEN`; only the `Soundgruppe` names are listed here.

## Reference Tools

### Application Config Files

**`seiten`** — Tab/channel definition file found in each product's application
directory (e.g., `archive/Xtreme_eJay/eJay/eJay/seiten`). Lists the UI
sound-group tabs as numbered entries:

```text
B_GRUPPE_01 / RadioButton / Soundgruppe / loop
B_GRUPPE_02 / RadioButton / Soundgruppe / drum
...
```

The tab number (1-based) corresponds to INF field 8 (`channel_id`). Useful for
discovering channel names when no screenshots of the UI are available.

For Techno eJay 3, `seiten` lists the sound-group tabs as `loop`, `drum`,
`bass`, `keys`, `sphere`, `voice`, `effect`, `xtra`, `hyper`, and `wave`.
This matches the original UI screenshots and explains why the `SRC*` pad bank
must be documented as `Sphere` instead of `Scratch`.

**Known bugs in eJayDecompressor**:

- INF file discovery uses `*0.inf` glob pattern, which misses catalog files
  not ending in `0` (e.g., `DANCESK4.INF`, `DANCESK5.INF`, `DANCESK6.INF`)
- Some header edge cases (files starting with `"45"` or `"Hyper2"`) are
  special-cased rather than handled generically

## Source Data Layout

This tree focuses on the sample/archive inputs. `.mix` inventory and format
notes are maintained separately in [mix-format-analysis.md](mix-format-analysis.md).
Player-ready sample-kit assets used by the mix player live under `output/`
(for example `output/SampleKit_DMKIT1/`, `output/SampleKit_DMKIT2/`, and
`output/SampleKit_DMKIT3/`), not under `archive/`.

```text
archive/
├── _userdata/{Dance and House,Hip Hop,Rave,Techno,_unsorted}/
│                                    — auxiliary unsorted/imported material
├── Dance_eJay1/
│   ├── dance/{AA..BW,DMACHINE}/     — individual PXD banks + Dance 1 catalogs
│   └── MIX/                         — 4 mix files
├── Dance_eJay2/
│   ├── D_ejay2/
│   │   ├── ejay/{AUDIO,Audio_d,Audio_e,Audio_f}
│   │   │                         — app audio + localized assets
│   │   └── PXD/{DANCE20,DANCESK4-6}
│   │                         — packed archives + sample catalog INFs
│   └── MIX/                         — mix files
├── Dance_eJay3/
│   ├── eJay/
│   │   ├── eJay/                    — application runtime + metro.pxd
│   │   └── pxd/{dance30,dance30.inf}
│   │                         — packed archive + sample catalog
│   └── MIX/                         — mix files
├── Dance_eJay4/
│   ├── ejay/
│   │   ├── eJay/                    — application runtime + metro.pxd
│   │   └── PXD/{DANCE40,DANCE40.inf}
│   │                         — packed archive + sample catalog
│   └── Mix/                         — mix files
├── Dance_SuperPack/
│   ├── dance/{AA..BV,Bw,dmkit1-3,EJAY}
│   │                         — Gen 1 banks + bundled DMachine kit banks
│   ├── eJay SampleKit/{DMKIT1,DMKIT2}
│   │                         — nested sample-kit installer content
│   ├── MIX/                         — mix files
│   └── Special/                     — WAV bonus samples
├── GenerationPack1/
│   ├── Dance/dance/{AA..BV,Bw,EJAY} — Dance Gen 1 banks
│   ├── Dance/MIX/                   — Mix files
│   ├── Dance/Special/               — WAV bonus samples
│   ├── eJay/setup/                  — bundled demo/setup assets
│   ├── HipHop/HIPHOP/{AA..BR,EJAY,SCRATCH}
│   │                         — HipHop Gen 1 banks + scratch assets
│   ├── HipHop/MIX/                  — Mix files
│   ├── HipHop/Special/              — WAV bonus samples
│   ├── Rave/RAVE/{AA..BS,EJAY,HYPER}
│   │                         — Rave Gen 1 banks + hyper assets
│   └── Rave/MIX/                    — Mix files
├── HipHop 2/
│   ├── eJay/
│   │   ├── eJay/                    — application runtime + scratch/DirectX assets
│   │   ├── eJayDemo/{Dance2,Dance3,Techno2}
│   │   │                         — bundled demos
│   │   └── pxd/{HipHop20,HipHop20.inf}
│   │                         — packed archive + sample catalog
│   └── MIX/                         — mix files
├── HipHop 3/
│   ├── eJay/
│   │   ├── eJay/                    — application runtime
│   │   └── pxd/{hiphop30,hiphop30.inf}
│   │                         — packed archive + sample catalog
│   └── MIX/                         — mix files
├── HipHop 4/
│   ├── eJay/
│   │   ├── eJay/                    — application runtime
│   │   └── pxd/{HipHop40,HipHop40.inf}
│   │                         — packed archive + sample catalog
│   └── MIX/                         — mix files
├── House_eJay/
│   ├── ejay/
│   │   ├── eJay/                    — application runtime
│   │   └── PXD/{House10,HOUSE10.inf}
│   │                         — packed archive + sample catalog
│   └── Mix/                         — mix files
├── Rave/
│   ├── RAVE/{AA..BS,EJAY,HYPER}    — individual PXD banks + hyper assets
│   └── MIX/                        — mix files
├── TECHNO_EJAY/
│   ├── EJAY/
│   │   ├── EJAY/                    — application runtime + DirectX assets
│   │   └── PXD/{HYP1..HYP4,RAVE20,RAVE20.INF}
│   │                         — stem folders + packed archive/catalog
│   └── MIX/                         — mix files
├── Techno 3/
│   ├── eJay/
│   │   ├── eJay/                    — application runtime
│   │   └── pxd/{rave30,rave30.inf}  — packed archive + sample catalog
│   └── MIX/                         — mix files
└── Xtreme_eJay/
  ├── eJay/
  │   ├── eJay/                    — application runtime
  │   └── PXD/{xejay10,xejay10.inf}
  │                         — packed archive + sample catalog
  └── mix/                         — mix files
```
