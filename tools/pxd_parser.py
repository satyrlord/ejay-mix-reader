#!/usr/bin/env python3
"""
PXD Parser — Extract audio samples from eJay PXD files and packed archives.

Decodes the proprietary PXD compression format used by eJay music software
(late 1990s / early 2000s) and writes standard WAV files + a metadata catalog.
Optionally enriches samples with category data from a Pxddance catalog and
organizes output into named subdirectories.

Usage:
    # Extract individual PXD files from a directory
    python pxd_parser.py archive/Dance_eJay1/dance --output output/Dance_eJay1

    # Extract and organize into category folders with human-readable names
    python pxd_parser.py archive/Dance_eJay1/dance --output output/Dance_eJay1 \\
        --catalog archive/Dance_SuperPack/dance/EJAY/Pxddance \\
        --format "{category}/{alias} - {detail}"

    # Extract from a packed archive using an INF catalog
    python pxd_parser.py archive/Dance_eJay2/D_ejay2/PXD/DANCE20 --output output/Dance_eJay2

    # Extract a single PXD file
    python pxd_parser.py path/to/file.pxd --output output/test
"""

import argparse
import json
import os
import re
import struct
import sys
import wave
from pathlib import Path
from typing import Literal


# --- PXD Format Constants ---

PXD_MAGIC = b'tPxD'
WAV_MAGIC = b'RIFF'
AUDIO_MARKER = 0x54  # 'T'

# Dictionary-define opcodes: byte value -> snippet length
OPCODES = {0xF4: 1, 0xF5: 2, 0xF6: 3, 0xF7: 4, 0xF8: 5}

LITERAL_ESCAPE = 0xFF
SILENCE_BYTE = 0x00  # emits 5 × 0x80 (center-value silence)
SILENCE_FILL = b'\x80' * 5

# WAV output parameters
SAMPLE_RATE = 44100
NUM_CHANNELS = 1
SAMPLE_WIDTH = 2  # 16-bit signed PCM (DPCM-reconstructed)

# DPCM step table — maps decoded byte values (0x01–0xF3) to 16-bit accumulation
# deltas.  The PXD codec stores DPCM delta codes, not absolute PCM.  To
# reconstruct proper 16-bit audio: output[n] = output[n-1] + DPCM_STEP_TABLE[byte].
# Table is perfectly symmetric around 0x80 (silence / zero delta).
# Extracted from PXD32R4.DLL (Gen 2); Gen 3 DLLs use 2× these values.
# fmt: off
DPCM_STEP_TABLE: tuple[int, ...] = (
    # 0x00 placeholder (silence opcode, not a delta)
        0,
    # 0x01–0x10
    -25266, -24412, -23582, -22776, -21992, -21232, -20494, -19778,
    -19082, -18406, -17752, -17116, -16500, -15904, -15326, -14766,
    # 0x11–0x20
    -14222, -13696, -13186, -12692, -12214, -11752, -11304, -10872,
    -10454, -10050,  -9660,  -9282,  -8916,  -8564,  -8224,  -7896,
    # 0x21–0x30
     -7578,  -7272,  -6976,  -6690,  -6414,  -6148,  -5892,  -5646,
     -5408,  -5178,  -4958,  -4746,  -4542,  -4346,  -4156,  -3974,
    # 0x31–0x40
     -3798,  -3630,  -3468,  -3312,  -3162,  -3018,  -2880,  -2748,
     -2620,  -2498,  -2380,  -2268,  -2160,  -2056,  -1956,  -1860,
    # 0x41–0x50
     -1768,  -1680,  -1596,  -1516,  -1440,  -1366,  -1296,  -1228,
     -1164,  -1102,  -1044,   -988,   -934,   -882,   -834,   -788,
    # 0x51–0x60
      -744,   -702,   -662,   -624,   -588,   -554,   -520,   -488,
      -458,   -430,   -402,   -376,   -352,   -328,   -306,   -286,
    # 0x61–0x70
      -266,   -248,   -230,   -214,   -198,   -182,   -168,   -154,
      -142,   -130,   -118,   -108,    -98,    -88,    -80,    -72,
    # 0x71–0x80
       -64,    -56,    -50,    -44,    -38,    -32,    -26,    -22,
       -18,    -14,    -10,     -8,     -6,     -4,     -2,      0,
    # 0x81–0x90
         2,      4,      6,      8,     10,     14,     18,     22,
        26,     32,     38,     44,     50,     56,     64,     72,
    # 0x91–0xA0
        80,     88,     98,    108,    118,    130,    142,    154,
       168,    182,    198,    214,    230,    248,    266,    286,
    # 0xA1–0xB0
       306,    328,    352,    376,    402,    430,    458,    488,
       520,    554,    588,    624,    662,    702,    744,    788,
    # 0xB1–0xC0
       834,    882,    934,    988,   1044,   1102,   1164,   1228,
      1296,   1366,   1440,   1516,   1596,   1680,   1768,   1860,
    # 0xC1–0xD0
      1956,   2056,   2160,   2268,   2380,   2498,   2620,   2748,
      2880,   3018,   3162,   3312,   3468,   3630,   3798,   3974,
    # 0xD1–0xE0
      4156,   4346,   4542,   4746,   4958,   5178,   5408,   5646,
      5892,   6148,   6414,   6690,   6976,   7272,   7578,   7896,
    # 0xE1–0xF0
      8224,   8564,   8916,   9282,   9660,  10050,  10454,  10872,
     11304,  11752,  12214,  12692,  13186,  13696,  14222,  14766,
    # 0xF1–0xF3
     15326,  15904,  16500,
)
# fmt: on


