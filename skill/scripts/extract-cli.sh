#!/usr/bin/env bash
# Extract cli.js from the Claude Code native binary.
#
# Since v2.1.113 the npm package (@anthropic-ai/claude-code) is a thin installer
# and no longer contains cli.js — the real CLI ships as a per-platform native
# Bun executable with the JS embedded in its module graph. This script locates
# the installed binary and extracts cli.js from it. Caches by version.
set -euo pipefail

CACHE_DIR="/tmp/claude-code-npm"
VERSION_FILE="$CACHE_DIR/.version"
CLI_PATH="$CACHE_DIR/package/cli.js"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

INSTALLED_VERSION=$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "")
if [[ -z "$INSTALLED_VERSION" ]]; then
    echo "ERROR: Cannot determine Claude Code version. Install Claude Code (the native binary)." >&2
    exit 1
fi

# Check cache
if [[ -f "$VERSION_FILE" && -f "$CLI_PATH" ]]; then
    if [[ "$(cat "$VERSION_FILE")" == "$INSTALLED_VERSION" ]]; then
        echo "Using cached cli.js for version $INSTALLED_VERSION"
        echo "Path: $CLI_PATH"
        exit 0
    fi
fi

# Locate the installed native binary. Common locations:
#   ~/.local/share/claude/versions/<version>   (Linux/macOS user install)
#   the resolved target of `which claude`
BINARY=""
for cand in \
    "$HOME/.local/share/claude/versions/$INSTALLED_VERSION" \
    "$(command -v claude 2>/dev/null || true)"; do
    if [[ -n "$cand" && -f "$cand" ]]; then
        # Skip shell-script shims; we need the actual ELF/Mach-O binary.
        # (Don't match "executable" — `file` reports shell scripts as
        # "shell script ... executable" too, which would defeat the guard.)
        if file "$cand" 2>/dev/null | grep -qiE 'ELF|Mach-O'; then
            BINARY="$cand"
            break
        fi
    fi
done

if [[ -z "$BINARY" ]]; then
    echo "ERROR: Could not find the native Claude Code binary for $INSTALLED_VERSION." >&2
    echo "Looked in ~/.local/share/claude/versions/ and \$(which claude)." >&2
    echo "As a fallback you can 'npm pack @anthropic-ai/claude-code-<platform>' to fetch the" >&2
    echo "platform binary tarball (package/claude), then point this script at it." >&2
    exit 1
fi

echo "Extracting cli.js from native binary: $BINARY"
mkdir -p "$CACHE_DIR/package"
rm -f "$CLI_PATH"
python3 "$SCRIPT_DIR/extract-bun-cli.py" "$BINARY" "$CACHE_DIR/bun-modules"
cp "$CACHE_DIR/bun-modules/cli.js" "$CLI_PATH"

if [[ ! -f "$CLI_PATH" ]]; then
    echo "ERROR: cli.js not produced by the extractor." >&2
    exit 1
fi

echo "$INSTALLED_VERSION" > "$VERSION_FILE"
echo "Extracted cli.js ($(du -h "$CLI_PATH" | cut -f1)) for version $INSTALLED_VERSION"
echo "Also written to $CACHE_DIR/bun-modules: the two tiny CJS shims and the"
echo "image-processor / audio-capture Rust NAPI addons. (The ~144 MB Bun bytecode"
echo "blob lives in the .bun section but is not a path-table module, so it isn't emitted.)"
echo "Path: $CLI_PATH"
