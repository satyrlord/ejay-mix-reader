#!/usr/bin/env python3
"""
reorganize.py — Reorganize extracted eJay samples into channel-based folder structure.

Reads metadata.json files produced by pxd_parser.py and moves WAV files into
per-channel subfolders (Drum, Bass, Guitar, Loop, Seq, Layer, Rap, Voice, Effect, Xtra)
based on the internal filename prefix encoded in each sample's `internal_name` field.

Usage:
    python tools/reorganize.py output/Dance_eJay2
    python tools/reorganize.py output/Dance_eJay2 --dry-run
"""

import argparse
import json
import os
import re
import shutil

# Maps the type code embedded in internal filenames to eJay channel tabs.
#
# Dance eJay 2 pattern:  D<digit><CODE><seq>          e.g. D5MA060   → code MA
# Dance eJay 4 pattern:  DA<CODE><variant><seq>        e.g. DAGAX022  → code GA
# Xtreme eJay pattern:   X<pack><CODE>X<pack><seq>    e.g. XABTXA001 → code BT
# HipHop 2 / Gen 3 pattern: <CODE><seq>               e.g. GA019     → code GA
#
# Shared codes (BS, GT, FX, DA, DB, DC, DD, DF, LA, EX) work across products.
CHANNEL_MAP: dict[str, str] = {
    # ── Drum machine hits ─────────────────────────────────────────────────────
    "MA": "Drum",   # kicks / lead hits
    "MB": "Drum",   # snares
    "MC": "Drum",   # hi-hats
    "MD": "Drum",   # mutes / cymbals
    "ME": "Drum",   # world/ethnic percussion
    "MF": "Drum",   # toms
    "MG": "Drum",   # misc hits
    # Drum beat loops
    "DA": "Drum",
    "DB": "Drum",
    "DC": "Drum",
    "DD": "Drum",
    "DE": "Drum",   # perc / toms (Dance 3, HipHop 2, Dance 4 via DA prefix)
    "DF": "Drum",
    # HipHop 2 drum hits
    "GA": "Drum",   # kick
    "GB": "Drum",   # snare (HH2) / kick (HH3) — all map to Drum
    "GC": "Drum",   # hi-hat (HH2) / cymbal (HH3)
    "GCA": "Drum",  # cymbals
    "GDA": "Drum",  # shakers
    "GDB": "Drum",  # claps
    "GDC": "Drum",  # wood blocks
    "GDD": "Drum",  # bells
    "GDE": "Drum",  # percussion
    # Gen 3 drum variants (HipHop 3, Dance 4 via DA prefix, House)
    "GD": "Drum",   # cymbals (Dance 4 GAX/GBX scheme)
    "GE": "Drum",   # perc (Dance 4, House)
    "GF": "Drum",   # drum FX
    "GS": "Drum",   # snare (HipHop 3)
    "GH": "Drum",   # hi-hat (HipHop 3)
    "GP": "Drum",   # perc (HipHop 3)
    # ── Bass ──────────────────────────────────────────────────────────────────
    "BS": "Bass",
    # ── Guitar / riffs ────────────────────────────────────────────────────────
    "GT": "Guitar",
    # ── Audio loops ───────────────────────────────────────────────────────────
    "LA": "Loop",
    "LC": "Loop",
    "HS": "Loop",   # House eJay main loop bank
    "BT": "Loop",   # Xtreme eJay beat loops
    # ── Layered / atmospheric pads ────────────────────────────────────────────
    "LY": "Layer",
    "SR": "Layer",  # strings / pads (Dance 4, Techno 3)
    # ── Sequenced melodies ────────────────────────────────────────────────────
    "SQ": "Seq",
    "HA": "Seq",    # harmonic sequences (Dance 4, Techno 3)
    "HB": "Seq",
    "HM": "Seq",
    "HX": "Seq",
    # ── Rap ───────────────────────────────────────────────────────────────────
    "RP": "Rap",
    "ZZ": "Rap",
    "RM": "Rap",
    "RN": "Rap",
    "VX": "Rap",    # extended rap vocals (HipHop 3, Techno 3)
    # ── Vocals ────────────────────────────────────────────────────────────────
    "VA": "Voice",   # House eJay vocal pack A
    "VB": "Voice",   # House eJay vocal pack B
    "VC": "Voice",
    "VF": "Voice",
    "VM": "Voice",
    # ── Sound effects ─────────────────────────────────────────────────────────
    "FX": "Effect",
    # ── Saxophone ──────────────────────────────────────────────────────────────
    "SX": "Xtra",    # House eJay saxophone loops
    # ── Keys / melodic instruments ────────────────────────────────────────────
    "PN": "Keys",   # piano
    "ON": "Keys",   # organ
    "SY": "Keys",   # synthesizer
    "KY": "Seq",    # Xtreme eJay sequences (field8=5 → sequence tab)
    # ── Scratch loops ─────────────────────────────────────────────────────────
    "ST": "Scratch",
    "RX": "Scratch",
    "SRC": "Scratch",  # HipHop 3 scratch loops (longer than SR → beats Layer match)
    # ── Wave (full-spectrum loops) ────────────────────────────────────────────
    "EY": "Wave",
    # ── Techno eJay HYP stem names (BASS001, KICK001, etc.) ───────────────────
    "BASS": "Bass",
    "KICK": "Drum",
    "SNARE": "Drum",
    "HIHAT": "Drum",
    "CLAP": "Drum",
    "PERC": "Drum",
    "SYNTH": "Keys",
    "ROBOT": "Xtra",
    # ── Extra / misc instruments ──────────────────────────────────────────────
    "EX": "Xtra",
}