# --- PXD Decoding ---

def decode_pxd_audio(compressed: bytes, decoded_size: int) -> bytes:
    """Decode PXD-compressed audio data to raw 8-bit unsigned PCM.

    The PXD codec uses dictionary-based compression:
      - 0xF4..0xF8 NN D1..Dn  — define dict[NN] = n data bytes, emit them
      - 0xFF DD               — literal escape, emit byte DD
      - 0x00                  — emit 5 silence samples (0x80)
      - NN (if in dict)       — back-reference, emit dict[NN]
      - NN (if not in dict)   — literal, emit byte NN

    Data bytes are in range 0x01–0xF3; control bytes (0x00, 0xF4–0xFF)
    never appear as payload, giving an unambiguous parse.
    """
    dictionary = {}
    output = bytearray()
    pos = 0
    length = len(compressed)

    while pos < length and len(output) < decoded_size:
        b = compressed[pos]

        if b in OPCODES:
            # Dictionary define: opcode + key + n payload bytes
            snippet_len = OPCODES[b]
            key = compressed[pos + 1]
            payload = compressed[pos + 2 : pos + 2 + snippet_len]
            dictionary[key] = payload
            output.extend(payload)
            pos += 2 + snippet_len

        elif b == LITERAL_ESCAPE:
            # Literal escape: emit the next byte verbatim
            output.append(compressed[pos + 1])
            pos += 2

        elif b == SILENCE_BYTE:
            # Silence marker: emit 5 center-value samples
            output.extend(SILENCE_FILL)
            pos += 1

        elif b in dictionary:
            # Dictionary back-reference
            output.extend(dictionary[b])
            pos += 1

        else:
            # Literal data byte (before its key is assigned)
            output.append(b)
            pos += 1

    # Pad with silence if decoder undershoots, truncate if overshoots
    if len(output) < decoded_size:
        output.extend(b'\x80' * (decoded_size - len(output)))

    return bytes(output[:decoded_size])


def apply_dpcm(decoded_bytes: bytes, scale: int = 1) -> bytes:
    """Convert 8-bit DPCM delta codes to 16-bit signed PCM via accumulation.

    Each decoded byte is a lookup into DPCM_STEP_TABLE; the output sample is the
    running sum of successive deltas, clamped to int16 range.

    Args:
        decoded_bytes: Raw output from decode_pxd_audio (8-bit delta codes).
        scale: Amplitude multiplier (1 for Gen 2, 2 for Gen 3).

    Returns:
        16-bit little-endian signed PCM as bytes (2 bytes per sample).
    """
    accum = 0
    out = bytearray(len(decoded_bytes) * 2)
    table = DPCM_STEP_TABLE
    table_len = len(table)
    for i, b in enumerate(decoded_bytes):
        if b < table_len:
            accum += table[b] * scale
        # else: out-of-range byte (control byte leaked) — treat as zero delta
        if accum > 32767:
            accum = 32767
        elif accum < -32768:
            accum = -32768
        struct.pack_into('<h', out, i * 2, accum)
    return bytes(out)


