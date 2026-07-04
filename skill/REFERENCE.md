# Reference: Claude Code Reverse Engineering

## Minified vs obfuscated

Claude Code's `cli.js` is **minified**, not **obfuscated**. The distinction matters:

| Technique | What it does | Reversible? | Claude Code? |
|-----------|-------------|-------------|--------------|
| **Minification** | Removes whitespace, shortens identifiers, tree-shakes dead code | Mostly (structure recoverable, names lost) | Yes |
| **Obfuscation** | Control flow flattening, string encryption, dead code insertion, opaque predicates | Partially (requires dedicated deobfuscation) | No |

webcrack is run with `--no-deobfuscate` because there is nothing to deobfuscate. It only reverses syntax-level minification transforms (comma expressions → statements, sequence expressions → blocks, etc.). The output file is called `deobfuscated.js` by webcrack convention.

**Key implication:** String literals, object property names, and API shapes are fully intact in the minified source. They are the primary evidence for understanding what the code does.

## Tool comparison

| Tool | Repo | Does | When to use |
|------|------|------|-------------|
| **webcrack** | [j4k0xb/webcrack](https://github.com/j4k0xb/webcrack) | Unminify syntax, deobfuscate, unpack webpack | Always — first pass. Use `--no-unpack --no-deobfuscate --no-jsx` for Claude Code. `--no-jsx` matters: on the ~18 MB bundle the JSX-decompile pass takes ~50 min, needs 4 GB+ RAM, and currently produces output Prettier can't reparse. Run it (if needed) only on an already-extracted module. |
| **Prettier** | [prettier/prettier](https://github.com/prettier/prettier) | AST-aware formatting | Always — second pass after webcrack |
| **humanify** | [jehna/humanify](https://github.com/jehna/humanify) | webcrack + LLM variable rename via Babel AST | Technique reference for rename approach |
| **wakaru** | [pionxzh/wakaru](https://github.com/pionxzh/wakaru) | Reverse transpilation, heuristic rename | Limited — only handles destructuring/React patterns |
| **js-beautify** | [beautifier/js-beautify](https://github.com/beautifier/js-beautify) | Whitespace/indentation only | Not needed if using webcrack + prettier |

## Source acquisition

### The npm package no longer contains code (since v2.1.113)

`npm pack @anthropic-ai/claude-code` now yields a ~170 KB **thin installer**: `install.cjs`, `cli-wrapper.cjs`, and a set of per-platform `optionalDependencies` (`@anthropic-ai/claude-code-linux-x64`, `-darwin-arm64`, etc.). There is no `cli.js` in it. The real CLI is a per-platform native **Bun standalone executable** (~250 MB) shipped in the platform package / installed under `~/.local/share/claude/versions/`.

Two ways to get the binary:

```bash
# (a) use the already-installed binary (what extract-cli.sh does):
ls ~/.local/share/claude/versions/          # pick your version

# (b) fetch the platform tarball explicitly:
npm pack @anthropic-ai/claude-code-linux-x64   # → package/claude (the ELF binary)
```

Then extract `cli.js` from the binary's module graph with `scripts/extract-bun-cli.py`.

### Bun binary format (current layout)

The binary is a Bun standalone executable. JavaScript is embedded as **plaintext**, alongside a large **precompiled Bun bytecode blob** (`@bytecode` pragma — for startup speed) and native addons.

Unlike the older end-of-file-append layout that [bun-decompile](https://github.com/lafkpages/bun-decompile/blob/main/src/lib/index.ts) documents, on the current Linux binary the module graph lives in a dedicated **`.bun` ELF section** (`readelf -S`), and the metadata records are **52 bytes** each. `scripts/extract-bun-cli.py` handles this: it takes the `.bun` section bounds as the graph blob, scans the tail for the `/$bunfs/root/...` path table, matches each path to its record (`<flags u32><pathOff u32><pathLen u32><contentsOff u32><contentsLen u32>…`, offsets relative to `blobStart+8`), and writes out each module.

The five modules in the 2.1.201 binary:

| Module | Size | What |
|--------|------|------|
| `cli.js` | ~18.7 MB | The entrypoint bundle — unminify this |
| Bun bytecode blob | ~144 MB | Precompiled bytecode for fast startup |
| `image-processor.node` | ~1.5 MB | Rust NAPI addon — image resize/encode + clipboard image read |
| `audio-capture.node` | ~0.5 MB | Rust NAPI addon — voice/dictation capture |
| `image-processor.js` / `audio-capture.js` | ~2 KB each | Tiny CJS shims that `require` the `.node` addons |

Bun docs: [Single-file executable](https://bun.com/docs/bundler/executables).

### Source maps

Do not exist in the shipped artifact. **Exception (a leak, not a feature):** on 2026-03-31 the v2.1.88 build was briefly published to npm with a 59.7 MB source map exposing the original TypeScript (~1,884 files); Anthropic unpublished it within a day. This skill deliberately reads the **shipped binary**, not that leak — it's provenance-clean, and 2.1.88 predates a large share of current behavior anyway. If you ever cross-reference the leaked TS, treat it as a stale hint only.

## Prior art

| Who | Method | Link |
|-----|--------|------|
| dnakov | Source map extraction (DMCA'd) | [github.com/dnakov/claude-code](https://github.com/dnakov/claude-code) |
| Kir Shatrov | mitmproxy API interception | [kirshatrov.com](https://kirshatrov.com/posts/claude-code-internals) |
| Lee Han Chung | npm pack + manual search | [leehanchung.github.io](https://leehanchung.github.io/blogs/2025/03/07/claude-code/) |
| Travis Fischer | Extracted system prompts from minified JS | [gist](https://gist.github.com/transitive-bullshit/487c9cb52c75a9701d312334ed53b20c) |
| Reid Barber | Reverse engineering blog | [reidbarber.com](https://www.reidbarber.com/blog/reverse-engineering-claude-code) |
| Yuyz0112 | Monkey-patch cli.js + API logging | [github.com/Yuyz0112/claude-code-reverse](https://github.com/Yuyz0112/claude-code-reverse) |
| Sabrina | LLM sub-agent deobfuscation pipeline | [sabrina.dev](https://www.sabrina.dev/p/reverse-engineering-claude-code-using) |
| Martin Alderson | AST diffing with acorn | [martinalderson.com](https://martinalderson.com/posts/minification-isnt-obfuscation-claude-code-proves-it/) |
| ShareAI Lab | Hybrid static + dynamic + LLM pipeline | [github.com/shareAI-lab/learn-claude-code](https://github.com/shareAI-lab/learn-claude-code) |
| ghuntley | Cleanroom LLM transpilation | [ghuntley.com](https://ghuntley.com/tradecraft/) |
| 0xdevalias | Comprehensive tool/technique catalogue | [gist](https://gist.github.com/0xdevalias/d8b743efb82c0e9406fc69da0d6c6581) |

## Command registry architecture

Commands are collected from multiple sources and merged into a single list:

```
getAllCommands(mcpClients) =
  bundledSkills          (shipped with Claude Code)
  + skillDirCommands     (~/.claude/commands/*.md, .claude/commands/*.md)
  + mcpCommands          (from MCP server connections)
  + pluginSkills         (from installed plugins)
  + policyCommands       (from organization policies)
  + builtinCommands      (hardcoded ~60+ commands)
  + remoteCommands       (from remote/paired sessions, inserted before built-ins)
```

Filtered by `cmd.isEnabled()`. Commands with `isHidden: true` are callable but don't appear in the autocomplete menu.

The autocomplete menu uses **Fuse.js** for fuzzy matching with weighted fields (command name 3x, parts 2x, aliases 2x, description 0.5x) and **exponential decay recency scoring** (7-day half-life) to rank recently-used commands higher.

## Mangled identifier reference

These infrastructure functions appear across the codebase. Recognizing them speeds up analysis by providing a starting hypothesis for what a function does.

**The mangled names in the first column below are from the 2.1.34 build and are already ALL wrong for 2.1.201** — confirmed during the 2.1.201 refresh, essentially every single-token identifier changed. Do not grep for them. The durable part is the **third column** (behavior patterns / string signatures). Re-identify a function by its stable anchors: the telemetry function is always called with `("tengu_*", { ... })`; the compact summarization system prompt is always the literal `"You are a helpful AI assistant tasked with summarizing conversations."`; a model resolver always returns a registry entry whose `id` is a literal like `"claude-opus-4-8"`. Anchor on strings, then read outward.

| Mangled (2.1.34, historical) | Meaning | Evidence (stable across versions) |
|---------|---------|----------|
| `v(() => { ... })` | Lazy initializer (runs once on first access) | Used to wrap every module's setup code |
| `Q4("name")` | Track feature usage / telemetry breadcrumb | Called at entry of every command with the command name |
| `l("event_name", { ... })` | Track telemetry event with properties | `"tengu_compact"`, `"tengu_input_command"`, etc. |
| `h("message", { level })` | Debug logging | Used throughout with `level: "error"`, `"warn"`, etc. |
| `K1(err)` | Log error (non-fatal) | `K1(err instanceof Error ? err : Error(String(err)))` |
| `Q8("flag_name", default)` | Read feature flag | `Q8("tengu_compact_cache_prefix", false)` |
| `_6(value)` | Check if value is truthy | Used for env var checks: `_6(process.env.DISABLE_COMPACT)` |
| `j6()` | Get user settings object | Returns `{ autoCompactEnabled, skillUsage, ... }` |
| `g6({ content })` | Create a user-role message object | Used to build conversation messages |
| `J5()` | Get the default/current model | Returns model identifier string |
| `KA(() => ...)` | Lazy compute (memoized factory) | Like `v()` but returns a callable that caches its result |
| `uA(obj, { key: () => val })` | Register module exports | `uA(module, { call: () => entryFunction })` |
| `oP(messages)` | Count tokens in messages | Returns token count number |
| `yL(messages)` | Count tokens (alternate) | Also returns token count |
| `K6.dim(text)` | Chalk dim styling | `K6` = chalk instance |
| `gZ()` | Generate UUID | Used for message UUIDs |
| `lj("event", opts)` | Run lifecycle hooks | Returns hook results array |
| `wW6(params, signal)` | Run pre-compact hooks | Pre-compact hook runner specifically |
| `PD("action", "Context", "key")` | Get keybinding display string | e.g., `PD("app:toggleTranscript", "Global", "ctrl+o")` |
| `s7(handlers, opts)` | Register keyboard shortcuts | Binds action handlers to key contexts |
| `BR` | Fuse.js constructor | Fuzzy search library used for command matching |
| `wJ(messages)` | Convert to API message format | Transforms internal messages to API format |
| `wN(messages)` | Convert to conversation messages | Transforms for internal processing |
| `HP(model, provider)` | Get model context window size | Returns token limit for the model |
| `q1(N)` | React memo cache alloc | `Symbol.for("react.memo_cache_sentinel")` — verbose but mechanical memoization boilerplate |
| `f` | Ink `<Text>` component | In `createElement(f, { dimColor: true }, ...)` |
| `I` | Ink `<Box>` component | Layout container in `createElement(I, { ... }, ...)` |

**Note:** These mangled names are version-specific. They will likely differ in future Claude Code releases. Always verify against the actual source.

## Anchor strings for locating subsystems (2.1.201-verified)

String literals survive minification perfectly and are the fastest way to jump to a feature. These held in 2.1.201 and are unlikely to churn much (they're user-facing text, prompts, telemetry, or API field names):

| Subsystem | High-signal anchors |
|-----------|---------------------|
| `/compact` | `"You are a helpful AI assistant tasked with summarizing conversations."`, `"CRITICAL: Respond with TEXT ONLY"`, `tengu_compact`, `tengu_auto_compact_circuit_breaker`, `"Autocompact is thrashing"` |
| `/insights` | `"RESPOND WITH ONLY A VALID JSON OBJECT"`, `record_facets`, `goal_categories`, `at_a_glance`, `warmup_minimal`, `"CC FEATURES REFERENCE"` |
| `/usage` (stats/cost) | `aliases: ["cost", "stats"]`, `stats-cache.json`, `"War and Peace"` (fun facts), heatmap glyphs `░▒▓█` |
| `/context` | grid glyphs `⛁ ⛀ ⛶ ⛝`, `"MCP tools (deferred)"`, `get_context_usage` |
| Slash-command menu | Fuse keys `commandName`/`displayName`/`aliasKey`, `threshold: 0.3` |
| Skills | `SKILL.md`, `.claude/skills`, `allowed-tools`, `disallowed-tools`, `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` |
| Agents / Workflows | `subagent_type`, `SendMessage`, `run_in_background`, `ultracode`, `/workflows`; note `TeamCreate`/`TeamDelete` are **absent** (removed 2.1.178) |
| Caching / context-eng | `cache_control`, `ephemeral`, `ENABLE_PROMPT_CACHING_1H`, `ToolSearch`, `<system-reminder>` |
| Remote control | `thinClientDispatch`, `control-request`, `get_context_usage`, poll-interval constants |

Model IDs live in a central registry array (each entry has `id`, `family`, `display_name`, `provider_ids`, `knowledge_cutoff`). Grep a known ID like `"claude-opus-4-8"` or `"claude-fable-5"` to find it, then trace which resolver a feature calls to learn what model it uses.
