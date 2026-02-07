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

## Useful patterns in Claude Code source

- **Command definitions**: Objects with `{ type: "prompt", name: "...", description: "...", getPromptForCommand(args) { ... } }` or `{ type: "local", name: "...", load: () => ... }` or `{ type: "local-jsx", ... }`
- **API calls**: Look for `querySource: "feature_name"` in options objects passed to the call helper
- **Lazy init**: `var initFoo = v(() => { /* runs once */ })` — the `v()` wrapper is a lazy initializer
- **Lazy compute**: `var getFoo = KA(() => value)` — memoized factory, returns a callable
- **Feature flags**: Check for `isEnabled: () => ...` in command definitions, and `Q8("flag_name", default)` for runtime flags
- **File paths**: `join(getClaudeConfigDir(), "subfolder")` pattern for config/data paths
- **Error handling**: `K1(err instanceof Error ? err : Error("..."))` pattern for non-fatal logging
- **Telemetry**: `l("tengu_feature_event", { key: value })` for analytics events; `Q4("feature")` for usage breadcrumbs
- **Settings**: `j6()` returns the user settings object
- **Messages**: `g6({ content })` creates a user-role message; `wJ()` converts to API format
- **Token counting**: `oP(messages)` and `yL(messages)` count tokens
- **Hooks**: `lj("event", opts)` runs lifecycle hooks; `wW6(params, signal)` runs pre-compact hooks specifically

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

These identifiers were discovered across multiple analyses. **The mangled names WILL change between Claude Code versions** since they are artifacts of minification. However, the _behavioral signatures_ (how the function is called, what string arguments it receives) remain stable. Use the "Notes" column to re-identify functions in a new version.

For example: the telemetry function is always called as `someName("tengu_*", { ... })` — search for that call pattern to find it regardless of what the minifier named it.

| Mangled | Meaning | Notes |
|---------|---------|-------|
| `v()` | Lazy initializer | Wraps module setup code |
| `KA()` | Lazy compute / memoized factory | Returns callable that caches result |
| `uA()` | Register module exports | `uA(module, { call: () => fn })` |
| `Q4()` | Feature usage tracking | Entry-point breadcrumb |
| `l()` | Telemetry event | `l("tengu_*", { ... })` |
| `h()` | Debug log | `h("msg", { level: "error" })` |
| `K1()` | Error logger (non-fatal) | Wraps in Error if needed |
| `Q8()` | Feature flag reader | `Q8("flag", default)` |
| `_6()` | Truthy check | For env vars |
| `j6()` | Settings accessor | Returns settings object |
| `g6()` | Message factory | Creates user-role messages |
| `J5()` | Default model getter | Returns model ID string |
| `oP()` / `yL()` | Token counters | Count tokens in message arrays |
| `K6` | Chalk instance | `K6.dim()`, `K6.bold()`, etc. |
| `gZ()` | UUID generator | For message IDs |
| `lj()` | Lifecycle hook runner | Returns hook results |
| `PD()` | Keybinding display | Human-readable key combo |
| `s7()` | Keyboard shortcut register | Binds handlers to contexts |
| `HP()` | Context window size getter | `HP(model, provider)` |
| `BR` | Fuse.js | Fuzzy search constructor |
| `wJ()` | To API message format | Internal → API transform |
| `wN()` | To conversation messages | Internal transform |
| `q1(N)` | React memo cache alloc | `Symbol.for("react.memo_cache_sentinel")` |
| `f` | Ink `<Text>` component | In `createElement(f, props, ...)` |
| `I` | Ink `<Box>` component | Layout container |

**Note:** These mangled names are version-specific. They will likely differ in future Claude Code releases. Always verify against the actual source.