def parse_pxd_header(data: bytes):
    """Parse a PXD file header and return (metadata_text, decoded_size, unknown_field, audio_offset).

    Returns None if the data is not a valid PXD file.
    """
    if len(data) < 12:
        return None

    magic = data[:4]
    if magic == WAV_MAGIC:
        return None  # plain WAV disguised as .pxd

    if magic != PXD_MAGIC:
        return None

    meta_len = data[4]
    meta_end = 5 + meta_len
    if meta_end + 7 > len(data):
        return None

    metadata_raw = data[5:meta_end]
    metadata_text = metadata_raw.rstrip(b'\x00').decode('ascii', errors='replace')

    marker = data[meta_end]
    if marker != AUDIO_MARKER:
        return None

    decoded_size, unknown_field = struct.unpack_from('<IH', data, meta_end + 1)
    audio_offset = meta_end + 7

    return metadata_text, decoded_size, unknown_field, audio_offset


def decode_pxd_file(data: bytes):
    """Decode a complete PXD file.

    Returns (pcm_data, metadata_text, decoded_size, unknown_field) or None for WAV/invalid.
    """
    header = parse_pxd_header(data)
    if header is None:
        return None

    metadata_text, decoded_size, unknown_field, audio_offset = header
    compressed = data[audio_offset:]
    pcm = decode_pxd_audio(compressed, decoded_size)
    return pcm, metadata_text, decoded_size, unknown_field


def write_wav(path: str, pcm_data: bytes, sample_rate=SAMPLE_RATE,
              num_channels=NUM_CHANNELS, sample_width=SAMPLE_WIDTH):
    """Write raw PCM data as a WAV file."""
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with wave.open(path, 'wb') as wf:
        wf.setnchannels(num_channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_data)


# --- Metadata Parsing ---

def parse_metadata_fields(text: str) -> dict:
    """Parse CRLF-separated PXD metadata into structured fields.

    Metadata format varies by product generation:
      - Gen 1 (Dance 1, Rave, SuperPack): "alias" or "alias\\r\\ndetails"
      - Gen 2 (Dance 2, Techno): "product\\r\\ndescription\\r\\n..."
    """
    fields = text.replace('\r\n', '\n').split('\n')
    fields = [f.strip() for f in fields if f.strip()]

    result = {'raw': text}
    if len(fields) >= 1:
        result['alias'] = fields[0]
    if len(fields) >= 2:
        result['detail'] = fields[1]
    if len(fields) >= 5:
        result['category'] = fields[4]

    return result


# --- INF Catalog Parsing ---

def parse_inf_catalog(inf_path: str) -> list:
    """Parse an INF catalog file describing a packed archive.

    Returns a list of dicts with keys:
        sample_id, filename, offset, size, category, alias
    """
    with open(inf_path, 'r', encoding='ascii', errors='replace') as f:
        text = f.read()

    lines = text.replace('\r\n', '\n').split('\n')
    entries = []
    i = 0

    # Find [SAMPLES] section
    while i < len(lines):
        if lines[i].strip() == '[SAMPLES]':
            i += 1
            break
        i += 1

    # Parse entries (each entry is ~12 lines)
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith('['):
            break  # next section
        if not line:
            i += 1
            continue

        try:
            sample_id = int(lines[i].strip())
            _flag = int(lines[i + 1].strip())
            filename = lines[i + 2].strip().strip('"')
            offset = int(lines[i + 3].strip())
            size = int(lines[i + 4].strip())
            category = lines[i + 5].strip().strip('"')
            alias = lines[i + 6].strip().strip('"')
            entries.append({
                'sample_id': sample_id,
                'filename': filename,
                'offset': offset,
                'size': size,
                'category': category,
                'alias': alias,
            })
            i += 12
        except (ValueError, IndexError):
            i += 1

    return entries


# --- Extraction Modes ---