# Keywords in the INF category field → channel.  Used as fallback when the
# internal name prefix is too generic (e.g. all-'T' Techno 1, 'HIPHOP' HH4).
# Order matters: more specific / longer patterns are checked first.
_CATEGORY_HINTS: list[tuple[str, str]] = [
    ("drum loop", "Drum"),
    ("drum",      "Drum"),
    ("kick",      "Drum"),
    ("snare",     "Drum"),
    ("hihat",     "Drum"),
    ("hi-hat",    "Drum"),
    ("hihats",    "Drum"),
    ("clap",      "Drum"),
    ("cymbal",    "Drum"),
    ("perc",      "Drum"),
    ("bass",      "Bass"),
    ("guitar",    "Guitar"),
    ("scratch",   "Scratch"),
    ("loop",      "Loop"),
    ("piano",     "Keys"),
    ("organ",     "Keys"),
    ("synth",     "Keys"),
    ("chord",     "Keys"),
    ("melody",    "Keys"),
    ("arp",       "Keys"),
    ("keys",      "Keys"),
    ("string",    "Layer"),
    ("pad",       "Layer"),
    ("fx",        "Effect"),
    ("effect",    "Effect"),
    ("rap",       "Rap"),
    ("vox",       "Voice"),
    ("voice",     "Voice"),
    ("vocal",     "Voice"),
    ("seq",       "Seq"),
]

# Regex: Dance eJay 2 — D<digit><CODE><seq>  e.g. D5MA060 → MA
_D5_RE = re.compile(r"^[A-Z]\d([A-Z]+)\d+", re.IGNORECASE)
# Regex: Dance eJay 4 — DA<2-letter-code>…  e.g. DAGAX022 → GA, DALAA001 → LA
_DA_RE = re.compile(r"^DA([A-Z]{2})", re.IGNORECASE)
# Regex: Xtreme eJay — X<pack><2-letter-code>X<pack>  e.g. XABTXA001 → BT
_X_RE = re.compile(r"^X[A-Z]([A-Z]{2})X[A-Z]", re.IGNORECASE)
# Regex: House eJay — HS<digit><pack><CODE><seq>  e.g. HS1AEX001 → EX
_HS_RE = re.compile(r"^HS\d[A-F]([A-Z]{2,})\d", re.IGNORECASE)
# Regex: HipHop 4 — HIPHOP_<CODE><seq>  e.g. HIPHOP_BASS001_90_A_H6 → BASS
_HH4_RE = re.compile(r"^HIPHOP_([A-Z]+)\d", re.IGNORECASE)
# Regex: direct prefix — leading letters before first digit  e.g. GDE046 → GDE
_PFX_RE = re.compile(r"^([A-Z]+)\d+", re.IGNORECASE)

# HipHop 4 channel map — HIPHOP_<CODE> → channel name.
# Codes extracted from the HIPHOP_XXX internal name scheme.
_HH4_CHANNEL_MAP: dict[str, str] = {
    "LOOP": "Loop",
    "DRUMA": "Drum",
    "DRUMB": "Drum",
    "DRUMC": "Drum",
    "DRUMD": "Drum",
    "DRUME": "Drum",
    "GA": "Drum",      # kicks
    "GB": "Drum",      # snares
    "GC": "Drum",      # hats
    "GD": "Drum",      # cymbals
    "GE": "Drum",      # percussion
    "GF": "Drum",      # drum extras
    "BASS": "Bass",
    "SYNTH": "Keys",
    "PIANO": "Keys",
    "ORGAN": "Keys",
    "GUITAR": "Guitar",
    "FEMALE": "Ladies",
    "MALE": "Fellas",
    "FX": "Effect",
    "EXTRA": "Xtra",
    "SCRATCH": "Scratch",
}


