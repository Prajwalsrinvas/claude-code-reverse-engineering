# How Claude Code Works Internally

Reverse engineering deep dives into Claude Code's features, built by reading the minified source directly.

## Why this exists

Claude Code is not open source. The [public GitHub repo](https://github.com/anthropics/claude-code) only has plugins, examples, and changelogs — the actual CLI ships as minified JavaScript in the npm package. At the time this project started, there was no official documentation explaining how `/insights` worked internally, and the only way to find out was to read the source.

That first analysis turned into a repeatable process: acquire the npm package, unminify with webcrack + prettier, search for anchor strings, extract the relevant code, rename identifiers, and document the findings. The process is packaged as a [Claude Code skill](skill/) so it can be reused for any feature.

## Deep dives

| Feature | What it does | Deep dive |
|---------|-------------|----------|
| **`/insights`** | Analyzes past sessions, has Opus extract structured facets from each, aggregates stats, generates narrative sections, and produces an HTML report | [deep-dives/insights/](deep-dives/insights/) |
| **`/compact`** | Clears conversation history while preserving a detailed summary. Two paths: a session-memory fast path (no LLM call) and a standard LLM summarization path | [deep-dives/compact/](deep-dives/compact/) |
| **Slash command menu** | The `/` autocomplete dropdown — Fuse.js fuzzy search with weighted fields, exponential decay recency scoring, command registry architecture | [deep-dives/slash-commands/](deep-dives/slash-commands/) |
| **`/stats` and `/context`** | `/stats` shows historical usage statistics (GitHub-style heatmap, streaks, per-model token breakdown) from session JSONL files with incremental disk caching. `/context` visualizes current context window usage as a colored grid with token counts per category | [deep-dives/stats-and-context/](deep-dives/stats-and-context/) |

Each deep dive folder contains a **README.md** with the full writeup (architecture diagrams, code excerpts, findings). Deep dives that required substantial code extraction also include an **\*-annotated.js** file with the source identifiers renamed to meaningful names. The slash-commands deep dive reuses the code already extracted in the compact annotated file.

## The skill

The [`skill/`](skill/) folder contains a Claude Code custom skill that automates the analysis pipeline:

1. **Acquire source** — Download `cli.js` from npm (`npm pack @anthropic-ai/claude-code`)
2. **Unminify** — webcrack for syntax transforms + prettier for formatting (712K+ readable lines)
3. **Locate** — Search for anchor strings (string literals survive minification perfectly)
4. **Extract & annotate** — Pull out the feature's code, rename identifiers inline
5. **Analyze** — Document behavior, LLM calls, data flow
6. **Report** — Produce a markdown report with code evidence
7. **Self-reflect** — Evaluate whether the skill itself should be updated

To use it, copy `skill/` to `~/.claude/skills/analyze-cc-feature/` and invoke with `/analyze-cc-feature [feature-name]`. Requires [Claude Code](https://code.claude.com/docs) to be installed.

See [skill/SKILL.md](skill/SKILL.md) for full instructions and [skill/REFERENCE.md](skill/REFERENCE.md) for tool comparison, prior art, and a table of known mangled identifiers.

## How the source is obtained

Claude Code's CLI implementation ships as a minified `cli.js` (~11 MB) in the npm package. It is **minified** (whitespace removed, identifiers shortened), not **obfuscated** (no control flow flattening, no string encryption). This means string literals — prompts, error messages, field names, telemetry events — are fully intact and serve as the primary evidence for understanding what the code does.

```bash
npm pack @anthropic-ai/claude-code
tar -xzf anthropic-ai-claude-code-*.tgz
npx webcrack package/cli.js --no-unpack --no-deobfuscate --force -o webcrack-output/
npx prettier --write webcrack-output/deobfuscated.js
```

The unminified source (`deep-dives/webcrack-output/deobfuscated.js`) is gitignored at ~17 MB / 712K lines. Reproduce it with the commands above or the scripts in `skill/scripts/`.

## Prior art

Others who have reverse engineered Claude Code:

| Who | Method |
|-----|--------|
| [Martin Alderson](https://martinalderson.com/posts/minification-isnt-obfuscation-claude-code-proves-it/) | AST diffing with acorn — coined "minification isn't obfuscation" |
| [0xdevalias](https://gist.github.com/0xdevalias/d8b743efb82c0e9406fc69da0d6c6581) | Comprehensive tool/technique catalogue |
| [Sabrina](https://www.sabrina.dev/p/reverse-engineering-claude-code-using) | LLM sub-agent deobfuscation pipeline |
| [ghuntley](https://ghuntley.com/tradecraft/) | Cleanroom LLM transpilation |
| [Kir Shatrov](https://kirshatrov.com/posts/claude-code-internals) | mitmproxy API interception |
| [Reid Barber](https://www.reidbarber.com/blog/reverse-engineering-claude-code) | Reverse engineering blog |
| [ShareAI Lab](https://github.com/shareAI-lab/learn-claude-code) | Hybrid static + dynamic + LLM pipeline |

See [skill/REFERENCE.md](skill/REFERENCE.md) for the full list.

## Tools used

| Tool | Purpose |
|------|---------|
| [webcrack](https://github.com/j4k0xb/webcrack) | Syntax unminification |
| [Prettier](https://github.com/prettier/prettier) | Code formatting |
| [Claude Code](https://code.claude.com/docs) | The analysis itself (model: Claude Opus 4.6) |