def extract_individual_pxds(source_dir: str, output_dir: str,
                            use_16bit: bool = False) -> list:
    """Extract all individual PXD files from a directory tree.

    Returns a list of metadata dicts for the catalog.
    """
    catalog = []
    source = Path(source_dir)

    pxd_files = sorted(source.rglob('*.PXD')) + sorted(source.rglob('*.pxd'))
    # Deduplicate: normalise to lower-case to avoid importing the same file twice
    # on case-insensitive filesystems (e.g. Windows, macOS HFS+)
    seen_paths = set()
    unique_files = []
    for p in pxd_files:
        key = str(p).lower()
        if key not in seen_paths:
            seen_paths.add(key)
            unique_files.append(p)

    total = len(unique_files)
    decoded_count = 0
    wav_count = 0
    skipped = 0

    for pxd_path in unique_files:
        with open(pxd_path, 'rb') as f:
            data = f.read()

        rel_path = pxd_path.relative_to(source)
        bank = rel_path.parts[0] if len(rel_path.parts) > 1 else ''
        stem = pxd_path.stem

        # Check for plain WAV
        if data[:4] == WAV_MAGIC:
            wav_name = f'{bank}_{stem}.wav' if bank else f'{stem}.wav'
            wav_out = os.path.join(output_dir, wav_name)
            os.makedirs(os.path.dirname(wav_out) or '.', exist_ok=True)
            with open(wav_out, 'wb') as f:
                f.write(data)
            wav_count += 1
            catalog.append({
                'filename': wav_name,
                'source': rel_path.as_posix(),
                'bank': bank,
                'format': 'wav',
            })
            continue

        result = decode_pxd_file(data)
        if result is None:
            skipped += 1
            continue

        pcm, meta_text, decoded_size, unknown_field = result
        meta = parse_metadata_fields(meta_text)

        wav_name = f'{bank}_{stem}.wav' if bank else f'{stem}.wav'
        wav_out = os.path.join(output_dir, wav_name)
        if use_16bit:
            pcm = apply_dpcm(pcm)
            write_wav(wav_out, pcm, sample_width=2)
        else:
            write_wav(wav_out, pcm)
        decoded_count += 1

        duration_sec = decoded_size / SAMPLE_RATE
        beats = round(duration_sec * 140 / 60)
        bit_depth = 16 if use_16bit else 8

        entry = {
            'filename': wav_name,
            'source': rel_path.as_posix(),
            'bank': bank,
            'alias': meta.get('alias', stem),
            'duration_sec': round(duration_sec, 4),
            'beats': beats,
            'decoded_size': decoded_size,
            'sample_rate': SAMPLE_RATE,
            'bit_depth': bit_depth,
            'channels': 1,
        }
        if 'category' in meta:
            entry['category'] = meta['category']
        if 'detail' in meta:
            entry['detail'] = meta['detail']

        catalog.append(entry)

    print(f'  Decoded: {decoded_count} PXD files')
    if wav_count:
        print(f'  Copied:  {wav_count} plain WAV files')
    if skipped:
        print(f'  Skipped: {skipped} unrecognized files')

    return catalog


def extract_packed_archive(archive_path: str, output_dir: str,
                           inf_path: str | None = None,
                           use_16bit: bool = False) -> list:
    """Extract PXD samples from a packed archive using its INF catalog.

    If inf_path is not given, looks for <archive_path>.inf or <archive_path>.INF.
    Returns a list of metadata dicts for the catalog.
    """
    archive_path = str(archive_path)

    # Auto-detect INF file
    if inf_path is None:
        for ext in ('.inf', '.INF', '.Inf'):
            candidate = archive_path + ext
            if os.path.isfile(candidate):
                inf_path = candidate
                break
        if inf_path is None:
            print(f'  ERROR: No INF catalog found for {archive_path}', file=sys.stderr)
            return []

    entries = parse_inf_catalog(inf_path)
    if not entries:
        print(f'  WARNING: No sample entries found in {inf_path}', file=sys.stderr)
        return []

    with open(archive_path, 'rb') as f:
        archive_data = f.read()

    catalog = []
    decoded_count = 0
    wav_count = 0
    skipped = 0

    for entry in entries:
        offset = entry['offset']
        size = entry['size']
        pxd_data = archive_data[offset:offset + size]

        if len(pxd_data) < 10:
            skipped += 1
            continue

        filename = entry['filename']
        category = entry['category']
        alias = entry['alias']

        safe_name = filename.replace('/', '_').replace('\\', '_')
        wav_name = f'{safe_name}.wav'
        wav_out = os.path.join(output_dir, wav_name)

        # Check for plain WAV
        if pxd_data[:4] == WAV_MAGIC:
            os.makedirs(os.path.dirname(wav_out) or '.', exist_ok=True)
            with open(wav_out, 'wb') as f:
                f.write(pxd_data)
            wav_count += 1
            catalog.append({
                'filename': wav_name,
                'source_archive': os.path.basename(archive_path),
                'internal_name': filename,
                'alias': alias,
                'category': category,
                'format': 'wav',
            })
            continue

        result = decode_pxd_file(pxd_data)
        if result is None:
            skipped += 1
            continue

        pcm, meta_text, decoded_size, unknown_field = result
        if use_16bit:
            pcm = apply_dpcm(pcm)
            write_wav(wav_out, pcm, sample_width=2)
        else:
            write_wav(wav_out, pcm)
        decoded_count += 1

        duration_sec = decoded_size / SAMPLE_RATE
        beats = round(duration_sec * 140 / 60)
        bit_depth = 16 if use_16bit else 8

        cat_entry = {
            'filename': wav_name,
            'source_archive': os.path.basename(archive_path),
            'internal_name': filename,
            'sample_id': entry['sample_id'],
            'alias': alias,
            'category': category,
            'duration_sec': round(duration_sec, 4),
            'beats': beats,
            'decoded_size': decoded_size,
            'sample_rate': SAMPLE_RATE,
            'bit_depth': bit_depth,
            'channels': 1,
        }

        # Also include PXD-embedded metadata if present
        if meta_text:
            meta = parse_metadata_fields(meta_text)
            if 'detail' in meta:
                cat_entry['detail'] = meta['detail']

        catalog.append(cat_entry)

    print(f'  Decoded: {decoded_count} samples from packed archive')
    if wav_count:
        print(f'  Copied:  {wav_count} embedded WAV files')
    if skipped:
        print(f'  Skipped: {skipped} unrecognized entries')

    return catalog


