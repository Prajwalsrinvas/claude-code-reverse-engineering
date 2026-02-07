# analyze-cc-feature

A [Claude Code custom skill](https://code.claude.com/docs/en/skills) that reverse engineers Claude Code's own features from its minified source.

## What it does

Given a feature keyword (e.g. `insights`, `compact`), it runs a 7-step pipeline:

1. **Acquire** — downloads `cli.js` from the npm package
2. **Unminify** — runs webcrack + prettier to produce ~712K lines of readable JS
3. **Locate** — searches for anchor strings (command names, prompts, telemetry events) to find the feature's code
4. **Extract & annotate** — pulls out the relevant code and renames mangled identifiers to meaningful names
5. **Analyze** — documents behavior, LLM calls, data flow, caching, and edge cases
6. **Report** — produces a markdown deep dive with Mermaid diagrams and line-number citations
7. **Self-reflect** — evaluates whether the analysis revealed patterns that should improve the skill itself

## Prerequisites

- [Claude Code](https://code.claude.com/docs) (the skill runs inside Claude Code)
- [Node.js](https://nodejs.org/) (for `npm` and `npx`)
- [webcrack](https://github.com/j4k0xb/webcrack) — `npm install -g webcrack` (tested with 2.15.1)
- [Prettier](https://github.com/prettier/prettier) — `npm install -g prettier` (tested with 3.8.1)

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
| `REFERENCE.md` | Stable patterns, infrastructure functions, and prior art |
| `scripts/extract-cli.sh` | Downloads cli.js from npm |
| `scripts/unminify.sh` | Runs webcrack + prettier |
