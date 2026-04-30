# MIX File Format Analysis & Compatibility Abstraction Layer

Comprehensive reverse-engineering analysis of the `.MIX` project file format used
by eJay music software (1997–2003). Covers all 14 products across 4 format
generations, plus the compatibility notes needed by the current parser,
resolver, and browser MIX-loading workflow.

> **Scope**: this document is the MIX format reference and compatibility note.
> It tracks on-disk structures, parser expectations, and unresolved findings
> rather than implementation sequencing.

## Lane / Track Counts per Generation

The number of timeline tracks ("lanes") visible in the original eJay UI is
fixed per product generation. This is independent of how many lanes a given
song actually populates — the sequencer always renders the full lane count
for the target generation, so a song that places samples only in lanes 4 and
5 should still display all of its generation's lanes (with the unused ones
empty), not a collapsed 2-lane view.

| Generation | Format | Products | Lane count | Notes |
|------------|--------|----------|-----------|-------|
| **Gen 1** | A | Dance eJay 1, Rave eJay, HipHop eJay 1 | **8 lanes** | Fixed. Encoded directly as 8 columns × uint16 LE per row in the binary grid (two such grids stacked back-to-back — see the Format A spec for details). |
| **Gen 2** | B | Dance eJay 2, Techno eJay, HipHop eJay 2 | **17 lanes** (16 normal + 1 user-percussion / HyperKit) | The 17th lane carries the user's recorded percussion / HyperKit performance, not a stock sample bank channel. |
| **Gen 3+** | C, D | Dance eJay 3 / 4, HipHop eJay 3 / 4, Techno eJay 3, Xtreme eJay, House eJay | **32+ lanes** | Later products extend further (HipHop 4 reaches 49 mixer tracks, House 25). The "lane" count reported in the UI is the visible timeline-row count, which is 32 for the early Gen 3 products and grows from there. |

> Implication for the player: the sequencer view must source its lane count
> from the parsed `MixIR.format` / `MixIR.product`, **not** from the set of
> channels that happen to carry events. See
> [`docs/architecture-notes.md`](architecture-notes.md) for the corresponding
> rendering/runtime wiring.

## File Inventory

177 `.MIX` files across the 13 currently archived products. Dance SuperPack and
Generation Pack 1 (Dance / Rave / HipHop) were intentionally removed from the
archive in April 2026; they shared mixes with Dance eJay 1 / Rave eJay /
HipHop eJay 1 respectively and the canonical mixes for those generations are
preserved in those folders.

### Per-Product Listing

| Product | MIX Count | Size Range | Format |
|---------|-----------|------------|--------|
| Dance eJay 1 | 4 | 11,234 (all identical) | A |
| Dance eJay 2 | 13 | 1,553–8,219 | B |
| Dance eJay 3 | 16 | 2,852–6,362 | C |
| Dance eJay 4 | 12 (+1 empty) | 5,055–9,924 | C |
| HipHop eJay 1 | 11 | 12,692 (all identical) | A |
| HipHop eJay 2 | 20 | 1,532–8,841 | B |
| HipHop eJay 3 | 18 | 3,546–6,865 | C |
| HipHop eJay 4 | 15 | 14,648–23,721 | D |
| House eJay | 14 | 11,356–20,694 | D |
| Rave eJay | 15 | 11,276–11,326 | A |
| Techno eJay | 13 | 2,144–6,243 | B |
| Techno eJay 3 | 20 | 3,988–6,232 | C |
| Xtreme eJay | 4 | 7,960–21,270 | C |

**Note**: counts above are the file totals after the April 2026 streamlined
archive cleanup. Earlier revisions of this document referenced 231 mixes
across 14 products including Dance SuperPack and the three Generation Pack 1
sub-folders — those folders have been removed.

**Note**: `archive/Dance_eJay4/Mix/.mix` is a 2-byte empty file (just
`0x00 0x00`, verified). Skip any `.mix` file smaller than 4 bytes during
parsing.

**Note**: any `.mix` file whose size exceeds ~100 KB most likely contains one
or more custom audio samples embedded directly in the file (a feature of the
eJay HyperKit / recording workflow). None of the 231 shipped library mixes
reaches that threshold — the largest is 23,721 bytes. Files above 100 KB
should be parsed normally (the format header is unaffected), but the caller
should expect unresolvable sample references until the embedded PCM data is
recovered. Use `npm run mix:extract-embedded` to extract those in-band WAVs
into `output/Unsorted/embedded mix` and write the provenance manifest consumed
by `scripts/build-index.ts`.

---

## Format Families

Binary analysis reveals **4 distinct MIX format generations**, identified by the
uint32 LE value at offset 0x00, file size patterns, and structural markers:

| Family | Gen | Products | App ID (uint32 LE @ 0x00) | Size profile | Text Sections | SKKENNUNG | Mixer State |
|--------|-----|----------|---------------------------|--------------|---------------|-----------|-------------|
| **A** | 1 | Dance 1, Rave, HipHop 1 | `0x0A06`–`0x0A08` | Near-fixed per product (±~200 B) | No | No | None |
| **B** | 2 | Dance 2, Techno, HipHop 2 | `0x0889`–`0x11E9` | Variable (1.5–8.8 KB) | Yes | Yes | None |
| **C** | 3a | Dance 3/4, HipHop 3, Techno 3, Xtreme | `0x2571`–`0x2D41` | Variable (2.8–21.3 KB) | Yes | Yes | BOOU/DrumEQ/FX text |
| **D** | 3b | HipHop 4, House | `0x11D6`–`0x15DC` | Variable (11.4–23.7 KB) | Yes | Yes | Full mixer text |

> Format A files are very nearly fixed-size. Dance 1 and Rave/HipHop 1 mixes
> all sit in tight bands (11,234 / 11,276–11,326 / 12,692 bytes); a small
> minority overshoot the fixed footprint by a few bytes when an external
> WAV reference (HyperKit `c:\raveejay\hypersav\…`) is appended after the
> deterministic trailer. The grid layout itself is invariant: two
> back-to-back 8×351 uint16 LE matrices, totalling 11,232 grid bytes plus a
> 2-byte signature.

### Cross-Product Header Table

`U32@04` is the uint32 LE value at offset 0x04. In Gen 1 it is the third
uint16 cell (col 1) of Grid 1 row 0 followed by the col-2 cell. In Gen 2/3 it
is an entry count / metadata offset.

| Product | App ID | File Size | U32@04 | BPM1 | BPM2 | SKKENNUNG |
|---------|--------|-----------|--------|------|------|-----------|
| Dance 1 | `0x00000A06` | 11,234 | (grid data) | (implicit 140) | — | No |
| Rave | `0x00000A07` | 11,276 | (grid data) | (implicit 180) | — | No |
| HipHop 1 | `0x00000A08` | 12,692 | (grid data) | (implicit 90) | — | No |
| Dance 2 | `0x00000A19` | 6,124 | 219 | 140 | 140 | Yes |
| Techno | `0x00000889` | 5,224 | 216 | 140 | 140 | Yes |
| HipHop 2 | `0x000011E9` | 4,784 | 158 | 90 | 94 | Yes |
| Dance 3 | `0x00002571` | 6,362 | 87 | 140 | 140 | Yes |
| Dance 4 | `0x00002D41` | 7,578 | 129 | 140 | 140 | Yes |
| HipHop 3 | `0x00002573` | 4,708 | 110 | 90 | 91 | Yes |
| HipHop 4 | `0x000015DC` | 17,183 | 139 | 90 | 90 | Yes |
| House | `0x000011D6` | 11,712 | 79 | 125 | 125 | Yes |
| Techno 3 | `0x00002572` | 6,232 | 142 | 140 | 140 | Yes |
| Xtreme | `0x00002964` | 21,270 | 214 | 160 | 160 | Yes |

**BPM note**: HipHop 2 has BPM1=90, BPM2=94; HipHop 3 has BPM1=90, BPM2=91.
All other products have BPM1 === BPM2. Hypothesis: BPM2 is the user-adjusted
playback tempo while BPM1 is the original library BPM. Default to BPM1 for
playback.

