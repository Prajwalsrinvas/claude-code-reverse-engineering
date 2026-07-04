// ============================================================================
// Claude Code — Context engineering & prompt caching — annotated extraction
// Source: Claude Code npm package v2.1.201, webcrack --no-jsx + prettier
// Date extracted: 2026-07-04
//
// This is a NEW deep dive (no prior version to diff against). Scope: how
// Claude Code places `cache_control` breakpoints on outgoing API requests,
// the lean vs full system prompt split, ToolSearch/MCP deferral, the /cd
// cache-preserving directory move, and related env vars/flags.
//
// Identifiers below are RENAMED from the mangled source for readability.
// Every renamed symbol carries a `// deobfuscated.js:NNNNN` line reference to
// the original. Renames are inferred from string literals, telemetry event
// names, and call-site usage; anything not fully certain is flagged
// `/* uncertain */`. Full evidence + line cites: see ev-ctxeng.md.
//
// LIVE CONFIRMATION: this agent's own harness system prompt (visible at the
// top of its transcript) is a byte-for-byte match for the "lean" prompt
// template below (leanSystemPrompt()/yLp), including the literal marker
// string SYSTEM_PROMPT_BOUNDARY_MARKER ("__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__")
// and the securityNoticeBlock (zho) text. Several sections below are
// annotated with the exact matching text from that live prompt.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. Cache breakpoint placement on messages — deobfuscated.js:619536-619603
// ----------------------------------------------------------------------------
// buildCachedMessagesForAPI(messages, cachingEnabled, ttl, skipCacheWrite,
//                            forkPointUuid, stablePrefixUuid)
function buildCachedMessagesForAPI(e, t, n, r = false, o, s) {  // was xVf
  // Walk backward past any api_system (mid-conversation system-role) entries
  // to find the last "real" message index.
  let lastRealIndex = f => {
    let m = f;
    while (m >= 0 && e[m].type === "api_system") m--;
    return m;
  };
  let a = lastRealIndex(e.length - 1);
  if (r /* skipCacheWrite */) a = lastRealIndex(a - 1);   // step back one more

  let breakpoints = new Set();               // was l — set of message indices to cache_control
  if (a >= 0) breakpoints.add(a);             // breakpoint #1: end of conversation (rolling window)

  let stablePrefixPinned = false;             // was c
  let stablePrefixIdx = -1;                   // was u
  if (s /* stablePrefixUuid */) {
    let f = e.findLastIndex(m => m.uuid === s);
    if (f >= 0 && f < a) stablePrefixIdx = lastRealIndex(f);
  }

  let forkPointPinned = false;                // was d
  if (isExtendedBetaFlow() && o /* forkPointUuid */) {         // uXe()
    let f = e.findLastIndex(m => m.uuid === o);
    if (f >= 0 && f <= a) {
      let m = r && f === a && shouldStepBackForCacheWrite() ? lastRealIndex(f - 1) : f;  // b4l()
      if (m >= 0) { breakpoints.add(m); forkPointPinned = true; }
    }
  } else if (extendedBetasEnabled() /* xL() */) {
    if (stablePrefixIdx >= 0) {
      breakpoints.add(stablePrefixIdx);       // breakpoint #2: pinned "fold"/stable-prefix marker
      stablePrefixPinned = true;
    } else if (isExtendedBetaFlow() && !r) {
      let f = lastRealIndex(a - 1);
      if (f >= 0) { breakpoints.add(f); forkPointPinned = true; }
    }
  }

  // Telemetry: exactly how many breakpoints this request carries and why.
  q("tengu_api_cache_breakpoints", {
    totalMessageCount: e.length,
    cachingEnabled: t,
    skipCacheWrite: r,
    forkPointPinned: forkPointPinned,
    foldTurnStartRequested: s !== undefined,
    foldTurnStartPinned: stablePrefixPinned,
    markerCount: breakpoints.size,       // observed: 1 (steady state) or 2 (fork/fold present)
  });

  return e.map((f, m) => {
    let isBreakpoint = breakpoints.has(m);
    if (f.type === "user") return buildUserMessageForAPI(f, isBreakpoint, t, n);       // mVf
    if (f.type === "api_system") return { role: "system", content: f.message.content };
    return buildAssistantMessageForAPI(f, isBreakpoint, t, n);                        // gVf
  });
}

