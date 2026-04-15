# eJay File Formats

Detailed technical documentation for the proprietary audio formats used by
eJay music software. See [copilot-instructions.md](../.github/copilot-instructions.md)
for build instructions and project conventions.

## Products (14 titles)

All source data lives under `archive/` (read-only).

| # | Product | Folder | Genre | Gen | Sample Formats | Catalog File(s) |
|---|---------|--------|-------|-----|----------------|-----------------|
| 1 | Dance eJay 1 | `Dance_eJay1` | Dance | 1 | Individual PXD | — |
| 2 | Dance eJay 2 | `Dance_eJay2` | Dance | 2 | Individual PXD + packed archive | `DANCE20.INF`, `DANCESK4-6.INF` |
| 3 | Dance eJay 3 | `Dance_eJay3` | Dance | 3 | Packed archive | `dance30.inf` |
| 4 | Dance eJay 4 | `Dance_eJay4` | Dance | 3 | Packed archive | `DANCE40.inf` |
| 5 | Dance SuperPack | `Dance_SuperPack` | Dance | 1+ | Individual PXD + WAV | — |
| 6 | Generation Pack 1 | `GenerationPack1` | Multi | 1 | PXD banks (Dance/Rave) + WAV | — |
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
| `.MIX` | ~231 | eJay project/mix files |
| `.INF` | ~15 | Sample catalog files — text format (excluding DirectX INFs) |

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

**Sample catalog INF files** (not the DirectX-related INFs shipped with the
app):

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

## Pxddance Catalog Format (Gen 1 Enrichment)

Binary catalog files (e.g., `Dance_SuperPack/dance/EJAY/Pxddance`) map Gen 1
bank/file positions to human-readable category names and aliases. Used with
`--catalog` flag for category enrichment during extraction.

## Channel Mapping (per product)

Each product's UI arranges samples into named "sound group" tabs (channels).
After extraction, `tools/reorganize.ts` sorts WAV files into channel folders
using internal-name sub-codes.

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

**Product-specific channels**: HipHop 4 uses `Ladies` (FEMALE code) and
`Fellas` (MALE code) instead of generic Voice. House eJay maps `EX` sub-code
to `Groove` instead of Xtra. Xtreme eJay maps `KY` to `Seq` (Sequence) rather
than Keys. Techno eJay 3 defines `Sphere` and `Hyper` tabs in `seiten`; the
`SRC*` bank in `rave30.inf` is a sphere-pad bank, not a scratch bank.

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

```text
archive/
├── Dance_eJay1/
│   ├── dance/{AA..BW,DMACHINE}/     — Individual PXD files in bank dirs
│   └── MIX/                         — 4 mix files
├── Dance_eJay2/
│   └── D_ejay2/
│       ├── ejay/AUDIO/              — Individual PXD files
│       ├── ejay/{Audio_d,Audio_e,Audio_f}/  — Localized audio
│       └── PXD/{DANCE20,DANCESK4-6} — Packed archives + INF catalogs
├── Dance_eJay3/
│   └── eJay/
│       ├── eJay/                    — Application + metro.pxd
│       └── pxd/{dance30,dance30.inf} — Packed archive + catalog
├── Dance_eJay4/
│   └── ejay/
│       ├── eJay/                    — Application + metro.pxd
│       └── PXD/{DANCE40,DANCE40.inf} — Packed archive + catalog
├── Dance_SuperPack/
│   ├── dance/{AA..BV,Bw,dmkit1-3,EJAY}/ — PXD banks + drum kits
│   ├── Special/                     — WAV bonus samples (~168 files)
│   └── MIX/                         — Mix files
├── GenerationPack1/
│   ├── Dance/dance/{AA..BV,Bw,EJAY}/ — PXD banks (same layout as Dance 1)
│   ├── Dance/Special/               — WAV bonus samples
│   ├── HipHop/Special/              — WAV bonus samples
│   ├── Rave/RAVE/{AA..BS,EJAY,HYPER}/ — PXD banks
│   └── Rave/MIX/                    — Mix files
├── HipHop 2/
│   └── eJay/
│       ├── eJay/                    — Application runtime
│       ├── eJayDemo/{Dance2,Dance3,Techno2}/ — Bundled demos
│       └── pxd/{HipHop20,HipHop20.inf} — Packed archive + catalog
├── HipHop 3/
│   └── eJay/pxd/{hiphop30,hiphop30.inf} — Packed archive + catalog
├── HipHop 4/
│   └── eJay/pxd/{HipHop40,HipHop40.inf} — Packed archive + catalog
├── House_eJay/
│   └── ejay/PXD/{House10,HOUSE10.inf} — Packed archive + catalog
├── Rave/
│   └── RAVE/{AA..BS,EJAY,HYPER}/   — Individual PXD files in bank dirs
├── TECHNO_EJAY/
│   └── EJAY/
│       ├── EJAY/                    — Application runtime
│       └── PXD/
│           ├── HYP1..HYP4/         — Individual PXD files (named by category)
│           └── {RAVE20,RAVE20.INF}  — Packed archive + catalog
├── Techno 3/
│   └── eJay/pxd/{rave30,rave30.inf} — Packed archive + catalog
└── Xtreme_eJay/
    └── eJay/PXD/{xejay10,xejay10.inf} — Packed archive + catalog
```
