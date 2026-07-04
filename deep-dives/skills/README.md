# How Claude Code's Skills System Works

> **Analysis model:** Claude Fable 5 (`claude-fable-5`) via Claude Code CLI\
> **Date:** 2026-07-04\
> **Source:** Claude Code v2.1.201, extracted from the Bun standalone binary, unminified with webcrack (`--no-jsx`) + prettier\
> **Annotated files:** `skills-annotated.js`\
> **Build:** `2.1.201`, git `5bb45156`

Skills are Claude Code's mechanism for turning a Markdown file with YAML frontmatter into an invocable command. This deep dive covers how they're discovered, parsed, merged, exposed to the model, and executed. It's a companion to the [slash-command menu deep dive](../slash-commands/) — that one covers the *ranking surface*; this one covers *what the entries actually are*. The headline: a skill and a `/`-command are the same object type under the hood, and a large share of what look like built-in commands (`/code-review`, `/simplify`) are really bundled skills.

## Table of Contents

1. [The one-tool model](#the-one-tool-model)
2. [Where skills come from](#where-skills-come-from)
3. [Loading a SKILL.md](#loading-a-skillmd)
4. [Frontmatter fields](#frontmatter-fields)
5. [The merge and collision resolution](#the-merge-and-collision-resolution)
6. [Contextual (nested) loading](#contextual-nested-loading)
7. [Stacked invocation](#stacked-invocation)
8. [The Skill tool: inline vs fork](#the-skill-tool-inline-vs-fork)
9. [disableBundledSkills](#disablebundledskills)
10. [/reload-skills](#reload-skills)
11. [Token accounting](#token-accounting)
12. [Skills vs built-in commands](#skills-vs-built-in-commands)
13. [Key constants & flags](#key-constants--flags)
14. [Open questions](#open-questions)

---

## The one-tool model

Every skill — SKILL.md-authored, plugin-provided, MCP-served, or hardcoded — is exposed to the model through exactly **one** tool named `Skill` (`deobfuscated.js:589772`, tool-name constant `Fh = "Skill"`). Its input schema is tiny (`deobfuscated.js:589751`):

```js
Skill({
  skill: string,   // "The name of a skill from the available-skills list. Do not guess names."
  args?: string,   // "Optional arguments for the skill"
})
```

The tool's `prompt` field renders the "available-skills list" — a budgeted listing of every visible skill's name and description (see [Token accounting](#token-accounting)). So the model doesn't get one tool per skill; it gets one `Skill` tool plus a listing, and calls it by name. Typing `/name` in the composer and the model calling `Skill({skill: "name"})` are **two entry points into the same object**, resolved through the same registry lookup.

The tool's output schema is a union that already tells you the two execution modes exist (`deobfuscated.js:589755`):

```js
// inline result:
{ success, commandName, allowedTools?, model?, status: "inline" }
// forked result:
{ success, commandName, status: "forked", agentId, result }
```

## Where skills come from

Five sources, merged into one registry:

| Source | Location | `source` / `loadedFrom` |
|--------|----------|--------------------------|
| Bundled | Hardcoded JS objects shipped in the CLI | `source: "bundled"` |
| User | `~/.claude/skills/<name>/SKILL.md` | `loadedFrom: "skills"` (userSettings) |
| Project | `<project>/.claude/skills/<name>/SKILL.md` (+ ancestor dirs, + `--add-dir` dirs) | `loadedFrom: "skills"` (projectSettings) |
| Policy | Managed-settings skills tree | policySettings (gated by `CLAUDE_CODE_DISABLE_POLICY_SKILLS`) |
| Legacy | `.claude/commands/*.md` | `loadedFrom: "commands_DEPRECATED"` |
| Plugin / MCP | Installed plugins; MCP `SKILL.md` resources | `loadedFrom: "plugin"` / `"mcp"` |

## Loading a SKILL.md

One worker, `readSkillDir(dir, source)` (`deobfuscated.js:386165`), reads a directory one level deep. Each entry must be a directory (or a symlink to one) containing a top-level `SKILL.md`; anything else is skipped with a warning. There's a hard **file-size cap** — a SKILL.md over the limit is skipped with a `skill_load_too_large` warning (`deobfuscated.js:386258`). The body is parsed by the generic frontmatter splitter and the fields mapped to an internal skill object with `${CLAUDE_SKILL_DIR}` / `${CLAUDE_PROJECT_DIR}` substitution applied to tool paths.

The frontmatter parser `fm(text, filePath, opts)` (`deobfuscated.js:185503`) splits the `---\n…\n---` block and runs `Bun.YAML.parse`, retrying once after a repair pass (quote bare values with YAML-special characters, convert leading tabs to spaces) if the first parse throws. Unknown keys are **not** rejected — a shadow validator emits telemetry (`tengu_frontmatter_shadow_unknown_key`) but leaves the frontmatter untouched.

## Frontmatter fields

Verified against the skill schema (`deobfuscated.js:185388`) and the field mapper (`386009`):

| Key | Internal field | Notes |
|-----|----------------|-------|
| `name` | displayName | defaults to the directory name |
| `description` | description | auto-derived from the body if absent |
| `model` | model | `"inherit"` → parent model |
| `allowed-tools` | allowedTools | string or list; `${CLAUDE_SKILL_DIR}`/`${CLAUDE_PROJECT_DIR}` substituted |
| `disallowed-tools` | disallowedTools | deny list (added 2.1.152) |
| `argument-hint` | argumentHint | shown after the command name |
| `disable-model-invocation` | disableModelInvocation | model can't invoke; still user-typable |
| `user-invocable` | userInvocable | `false` → model-only, hidden from users |
| `effort` | effort | `low/medium/high/max` or integer |
| `shell` | shell | `bash`/`powershell` for `!`-blocks |
| `when_to_use` | whenToUse | folded into the tool-listing description |
| `paths` | paths | glob(s); makes the skill **conditional** — loads only when the model touches a matching file |
| `context` | executionContext | `"inline"` (default) or `"fork"` (spawn a subagent) |
| `agent` | agent | agent type to spawn when `context: fork` |
| `hooks` | hooks | validated against the settings hooks shape; ignored for MCP skills |
| `fallback` | fallback | thin-pointer stub that yields to a same-suffix plugin/MCP skill |

## The merge and collision resolution

`loadAllSkills` (`deobfuscated.js:386709`) loads policy + user + project (ancestor `.claude/skills` dirs, closest-first) + `--add-dir` dirs + legacy commands in parallel, then dedups **by physical file** (`fs.realpath`), not by name. Two different directories can both define a skill named `foo` and both survive this stage — name-collision resolution happens one layer up.

That upper layer (`deobfuscated.js:775281`) merges the static registry against dynamic/contextual skills and resolves name clashes by **path-qualified renaming, not silent dropping**: a colliding nested skill is kept under a `<relative-path>:<name>` name, and its description is rewritten to say it's "scoped to `sub/dir/` — use this instead of the unscoped `foo` when the files being changed are under `sub/dir/`." Both remain invocable.

Two places do genuine drops: a `fallback: true` stub is removed when a same-suffix plugin/MCP skill loads (`775425`), and duplicate `source: "bundled"` entries with the same name are removed (`775457`).

## Contextual (nested) loading

Two independent mechanisms feed the visible skill set:

1. **Ancestor scan** (`deobfuscated.js:784472`) — at session start, walk from `cwd` up to `$HOME` (or the nearest git root, whichever comes first) and load every `.claude/skills` dir found, closest-first. Loaded unconditionally.
2. **True contextual discovery** (`deobfuscated.js:386540`) — walk from each *edited file's* directory up toward the project root and register any `.claude/skills` dir found as a "dynamic skill dir" (respecting `.gitignore`). Touching a file under `some/subdir/` makes `some/subdir/.claude/skills/*` skills appear **mid-session, without a restart**. This is the 2.1.178 behavior.

There's a subtlety worth flagging (see [Open questions](#open-questions)): the changelog's "closest-directory-wins" phrasing literally describes how **agents** and **routines** resolve collisions (a depth-sorted `Map` overwrite where the deepest dir silently wins, `deobfuscated.js:784468`). Skills use the softer path-qualified renaming above instead. These look like two different policies wearing one changelog label.

## Stacked invocation

`/skill-a /skill-b do X` loads up to **5** leading skills (`deobfuscated.js:587970`, cap constant `jFl = 5` at `588195`). The parser walks leading `/name` tokens; on the 6th it stops, sets `capped = true`, and appends `Stacked command limit (5) reached — remaining input passed as arguments`. Only `type: "prompt"` skills can stack — not fork-context skills, and not ones whose args may themselves contain slash commands. Each stacked skill executes independently and its messages are appended in order; the first user message is tagged with the full original input so the transcript can reconstruct the display. (Added 2.1.199.)

## The Skill tool: inline vs fork

`Skill`'s `call` (`deobfuscated.js:589967`) branches on the skill's `context`:

- **`context: "inline"` (default)** — expands the skill body into new conversation messages appended to the *current* turn. Any `allowed-tools`/`model`/`effort` the skill declares are layered on via context layers, not a new agent.
- **`context: "fork"`** — spawns a genuine subagent through the full agent-query loop, with the skill's `agent:` frontmatter naming the agent type. The recursion guard blocks a fork-context skill from invoking itself from inside its own forked subagent. Results stream back and fold into a single tool result. (This is the bridge to the [agents & workflows](../agents-and-workflows/) machinery.)

`validateInput` resolves the skill name with fuzzy typo-suggestion (edit distance ≤ 2), and `checkPermissions` applies allow/deny rules keyed on skill name, defaulting to an interactive "ask" that can persist an allow rule.

## disableBundledSkills

`CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` (env) or `disableBundledSkills: true` (settings) — `deobfuscated.js:311810`. It treats two source tags differently, which is a genuinely useful distinction:

- **`source: "bundled"`** (real SKILL.md-shaped skills shipped in the CLI) — **removed entirely**; they never enter the registry.
- **`source: "builtin"`** (the ~150 hardcoded slash-command objects) — **stay typable but hidden from the model** (demoted from "on" to "user-invocable-only").

Plugins, `.claude/skills/`, and `.claude/commands/` are untouched. The registry cache key includes this flag's value, so flipping it mid-session correctly invalidates the memoized list. (Added 2.1.169.)

## /reload-skills

A `type: "local"` command (`deobfuscated.js:739656`) that snapshots the skill list, clears **all** skill/command caches (including the per-session conditional-skill state), re-loads, and reports "Reloaded skills: N skills available (X added, Y removed)." In safe mode, on-disk custom skills don't apply and the message says so. (Added 2.1.152.)

## Token accounting

`/context`'s per-skill token count (`deobfuscated.js:620792`) is two numbers: the fixed overhead of exposing the `Skill` tool (its schema + the rendered listing), and a per-skill estimate for each visible entry (`"- name: description"`), using a chars→tokens ratio estimate (default 4 bytes/token) rather than a real tokenizer call per skill.

The listing is budgeted (`deobfuscated.js:364111`) with escalating degradation modes: **fits** → **priority** (drop lowest-priority full entries) → **truncate** (shrink all descriptions to an equal share) → **names-only** (show bare names). Constants: overall char ceiling `200000`, default budget fraction `0.01`, max per-entry description `1536` chars (the 2.1.105 raise from 250), names-only threshold below `20` chars. Overridable via `SLASH_COMMAND_TOOL_CHAR_BUDGET`.

## Skills vs built-in commands

Everything flows through one merged registry (`deobfuscated.js:775877`) that feeds both slash-command typing and the `Skill` tool. The ~150 hardcoded commands (`/compact`, `/clear`, `/rewind`, …) are merged into the same array shape as skills and pass through the same `type` discriminator:

- **`type: "prompt"`** = a skill: its body came from Markdown (SKILL.md, `.claude/commands/*.md`, a plugin skill, or an MCP prompt). Has a `loadedFrom` value.
- **`type: "local"`** = a TS-implemented command with a `call()` handler. Has `source: "builtin"`, no `loadedFrom`.
- **`type: "local-jsx"`** = renders a React/Ink UI.

Both skills and built-ins go through the same name lookup, the same visibility gate, the same collision resolution, and the same `Skill` tool `call()` when invoked by name. This is *why* `/code-review` and `/simplify` show up as skills, not commands — they're `type: "prompt"` entries with Markdown bodies.

## Key constants & flags

| Constant / flag | Value | Purpose |
|-----------------|-------|---------|
| Stacked-skill cap | 5 | Max leading `/skills` per turn |
| Tool name | `"Skill"` | The single skill-invocation tool |
| Max description chars | 1,536 | Per-skill description in the tool listing |
| Names-only threshold | 20 | Below this, listing degrades to bare names |
| Listing char ceiling | 200,000 | Overall budget cap |
| Default budget fraction | 0.01 | Fraction of the ceiling actually used |
| `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` | bool | Remove bundled skills; hide built-ins from the model |
| `CLAUDE_CODE_DISABLE_POLICY_SKILLS` | bool | Disable the managed/policy skills tree |
| `SLASH_COMMAND_TOOL_CHAR_BUDGET` | number | Override the listing char budget (testing) |

## Open questions

Two items could not be fully confirmed from the source, and are worth stating honestly rather than asserting:

1. **Case-insensitive frontmatter keys (2.1.186).** The parser `fm()` is called everywhere with `{ normalizeKeys: true }`, but its function body (`deobfuscated.js:185503`) never reads that third argument, and the kebab/snake case-folding table (`185451`) has no other call site. Either the normalization happens on a path not found here, or this wiring is vestigial in this build. Verified directly: `fm`'s third parameter is unused in the parse path.
2. **"Closest-directory-wins" for skills.** As above, the depth-sorted silent-overwrite that matches that phrase is used for agents and routines; skills instead do path-qualified renaming where both entries survive. Possibly two features conflated under one changelog line.