// cache_control on the LAST content block of a breakpointed user/assistant
// message. deobfuscated.js:616389-616465
function buildUserMessageForAPI(e, isBreakpoint, cachingEnabled, ttl) {  // was mVf
  if (isBreakpoint) {
    // ... string-content and array-content branches both put cache_control
    // ONLY on the final content block, via ephemeralCacheControl({ttl}) (Yse).
  }
  return { role: "user", content: /* stripped of empty tail */ };
}

// Builds { type: "ephemeral", ttl?, scope? }. `scope: "global"` is only set
// when scope === "global" is passed explicitly (see section 4).
// deobfuscated.js:616209-616220
function ephemeralCacheControl({ scope: e, ttl: t } = {}) {  // was Yse
  return {
    type: "ephemeral",
    ...(t && { ttl: t }),
    ...(e === "global" && { scope: e }),
  };
}

// ----------------------------------------------------------------------------
// 2. System-prompt cache scoping (the "global"/org/none 3-tier split)
//    — deobfuscated.js:615053-615155, called from 617070-617106
// ----------------------------------------------------------------------------
// splitSystemPromptForCache(promptBlocks, {skipGlobalCacheForSystemPrompt})
// Returns [{text, cacheScope}], cacheScope ∈ "global" | "org" | null.
function splitSystemPromptForCache(e, t) {  // was d3o
  let globalCacheEligible = globalSystemPromptCacheEnabled();  // VRe()
  let boundaryIdx = e.findIndex(c => c === SYSTEM_PROMPT_BOUNDARY_MARKER);

  // Fallback path used when an eager (non-deferred) MCP tool schema is present
  // — see section 4. Tool schemas are per-org/per-user, so the org-wide
  // "global" cache scope can't safely include them; this path buckets
  // everything (minus the billing header) as "org"-scoped instead.
  if (globalCacheEligible && t?.skipGlobalCacheForSystemPrompt && boundaryIdx === -1) {
    q("tengu_sysprompt_using_tool_based_cache", { promptBlockCount: e.length });
    // billing header -> cacheScope: null (never cached — carries a per-request nonce)
    // identity line (the "You are Claude Code..." block) -> cacheScope: "org"
    // everything else, joined -> cacheScope: "org"
  }

  if (globalCacheEligible) {
    if (boundaryIdx !== -1) {
      // Normal path: blocks BEFORE the boundary marker (the static, identical-
      // across-every-installation harness prose) get cacheScope: "global".
      // Blocks AFTER the boundary (CLAUDE.md, env info, memory index — all
      // per-user/per-repo) get cacheScope: "org".
      // billing header -> null, identity line -> null (excluded from both).
      q("tengu_sysprompt_boundary_found", { blockCount, staticBlockLength, dynamicBlockLength });
      return /* [...] */;
    }
    q("tengu_sysprompt_missing_boundary_marker", { promptBlockCount: e.length });
  }
  // No global caching (backend isn't firstParty/anthropicAws, or betas off):
  // everything (minus billing header) -> cacheScope: "org".
}

// The literal boundary marker. This EXACT string is visible, unrendered, in
// this agent's own live system prompt — proof the boundary/global-cache path
// is active for this session. deobfuscated.js:74545, re-exported at 761331.
var SYSTEM_PROMPT_BOUNDARY_MARKER = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";  // was vce

// globalSystemPromptCacheEnabled(): global-scope cache_control is only
// attempted on firstParty/anthropicAws, with extended betas on, and an
// account-level gate Jc(). deobfuscated.js:169245-169251
function globalSystemPromptCacheEnabled() {  // was VRe
  if (!extendedBetasEnabled()) return false;      // xL()
  if (!accountEligibleForGlobalCache()) return false;  // Jc() — /* uncertain: exact gate unresolved */
  let backend = getBackend();                    // fr()
  return backend === "firstParty" || backend === "anthropicAws";
}

