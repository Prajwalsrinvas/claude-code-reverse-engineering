# How Claude Code Works Internally

Reverse engineering deep dives into Claude Code's features, built by reading the minified source directly.

## Why this exists

Claude Code is not open source. The [public GitHub repo](https://github.com/anthropics/claude-code) only has plugins, examples, and changelogs — the actual CLI ships as minified JavaScript. At the time this project started, there was no official documentation explaining how `/insights` worked internally, and the only way to find out was to read the source.

That first analysis turned into a repeatable process: acquire the source, unminify with webcrack + prettier, search for anchor strings, extract the relevant code, rename identifiers, and document the findings. The process is packaged as a [Claude Code skill](skill/) so it can be reused for any feature.

**One thing changed since the project started:** the npm package no longer contains the code. As of v2.1.113 it's a thin installer that downloads a per-platform **native Bun binary**, with `cli.js` embedded in the binary's module graph. The extraction step now pulls `cli.js` out of that binary (see below); everything after that — unminify, locate, extract, document — is unchanged, because string literals survive minification intact.

All deep dives were refreshed against **Claude Code v2.1.201** (analyzed with Claude Fable 5). Each carries a "how this evolved" section comparing it to the original v2.1.34 analysis; the cross-cutting evolution story lives in [FIELD-NOTES.md](FIELD-NOTES.md).

### Feature deep dives

| Feature | What it does | Deep dive |
|---------|-------------|----------|
| **`/compact`** | Clears history while preserving a summary. Now a background precompute/borrow system with a hardened summarization prompt, circuit breaker, thrashing detector, and cache-sharing — plus a new `/autocompact` command | [deep-dives/compact/](deep-dives/compact/) |
| **`/insights`** | Reads past sessions, has Opus 4.8 extract structured facets, aggregates, generates narrative sections, and produces an HTML report | [deep-dives/insights/](deep-dives/insights/) |
| **`/usage` & `/context`** | `/stats`, `/cost`, `/usage` are now one command (a 4-tab modal): heatmap, streaks, per-model tokens, cost. `/context` visualizes context-window usage as a colored grid | [deep-dives/stats-and-context/](deep-dives/stats-and-context/) |
| **Slash command menu** | The `/` autocomplete — Fuse.js fuzzy search with weighted fields (now incl. display-name keys), exponential-decay recency scoring, and a registry that's increasingly skill-driven | [deep-dives/slash-commands/](deep-dives/slash-commands/) |

### Subsystem deep dives (new)

| Subsystem | What it covers | Deep dive |
|-----------|----------------|----------|
| **Skills** | How SKILL.md skills are discovered, parsed, merged, and invoked — the single `Skill` tool, the five-source registry, contextual loading, stacked invocation, inline vs fork | [deep-dives/skills/](deep-dives/skills/) |
| **Agents & Workflows** | The multi-agent runtime: the Agent/Task tool, background-by-default subagents, the implicit team + SendMessage, the agent authority model, depth caps, and the Dynamic Workflows engine | [deep-dives/agents-and-workflows/](deep-dives/agents-and-workflows/) |
| **Context engineering & caching** | Cache breakpoints, the cross-customer "global" cache scope, the lean system prompt, ToolSearch deferral, TTL selection, and the cache-preserving tricks (`/cd`, date-as-reminder) | [deep-dives/context-engineering/](deep-dives/context-engineering/) |
| **Remote control** | The two bridges (WebSocket REPL + HTTP worker), the control-request protocol, poll timing, push notifications, scheduling, Teleport, and the 10-condition gating chain | [deep-dives/remote-control/](deep-dives/remote-control/) |

Each deep dive folder contains a **README.md** with the full writeup (architecture diagrams, code excerpts, findings) and an **\*-annotated.js** file with the source identifiers renamed to meaningful names. The slash-commands deep dive reuses the code already extracted in the compact annotated file.

## The skill

The [`skill/`](skill/) folder contains a Claude Code custom skill that automates the analysis pipeline:

1. **Acquire source** — Extract `cli.js` from the installed native Bun binary
2. **Unminify** — webcrack (`--no-jsx`) for syntax transforms + prettier for formatting (~965K readable lines)
3. **Locate** — Search for anchor strings (string literals survive minification perfectly)
4. **Extract & annotate** — Pull out the feature's code, rename identifiers inline
5. **Analyze** — Document behavior, LLM calls, data flow
6. **Report** — Produce a markdown report with code evidence
7. **Self-reflect** — Evaluate whether the skill itself should be updated

To use it, copy `skill/` to `~/.claude/skills/analyze-cc-feature/` and invoke with `/analyze-cc-feature [feature-name]`. Requires [Claude Code](https://code.claude.com/docs) to be installed.

See [skill/SKILL.md](skill/SKILL.md) for full instructions and [skill/REFERENCE.md](skill/REFERENCE.md) for tool comparison, prior art, and a table of known mangled identifiers.

## How the source is obtained

Claude Code's CLI implementation is a minified `cli.js` (~18.7 MB at 2.1.201). It is **minified** (whitespace removed, identifiers shortened), not **obfuscated** (no control flow flattening, no string encryption). String literals — prompts, error messages, field names, telemetry events — are fully intact and serve as the primary evidence for what the code does.

Since v2.1.113 `cli.js` isn't in the npm package; it's embedded in the native Bun binary's module graph (a `.bun` ELF section on Linux). The skill's extractor pulls it out, then webcrack + prettier unminify it:

```bash
bash skill/scripts/extract-cli.sh    # locate the installed native binary, extract cli.js from its .bun section
bash skill/scripts/unminify.sh       # webcrack --no-jsx + prettier  → deobfuscated.js
```

`--no-jsx` matters: on today's ~18 MB bundle webcrack's JSX-decompile pass takes ~50 min, needs 4 GB+ RAM, and produces output Prettier can't reparse — disabling it costs only verbose `createElement` boilerplate. The result is `webcrack-output/deobfuscated.js` (~965K lines, gitignored). See [skill/scripts/extract-bun-cli.py](skill/scripts/extract-bun-cli.py) for the binary-graph parser.

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
| [webcrack](https://github.com/j4k0xb/webcrack) | Syntax unminification (run with `--no-jsx`) |
| [Prettier](https://github.com/prettier/prettier) | Code formatting |
| [Claude Code](https://code.claude.com/docs) | The analysis itself (original pass: Claude Opus 4.6; 2.1.201 refresh: Claude Fable 5) |
