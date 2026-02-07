#!/usr/bin/env bash
# Extract cli.js from the Claude Code npm package.
# Caches by version to avoid redundant downloads.
set -euo pipefail

CACHE_DIR="/tmp/claude-code-npm"
VERSION_FILE="$CACHE_DIR/.version"
CLI_PATH="$CACHE_DIR/package/cli.js"

# Get installed version
INSTALLED_VERSION=$(claude --version 2>/dev/null || echo "unknown")

# Check cache
if [[ -f "$VERSION_FILE" && -f "$CLI_PATH" ]]; then
    CACHED_VERSION=$(cat "$VERSION_FILE")
    if [[ "$CACHED_VERSION" == "$INSTALLED_VERSION" ]]; then
        echo "Using cached cli.js for version $INSTALLED_VERSION"
        echo "Path: $CLI_PATH"
        exit 0
    fi
fi

echo "Downloading Claude Code npm package..."
mkdir -p "$CACHE_DIR"
cd "$CACHE_DIR"

# Clean up any previous extraction
rm -rf package/ anthropic-ai-claude-code-*.tgz

# Download and extract
npm pack @anthropic-ai/claude-code 2>/dev/null
tar -xzf anthropic-ai-claude-code-*.tgz
rm -f anthropic-ai-claude-code-*.tgz

# Verify
if [[ ! -f "$CLI_PATH" ]]; then
    echo "ERROR: cli.js not found after extraction" >&2
    exit 1
fi

echo "$INSTALLED_VERSION" > "$VERSION_FILE"
echo "Extracted cli.js ($(du -h "$CLI_PATH" | cut -f1)) for version $INSTALLED_VERSION"
echo "Path: $CLI_PATH"