function extendedBetasEnabled() {  // was xL — deobfuscated.js:169241-169243
  return isFirstOrAwsOrFoundryBackend() && !experimentalBetasDisabled();  // ZJr() && !YWe()
}

// ----------------------------------------------------------------------------
// 3. Lean vs full system prompt — deobfuscated.js:312394-312625, 168863-168882
// ----------------------------------------------------------------------------
// The top-level assembly point. `isLean` selects ONE function call
// (leanSystemPrompt) vs SIX section builders (identity/tone/coding-instructions
// /environment/tools/style) for the "classic" prompt.
async function assembleSystemPromptSections(e, t, n, r) {  // was XL
  // ...
  let isLean = shouldUseLeanPrompt(t);  // was `let o = Dh(t)` — t is the model id
  // ...
  return [
    ...(isLean
      ? [leanSystemPrompt(c)]                                    // yLp — THE branch this session hit
      : [identityBlock(c), toneBlock(), c === null || c.keepCodingInstructions === true ? codingInstructionsBlock() : null,
         environmentBlock(t), toolsBlock(d), styleGuideBlock()]),  // cLp, uLp, dLp, pLp, fLp, hLp
    ...(r?.excludeDynamicSections ? [dynamicSectionsPlaceholder(t)] : []),  // XVi — see section 6 (--exclude-dynamic-system-prompt-sections)
    ...(globalSystemPromptCacheEnabled() ? [SYSTEM_PROMPT_BOUNDARY_MARKER] : []),  // only inserted when global-cache eligible
    ...dynamicSections,     // memory, env_info, output_style, language, brief, etc. (see array `m` above this in source)
    finalSystemPromptTail(t),  // OCa — refusal/identity closer
  ].filter(y => y !== null);
}

// The lean template. This is IDENTICAL, including whitespace, to this
// session's own visible system prompt ("You are an interactive agent that
// helps users with software engineering tasks." + securityNoticeBlock +
// "# Harness" bullet list). deobfuscated.js:312577-312596
function leanSystemPrompt(outputStyle) {  // was yLp
  let hasOutputStyle = someOutputStyleCheck();  // Jho()
  let identity = hasOutputStyle
    ? "You work alongside the user on software engineering tasks and own the outcome of what you take on."
    : "You are an interactive agent that helps users with software engineering tasks.";
  // (outputStyle !== null branch swaps in output-style-aware phrasing)
  return `
${identity}

${securityNoticeBlock}

# Harness
 - Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.
 - Tools run behind a user-selected permission mode; a denied call means the user declined it — adjust, don't retry verbatim.
 - \`<system-reminder>\` tags in messages and tool results are injected by the harness, not the user. Hooks may intercept tool calls; treat hook output as user feedback.
 - Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response.
 - Reference code as \`file_path:line_number\` — it's clickable.`;
}

// deobfuscated.js:312325 — matches this session's system prompt verbatim.
var securityNoticeBlock = "IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.";  // was zho

// Model gate for lean vs classic. deobfuscated.js:168863-168882
var shouldUseLeanPrompt = memoize(e => {  // was Dh = Tn(...)
  if (!e) return false;
  if (env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT) return true;   // forced on
  if (envExplicitlyFalse(env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT)) return false;  // forced off
  return !requiresClassicPrompt(e) || remoteLeanOverride(e);  // !eqd(e) || Z5d(e)
});