def merge_stereo_pairs(catalog: list) -> list:
    """Identify stereo L/R pairs in the catalog and mark them.

    Stereo pairs have metadata aliases ending with " L" / " R".
    This adds a 'stereo_pair' field to paired entries.
    """
    # Build index by alias minus the L/R suffix
    by_base = {}
    for entry in catalog:
        alias = entry.get('alias', '')
        if alias.endswith(' L') or alias.endswith(' R'):
            base = alias[:-2]
            channel = alias[-1]
            by_base.setdefault(base, {})[channel] = entry

    paired = 0
    for base, channels in by_base.items():
        if 'L' in channels and 'R' in channels:
            channels['L']['stereo_pair'] = channels['R']['filename']
            channels['L']['stereo_channel'] = 'L'
            channels['R']['stereo_pair'] = channels['L']['filename']
            channels['R']['stereo_channel'] = 'R'
            paired += 1

    if paired:
        print(f'  Stereo:  {paired} L/R pairs identified')

    return catalog


# --- Pxddance Catalog Parsing ---

def parse_pxddance(filepath: str) -> list[dict]:
    """Parse a Pxddance catalog file.

    Format: repeated blocks of 6 quoted lines:
        "bank/filename.pxd"
        ""
        "category"
        "flag"
        "group_alias"
        "version_detail"
    """
    with open(filepath, 'rb') as f:
        data = f.read()

    text = data.decode('ascii', errors='replace')
    lines = text.replace('\r\n', '\n').split('\n')

    entries = []
    i = 0
    while i + 5 < len(lines):
        line0 = lines[i].strip().strip('"')
        line2 = lines[i + 2].strip().strip('"')
        line3 = lines[i + 3].strip().strip('"')
        line4 = lines[i + 4].strip().strip('"')
        line5 = lines[i + 5].strip().strip('"')

        if line0.lower().endswith('.pxd') or '/' in line0 or '\\' in line0:
            entries.append({
                'path': line0.replace('\\', '/'),
                'category': line2,
                'flag': line3,
                'group': line4,
                'version': line5,
            })
            i += 6
        else:
            i += 1

    return entries


def build_category_map(entries: list[dict]) -> dict[str, dict]:
    """Build a lookup from normalized filename key to category info."""
    mapping: dict[str, dict] = {}
    for e in entries:
        path_norm = e['path'].lower().replace('\\', '/')
        parts = path_norm.split('/')
        bank = parts[0].upper()
        filename = parts[-1].upper().replace('.PXD', '')
        key = f"{bank}_{filename}"
        mapping[key] = {
            'category': e['category'],
            'flag': e['flag'],
            'group': e['group'],
            'version': e['version'],
        }
    return mapping


