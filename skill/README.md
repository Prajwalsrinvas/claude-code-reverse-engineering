# analyze-cc-feature

A [Claude Code custom skill](https://code.claude.com/docs/en/skills) that reverse engineers Claude Code's own features from its minified source.

## What it does

Given a feature keyword (e.g. `insights`, `compact`), it runs a 7-step pipeline:

1. **Acquire** — extracts `cli.js` from the installed native Bun binary (the npm package no longer ships code)
2. **Unminify** — runs webcrack (`--no-jsx`) + prettier to produce ~965K lines of readable JS
3. **Locate** — searches for anchor strings (command names, prompts, telemetry events) to find the feature's code
4. **Extract & annotate** — pulls out the relevant code and renames mangled identifiers to meaningful names
5. **Analyze** — documents behavior, LLM calls, data flow, caching, and edge cases
6. **Report** — produces a markdown deep dive with Mermaid diagrams and line-number citations
7. **Self-reflect** — evaluates whether the analysis revealed patterns that should improve the skill itself

## Prerequisites

- [Claude Code](https://code.claude.com/docs) installed as the native binary (the skill extracts source from it)
- [Node.js](https://nodejs.org/) (for `npx`) and Python 3 (for the binary extractor)
- `readelf`/`file` (binutils) — used by the extractor to find the `.bun` section on Linux
- [webcrack](https://github.com/j4k0xb/webcrack) — run via `npx webcrack@2` (tested with 2.16.0)
- [Prettier](https://github.com/prettier/prettier) — run via `npx prettier@3`

## Installation

```bash
cp -r skill/ ~/.claude/skills/analyze-cc-feature/
```

## Usage

```
/analyze-cc-feature how does /compact work
```

Or just ask Claude Code to analyze a feature — the skill's description lets Claude invoke it automatically when relevant.

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Main skill instructions (the pipeline) |
| `REFERENCE.md` | Stable patterns, infrastructure functions, anchor strings, and prior art |
| `scripts/extract-cli.sh` | Locates the installed native binary and extracts cli.js from it |
| `scripts/extract-bun-cli.py` | Parses the Bun binary module graph (`.bun` ELF section) to pull out cli.js |
| `scripts/unminify.sh` | Runs webcrack (`--no-jsx`) + prettier |
