#!/usr/bin/env bash
# Unminify cli.js using webcrack + prettier.
# Caches the output to avoid redundant processing.
set -euo pipefail

CLI_PATH="/tmp/claude-code-npm/package/cli.js"
OUTPUT_DIR="/tmp/claude-code-npm/webcrack-output"
DEOBFUSCATED="$OUTPUT_DIR/deobfuscated.js"
VERSION_FILE="/tmp/claude-code-npm/.unminify-version"

if [[ ! -f "$CLI_PATH" ]]; then
    echo "ERROR: cli.js not found. Run extract-cli.sh first." >&2
    exit 1
fi

# Get CLI version for cache check
INSTALLED_VERSION=$(cat /tmp/claude-code-npm/.version 2>/dev/null || echo "unknown")

# Check cache
if [[ -f "$VERSION_FILE" && -f "$DEOBFUSCATED" ]]; then
    CACHED_VERSION=$(cat "$VERSION_FILE")
    if [[ "$CACHED_VERSION" == "$INSTALLED_VERSION" ]]; then
        LINES=$(wc -l < "$DEOBFUSCATED")
        echo "Using cached deobfuscated.js ($LINES lines) for version $INSTALLED_VERSION"
        echo "Path: $DEOBFUSCATED"
        exit 0
    fi
fi

# NOTE: `--no-jsx` is important. On today's ~18 MB bundle webcrack's JSX-decompile
# pass takes ~50 min, uses 4 GB+ RAM, and (as of this writing) emits output that
# Prettier cannot reparse. Disabling it costs only verbose `createElement(...)` +
# React memo-cache boilerplate, which is mechanical to read. `--max-old-space-size`
# is raised because the bundle is large.
echo "Running webcrack (syntax transforms, JSX decompile disabled)..."
NODE_OPTIONS="--max-old-space-size=12288" \
    npx webcrack@2 "$CLI_PATH" --no-unpack --no-deobfuscate --no-jsx --force -o "$OUTPUT_DIR"

if [[ ! -f "$DEOBFUSCATED" ]]; then
    echo "ERROR: webcrack did not produce deobfuscated.js" >&2
    exit 1
fi

echo "Running prettier (formatting)..."
NODE_OPTIONS="--max-old-space-size=12288" npx prettier@3 --write "$DEOBFUSCATED"

LINES=$(wc -l < "$DEOBFUSCATED")
echo "$INSTALLED_VERSION" > "$VERSION_FILE"
echo "Unminified: $LINES lines"
echo "Path: $DEOBFUSCATED"