def enrich_with_categories(catalog: list, category_map: dict[str, dict]) -> int:
    """Add category field to catalog entries using a Pxddance-derived map.

    Returns the number of matched entries.
    """
    matched = 0
    for sample in catalog:
        key = sample['filename'].replace('.wav', '').upper()
        if key in category_map:
            sample['category'] = category_map[key]['category']
            matched += 1
    return matched


# --- Output Organization ---

# Characters unsafe in filenames across platforms (reserved on Windows; best avoided everywhere)
_UNSAFE_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _sanitize_filename(name: str) -> str:
    """Replace unsafe characters and collapse whitespace."""
    name = _UNSAFE_CHARS.sub('_', name)
    name = re.sub(r'\s+', ' ', name).strip()
    name = name.strip('. ')
    if not name:
        name = '_'
    return name


def _build_display_name(sample: dict, fmt: str) -> str:
    """Build a human-readable name from a sample entry using a format template.

    Placeholders: {alias}, {detail}, {category}, {bank},
                  {stereo_channel}, {beats}
    """
    alias = sample.get('alias', '').strip()
    detail = sample.get('detail', '').strip()
    category = sample.get('category', 'unknown').strip()
    bank = sample.get('bank', '').strip()
    channel = sample.get('stereo_channel', '').strip()
    beats = str(sample.get('beats', ''))

    result = fmt.format(
        alias=alias,
        detail=detail,
        category=category,
        bank=bank,
        stereo_channel=channel,
        beats=beats,
    )

    # Clean up dangling separators from empty fields
    result = re.sub(r' -\s*$', '', result)       # trailing " - "
    result = re.sub(r'\s*-\s*-', ' -', result)    # double dashes
    result = re.sub(r'\(\s*\)', '', result)        # empty parens
    result = re.sub(r'\s+', ' ', result).strip()   # collapse whitespace

    return result


def organize_output(catalog: list, output_dir: str, fmt: str) -> None:
    """Rename WAV files in output_dir according to the format template.

    Updates 'filename' and 'stereo_pair' in each catalog entry to reflect new paths.
    """
    used_names: dict[str, int] = {}    # collision tracker
    rename_map: dict[str, str] = {}    # old_name -> new_name for stereo_pair fixup

    for sample in catalog:
        old_name = sample['filename']
        old_path = os.path.join(output_dir, old_name)
        if not os.path.exists(old_path):
            continue

        raw = _build_display_name(sample, fmt)

        # Split on '/' to support subdirectories in template
        parts = raw.split('/')
        if len(parts) > 1:
            safe = '/'.join(_sanitize_filename(p) for p in parts)
        else:
            safe = _sanitize_filename(raw)

        # Append stereo channel if not already in the alias
        channel = sample.get('stereo_channel', '')
        if channel and '{stereo_channel}' not in fmt:
            alias = sample.get('alias', '')
            if not alias.endswith(f' {channel}'):
                safe = f'{safe} {channel}'

        new_name = f'{safe}.wav'

        # Handle duplicate names
        key = new_name.lower()
        if key in used_names:
            used_names[key] += 1
            base, ext = os.path.splitext(new_name)
            new_name = f'{base} ({used_names[key]}){ext}'
        else:
            used_names[key] = 1

        new_path = os.path.join(output_dir, new_name)
        os.makedirs(os.path.dirname(new_path) or '.', exist_ok=True)
        os.rename(old_path, new_path)
        rename_map[old_name] = new_name
        sample['filename'] = new_name

    # Fix up stereo_pair references to use new filenames
    for sample in catalog:
        pair = sample.get('stereo_pair')
        if pair and pair in rename_map:
            sample['stereo_pair'] = rename_map[pair]


# --- CLI ---

def detect_source_type(path: str) -> Literal['directory', 'packed_archive', 'single_pxd'] | None:
    """Determine if path is a directory of PXD files, a packed archive, or a single PXD."""
    if os.path.isdir(path):
        return 'directory'
    if os.path.isfile(path):
        with open(path, 'rb') as f:
            magic = f.read(4)
        if magic == PXD_MAGIC or magic == WAV_MAGIC:
            return 'single_pxd'
        # Check for INF companion → packed archive
        for ext in ('.inf', '.INF', '.Inf'):
            if os.path.isfile(path + ext):
                return 'packed_archive'
        # Could be a packed archive without INF — check if extension-less
        if '.' not in os.path.basename(path):
            return 'packed_archive'
        return 'single_pxd'
    return None