// requiresClassicPrompt(model): hardcoded per-family gate.
// deobfuscated.js:168848-168861
function requiresClassicPrompt(e) {  // was eqd
  if (isEarlyAccessPreview(e)) return false;                        // HSe() -eap suffix -> lean
  let t = canonicalizeModel(e);                                     // oo(e)
  if (growthbookFlag(t, "lean_prompt") || t === "claude-mythos-5") return false;  // explicit lean flag/Mythos -> lean
  if (t.includes("claude-3-") || t.includes("haiku") || t.includes("sonnet")
      || t === "claude-opus-4-0" || t === "claude-opus-4-1" || t === "claude-opus-4-5"
      || t === "claude-opus-4-6" || t === "claude-opus-4-7") {
    return true;   // classic prompt — Haiku, ALL Sonnet family (incl. "claude-sonnet-5"
                    // by substring!), Opus <= 4-7
  }
  return !isKnownCurrentModel();  // id() /* uncertain name */ — unknown/legacy ids -> classic
}

// remoteLeanOverride(model): per-model GrowthBook/remote-config carve-out that
// can flip a model INTO lean even though requiresClassicPrompt(model) is true.
// deobfuscated.js:168838-168850
// FINDING: this is how Sonnet 5 ends up lean despite the ".includes('sonnet')"
// hardcoded classic-prompt rule above — this session (model claude-sonnet-5)
// rendered the lean template, so remoteLeanOverride() must be returning true
// for it right now via one of:
function remoteLeanOverride(e) {  // was Z5d
  let t = canonicalizeModel(e);
  let staticConfig = remoteConfig()?.simple_system_prompt;    // nR()?.simple_system_prompt
  if (isNonNullObject(staticConfig)
      && Object.entries(staticConfig).some(([k, v]) => v === true && t.includes(k))) return true;
  let experiment = growthbookGet("tengu_velvet_cascade", null);  // per-model experiment
  if (!isNonNullObject(experiment) || !Array.isArray(experiment.models)) return false;
  return experiment.models.some(m => typeof m === "string" && t.includes(m));
}

// ----------------------------------------------------------------------------
// 4. ToolSearch deferral + global-cache interplay (2.1.128)
//    — deobfuscated.js:616991-617105
// ----------------------------------------------------------------------------
function buildRequestBody(/* ... */) {
  let globalCacheEligible = globalSystemPromptCacheEnabled();       // I = VRe()
  let isDeferred = tool => useToolSearch && (deferredNameSet.has(tool.name) || isAlwaysEagerException(tool));  // x — hVf(tool) /* uncertain */
  // Skip the "global" cache scope if ANY MCP tool is loaded eagerly
  // (not deferred) — its schema is per-user/per-org, so it can't ride the
  // cross-customer global cache.
  let hasEagerMcpTool = globalCacheEligible && toolList.some(tool => tool.isMcp === true && !isDeferred(tool));  // C
  let globalCacheStrategy = globalCacheEligible ? (hasEagerMcpTool ? "none" : "system_prompt") : "none";  // k
  // ... globalCacheStrategy is logged (o6a) and threaded into
  // splitSystemPromptForCache() as skipGlobalCacheForSystemPrompt = hasEagerMcpTool.
}

// Tool schema shape: cache_control + defer_loading both live alongside
// name/description/input_schema. deobfuscated.js:615000-615027
function buildToolSchemaForAPI(tool, opts) {  // partial, was inline in a larger fn
  let schema = { name: tool.name, description: tool.description, input_schema: tool.inputSchema };
  if (opts.deferLoading) schema.defer_loading = true;      // ToolSearch: not sent inline, discoverable via search
  if (opts.cacheControl) schema.cache_control = opts.cacheControl;
  // Experimental-betas-disabled path strips anything except
  // name/description/input_schema/cache_control before sending.
  return schema;
}

// alwaysLoad MCP config option (2.1.121) — opts a specific MCP tool OUT of
// ToolSearch deferral (always sent inline). deobfuscated.js:614532, 626174,
// 760836-760876.
// mcp.json: { "mcpServers": { "x": { "tools": { "some_tool": { "alwaysLoad": true } } } } }
// -> propagated as _meta["anthropic/alwaysLoad"]: true on the tool schema.