def get_channel(internal_name: str, category: str = "") -> str:
    """Return the eJay channel folder for a sample, or 'Xtra' if unknown.

    Args:
        internal_name: The internal filename from the INF catalog (e.g. 'D5MA060',
                       'DAGAX022', 'XABTXA001', 'GA019').
        category:      The display category from the INF catalog.  Used as a
                       fallback when the prefix is too generic (e.g. 'T', 'HIPHOP').
    """
    name = internal_name.upper()

    # 1. HipHop 4 — HIPHOP_<CODE>: HIPHOP_BASS001_90_A_H6 → BASS
    m = _HH4_RE.match(name)
    if m:
        return _HH4_CHANNEL_MAP.get(m.group(1).upper(), "Xtra")

    # 2. House eJay — HS<digit><pack><CODE>: HS1AEX001 → EX (Groove in HS context)
    m = _HS_RE.match(name)
    if m:
        code = m.group(1).upper()
        if code == "EX":
            return "Groove"
        return CHANNEL_MAP.get(code, "Xtra")

    # 3. Dance eJay 2 — D<digit><CODE><seq>: D5MA060 → MA
    m = _D5_RE.match(name)
    if m:
        return CHANNEL_MAP.get(m.group(1), "Xtra")

    # 3. Dance eJay 4 — DA<2-letter code>: DAGAX022 → GA, DABSH001 → BS
    m = _DA_RE.match(name)
    if m:
        return CHANNEL_MAP.get(m.group(1).upper(), "Xtra")

    # 4. Xtreme eJay — X<pack><2-letter code>X<pack>: XABTXA001 → BT
    m = _X_RE.match(name)
    if m:
        return CHANNEL_MAP.get(m.group(1).upper(), "Xtra")

    # 5. Direct prefix — longest match (handles GDE, GCA, GDA, GDB, GDC, GDD)
    m = _PFX_RE.match(name)
    if m:
        code = m.group(1)
        for length in range(len(code), 0, -1):
            sub = code[:length]
            if sub in CHANNEL_MAP:
                return CHANNEL_MAP[sub]

    # 7. Category-keyword fallback (used for all-T Techno 1)
    if category:
        cat = category.lower()
        for hint, channel in _CATEGORY_HINTS:
            if hint in cat:
                return channel

    return "Xtra"


def collect_metadata(product_dir: str) -> list[tuple[str, dict]]:
    """
    Walk product_dir for metadata.json files and return a flat list of
    (source_subdir, sample_record) tuples.
    """
    records: list[tuple[str, dict]] = []
    for root, _dirs, files in os.walk(product_dir):
        if "metadata.json" in files:
            path = os.path.join(root, "metadata.json")
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
            for sample in data.get("samples", []):
                records.append((root, sample))
    return records


def reorganize(product_dir: str, dry_run: bool = False) -> None:
    """Move WAV files into channel-based subfolders within product_dir."""
    records = collect_metadata(product_dir)
    if not records:
        print(f"No metadata.json found under {product_dir}")
        return

    moved = 0
    skipped = 0
    conflicts = 0
    merged_samples: list[dict] = []

    for source_dir, sample in records:
        filename = sample.get("filename", "")
        if not filename:
            skipped += 1
            continue

        src_path = os.path.join(source_dir, filename)
        if not os.path.isfile(src_path):
            skipped += 1
            continue

        internal_name = sample.get("internal_name", "")
        if not internal_name:
            # Use PXD filename stem from source path as fallback
            # (e.g. 'HYP1/BASS001.PXD' → 'BASS001'; 'AA/BINP.PXD' → 'BINP')
            source = sample.get("source", "")
            if source:
                internal_name = os.path.splitext(os.path.basename(source))[0]
        category = sample.get("category", "")
        channel = get_channel(internal_name, category)

        dest_dir = os.path.join(product_dir, channel)
        dest_path = os.path.join(dest_dir, filename)

        # Resolve filename collision: prepend source archive tag
        if os.path.exists(dest_path) and os.path.abspath(dest_path) != os.path.abspath(src_path):
            archive = sample.get("source_archive", os.path.basename(source_dir))
            base, ext = os.path.splitext(filename)
            filename = f"{archive} {base}{ext}"
            dest_path = os.path.join(dest_dir, filename)
            conflicts += 1

        updated_sample = dict(sample)
        updated_sample["filename"] = filename
        updated_sample["channel"] = channel
        merged_samples.append(updated_sample)

        if dry_run:
            print(f"  {channel:8s}  {os.path.relpath(src_path, product_dir)}  →  {channel}/{filename}")
            moved += 1
            continue

        os.makedirs(dest_dir, exist_ok=True)
        shutil.move(src_path, dest_path)
        moved += 1

    print(
        f"{'[DRY RUN] ' if dry_run else ''}"
        f"{moved} samples {'would be ' if dry_run else ''}moved, "
        f"{conflicts} collision(s) renamed, "
        f"{skipped} skipped (missing files)"
    )

    if not dry_run:
        # Write a merged metadata.json at the product level
        merged_path = os.path.join(product_dir, "metadata.json")
        with open(merged_path, "w", encoding="utf-8") as fh:
            json.dump({"samples": merged_samples}, fh, indent=2, ensure_ascii=False)
        print(f"Wrote merged metadata.json ({len(merged_samples)} samples) → {merged_path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Reorganize extracted eJay WAVs into per-channel subfolders."
    )
    parser.add_argument(
        "product_dir",
        help="Path to the extracted product output folder (e.g. output/Dance_eJay2)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be moved without actually moving files.",
    )
    args = parser.parse_args()

    if not os.path.isdir(args.product_dir):
        parser.error(f"Directory not found: {args.product_dir}")

    reorganize(args.product_dir, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
