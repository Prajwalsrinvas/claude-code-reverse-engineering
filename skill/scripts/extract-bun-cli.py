#!/usr/bin/env python3
"""Extract the bundled cli.js from a Claude Code Bun standalone binary.

Since v2.1.113 the npm package (@anthropic-ai/claude-code) is a thin installer:
it no longer contains cli.js. The real CLI ships as a per-platform native Bun
executable. The JavaScript is embedded in the binary's module graph (an ELF
`.bun` section on Linux) as plaintext, alongside a precompiled bytecode blob and
two Rust NAPI addons.

This script parses that module graph and writes out each bundled JS module.
Ported/re-derived from lafkpages/bun-decompile for the current layout, where the
graph lives inside a dedicated section rather than appended at end-of-file, and
metadata records are 52 bytes.

Usage:
    python3 extract-bun-cli.py <binary-path> <output-dir>

Finds the entrypoint (cli.js) plus any sibling modules (image-processor.js,
audio-capture.js) and the .node addons. Prints a manifest.
"""
import struct
import sys
import os

BUN_TRAILER = b"\n---- Bun! ----\n"


def u32(buf, off):
    return struct.unpack_from("<I", buf, off)[0]


def _elf_bun_section(binary_path):
    """Return (offset, size) of the ELF `.bun` section, or None.

    On Linux the Bun module graph is a dedicated `.bun` PROGBITS section rather
    than an end-of-file append. Using the section bounds is ground truth; we shell
    out to readelf to avoid a hand-rolled ELF parser.
    """
    import re
    import subprocess
    try:
        out = subprocess.run(
            ["readelf", "-S", binary_path], capture_output=True, text=True
        ).stdout
    except (FileNotFoundError, OSError):
        return None
    m = re.search(r"\.bun\s+PROGBITS\s+\S+\s+(\S+)\n\s+(\S+)", out)
    if not m:
        return None
    return int(m.group(1), 16), int(m.group(2), 16)


def find_graph(data, binary_path):
    """Return (start, end) of the Bun module-graph blob within `data`.

    Preferred: the ELF `.bun` section bounds (Linux). The blob's own
    totalByteCount (u32 at end-8) equals the section size, which we sanity-check.
    Fallbacks: end-of-file append, then last-trailer anchor (macOS Mach-O / other).
    """
    sec = _elf_bun_section(binary_path)
    if sec:
        off, size = sec
        end = off + size
        # In the section-embedded layout the trailer is the final 16 bytes of the
        # section (no trailing byte-count field). The section bounds ARE the blob.
        if data[end - len(BUN_TRAILER):end] == BUN_TRAILER:
            return off, end
    n = len(data)
    if data[n - 8 - len(BUN_TRAILER):n - 8] == BUN_TRAILER:
        total = u32(data, n - 8)
        return (n - total if total <= n else 0), n
    idx = data.rfind(BUN_TRAILER)
    if idx == -1:
        raise SystemExit("No Bun trailer found — not a Bun standalone binary?")
    end = idx + len(BUN_TRAILER)
    # totalByteCount sits 8 bytes before the blob end; the blob end is the byte
    # after the trailer's 8-byte count field.
    end += 8
    total = u32(data, end - 8)
    start = end - total
    if start < 0:
        raise SystemExit(f"totalByteCount {total} exceeds preceding data")
    return start, end


def extract(binary_path, out_dir):
    data = open(binary_path, "rb").read()
    gstart, gend = find_graph(data, binary_path)
    g = data[gstart:gend]
    n = len(g)

    # Module contents and path strings are addressed relative to the blob start
    # plus an 8-byte header (base = 8).
    base = 8

    # The metadata record array and the short "/$bunfs/root/..." path strings it
    # references live near the tail of the blob (the "file:///..." specifiers near
    # the start are a different table and are NOT what records point at). Scan the
    # tail for NUL-terminated metadata paths, then find each one's record. A record
    # is <flags u32><pathOff u32><pathLen u32><contentsOff u32><contentsLen u32>...
    # where pathOff is relative to base.
    path_marker = b"/$bunfs/root/"
    # Window must be large enough to include the entrypoint's path-table entry,
    # which can sit tens of MB before the blob end (the huge cli.js *contents*
    # precede it). 48 MB comfortably covers an ~18 MB cli.js bundle.
    tail_start = max(0, n - 48 * 1024 * 1024)  # last 48 MB
    paths = []
    i = tail_start
    while True:
        i = g.find(path_marker, i)
        if i == -1:
            break
        j = i
        while j < n and g[j] != 0:
            j += 1
        paths.append((i, g[i:j]))
        i = j + 1

    rec_positions = []
    for off, s in paths:
        needle = struct.pack("<II", off - base, len(s))
        pos = g.find(needle, tail_start)
        while pos != -1:
            rec_positions.append(pos - 4)  # flags u32 precedes pathOff
            pos = g.find(needle, pos + 1)

    if not rec_positions:
        raise SystemExit("Could not locate module metadata record array")
    rec_array_start = min(rec_positions)

    CHUNK = 52  # 13 u32 fields per record in the current layout
    os.makedirs(out_dir, exist_ok=True)
    manifest = []
    i = 0
    while True:
        rec_off = rec_array_start + i * CHUNK
        if rec_off + CHUNK > n:
            break
        flags, poff, plen, coff, clen = struct.unpack_from("<5I", g, rec_off)
        if plen == 0 or plen > 4096 or poff + base > n:
            break
        path = g[base + poff:base + poff + plen].decode("utf-8", "replace")
        if not path.startswith("/$bunfs/root/"):
            break
        contents = g[base + coff:base + coff + clen]
        name = path.rsplit("/", 1)[-1]
        with open(os.path.join(out_dir, name), "wb") as f:
            f.write(contents)
        manifest.append((name, clen))
        i += 1
        if i > 64:  # safety
            break

    print(f"graph blob: file[{gstart}:{gend}] ({n:,} bytes)")
    for name, size in manifest:
        tag = "  <== entrypoint (unminify this)" if name == "cli.js" else ""
        print(f"  {name:<24} {size:>14,} bytes{tag}")
    if not any(name == "cli.js" for name, _ in manifest):
        raise SystemExit("WARNING: cli.js not found among extracted modules")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    extract(sys.argv[1], sys.argv[2])
