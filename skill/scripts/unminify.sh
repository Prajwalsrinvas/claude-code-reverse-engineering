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

echo "Running webcrack (syntax transforms)..."
npx webcrack "$CLI_PATH" --no-unpack --no-deobfuscate --force -o "$OUTPUT_DIR"

if [[ ! -f "$DEOBFUSCATED" ]]; then
    echo "ERROR: webcrack did not produce deobfuscated.js" >&2
    exit 1
fi

echo "Running prettier (formatting)..."
npx prettier --write "$DEOBFUSCATED"

LINES=$(wc -l < "$DEOBFUSCATED")
echo "$INSTALLED_VERSION" > "$VERSION_FILE"
echo "Unminified: $LINES lines"
echo "Path: $DEOBFUSCATED"
