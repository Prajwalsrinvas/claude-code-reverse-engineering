# How Claude Code Does Context Engineering & Prompt Caching

> **Analysis model:** Claude Fable 5 (`claude-fable-5`) via Claude Code CLI\
> **Date:** 2026-07-04\
> **Source:** Claude Code v2.1.201, extracted from the Bun standalone binary, unminified with webcrack (`--no-jsx`) + prettier\
> **Annotated files:** `context-engineering-annotated.js`\
> **Build:** `2.1.201`, git `5bb45156`

This dive is about the plumbing that decides what goes into the API request and how much of it can be cached — the prompt-cache breakpoints, the "global" cross-customer cache scope, the lean system prompt, ToolSearch deferral, TTL selection, and the small design choices (date placement, `/cd`) that exist purely to avoid busting the cache. Much of it was cross-checked against the live system prompt of the session that produced the analysis, so several claims are "the code says X, and the running transcript shows X."

## Table of Contents

1. [Cache breakpoints](#cache-breakpoints)
2. [The global cache scope](#the-global-cache-scope)
3. [The lean system prompt (and why Sonnet 5 gets it anyway)](#the-lean-system-prompt-and-why-sonnet-5-gets-it-anyway)
4. [ToolSearch deferral enables the global cache](#toolsearch-deferral-enables-the-global-cache)
5. [TTL selection: 1h vs 5m](#ttl-selection-1h-vs-5m)
6. [Keeping the date out of the cached prompt](#keeping-the-date-out-of-the-cached-prompt)
7. [/cd without busting the cache](#cd-without-busting-the-cache)
8. [Cache-eligible background summaries](#cache-eligible-background-summaries)
9. [Env vars & flags](#env-vars--flags)
10. [Open questions](#open-questions)

---

## Cache breakpoints

Anthropic's API allows up to 4 `cache_control` breakpoints per request. Claude Code places them in two regions:

- **Messages** (`deobfuscated.js:619536`): a set of message indices get a `cache_control` block on their last content block. In steady state that's **1 breakpoint** — the end of the rolling conversation window. A **2nd** appears when a pinned fold/compaction marker (`stablePrefixUuid`) or a fork point (`forkPointUuid`) resolves earlier than the tail. Every call emits `tengu_api_cache_breakpoints` telemetry with `markerCount`, `forkPointPinned`, `foldTurnStartPinned`.
- **System prompt** (`deobfuscated.js:615053`): each cacheable text block gets its own `cache_control`, tagged with a scope (next section).

The `cache_control` object itself (`deobfuscated.js:616209`):

```js
function ephemeralCacheControl({ scope, ttl } = {}) {
  return { type: "ephemeral", ...(ttl && { ttl }), ...(scope === "global" && { scope }) };
}
```

A typical request ends up with roughly 2–4 breakpoints total (1–2 in `system`, 1–2 in `messages`).

## The global cache scope

This is the most interesting piece. Claude Code splits its assembled system prompt at a sentinel constant (`deobfuscated.js:74545`):

```js
var SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";
```

Blocks **before** the boundary are the static, byte-identical-across-every-install content (the "You are an interactive agent…" identity line and the `# Harness` bullets). Blocks **after** it are genuinely per-user/per-repo (CLAUDE.md, memory index, env info, email, date). The splitter (`deobfuscated.js:615053`) tags them:

| Segment | `cacheScope` | Why |
|---------|--------------|-----|
| Static prefix (identity + Harness) | `"global"` | Identical across all installs → cache once, cross-customer |
| Dynamic suffix (CLAUDE.md, memory, env, email, date) | `"org"` | Per-user/org |
| Billing header + "You are Claude Code…" identity line | `null` (never cached) | Billing header likely carries a per-request nonce |

The `scope: "global"` field is a beta cross-customer cache scope: the static Harness/identity text is the same for everyone, so it can be cached once globally rather than per-account. It only applies to the system prompt's static prefix, never to per-message breakpoints. Eligibility is gated (`deobfuscated.js:169245`) to first-party / anthropic_aws backends with extended betas and an account-level entitlement.

## The lean system prompt (and why Sonnet 5 gets it anyway)

Since 2.1.154 most models get a **lean** system prompt — just the identity line, the security notice, and the `# Harness` bullets, with tone/style/coding-instructions/environment/tools sections dropped (they're covered by tool descriptions and system-reminders instead).

The model gate has a twist worth documenting, because it shows how much of this is server-tunable after ship. The hardcoded rule (`deobfuscated.js:168850`) forces the **classic** (full) prompt for anything whose model id contains `"sonnet"` — which includes `claude-sonnet-5`:

```js
function requiresClassicPrompt(model) {
  // ...
  if (model.includes("claude-3-") || model.includes("haiku") ||
      model.includes("sonnet") || model === "claude-opus-4-0" /* … 4-1,4-5,4-6,4-7 */)
    return true;
  return !isKnownCurrentModel();
}
```

But `shouldUseLeanPrompt` is `!requiresClassicPrompt(model) || remoteLeanOverride(model)`, and `remoteLeanOverride` (`deobfuscated.js:168838`) is a live remote-config carve-out — a `simple_system_prompt` map and the `tengu_velvet_cascade` experiment's `models` array can flip a model back to lean even when the hardcoded rule says classic. In the analysis session (running `claude-sonnet-5`), the **lean** prompt rendered — so the 2.1.154 changelog line ("lean is default for all models except Haiku/Sonnet/Opus-4.7-and-earlier") is **already stale for Sonnet 5**, changed via server config without a client release. `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT` forces it either direction.

## ToolSearch deferral enables the global cache

The global cache scope is only safe when the cached prefix is truly identical across installs — which means no per-org MCP tool schemas can be inlined in it. This is exactly what ToolSearch's deferral buys (`deobfuscated.js:616991`):

```js
let globalEligible = globalCacheEligible();
let isDeferred = tool => useToolSearch && (deferredSet.has(tool.name) || alwaysEager(tool));
let hasEagerMcpTool = globalEligible && toolList.some(t => t.isMcp && !isDeferred(t));
let globalCacheStrategy = globalEligible ? (hasEagerMcpTool ? "none" : "system_prompt") : "none";
```

Read: if **any** MCP tool schema is eagerly loaded (not deferred), global system-prompt caching is switched off, because that per-org schema would pollute the supposedly-universal cached prefix. ToolSearch keeps MCP schemas out of the eagerly-sent prompt (they load on demand), so the static prefix stays byte-identical and the global scope is usable. This is the mechanism behind changelog 2.1.128 ("global system-prompt caching now works with ToolSearch").

The `alwaysLoad` MCP option (2.1.121) opts a specific tool *out* of deferral (propagated as `_meta["anthropic/alwaysLoad"]`); setting it on any MCP tool pushes the session into the `"none"` global-cache strategy.

## TTL selection: 1h vs 5m

`resolveTtl` (`deobfuscated.js:616216`) picks the cache TTL:

1. `FORCE_PROMPT_CACHING_5M` set → always 5m (overrides everything).
2. else `ENABLE_PROMPT_CACHING_1H` (or Bedrock + `ENABLE_PROMPT_CACHING_1H_BEDROCK`) → always 1h.
3. else eligible only on first-party/AWS/Foundry backends and not on usage-overage.
4. If eligible, 1h is gated **per query source** via `tengu_prompt_cache_1h_config`, default allowlist `["repl_main_thread*", "sdk", "auto_mode", "memdir_relevance"]`.

So by default only the main REPL loop, SDK callers, auto-mode, and memory-relevance side calls get 1h caching; most ad-hoc/classifier calls stay on the 5-minute default. Per-family kill switches exist too: `DISABLE_PROMPT_CACHING` and `_HAIKU`/`_SONNET`/`_OPUS`/`_FABLE`/`_MYTHOS`.

## Keeping the date out of the cached prompt

Since 2.1.42 the current date is deliberately **not** in the cached `system` array. `buildUserEnvContext` (`deobfuscated.js:318505`) puts `currentDate: "Today's date is …"` into a `<system-reminder>`-wrapped prepended message (`isMeta: true`), which sits *after* the dynamic boundary marker — structurally outside the global-cached prefix. A daily date change therefore never invalidates the cross-customer global cache; it only affects the per-session prefix, which resets each session start anyway.

Mid-session midnight rollover is handled the same way — as a message, not a system-prompt edit: *"The date has changed. Today's date is now … DO NOT mention this to the user explicitly because they are already aware."*

## /cd without busting the cache

`/cd` (`deobfuscated.js:644769`) moves the session to a new working directory — and pointedly **never rebuilds the system prompt**. `relocateSession` (`deobfuscated.js:644202`) does `process.chdir`, moves the transcript, clears a couple of local caches, and appends a plain conversational notice:

> The session's working directory has changed to `<path>`… The environment block at the start of this conversation still names the previous directory — that information is stale. All tool calls and relative paths now resolve from `<path>`.

Because the `system` array text is untouched, its hash is untouched, so the existing cache breakpoint over it keeps hitting. The stale cwd in the cached environment block is left stale *on purpose* — the model is just told to ignore it. This is the literal mechanism behind "2.1.169: `/cd` added to move directories without breaking the prompt cache." (The same validation backs a `set_cwd` remote-control request — see the [remote control dive](../remote-control/).)

## Cache-eligible background summaries

Two background call sites — `/compact`'s summarization and the periodic "agent summary" poller that describes an agent's latest action in 3–5 words for the progress UI — were made cache-eligible in 2.1.128 (the "~3× cache_creation reduction"). Both fork the parent conversation: they pass a slice of the parent's real messages plus its system prompt into a shared forked-query helper with `skipCacheWrite: true` and a `forkPointUuid` set to the parent's effective tail message (`deobfuscated.js:609708`).

The effect: the summary call **cache-reads** the parent's already-cached prefix up to the fork point and does **not** write a new cache entry for its own small appended prompt. Before this, each timer-fired summary forked a slightly different prefix and paid a fresh `cache_creation` each time. A `querySource` set (`prompt_suggestion`, `away_summary`, `agent_summary`, `memdir_aki_extract`) marks these as a distinct "cheap background call" class throughout the caching and compaction code.

## Env vars & flags

| Name | Effect |
|------|--------|
| `ENABLE_PROMPT_CACHING_1H` / `_BEDROCK` | Force 1h cache TTL |
| `FORCE_PROMPT_CACHING_5M` | Force 5m TTL (overrides 1h) |
| `DISABLE_PROMPT_CACHING` + `_HAIKU`/`_SONNET`/`_OPUS`/`_FABLE`/`_MYTHOS` | Cache kill switches (global / per family) |
| `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT` | Force lean prompt on/off |
| `CLAUDE_CODE_SIMPLE` | Collapse the env block to bare `CWD:`/`Date:` lines |
| `--exclude-dynamic-system-prompt-sections` | Move cwd/env/git-status/memory out of the cached system prompt into the first message, for cross-user cache reuse in `--print`/SDK mode (2.1.98) |
| `CLAUDE_CODE_EXTRA_BODY` | Arbitrary JSON merged into the request body |
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` | Disables extended betas → disables the global cache scope |

## Open questions

Flagged honestly rather than asserted:

1. **Attestation-token churn fix (2.1.181).** No distinct client-side code path was found matching "per-request attestation tokens breaking caching on custom `ANTHROPIC_BASE_URL`/Foundry." The only `attestation` hits relate to remote-control device attestation. Likely a server/proxy-side fix with no client artifact.
2. **Sonnet-5-specific mid-conversation system-role removal (2.1.201).** The general mechanism exists (`api_system`-role messages, gated with a fallback that strips and rebuilds without them), but it wasn't confirmed to be keyed specifically to Sonnet 5 vs. other models.
3. **The `scope: "global"` wire semantics** are a beta/internal Anthropic API feature not in public docs; behavior here is inferred from Claude Code's client-side usage only.