Techno-specific clarification: `bpmAdjusted` values around 134/135 do occur in
some Techno `.mix` files, but the base product/library BPM remains 140.
Treat those values as per-mix tempo edits, not as the default Techno BPM.

---

## Detailed Format Specifications

### Format A — Gen 1 Binary Grid (Dual 8×351 uint16 LE Matrices)

Used by: Dance eJay 1, Rave eJay, HipHop eJay 1.

The layout is verified empirically via
[`scripts/mix-grid-analyzer.ts`](../scripts/mix-grid-analyzer.ts) and
cross-checked against the decompiled VB6 source (save routine
`loc_00476E50`–`loc_00477135` and load routine from `loc_0043A285` in
`decompiled/dance1/EJaymix.frm`; identical loops confirmed in
`decompiled/rave/EJaymix.frm` and `decompiled/hiphop1/EJaymix.frm`).
Every Gen 1 mix file shares the same deterministic outline:

```text
Offset   Size   Field
------   ----   -----
0x0000   2      App signature (uint16 LE):
                  0x0A06 = Dance eJay 1
                  0x0A07 = Rave eJay
                  0x0A08 = HipHop eJay 1
0x0002   5616   Grid 1: 351 rows × 8 columns × uint16 LE sample IDs.
                Read row-major; each column is one of the 8 fixed
                Gen 1 timeline lanes. `0x0000` = empty cell.
0x15F2   5616   Grid 2: 351 rows × 8 columns × uint16 LE. Sparse,
                small-valued (typical maxima 8–12). The decompiled VB6
                writes this grid from form member `Me+0x60C`; current
                hypothesis is a per-cell duration / variant override
                applied alongside Grid 1 placements. Surfaced on the IR
                as the opaque `formatAGrid2` field.
0x2BE2   ≥2    Optional trailer. Marked by `uint16 0x0A08` at offset
                11234 when present; if the value at 0x2BE2 is anything
                other than 0x0A08 the file has no trailer. Immediately
                after the marker: `uint16 recordCount`, then
                `recordCount` variable-length records, each prefixed
                by a `uint16 payloadLen` field. Record payloads encode
                user-recorded HyperKit sample references and product
                version labels (see Trailer Block below).
```

#### Grid Structure

- **Row count is invariant**: 351 rows for both grids in every archived
  Gen 1 mix file (8 × 351 × 2 = 5616 bytes per grid). This is the
  source of the universal 11,234-byte minimum file size. Dance eJay 1
  hardcodes the count via `Me[0x492] = 0x15E` (350) and writes rows
  `0..350` inclusive (= 351 rows). Rave and HipHop 1 do not hardcode
  it in `EJaymix.frm`, but their trailer marker always lands at
  `2 + 32 × 351 = 11234`, so the on-disk extent is identical.
- **Cell width is uint16 LE for every Gen 1 product.** The earlier
  hypothesis that Rave and HipHop 1 used a byte-wide grid has been
  refuted: the suspicious "large" u16 values seen in those products
  (25974 = "ve", 28783 = "op") came from ASCII bytes inside the trailer
  being misread as grid cells. Using deterministic grid bounds (offsets
  `0x0002`–`0x15F1` for Grid 1) yields sane IDs on every product.