def main():
    parser = argparse.ArgumentParser(
        description='Extract audio samples from eJay PXD files and packed archives.'
    )
    parser.add_argument('source', help='Path to a PXD file, directory of PXDs, or packed archive')
    parser.add_argument('--output', '-o', default='output',
                        help='Output directory for WAV files and metadata.json')
    parser.add_argument('--inf', default=None,
                        help='Path to INF catalog (auto-detected for packed archives)')
    parser.add_argument('--catalog', default=None,
                        help='Path to Pxddance catalog file for category enrichment')
    parser.add_argument('--format', '-f', default=None,
                        help='Rename template (e.g. "{category}/{alias} - {detail}")')
    parser.add_argument('--8bit', dest='use_8bit', action='store_true',
                        help='Output raw 8-bit unsigned DPCM delta codes '
                             '(default: 16-bit signed PCM via DPCM reconstruction)')
    args = parser.parse_args()

    source = os.path.abspath(args.source)
    output_dir = os.path.abspath(args.output)

    source_type = detect_source_type(source)
    if source_type is None:
        print(f'Error: {source} not found', file=sys.stderr)
        sys.exit(1)

    print(f'Source: {source} ({source_type})')
    print(f'Output: {output_dir}')
    os.makedirs(output_dir, exist_ok=True)

    use_16bit = not args.use_8bit

    if source_type == 'directory':
        catalog = extract_individual_pxds(source, output_dir, use_16bit=use_16bit)
    elif source_type == 'packed_archive':
        catalog = extract_packed_archive(source, output_dir, inf_path=args.inf,
                                         use_16bit=use_16bit)
    elif source_type == 'single_pxd':
        with open(source, 'rb') as f:
            data = f.read()
        if data[:4] == WAV_MAGIC:
            wav_out = os.path.join(output_dir, Path(source).stem + '.wav')
            with open(wav_out, 'wb') as f:
                f.write(data)
            catalog = [{'filename': os.path.basename(wav_out), 'format': 'wav'}]
            print(f'  Copied plain WAV file')
        else:
            result = decode_pxd_file(data)
            if result is None:
                print(f'Error: could not decode {source}', file=sys.stderr)
                sys.exit(1)
            pcm, meta_text, decoded_size, unknown_field = result
            wav_name = Path(source).stem + '.wav'
            wav_out = os.path.join(output_dir, wav_name)
            if use_16bit:
                pcm = apply_dpcm(pcm)
                write_wav(wav_out, pcm, sample_width=2)
            else:
                write_wav(wav_out, pcm)
            meta = parse_metadata_fields(meta_text)
            bit_depth = 16 if use_16bit else 8
            catalog = [{
                'filename': wav_name,
                'alias': meta.get('alias', Path(source).stem),
                'decoded_size': decoded_size,
                'sample_rate': SAMPLE_RATE,
                'bit_depth': bit_depth,
                'channels': 1,
            }]
            print(f'  Decoded: 1 PXD file')
    else:
        raise AssertionError(f'Unhandled source type: {source_type}')

    # Identify stereo pairs
    catalog = merge_stereo_pairs(catalog)

    # Enrich with category data from Pxddance catalog
    if args.catalog:
        cat_entries = parse_pxddance(args.catalog)
        cat_map = build_category_map(cat_entries)
        matched = enrich_with_categories(catalog, cat_map)
        print(f'  Categories: {matched}/{len(catalog)} matched from {args.catalog}')

    # Organize into named folders / readable filenames
    if args.format:
        organize_output(catalog, output_dir, args.format)
        print(f'  Organized: {len(catalog)} files renamed')

    # Write metadata catalog
    catalog_path = os.path.join(output_dir, 'metadata.json')
    with open(catalog_path, 'w', encoding='utf-8') as f:
        json.dump({
            'source': source,
            'total_samples': len(catalog),
            'format': {
                'sample_rate': SAMPLE_RATE,
                'bit_depth': 16 if use_16bit else 8,
                'channels': 1,
                'encoding': 'signed_pcm' if use_16bit else 'unsigned_pcm',
            },
            'samples': catalog,
        }, f, indent=2, ensure_ascii=False)

    print(f'  Catalog: {catalog_path} ({len(catalog)} entries)')
    print('Done.')


if __name__ == '__main__':
    main()