// ToolSearch's OWN description cache (separate from the API prompt cache) is
// invalidated when the set of deferred tool NAMES changes.
// deobfuscated.js:399974-399994
function invalidateToolSearchCacheIfChanged(deferredTools) {  // was H6a
  let key = deferredTools.map(t => t.name).sort().join(",");  // CKp
  if (lastDeferredToolsKey !== key) {
    v("ToolSearchTool: cache invalidated - deferred tools changed");
    toolSearchDescriptionCache.clear();  // O9n.cache
    lastDeferredToolsKey = key;
  }
}

// ----------------------------------------------------------------------------
// 5. TTL selection: ENABLE_PROMPT_CACHING_1H / FORCE_PROMPT_CACHING_5M
//    — deobfuscated.js:616216-616232
// ----------------------------------------------------------------------------
function resolveTtl(querySource) {  // was _ze
  if (envTrue(process.env.FORCE_PROMPT_CACHING_5M)) return false;   // "false" ttl = default 5m
  if (envTrue(process.env.ENABLE_PROMPT_CACHING_1H)
      || (getBackend() === "bedrock" && envTrue(process.env.ENABLE_PROMPT_CACHING_1H_BEDROCK))) {
    return true;   // -> "1h" everywhere, unconditionally
  }
  if (!isFirstOrAwsOrFoundryBackend() || accountIsOnOverage()) return false;  // Eo(), e0.isUsingOverage
  // Otherwise: 1h TTL is gated to a fixed allowlist of query sources via
  // remote config "tengu_prompt_cache_1h_config" (deobfuscated.js:616224-616229):
  let allowlist = remoteConfig("tengu_prompt_cache_1h_config", {
    allowlist: ["repl_main_thread*", "sdk", "auto_mode", "memdir_relevance"],
  }).allowlist ?? [];
  return querySource !== undefined && allowlist.some(
    pattern => pattern.endsWith("*") ? querySource.startsWith(pattern.slice(0, -1)) : querySource === pattern
  );
}
// Called as: let V = resolveTtl(s.querySource) ? "1h" : undefined;
// Per-model DISABLE_PROMPT_CACHING_{HAIKU,SONNET,OPUS,FABLE,MYTHOS} env/remote
// kill switches live right above this, deobfuscated.js:616173-616199.

// ----------------------------------------------------------------------------
// 6. --exclude-dynamic-system-prompt-sections (2.1.98)
//    — CLI flag registration at deobfuscated.js:957995, consumed at 959646
// ----------------------------------------------------------------------------
// CLI help text (verbatim): "Move per-machine sections (cwd, env info, memory
// paths, git status) from the system prompt into the first user message.
// Improves cross-user prompt-cache reuse. Only applies with the default
// system prompt (ignored with --system-prompt)."
//
// Effect inside assembleSystemPromptSections (section 3): several section
// builders receive `excludeDynamicSections=true` and either return [] or a
// static-only variant (e.g. XL's `Qho()` "simple" early-return becomes
// `["CWD: ...", "Date: ..."]`-free; env_info swaps HLp -> vLp "env_info_static").
// Net effect: the cacheable system-prompt prefix becomes identical across
// different users/machines in --print mode, at the cost of moving cwd/env/
// git-status/memory into the (uncached) first message instead.