- **Sample IDs**: non-zero Grid 1 cells are direct MAX/PXD.TXT catalog
  indices documented in
  [Gen 1 Sample-ID Catalogs](file-formats.md#gen-1-sample-id-catalogs-max-pxddance-pxdtxt).
- **Eight fixed lanes**: each column corresponds to one of Gen 1's 8
  timeline lanes; the eJay UI always exposes all 8 lanes regardless of
  how many are populated by the song.

#### Grid 2 Semantics

Grid 2 has the same 8 × 351 uint16 shape as Grid 1, stored in the VB6
form at `Me+0x60C` (Grid 1 is at `Me+0x5EC`), but its content is
fundamentally different. Measured across a sample of 8 mixes:

| File | Grid 1 non-zero | Grid 2 non-zero | Grid 2 max | Grid 2 dominant values |
|------|-----------------|-----------------|------------|------------------------|
| `Dance_eJay1/start.mix` | 189 | **0** | — | — |
| `Dance_eJay1/FREAK.MIX` | 227 | 23 | 8 | `2` ×15, `8` ×7 |
| `Dance_eJay1/dream.mix` | 178 | 1 | 8 | `8` ×1 |
| `Dance_eJay1/WetDance.mix` | 211 | 20 | 8 | `8` ×15, `4` ×5 |
| `Rave/START.MIX` | 221 | **0** | — | — |
| `Rave/NODRUGS.MIX` | 209 | 8 | 12 | `8` ×6, `4` ×1, `12` ×1 |
| `HipHop 1/HIPHOP.MIX` | 111 | **0** | — | — |
| `HipHop 1/BCAUSE.MIX` | 211 | 6 | 8 | `8` ×4, `4` ×2 |

Key observations:

- Grid 2 max value is always **≤ 12** — incompatible with sample IDs
  (Grid 1 values reach ∼2067), pitch shifts, or volume levels.
- Grid 2 is **frequently entirely zero** in fully-populated songs
  (`start.mix` has 189 Grid-1 placements but 0 Grid-2 cells).
- Grid 2 cell `(r, c)` is **never equal** to Grid 1 cell `(r, c)` —
  it is not a stereo companion or duplicate.
- Values are dominated by **multiples of 4** (`2`, `4`, `8`, `12`).

**Current interpretation**: Grid 2 is an optional per-cell duration
override / sample-stretch flag. `0` means "play at natural length";
a non-zero value likely extends the cell across N additional grid rows.
Simple stock songs leave Grid 2 entirely empty; user-edited songs that
explicitly stretched samples populate it. Confirming the exact unit
(rows vs beats vs 1/8-bar) requires playback correlation with the
original eJay runtime. The parser surfaces Grid 2 on the IR as the
opaque `formatAGrid2` array; default `durationOverride = 0` is safe
for all current playback purposes.

#### Trailer Block

About 70 % of Gen 1 `.mix` files carry a trailer immediately after Grid 2.
The parser detects it by reading the `uint16` at offset `0x2BE2` (= 11234)
and checking for the marker `0x0A08`. Trailer layout (cross-checked against
the decompiled VB6 load routine):

```text
0x2BE2  2   uint16 trailerFlag  — 0x0A08 = trailer follows; anything else = no trailer
0x2BE4  2   uint16 recordCount  — number of variable-length records
            recordCount × Record:
              uint16 payloadLen  — byte length of the rest of this record
              byte   payload[payloadLen]
```

Record payloads contain a product/version label followed by `\x00\x01`
separators and inline `(uint16 idLow, uint16 idHigh)` pairs that map a
sample-ID range to an external `hypersav\*.wav` path. Example from
`Rave/NODRUGS.MIX`:

```text
01 00        recordCount = 1
10 00        payloadLen  = 16
"Rave eJay 1.01\x00\x01"
00 00 08 00  (sample-range data)
01 00 02 00  (record terminator)
... "c:\raveejay\hypersav\scool004.wav" ...
```

Per-product trailer behaviour (48 archived Gen 1 mixes):

| Product | Typical file size | Trailer bytes after offset 11234 | Notes |
|---------|-------------------|----------------------------------|-------|
| Dance 1 | 11,234–11,413 | 0–179 bytes | 4 of 16 mixes have no trailer (file ends at 11,234, no `0x0A08` marker) |
| Rave | 11,276 or 11,326 | 42 bytes (default) or 92 | 42-byte default present even with no user samples; 92 when a `hypersav\*.wav` reference is included |
| HipHop 1 | 12,692 | 1,458 bytes | Fixed-size pre-allocated slot block; includes a product label even when no user samples are referenced |

Dance 1 writes the trailer **only when records exist**; Rave and HipHop 1
always emit a fixed-size pre-allocated block.

The `.mix` player must **skip `hypersav` path references** — log a warning
and play silence for that cell. Only one such reference exists across all
archived mixes: `Rave/NODRUGS.MIX → c:\raveejay\hypersav\scool004.wav`.

Grid 2 cells must be excluded from the Grid 1 placement scan; otherwise
small Grid 2 values (typically 2/4/8/12) are misinterpreted as sample IDs.
The deterministic offsets above guarantee the two grids are never confused.

#### Cross-Product Loadability

Cross-checking the decompiled load routines reveals **asymmetric**
loadability between Gen 1 products:

- **Rave eJay and HipHop eJay 1** loaders compare the file's `appSig`
  against all three signatures (`0x0A06`, `0x0A07`, `0x0A08`) and accept
  any. A Dance 1 `.mix` can therefore be opened in Rave or HipHop 1.
  Disassembly anchors: Rave `loc_00449471/7D/89`; HipHop 1
  `loc_0044CAC5/D1/DD`.
- **Dance eJay 1** loader only accepts `0x0A06`. Rave and HipHop 1 mixes
  cannot be opened in Dance 1.

The parser accepts all three sigs regardless of which product object is
active, consistent with the more permissive Rave/HipHop 1 behaviour.

#### Product-Specific File Sizes (verified)

| Product | File Size | Grid 1 Range | Grid 2 Range | Trailer present |
|---------|-----------|--------------|--------------|-----------------|
| Dance 1 | 11,234 | 0x0002–0x15F1 | 0x15F2–0x2BE1 | ~50 % (3/4 mixes) |
| Rave | 11,276–11,326 | 0x0002–0x15F1 | 0x15F2–0x2BE1 | All |
| HipHop 1 | 12,692 (all identical) | 0x0002–0x15F1 | 0x15F2–0x2BE1 | All |

#### Common uint16 Value Histogram (Dance 1 START.MIX)

```text
0x04CF (1231): 33 occurrences — "ai/bvjp.pxd" (verified via the Gen 1 MAX catalog)
0x077F (1919): 15 occurrences
0x02EA ( 746): 13 occurrences
0x034B ( 843): 12 occurrences
0x0359 ( 857): 10 occurrences
... (49 unique non-zero values total)
```

#### Sample ID Mapping

Sample IDs are a plain lookup into the per-product `MAX` / `MAX.TXT`
catalog (`line N = ID N`). See the
[Gen 1 Sample-ID Catalogs](file-formats.md#gen-1-sample-id-catalogs-max-pxddance-pxdtxt)
section of `file-formats.md` and the generated
`output/<product>/gen1-catalog.json` files.

#### Remaining Follow-ups

The four open questions previously listed here have been investigated against
the full 83-file Gen 1 `.mix` corpus via temporary April 2026 analysis tools.
Those one-off scripts were retired after the findings were folded into this
document; only the column-to-channel mapping remains genuinely undetermined
(requires UI inspection of the original engine).

##### 1. Column-to-channel assignment — partially resolved

Joining each grid cell against the per-product Gen 1 catalog
(`MAX` + `Pxddance`/`PXD.TXT`) yields per-column category histograms.
Dance eJay 1 (the only product with PXD.TXT channel ranges) shows a
weak but real bias per column:

| Col | Dominant categories (Dance eJay 1) |
|-----|-------------------------------------|
| 0 | rap (51 %), voice (8 %) |
| 1 | xtra (40 %), effect (29 %), rap (17 %) |
| 2 | rap (17 %), effect (12 %), xtra (10 %) |
| 3 | xtra (74 %) |
| 4 | rap (28 %), xtra (21 %), effect (21 %) |
| 5 | rap (79 %) |
| 6 | rap (84 %) |
| 7 | voice (58 %), rap (17 %) |

Dance eJay 1's per-column bias suggests a soft UI convention for column 5/6
(voice-style tracks) and column 3 (extras), but Rave / HipHop 1 have no
catalog category data and are 100 % `<unknown>`. Earlier revisions of this
document also tabulated Dance SuperPack / Generation Pack 1 column biases;
those products have been removed from the archive (April 2026 cleanup) and
the historical observation — a much flatter distribution across all columns
— has been preserved in the project notes only.

**Conclusion**: columns are timeline tracks that *accept* any sample
type. There is no enforceable column → channel-category mapping derivable
from the binaries alone, though Dance eJay 1's bias suggests the UI
labels track 5/6 as voice-style tracks and track 3 as an "extras"
track. A definitive per-column UI label still requires running a known
mix through the original engine and observing routing — the parser will
continue to preserve the numeric column index only.

##### 2. ID overflow — historical (no longer reproducible)

This subsection documented expansion-kit (`DMKIT1` / `DMKIT2` /
`SpaceSounds`) overflow handling for SuperPack and GP1-HipHop mixes
(originally HipHop 1 ids up to 2071 against an 1,381-entry MAX catalog;
SuperPack `softvox.mix` / `space.mix` ids up to 4727 against a
2,845-entry MAX catalog). Both source folders —
`archive/Dance_SuperPack/` and `archive/GenerationPack1/` — were removed
during the April 2026 archive cleanup, and the staged
`output/SampleKit_DMKIT*/` directories were dropped along with them.
The resolver code paths for those products remain (see
`src/mix-player.ts`'s product fallback table) so that user-supplied
copies of the original installer content can still be plugged in via
Milestone 5 (External Library Support).

##### 3. Row-0 columns 0/1 (formerly "`headerAux`") — resolved

The bytes at offsets 0x02–0x03 were previously documented as a separate
`headerAux` field. The decompiled VB6 source and the corrected on-disk
layout show they are simply Grid 1 cell `(row=0, col=0)` — a regular
uint16 sample ID like every other grid cell. Earlier observations
("identical files share identical aux", "aux re-appears at 16-byte
intervals", "aux often equals `firstNonZeroId`") are entirely consistent
with this: row 0 column 0 is a real placement that frequently repeats on
downbeats (rows spaced 16 bytes apart) and is naturally the first non-zero
id in any mix that uses lane 0. The parser no longer surfaces a separate
field; the value is reachable through the normal `tracks[]` array.

##### 4. Extended trailer vocabulary — resolved

A full sweep of every Gen 1 trailer for path-like strings (containing
`\`, `/`, drive letters, or `.wav` suffixes) finds **exactly one**
external sample reference across all 83 files:

```text
archive/Rave/MIX/NODRUGS.MIX  → "c:\\raveejay\\hypersav\\scool004.wav"
```

The external import mechanism is therefore real but vanishingly rare
in the shipped library. Per `project-state.md`, the
`c:\raveejay\hypersav\` directory is the Rave HyperKit user-recording
folder; the resolver should skip / ignore these references rather than
attempt a library lookup. No other mix in the corpus uses this
mechanism.

---

### Format B — Gen 2 Header + Text + Grid

Used by: Dance eJay 2, Techno eJay (Gen 2), HipHop eJay 2

```text
Offset  Size  Field
------  ----  -----
0x00    4     App identifier (uint32 LE)
0x04    4     Entry count / complexity metric (uint32 LE)
0x08    2     BPM (uint16 LE) — e.g., 140
0x0A    2     BPM2 (uint16 LE) — usually equals BPM
0x0C    2     Unknown (uint16 LE) — always 0x0000
0x0E    2     Metadata length N (uint16 LE)
0x10    N     Metadata block (null-terminated strings):
                - Author name (e.g., "MC Magic")
                - "#SKKENNUNG#:NNNNNNN" — registration/serial key
```

After the metadata block, a `0x01` tag byte separates sections.

#### Section 1: Mix Title

```text
0x10+N  1     Tag: 0x01
0x11+N  2     Title length (uint16 LE)
0x13+N  ...   Title string (null-terminated), e.g., "Take me by the Hand"
0x??    1     Tag: 0x01
```

#### Section 2: Master Volume Grid

```text
0x??    2     Padding/flags (0x00 0x00)
0x??    ...   Array of uint16 LE volume values, one per beat position.
              Values observed: 0x6800 (26624), 0xB068 (probably normalized).
              0x0000 marks empty positions.
              Additional byte flags (0x00, 0x01, 0x02) appear after each uint16,
              possibly indicating beat emphasis or automation.
```

#### Section 3: Sample Catalog (Product Packs)

A repeating structure listing available sample libraries:

```text
For each catalog entry:
  0x00  2     Padding (0x00 0x00)
  0x02  2     Name length (uint16 LE)
  0x04  ...   Product/pack name (null-terminated), e.g., "Dance eJay 2.0"
  0x??  1     Tag: 0x01
  0x??  2     Unknown (0x09 0x00)
  0x??  4     ID range start (uint32 LE), e.g., 0x07D0 = 2000
  0x??  4     ID range end (uint32 LE), e.g., 0x0D47 = 3399
```

Known catalog entries from Dance eJay 2 `START.MIX`:

| Pack Name | ID Start | ID End |
|-----------|----------|--------|
| Dance eJay 2.0 | 2000 | 3399 |
| DanceMachine Samples | 3400 | 3899 |
| DanceMachine Samplekit Vol. 1 Raps & Voices | 3900 | 4475 |
| DanceMachine Samplekit Vol. 2 Drums & Synthies | 4476 | 5011 |
| DanceMachine Samplekit Vol. 3 Space Sounds | 5012 | 5787 |
| Dance eJay Samplekit Vol. 4 House | 5800 | 6499 |
| Dance eJay Samplekit Vol. 5 Trance | 6500 | 7199 |
| Dance eJay Samplekit Vol. 6 Latin Dance | 7200 | (end) |

#### Section 4: Track Entries

After the catalog, each placed sample has a variable-length record:

```text
For each track entry:
  0x00  2     Tag/flags (includes 0x02 marker)
  0x02  2     Unknown
  0x04  1     Tag: 0x01
  0x05  2     Sample ID (uint16 LE) — matches catalog range
  0x07  2     Unknown (byte pair)
  0x09  ...   PXD filename (length-prefixed, null-terminated), e.g., "humn.9"
  0x??  1     Tag: 0x01
  0x??  2     Timeline position (int16 LE, beat offset, can be negative)
  0x??  4     Sample data length (uint32 LE)
```

Some track entries also contain **ticker text** for the UI's scrolling message
display, with text labels like "You", "can", "even", "create", "some", "funky",
"lines", "with", "your", "Groove", "generat", "or  if", "you", "want", "!!!!".

#### Format B Channel Field — Resolved (April 2026)

**Finding:** the byte currently labelled `channelByte` in `parseFormatBTracks`
(consumed at `offset += 2` immediately after the two-byte sample-ID field) is
confirmed as the **zero-indexed lane index**.

**Evidence summary (April 2026 run):** all 45 Gen 2 mixes were cross-tabbed
(Dance eJay 2, Techno eJay, HipHop eJay 2 — 453 track placements total). For
each product, every observed `channelByte` value maps to exactly one group in
the seiten Soundgruppe table, and the byte value equals the channel's zero-based
position in that table:

| Product | channelByte | seiten name (0-indexed) | Count |
|---------|------------|-------------------------|-------|
| Dance_eJay2 | 6 | rap (index 6) | 11 |
| Dance_eJay2 | 7 | voice (index 7) | 7 |
| Dance_eJay2 | 8 | effect (index 8) | 33 |
| Dance_eJay2 | 9 | xtra (index 9) | 20 |
| Dance_eJay2 | 10 | groove (index 10) | 8 |
| Dance_eJay2 | 11 | wave (index 11) | 32 |
| HipHop_eJay2 | 5 | layer (index 5) | 1 |
| HipHop_eJay2 | 6 | scratch (index 6) | 46 |
| HipHop_eJay2 | 7 | voice (index 7) | 20 |
| HipHop_eJay2 | 8 | effect (index 8) | 53 |
| HipHop_eJay2 | 9 | xtra (index 9) | 72 |

The demo mixes use only the higher-numbered channels (rap, voice, effect, …);
lower channels (loop, drum, bass, guitar, sequence, layer) are present but
receive no placements in the archived demo mixes. This accounts for the absence
of bytes 0–4 in the histogram — not a gap in the format.

**Conclusion:** no parser change is required. `track.channel = channelByte` in
`parseFormatBTracks` is already correct. The field correctly identifies the
zero-based lane index, consistent with the 17-lane Gen 2 layout
(`LANE_COUNT_BY_FORMAT.B = 17`).

---

### Format C — Gen 3 Early (Mixer State + Text Tracks)

Used by: Dance eJay 3, Dance eJay 4, HipHop eJay 3, Techno eJay 3, Xtreme eJay

```text
Offset  Size  Field
------  ----  -----
0x00    4     App identifier (uint32 LE)
0x04    4     Entry count / metadata offset (uint32 LE)
0x08    2     BPM (uint16 LE)
0x0A    2     BPM2 (uint16 LE)
0x0C    2     Unknown (uint16 LE) — always 0x0000
0x0E    2     Metadata length N (uint16 LE)
0x10    N     Metadata block:
                - Author name (null-terminated), e.g., "marc", "DJ Emzee",
                  "eJay rules", or "-" for anonymous
                - "#SKKENNUNG#:NNNNNNN" — registration key (null-terminated)
```

After metadata, `0x01` tag then a uint16 LE value followed by the title string
(null-terminated).

#### Mixer State Section

Immediately after the title, a text-encoded mixer state block begins. The format
uses `0xB0 0x5F` (`°_`) as field separators:

```text
<ControlName>#°_#<Value>%°_%
```

Repeated for all active controls. The `#` characters delimit control name and
value; `%` terminates each value; `°_` (bytes `0xB0 0x5F`) acts as the
inter-field separator.

##### Mixer Controls by Product

**Dance eJay 3** (67 unique controls):

```text
Channel controls (10 channels, 0–9):
  BOOU1_{0..9}     — Channel volume (balance fader 1)
  BOOU2_{0..9}     — Channel volume (balance fader 2)
  DrumEQ{0..9}     — Per-channel EQ level

Master boost:
  BoostCompressorDrive, BoostCompressorGain, BoostCompressorSpeed
  BoostEQ_{0..9}   — 10-band master EQ
  BoostStereoWide  — Stereo spread

Drum effects:
  DrumEcho, DrumOver (overdrive)
  DrumK_SFX_ECHOFEEDBACK, DrumK_SFX_ECHOTIME, DrumK_SFX_ECHOVOLUME
  DrumK_SFX_OVERDRIVE, DrumK_SFX_OVERFILTER

FX send levels (16 slots):
  FX_{0..15}
```

**Dance eJay 4** (79 unique controls):

All Dance 3 controls plus:

```text
  DrumChorus, DrumEchoType, DrumHall
  DrumK_CHORUSCOLOR, DrumK_CHORUSVOLUME
  DrumK_MIDSWEEPGAIN, DrumK_MIDSWEEPRANGE, DrumK_MIDSWEEPSPEED
  DrumK_SFX_REVERBPRE, DrumK_SFX_REVERBTIME, DrumK_SFX_REVERBVOLUME
  DrumMidsweep
  DrumU1_{0..9}    — Additional per-channel controls
```

**HipHop eJay 3** (60 unique controls):

Same as Dance 3, without DrumEcho, DrumOver, and the SFX sub-controls.

**Techno eJay 3** (63 unique controls):

Dance 3 controls plus: `BoostCompressorLED`, `BoostStereoLED`, `BoostEQ`.

**Xtreme eJay** (36 unique controls):

Minimal set: `BOOU1_{0..9}`, `BOOU2_{0..9}`, boost compressor/EQ/stereo,
plus unique `Style` and `VideoMix` controls.

##### Control Value Encoding

- Numeric values: `50` (default center), `500` (max), `0` (min), `1` (enabled)
- String values: `passive` (disabled), `active` (enabled)
- Values represent UI slider positions normalized to product-specific ranges

#### Sample Catalog Section

Same structure as Format B. Lists available sample packs with ID ranges.

Example from Dance 3 `start.mix`:

```text
"Dance eJay 3.0"      — main library
"HipHop eJay1"         — cross-product samples
"HipHop Samplekit Vol. 1 Breakdance"
"HipHop Samplekit Vol. 2 Unplugged"
```

**Cross-product references** are common in Gen 3 mixes. The catalog section
enumerates all products required to fully resolve the mix.

Empty catalog slots use `0x02 0x00 0x00 0x01` (marking unused pack entries).

#### Track Entry Section

For ongoing Format C/D reverse-engineering, run:

```bash
npm run mix:dump-cd -- --product Dance_eJay3
```

The command is diagnostic-only: it writes hex/field dumps to
`logs/format-cd/` and does not modify `output/` or any extraction artifacts.
Re-run it when parser heuristics for C/D records change, or when new archive
mix sets are added and need fresh offset evidence.

Two sub-formats exist within Format C, both using the same regex path scan
(`pxd32p[a-z]\.tmp`).

##### Compact track record (gap 8–12 bytes)

Used by files such as `start.mix` in Dance eJay 3 / HipHop eJay 3:

```text
[marker:     4 bytes = 02 00 00 01]
[nameLen:    2 bytes uint16 LE]   ← printable char count only (no trailer)
[name:       nameLen bytes]       ← display alias, e.g. "kick12"
[8–12 bytes  state / padding]
[pathLen:    2 bytes uint16 LE]
[leftPath:   pathLen bytes]       ← e.g. "c:\windows\TEMP\pxd32pd.tmp"
[pathLen:    2 bytes uint16 LE]
[rightPath:  pathLen bytes]       ← same as left for mono
[FF FF       record terminator]
```

Current parser recovery (validated on archive mixes):

- `beat` is recovered from signed `int16 LE` at `pathStart - 10`
  (observed compact records use `gap === 10`).
- `channel` is recovered from the temp-path suffix letter:
  `pxd32p[d..s].tmp -> lane 0..15`.
- If any guard check fails (unexpected gap, out-of-range path window, or
  invalid suffix), the parser falls back to `beat: null` / `channel: null`.

##### Big track record (gap === 40 bytes)

Used by project-save files such as `french.mix` in Dance eJay 3, confirmed
by binary analysis of `archive/Dance_eJay3/MIX/french.mix` and
cross-referenced with the decompiled VB6 save routine in
`decompiled/dance3/sample.bas`. German identifiers from disassembly:
`zeitpos` = beat index, `Spur` = lane/channel.

```text
[marker:       4 bytes = 02 00 00 01]
[nameLen:      2 bytes uint16 LE]   ← chars + 2 (includes \0\x01 trailer)
[name:         nameLen - 2 bytes]   ← product name, e.g. "Dance eJay 3.0"
[\0\x01        2-byte trailer included in nameLen count]
[18 bytes      track state block (EQ/volume data; not all zeros)]
[dataLen:      4 bytes uint32 LE]   ← sample data size
[zeitpos:      4 bytes uint32 LE]   ← beat index (pathStart − 18)
[0x00:         1 byte padding]
[Spur:         1 byte uint8]        ← lane/channel index (pathStart − 13)
[8 bytes       state block (may contain non-zero EQ bytes)]
[mystery:      2 bytes uint16]      ← purpose unknown
[pathLen:      2 bytes uint16 LE]
[leftPath:     pathLen bytes]       ← e.g. "c:\windows\TEMP\pxd32pd.tmp"
[pathLen:      2 bytes uint16 LE]
[rightPath:    pathLen bytes]
[FF FF         record terminator]
```

Total gap from `nameEnd` to `pathStart` = 40 bytes (fixed).

Verified field offsets relative to `pathStart`:

| Offset        | Field       | Type      | Example |
|---------------|-------------|-----------|---------|
| `pathStart−22`| `dataLen`   | uint32 LE | 253     |
| `pathStart−18`| `zeitpos`   | uint32 LE | 1       |
| `pathStart−14`| padding     | uint8     | 0x00    |
| `pathStart−13`| `Spur`      | uint8     | 2       |
| `pathStart−4` | mystery     | uint16 LE | varies  |
| `pathStart−2` | `pathLen`   | uint16 LE | 27      |

Secondary placements (same channel, different beat) appear after the `FF FF`
terminator in a shorter continuation format (not yet fully decoded). The
parser skips these — only the first-occurrence record per sample voice is
extracted.

---

### Format D — Gen 3 Late (Full Mixer + Drum Machine)

Used by: HipHop eJay 4, House eJay

Same header structure as Format C, but with a dramatically expanded mixer state
and integrated drum machine parameters.

#### Mixer State — Extended

**HipHop eJay 4** (503 unique controls):

```text
Per-track mixer (49 tracks):
  MixVolume{1..49}    — Track volume
  MixPan{1..49}       — Track pan
  MixMute{1..49}      — Track mute (boolean)
  MixSolo{1..49}      — Track solo (boolean)
  MixRec{1..49}       — Track record-arm (boolean)

Drum machine (16 pads):
  DrumName{1..16}     — Pad sample name (string)
  DrumNummer{1..16}   — Pad number/ID
  DrumVolume{1..16}   — Pad volume
  DrumPan{1..16}      — Pad pan (note: DrumPan1 is implicit/absent)
  DrumPitch{1..16}    — Pad pitch shift
  DrumReverse{1..16}  — Pad reverse playback (boolean)
  DrumFX{1..16}       — Pad FX assignment ("passive" or FX name)

Drum effects chain:
  DRUMchoDri, DRUMchoLED, DRUMchoSpe              — Chorus
  DRUMech{1,2,3,5}, DRUMechFee, DRUMechLED,
    DRUMechTim, DRUMechVie, DRUMechVol             — Echo/delay
  DRUMequ{1,2,3}, DRUMequLED, DRUMequU1, DRUMequU2 — EQ
  DRUMmidLED, DRUMmidMod, DRUMmidRes, DRUMmidSpe  — Mid-sweep
  DRUMoveDri, DRUMoveFil, DRUMoveLED               — Overdrive
  DRUMrev{1..5}, DRUMrevLED, DRUMrevPre,
    DRUMrevtim, DRUMrevVol                          — Reverb
  DRUMvolume                                        — Drum master volume

FX chain (same params as drum, with FX prefix):
  FXchoDri, FXchoLED, FXchoSpe                     — Chorus
  FXech{1,2,3,5}, FXechFee, FXechLED, FXechTim,
    FXechVie, FXechVol                              — Echo
  FXequ{1,2,3}, FXequLED, FXequU1, FXequU2         — EQ
  FXharLED, FXhar{M5,M8,P4,P5,P8}                  — Harmonizer
  FXmidLED, FXmidMod, FXmidRes, FXmidSpe           — Mid-sweep
  FXorgGro, FXorgNam, FXorgSam                      — Organ/groove
  FXoveDri, FXoveFil, FXoveLED                      — Overdrive
  FXrev{1..5}, FXrevLED, FXrevPre, FXrevtim, FXrevVol — Reverb
  FXsemiTones                                        — Pitch transpose
  FXtraLED, FXtraPit                                 — Transposer
  FXvocCon, FXvocLED, FXvocTon                       — Vocoder
  FXvolume                                           — FX master volume
  FXcarNam, FXcarSam                                 — Carrier sample

Master boost:
  BO_COMP_DRIVE_SCROLL, BO_COMP_GAIN_SCROLL,
    BO_COMP_LED, BO_COMP_SPEED_SCROLL               — Compressor
  BO_Equalizer{0..9}                                 — 10-band EQ
  BO_EQUALIZER_{1,2,3}, BO_EQUALIZER_LED,
    BO_EQUALIZER_USER_{EINS,ZWEI}, BO_EinsEQvalue,
    BO_ZweiEQvalue                                   — EQ presets
  BO_STEREOWIDE_LED, BO_STEREOWIDE_SPREAD_SCROLL     — Stereo
  BOcom{Dri,Gai,LED,Spe}, BOequ{1,2,3,LED,U1,U2},
    BOste{LED,Spr}                                   — Short aliases

  DP_Equalizer{0..9}                                 — Display EQ

Globals:
  MainPitch, MA_PITCH                                — Master pitch
  LastButton, LastSpecial                             — UI state
```

**House eJay** (311 unique controls):

Same structure as HipHop 4 but with 25 mixer tracks (MixVolume{1..25}) and
10 drum pads instead of 16. Also includes `DM_METRONOME` control and
`FX_ZweiEQvalue`.

#### Track Entries — Extended

Format D track entries are similar to Format C, but each sample placement
includes drum machine per-pad state:

```text
  DrumPan1#°_#50%°_%
  DrumVolume1#°_#500%°_%
  DrumPitch1#°_#0%°_%
  DrumFX1#°_#passive%°_%
  DrumReverse1#°_#passive%°_%
  DRUMchoLED#°_#passive%°_%
  ...
```

This means each mix file snapshot captures the complete drum machine kit
configuration, not just the timeline placement.

> **Timeline rendering limitation**: Format D has the same null beat/channel
> problem as Format C.

Status update (April 2026): this limitation has been lifted. Format D now uses
the same compact-record recovery strategy as Format C:

- `beat = int16 LE(pathStart - 10)`
- `channel = pxd32p[d..s].tmp letter index`

Guarded fallback remains in place for malformed records.

---

## Sample Reference Resolution

### Resolution Chain

```text
MIX file sample ref → match method → metadata.json → output/*.wav
```

The match method varies by format:

| Format | Primary Reference | Match Strategy |
|--------|-------------------|----------------|
| A | uint16 sample ID | Map via Gen 1 bank directory structure + Pxddance catalog |
| B | PXD filename string | Match against `metadata.json[].id` or filename |
| C | Display name string | Match against `metadata.json[].alias` |
| D | Display name string | Match against `metadata.json[].alias` |

### Cross-Product Sample Libraries

Gen 2/3 MIX files can reference samples from multiple products. The catalog
section enumerates which products are needed:

**Dance eJay 2 `START.MIX` catalogs:**

- Dance eJay 2.0 (main library, IDs 2000–3399)
- DanceMachine Samples (IDs 3400–3899)
- DanceMachine Samplekit Vol. 1–3
- Dance eJay Samplekit Vol. 4–6

**Dance eJay 3 `minimalist.mix` catalogs:**

- Dance eJay 3.0 (main library)
- HipHop eJay1
- HipHop Samplekit Vol. 1 Breakdance
- HipHop Samplekit Vol. 2 Unplugged

**Resolution strategy**: Search across all `output/*/metadata.json` files,
keyed by the product name listed in the catalog, then by display name or
internal filename within that product's metadata.

### Gen 1 Sample ID Mapping (Unresolved)

Gen 1 files use raw uint16 IDs with no accompanying text. The mapping from
these IDs to PXD bank/file positions requires:

1. Enumerate all PXD files in each bank directory (AA→BW) for Dance 1
2. Build an ordered list: `bank_index × files_per_bank + file_index = sample_id`
3. Validate against the Pxddance binary catalog which maps bank/position to
   category and alias names
4. Cross-reference with known demo mix content (e.g., the "WELCOME" mix ships
   with every product and should produce recognizable audio)

---

## Channel/Track Layout per Product

Derived from `seiten` application config files:

### Soundgruppe Tab Mapping (from seiten)

**Dance eJay 2** (12 channels):

```text
01: loop       05: sequence    09: effect
02: drum       06: layer       10: xtra
03: bass       07: rap         11: groove
04: guitar     08: voice       12: wave
```

**Dance eJay 3** (13 channels):

```text
01: loop       05: sequence    09: effect     13: (OnOff button)
02: drum       06: groove      10: xtra
03: bass       07: rap         11: layer
04: guitar     08: voice       12: wave
```

**Dance eJay 4**: Same as Dance 3

**HipHop eJay 2** (10 channels):

```text
01: loop       04: guitar      07: scratch     10: xtra
02: drum       05: sequence    08: voice
03: bass       06: layer       09: effect
```

**HipHop eJay 3**: Same layout as Dance 3 with scratch track support

**Techno eJay 3** (10 channels via seiten):

```text
01: loop       04: keys        07: effect     10: wave
02: drum       05: sphere      08: xtra
03: bass       06: voice       09: hyper
```

**Xtreme eJay**: Uses a different seiten structure (`:Soundgruppen` + `EJAY00`),
with `G_PREVIEW` and `B_FULLSCREEN` controls. Channel layout from INF: Loop,
Drum, Bass, Guitar, Seq, Voice, Effect, Xtra.

### Mixer Track Counts (from control analysis)

| Product | Mixer Tracks | Drum Pads | FX Slots | Control Naming |
|---------|-------------|-----------|----------|----------------|
| Dance 3 | 10 (BOOU) | 0 | 16 (FX_) | BOOU1/2_{N}, DrumEQ{N} |
| Dance 4 | 10 (BOOU) | 0 | 5 (FX_) | BOOU1/2_{N}, DrumEQ{N}, DrumU1_{N} |
| HipHop 3 | 10 (BOOU) | 0 | 16 (FX_) | BOOU1/2_{N}, DrumEQ{N} |
| HipHop 4 | 49 (MixVolume) | 16 (DrumName) | Full chain | MixVolume{N}, DrumName{N} |
| House | 25 (MixVolume) | 10 (DrumName) | Full chain | MixVolume{N}, DrumName{N} |
| Techno 3 | 10 (BOOU) | 0 | 16 (FX_) | BOOU1/2_{N}, DrumEQ{N} |
| Xtreme | 10 (BOOU) | 0 | 0 | BOOU1/2_{N} only |

---

## Format Auto-Detection Algorithm

```text
if file size < 4 bytes: return UNKNOWN (skip)

read uint32 LE at offset 0 → app_id

if app_id in [0x0A06, 0x0A07, 0x0A08]:
    # Format A — caller must supply productHint so the parser
    # knows the implicit BPM and channel layout.
    return Format A

if file contains "#SKKENNUNG#":
    if file contains "MixVolume" or "DrumPan":
        return Format D
    elif file contains "BOOU" or "DrumEQ":
        return Format C
    else:
        return Format B

return UNKNOWN
```

O(1) for the initial check and O(n) for the string-scan fallback. In practice
a single `indexOf` over the first ~200 bytes for `SKKENNUNG` and the first
~1000 bytes for `MixVolume`/`BOOU` is sufficient.

---

## Proposed Compatibility Abstraction Layer

### Architecture Overview

```text
┌────────────────┐     ┌──────────────┐     ┌─────────────┐
│  Format A/B/C/D │ ──► │  MIX Parser  │ ──► │   MixIR     │
│  .mix binary    │     │  (per-format)│     │  (unified)  │
└────────────────┘     └──────────────┘     └──────┬──────┘
                                                    │
                       ┌──────────────┐             │
                       │ Sample Index │◄────────────┘
                       │ (data/index  │  resolve sample refs
                       │  .json +     │  to output WAV paths
                       │ metadata.json│
                       └──────────────┘
                                │
                       ┌────────▼────────┐
                       │  Web Audio API  │
                       │  Playback Engine│
                       └─────────────────┘
```

### MixIR Schema (TypeScript)

```typescript
interface MixIR {
  format: 'A' | 'B' | 'C' | 'D';
  product: string;                    // e.g., "Dance_eJay2"
  appId: number;                      // uint32 from offset 0x00
  bpm: number;                        // beats per minute
  bpmAdjusted: number | null;         // BPM2 if different from BPM
  author: string | null;              // null for Format A
  title: string | null;               // null for Format A
  registration: string | null;        // SKKENNUNG key

  tracks: TrackPlacement[];           // all sample placements on the timeline
  mixer: MixerState;                  // normalized mixer settings
  drumMachine: DrumMachineState | null; // only Format D
  tickerText: string[];               // scrolling text messages (Format B only)
  catalogs: CatalogEntry[];           // referenced sample packs
}

interface CatalogEntry {
  name: string;                       // e.g., "Dance eJay 2.0"
  idRangeStart: number;               // first sample ID in this pack
  idRangeEnd: number;                 // last sample ID in this pack
}

interface TrackPlacement {
  beat: number;                       // timeline position (0-indexed beat)
  channel: number;                    // track/row index (0-indexed)
  sampleRef: SampleRef;               // resolved sample reference
  volume: number;                     // 0.0–1.0 normalized
  pan: number;                        // -1.0 (L) to 1.0 (R)
  muted: boolean;
}

interface SampleRef {
  rawId: number;                      // original uint16 from the grid
  internalName: string | null;        // PXD filename (e.g., "D5MA060")
  displayName: string | null;         // human name (e.g., "kick28")
  resolvedPath: string | null;        // output WAV path or null if unmapped
  product: string;                    // which product's sample library
  category: string | null;            // channel/category (e.g., "drum")
}

interface MixerState {
  masterVolume: number;
  channels: ChannelState[];           // per-track mixer state
  eq: number[];                       // 10-band master EQ (0–100 per band)
  compressor: CompressorState | null;
  stereoWide: number | null;          // stereo spread (0–100)
}

interface ChannelState {
  index: number;
  volume: number;                     // normalized 0.0–1.0
  pan: number;                        // -1.0 to 1.0
  eq: number;                         // per-channel EQ level
  muted: boolean;
  solo: boolean;
}

interface CompressorState {
  drive: number;
  gain: number;
  speed: number;
  enabled: boolean;
}

interface DrumMachineState {
  pads: DrumPad[];                    // 10 (House) or 16 (HipHop 4) pads
  effects: DrumEffectsChain;
  masterVolume: number;
}

interface DrumPad {
  index: number;                      // 1-based pad number
  name: string;                       // display name
  sampleRef: SampleRef | null;
  volume: number;                     // 0–1000 → normalized 0.0–1.0
  pan: number;                        // 0–100 → -1.0 to 1.0
  pitch: number;                      // semitone offset
  reversed: boolean;
  fx: string;                         // "passive" or FX routing name
}

interface DrumEffectsChain {
  chorus: { drive: number; speed: number; enabled: boolean };
  echo: {
    time: number; feedback: number; volume: number;
    type: number; enabled: boolean;
  };
  eq: { low: number; mid: number; high: number; enabled: boolean };
  midsweep: { modulation: number; resonance: number; speed: number; enabled: boolean };
  overdrive: { drive: number; filter: number; enabled: boolean };
  reverb: {
    preDelay: number; time: number; volume: number;
    type: number; enabled: boolean;
  };
}
```

### Current Implementation Touchpoints

The current codebase splits MIX support across a focused set of tooling,
browser runtime, and test files:

| File | Role |
|------|------|
| `scripts/mix-parser.ts` | Node entry point that re-exports the canonical browser parser for offline analysis, golden tests, and CLI tooling. |
| `scripts/mix-resolver.ts` | Resolves parsed `SampleRef` values against normalized output metadata and Gen 1 catalogs. |
| `src/mix-buffer.ts` / `src/mix-parser.ts` | Browser-safe parsing path used after fetching `.mix` bytes from the UI. |
| `src/mix-player.ts` | `MixIR -> MixPlaybackPlan` builder plus browser-side sample lookup and Web Audio host/effect primitives. |
| `src/mix-file-browser.ts` | Archive-tree `.mix` picker, metadata tooltip/popup, and file-source abstraction for DEV/FSA/file-input flows. |
| `src/data.ts`, `src/main.ts`, `src/render/home.ts` | `mixLibrary` / `sampleIndex` data model, mix selection flow, sequencer rendering, and transport wiring. |
| `scripts/build-index.ts` | Scans archive MIX folders and emits `mixLibrary` entries into `data/index.json`. |
| `vite.config.ts` | Serves `/mix/<product>/<filename>` in dev and copies MIX files into `dist/mix/` for builds. |
| `tests/mix-playback.spec.ts`, `scripts/__tests__/mix-golden.test.ts`, and `scripts/__tests__/mix-resolver-parity.test.ts` | End-to-end, golden-file, and resolver-parity regression coverage for MIX loading and parsing. |

When mixer parameters or legacy effects cannot be reproduced exactly, the
runtime should degrade gracefully: ignore unsupported controls, keep parsing
or loading alive, and surface the gap in diagnostics rather than failing hard.

### Current Browser Playback Contract

The browser runtime consumes `MixIR` through `buildMixPlaybackPlan(...)` and
applies the following rules:

| Concern | Current behavior |
|---------|------------------|
| Timeline position | `track.beat` becomes the event beat when present; missing positions fall back to beat `0`. |
| Lane assignment | `track.channel` becomes `lane-<index>`; missing channels fall back to `track-<placement index>`. |
| Loop length | `loopBeats = max(event.beat) + 1`, with a minimum of `1`. |
| Sample lookup | Browser lookup order is product -> catalog hints -> product fallbacks -> `resolvedPath`, using `data/index.json.sampleIndex` maps (`bySampleId`, `byInternalName`, `byAlias`, `byStem`, `bySource`). |
| Missing audio | Missing references remain visible as dashed blocks and play silence. The timeline transport still runs and auto-scrolls. |
| Decode strategy | WAVs are fetched and decoded only on Play, then cached in memory per URL for repeat plays. |

### Player-Relevant Field Inventory by Format

| Format | Fields currently good enough for browser playback | Still incomplete / placeholder |
|--------|---------------------------------------------------|--------------------------------|
| **A** | `appId`, `bpm`, grid-derived `beat`, grid-derived `channel`, `rawId`, catalog metadata. | Browser-side Gen 1 sample resolution still depends on source-path / catalog parity work; unsupported trailer-only references remain silent. |
| **B** | `appId`, `bpm`, `beat`, `channel`, `rawId`, `internalName`, title/author/catalogs/ticker text. | Mixer/effect reproduction is still partial; browser resolution is only as good as `sampleIndex` coverage. |
| **C** | `appId`, `bpm`, title/author/catalogs, `displayName`/`internalName`, mixer raw text, recovered `beat`/`channel` for compact and big records. | Mixer/effect reproduction is still partial; continuation-record nuances are still simplified. |
| **D** | `appId`, `bpm`, title/author/catalogs, mixer raw text, drum-machine state, recovered `beat`/`channel`, `displayName`/`internalName`. | Drum-machine and mixer parameters are parsed but not yet reproduced faithfully in the browser transport. |

The largest currently measured archive mix is `archive/HipHop 4/MIX/monochroid.mix`
(23,721 bytes). A local timing baseline run in April 2026 showed fast parse
and plan times; timeline coordinates are now recovered for Format C/D, while
sample resolution quality still depends on alias/catalog coverage.

---

## Key Risks & Unknowns

| Risk | Severity | Mitigation |
|------|----------|------------|
| Gen 1 sample ID→WAV mapping is unverified | ~~**High**~~ **Resolved** | Every Gen 1 product ships a plain-text `MAX` catalog where line N = sample ID N. Parsed by `scripts/gen1-catalog.ts`; see [file-formats.md](file-formats.md#gen-1-sample-id-catalogs-max-pxddance-pxdtxt). |
| Grid dimensions for Format A are empirical | ~~**Medium**~~ **Resolved** | Confirmed via `scripts/mix-grid-analyzer.ts` (83 Gen 1 `.mix` files) and cross-checked against the decompiled VB6 source: 2-byte header (uint16 app sig only), two back-to-back 8×351 uint16 LE grids, `uint16 0x0A08` trailer marker at offset 11234. Row count 351 is deterministic — Dance 1 hardcodes `Me[0x492] = 0x15E`; Rave and HipHop 1 produce the same on-disk extent. `locateGridTrailer` is retained only for short/synthetic test buffers. |
| Format A HipHop ID overflow (max id exceeds MAX catalog size) | **Medium** | HipHop 1 mixes occasionally reference ids beyond the base MAX catalog. Historically resolved through the SuperPack / Generation Pack 1 expansion kits (`DMKIT1` / `DMKIT2` / `SpaceSounds`); those source folders are no longer in the archive after the April 2026 cleanup, so the overflow ids resolve to unknown samples until Milestone 5 reintroduces the expansion catalogs through external library support. |
| Format A Grid 2 (uint16 @ 0x15F2–0x2BE1) semantics | **Low** | Sparse and small-valued (max ≤ 12 across all sampled mixes); never overlaps Grid 1 cell values; frequently entirely zero; dominated by multiples of 4 (2, 4, 8, 12). Cross-product analysis of 8 mixes confirms it is a per-cell duration/variant override — `0` means natural length, non-zero extends the cell. Exact unit (rows vs beats vs 1/8-bar) unconfirmed. The parser surfaces it as the opaque `formatAGrid2` IR field; default `durationOverride = 0` is safe for all current playback. |
| External WAV reference in Rave/NODRUGS.MIX trailer | ~~**Low**~~ **Resolved** | Contains literal `c:\raveejay\hypersav\scool004.wav`. This is a user-recorded sound (Rave HyperKit = user save directory), not a commercial sample kit. The `.mix` player should silently skip `hypersav` path references and play silence for that cell. |
| Gen 2 track record format has variable-length fields | **Medium** | Parse opportunistically using `0x01` tags and string length prefixes. Use STEP.MIX (1,553 bytes, smallest file) as the reference implementation. |
| Cross-product sample resolution may require fuzzy matching | **Low** | Catalog sections enumerate required products. Start with exact-match by display name. Fall back to substring/Levenshtein if needed. |
| BPM2 field differs from BPM in HipHop 2/3 | **Low** | Investigate whether BPM2 is user-adjusted tempo. Default to BPM1 for playback; expose both in MixIR. |
| Ticker text (Format B) has no audio equivalent | **Low** | Preserve in MixIR for display purposes. Render as subtitle overlay in the UI. |
| SuperPack Gen 1+ files may have extended grid | ~~**Low**~~ **Resolved** | Historical concern from when SuperPack mixes were in the archive (`dream.mix` 11,413 B, `Mcxtreme.mix` 11,277 B). Both grids are now known to be deterministic (8 × 351 uint16 LE each), so any bytes past offset 0x2BE2 are guaranteed trailer metadata, never extended grid data. SuperPack source removed during the April 2026 archive cleanup; resolution preserved for the record. |
| Empty .mix file in Dance 4 | **None** | Skip 2-byte files during parsing. |
| Oversized .mix file (> 100 KB) contains embedded audio | **Low** | No shipped library mix exceeds 23,721 bytes. Files above ~100 KB are assumed to carry in-band PCM data from the eJay HyperKit recording workflow. Parse the header and text sections normally, then run `npm run mix:extract-embedded` to recover the WAV payloads into `output/Unsorted/embedded mix`; unresolved references should degrade gracefully rather than failing. |
| Format C/D `beat`/`channel` are always `null` — timeline rendering blocked | ~~**High (Milestone 3 blocker)**~~ **Resolved** | Compact C and Format D now recover `beat` from `int16 LE(pathStart-10)` and `channel` from `pxd32p[d..s].tmp` suffix mapping; big C (`gap===40`) keeps native `zeitpos`/`Spur` offsets. Guarded null fallback remains for malformed records. |

---

## Raw Hex Samples (Reference)

### Format A — Dance eJay 1 `START.MIX` (first 256 bytes)

```text
0000: 06 0A 00 00 A2 04 CF 04 00 00 00 00 00 00 00 00
0010: 00 00 00 00 00 00 CF 04 00 00 00 00 00 00 00 00
0020: 00 00 00 00 00 00 CF 04 7F 07 00 00 00 00 CD 03
0030: CE 03 00 00 00 00 CF 04 00 00 00 00 00 00 00 00
0040: 00 00 00 00 00 00 CF 04 7F 07 00 00 00 00 00 00
0050: 00 00 00 00 00 00 CF 04 00 00 00 00 00 00 00 00
0060: 00 00 41 03 00 00 CF 04 7F 07 00 00 00 00 00 00
0070: 00 00 00 00 00 00 CF 04 00 00 00 00 00 00 00 00
0080: 00 00 41 03 00 00 CF 04 7F 07 00 00 7F 04 00 00
0090: 00 00 00 00 00 00 CF 04 00 00 00 00 00 00 00 00
00A0: 00 00 41 03 47 03 CF 04 7F 07 BF 06 00 00 CD 03
00B0: CE 03 00 00 00 00 CF 04 00 00 00 00 00 00 00 00
00C0: 00 00 41 03 47 03 CF 04 7F 07 C0 06 00 00 00 00
00D0: 00 00 00 00 00 00 CF 04 00 00 00 00 00 00 00 00
00E0: 00 00 41 03 47 03 CF 04 7F 07 BF 06 00 00 00 00
00F0: 00 00 00 00 00 00 CF 04 00 00 00 00 00 00 00 00
```

### Format B — Dance eJay 2 `STEP.MIX` (first 128 bytes)

```text
0000: 19 0A 00 00 1B 00 00 00 8C 00 8C 00 00 00 1E 00  ................
0010: 4D 43 20 4D 61 67 69 63 00 23 53 4B 4B 45 4E 4E  MC Magic.#SKKENN
0020: 55 4E 47 23 3A 30 30 30 30 30 30 30 00 01 0C 00  UNG#:0000000....
0030: 44 75 63 6B 20 44 61 6E 63 65 00 01 00 00 E3 58  Duck Dance.....X
0040: 00 00 B0 68 00 00 B0 68 00 00 B0 68 00 00 B0 68  ...h...h...h...h
0050: 00 00 B0 68 00 00 B0 68 00 00 B0 68 00 00 B0 68  ...h...h...h...h
0060: 00 00 B0 68 01 00 B0 68 02 00 B0 68 01 00 B0 68  ...h...h...h...h
0070: 02 00 B0 68 01 00 B0 68 02 00 B0 68 00 00 00 00  ...h...h...h....
```

### Format C — Dance eJay 3 `start.mix` (first 128 bytes)

```text
0000: 71 25 00 00 57 00 00 00 8C 00 8C 00 00 00 1A 00  q%..W...........
0010: 6D 61 72 63 00 23 53 4B 4B 45 4E 4E 55 4E 47 23  marc.#SKKENNUNG#
0020: 3A 30 30 30 30 30 30 30 00 01 FB 04 44 61 6E 63  :0000000....Danc
0030: 65 20 65 4A 61 79 20 33 20 44 65 6D 6F 20 4D 69  e eJay 3 Demo Mi
0040: 78 00 42 4F 4F 55 23 B0 5F 23 31 25 B0 5F 25 42  x.BOOU#._#1%._%B
0050: 4F 4F 55 31 5F 30 23 B0 5F 23 35 30 25 B0 5F 25  OOU1_0#._#50%._%
0060: 42 4F 4F 55 32 5F 30 23 B0 5F 23 35 30 25 B0 5F  BOOU2_0#._#50%._
0070: 25 44 72 75 6D 45 51 30 23 B0 5F 23 35 30 25 B0  %DrumEQ0#._#50%.
```

### Format D — HipHop eJay 4 `start.mix` (first 128 bytes)

```text
0000: DC 15 00 00 8B 00 00 00 5A 00 5A 00 00 00 26 00  ........Z.Z...&.
0010: 6C 61 62 6F 72 64 61 2D 67 6F 6E 7A 61 6C 65 73  laborda-gonzales
0020: 00 23 53 4B 4B 45 4E 4E 55 4E 47 23 3A 30 30 30  .#SKKENNUNG#:000
0030: 30 30 30 30 00 01 0E 2E 6E 6F 74 68 69 6E 67 62  0000....nothingb
0040: 75 74 43 52 41 50 00 44 72 75 6D 50 61 6E 31 23  utCRAP.DrumPan1#
0050: B0 5F 23 35 30 25 B0 5F 25 44 72 75 6D 56 6F 6C  ._#50%._%DrumVol
0060: 75 6D 65 31 23 B0 5F 23 35 30 30 25 B0 5F 25 44  ume1#._#500%._%D
0070: 72 75 6D 50 69 74 63 68 31 23 B0 5F 23 30 25 B0  rumPitch1#._#0%.
```
