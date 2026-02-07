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
| **webcrack** | [j4k0xb/webcrack](https://github.com/j4k0xb/webcrack) | Unminify syntax, deobfuscate, unpack webpack | Always — first pass. Use `--no-unpack --no-deobfuscate` for Claude Code (it's not webpack-bundled or obfuscated) |
| **Prettier** | [prettier/prettier](https://github.com/prettier/prettier) | AST-aware formatting | Always — second pass after webcrack |
| **humanify** | [jehna/humanify](https://github.com/jehna/humanify) | webcrack + LLM variable rename via Babel AST | Technique reference for rename approach |
| **wakaru** | [pionxzh/wakaru](https://github.com/pionxzh/wakaru) | Reverse transpilation, heuristic rename | Limited — only handles destructuring/React patterns |
| **js-beautify** | [beautifier/js-beautify](https://github.com/beautifier/js-beautify) | Whitespace/indentation only | Not needed if using webcrack + prettier |

## Source acquisition

### npm package (recommended)

```bash
npm pack @anthropic-ai/claude-code
tar -xzf anthropic-ai-claude-code-*.tgz
# cli.js is at package/cli.js (~11 MB)
```

### Bun binary

Location: `~/.local/share/claude/versions/{version}`

The binary is a standard Bun standalone executable (ELF). JavaScript is embedded as plaintext, not bytecode.

**Binary format:**
- Trailer: `\n---- Bun! ----\n` at offset `size-24` to `size-8`
- Total byte count (uint32 LE) at offset `size-8`
- Module offset info at `size-48` (offsetByteCount), `size-44` (entrypointId), `size-40` (modulesPtrOffset), `size-36` (modulesPtrLength)
- Reference: [bun-decompile/src/lib/index.ts](https://github.com/lafkpages/bun-decompile/blob/main/src/lib/index.ts)
- Bun docs: [Single-file executable](https://bun.com/docs/bundler/executables)

### Source maps

Do not exist for Claude Code. Checked across:
- npm `cli.js`: no `sourceMappingURL` comment, no `.map` files
- Bun binary: `sourceMappingURL` string exists only as Bun runtime internals
- Early npm versions (0.2.9, 0.2.14, 0.2.18, 0.2.25): only SDK vendor `.map` files

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

**The mangled names WILL change between Claude Code versions** since they are artifacts of minification. The _behavior patterns_ and _evidence signatures_ (the third column) are stable — use those to re-identify the functions in a new version. For example, the telemetry function will always be called with `("tengu_*", { ... })` regardless of what the minifier names it.

| Mangled | Meaning | Evidence (stable across versions) |
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