// ----------------------------------------------------------------------------
// 7. Date kept OUT of the cached system prompt (2.1.42)
//    — deobfuscated.js:318505-318562, 789760
// ----------------------------------------------------------------------------
// buildUserEnvContext(): assembled once (memoized per-cwd via Tn(..., Oyo))
// and injected as a `<system-reminder>` MESSAGE (via wrapAsSystemReminder /
// XGl, isMeta: true) at conversation start — NOT as part of the `system`
// array. This is exactly the block visible in this session's own transcript:
// "# claudeMd" / "# userEmail" / "# currentDate" / "# attachedProject".
function buildUserEnvContext() {  // was vA
  return {
    ...(claudeMd && { claudeMd }),
    ...(userEmail && { userEmail: `The user's email address is ${userEmail}.` }),
    ...(attachedProject && { attachedProject }),
    currentDate: `Today's date is ${formatDate()}.`,  // VAe()
  };
}
function wrapAsSystemReminder(messages, contextObj) {  // was XGl
  if (Object.entries(contextObj).length === 0) return messages;
  return [buildMetaMessage(`<system-reminder>
As you answer the user's questions, you can use the following context:
${Object.entries(contextObj).map(([k, v]) => `# ${k}\n${v}`).join("\n")}

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
</system-reminder>
`, { isMeta: true }), ...messages];
}
// Mid-session date rollover (session spans midnight) is ALSO delivered as a
// message, not a system-prompt edit: deobfuscated.js:789760 —
// "The date has changed. Today's date is now ${e.newDate}. DO NOT mention
// this to the user explicitly because they are already aware."

// ----------------------------------------------------------------------------
// 8b. Cache-eligible subagent/background summaries (2.1.128)
//     — deobfuscated.js:514245-514310 (poller), 401995-402012 (/compact),
//       609708-609800 (shared fork helper)
// ----------------------------------------------------------------------------
// Both /compact's summarization call and the periodic "describe your last
// action" background poller (querySource: "agent_summary", used for progress-
// indicator UI) fork a NEW small request off the parent conversation via the
// same helper, `forkAndQuery` (was `dD`, 609723-609800):
async function forkAndQuery({ promptMessages, cacheSafeParams, querySource, skipCacheWrite, /* ... */ }) {
  let { systemPrompt, forkContextMessages } = cacheSafeParams;  // parent's real messages/system prompt
  let messages = [...forkContextMessages, ...promptMessages];   // parent tail + the tiny new prompt
  let forkPointUuid = lastRealMessageUuid(forkContextMessages); // was Isr — collapses dup trailing assistant chunks
  // forkPointUuid feeds straight into buildCachedMessagesForAPI (§1) as the
  // `forkPointUuid` param; skipCacheWrite shifts the tail breakpoint back one
  // message. Net effect: this forked call CACHE-READS the parent's already-
  // cached prefix through the fork point, and writes NO new cache entry for
  // its own tiny appended prompt.
  for await (let chunk of runQuery({ messages, systemPrompt, querySource, skipCacheWrite, forkPointUuid })) { /* ... */ }
}
// This is the "~3x cache_creation reduction" from 2.1.128: before sharing the
// parent's cache lineage this way, each timer-fired summary/compaction call
// presumably minted its own fresh (slightly different) cached prefix.
// /compact's use of this path is gated by remote-config flag
// `tengu_compact_cache_prefix` (default true, checked at 401995-401998).

// ----------------------------------------------------------------------------
// 8. /cd — move directories without busting the prompt cache (2.1.169)
//    — command def deobfuscated.js:644797-644807, impl 644202-644390
// ----------------------------------------------------------------------------
var cdCommandDefinition = {  // was CKf
  type: "local-jsx",
  name: "cd",
  description: "Move this session to a new working directory",
  argumentHint: "<path>",
};

// relocateSession(newPath, source): the key move — it does NOT rebuild/rehash
// the cached system prompt with the new cwd. It chdir()s the process,
// relocates the transcript file, refreshes local caches (git branch, config),
// then returns a plain conversational message:
async function relocateSession(newPath, source) {  // was j5o
  // process.chdir(newPath); relocate transcript; refresh git/config caches...
  let displayPath = formatPath(newPath);  // acr(e)
  let notice = wrapReminder(`The session's working directory has changed to ${displayPath} (${
    source === "cd_command" ? "via /cd" : "by the user"
  }). The environment block at the start of this conversation still names the previous directory — that information is stale. All tool calls and relative paths now resolve from ${displayPath}.`);  // jw()
  return { modelMessage: notice, transcriptRelocated: true /* or false on rollback */ };
}
// The cached system-prompt prefix (which embeds the OLD cwd in its
// environment-info section) is deliberately left stale and untouched — cache
// hits keep working — while a plain message tells the model the cwd changed.
// This is the direct mechanism for "/cd without breaking the prompt cache."
