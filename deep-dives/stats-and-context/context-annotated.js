// =============================================================================
// /context Command — Annotated Source
// Source: Claude Code v2.1.201 (deobfuscated.js, 2026-07-04)
// Supersedes the v2.1.34 analysis in this same file.
// =============================================================================
//
// Structurally unchanged from v2.1.34: two command variants (interactive
// colored-grid jsx, and a non-interactive markdown renderer), both built on
// top of one shared calculator. What changed: a new `[all]` argument that
// collapses/expands detail sections, remote (control-channel) support for the
// jsx variant, the cache-version-adjacent constants are untouched (buffers
// still 13000/3000), and an "actionable suggestions" UI slot exists but is
// currently a hard-coded no-op (see bottom section) — worth flagging since
// the changelog implies it should be doing something.
// =============================================================================

// ─── Command Definitions ────────────────────────────────────────────────────
// deobfuscated.js:666089-666119

var contextVisualCommand = {
  name: "context",
  description: "Visualize current context usage as a colored grid",
  argumentHint: "[all]", // NEW vs v2.1.34 — see collapseDetailSections below
  isEnabled: () => !isNonInteractive(), // !mr()
  type: "local-jsx",
  thinClientDispatch: "control-request", // NEW — remote/thin-client aware
  load: () =>
    Promise.resolve().then(() => {
      initContextJSXModule();
      return ContextJSXModule;
    }),
};

var contextTextCommand = {
  type: "local",
  name: "context",
  supportsNonInteractive: true,
  description: "Show current context usage",
  get isHidden() {
    return !isNonInteractive(); // mr()
  },
  isEnabled() {
    return isNonInteractive(); // mr()
  },
  load: () =>
    Promise.resolve().then(() => {
      initContextTextModule();
      return ContextTextModule;
    }),
};

// ─── Interactive (JSX) Entry Point ──────────────────────────────────────────
// deobfuscated.js:665985-666023 (ZQf), module wrapper at 665978-665982 (w7l)
//
// NEW: `/context all` vs bare `/context`. `collapseDetailSections` is true
// unless the argument trims+lowercases to "all":
//   let collapse = isInteractive() && argString.trim().toLowerCase() !== "all";
// Passed down into <ContextGrid collapseDetailSections>, which hides the
// per-category breakdown tables (MCP tools, memory files, skills, agents)
// behind a "N more categories, use /context all to expand" style summary line
// unless the caller asked for "all". This argument didn't exist in v2.1.34.
//
// NEW: remote support. If a control channel is attached (ql() !== null) and
// the channel supports it (lP("controlChannel")), the jsx variant sends a
// `get_context_usage` control request instead of computing locally, then
// renders the same <ContextGrid> against the remote payload:
//   sendControlRequest({ subtype: "get_context_usage" })
// and falls back to computing locally otherwise (existing behavior, unchanged
// core calculator call).

async function renderContextVisual(onClose, toolUseContext, argString) {
  let collapseDetailSections =
    isInteractive() && argString.trim().toLowerCase() !== "all";

  let remote = getControlChannel(); // ql()
  if (remote) {
    if (!channelSupports("controlChannel")) {
      onClose("Context usage isn't available over this remote connection");
      return null;
    }
    let data = await remote.sendControlRequest({ subtype: "get_context_usage" });
    let rendered = await renderToString(
      React.createElement(ContextGrid, { data, isRemote: true, collapseDetailSections }),
    );
    onClose(rendered, { display: "system", metaMessages: [renderContextMarkdown(data, { skipCollapseStatus: true })] });
    return null;
  }

  let { messages, getAppState, options: { mainLoopModel, tools } } = toolUseContext;
  let internalMessages = convertToInternalMessages(messages);
  let terminalWidth = process.stdout.columns || 80;
  let appState = getAppState();

  let contextData = await calculateContextUsage(
    internalMessages, mainLoopModel,
    async () => appState.toolPermissionContext,
    tools, appState.agentDefinitions, terminalWidth,
    toolUseContext, undefined, internalMessages, appState.autoCompactWindow,
  );

  let rendered = await renderToString(
    React.createElement(ContextGrid, { data: contextData, collapseDetailSections }),
  );
  onClose(rendered, { display: "system", metaMessages: [renderContextMarkdown(contextData)] });
  return null;
}

// ─── Non-Interactive (Text) Entry Point — CONFIRMED unchanged shape ────────
// deobfuscated.js:666055-666083 ($Vo / eZf / WTt)
// Same calculateContextUsage() core, rendered via renderContextMarkdown (Itn)
// into a markdown table document instead of the grid.

// ─── Core Calculator: Bar() — deobfuscated.js:621029-621324 ────────────────
//
// Runs the SAME 7 categories in parallel via Promise.all, CONFIRMED unchanged
// composition (destructured in this order):
//   1. system prompt        -> { systemPromptTokens, systemPromptSections, redirectedContextTokens }
//   2. memory (CLAUDE.md)   -> { claudeMdTokens, memoryFileDetails }
//   3. built-in tools       -> { builtInToolTokens, deferredBuiltinDetails, deferredBuiltinTokens, systemToolDetails }
//   4. MCP tools            -> { mcpToolTokens, mcpToolDetails, deferredToolTokens }
//   5. custom agents        -> { agentTokens, agentDetails }
//   6. slash commands       -> { slashCommandTokens, commandInfo }
//   7. messages/tool-calls  -> V (toolCallTokens, toolResultTokens, attachmentTokens,
//                                 assistantMessageTokens, userMessageTokens, ...)
// Skills are counted SEPARATELY afterwards via a dedicated call
// (deobfuscated.js:621078, ZVf) — confirmed still not part of the Promise.all.

async function calculateContextUsage(
  messages, model, getPermissionContext, tools, agentDefinitions,
  terminalWidth, toolUseContext, _unused, rawMessages, autoCompactWindow,
) {
  let { window: maxTokens, source: autocompactSource } = resolveContextWindow(model, autoCompactWindow); // A3()

  let [
    { systemPromptTokens, systemPromptSections, redirectedContextTokens },
    { claudeMdTokens, memoryFileDetails },
    { builtInToolTokens, deferredBuiltinDetails, deferredBuiltinTokens, systemToolDetails },
    { mcpToolTokens, mcpToolDetails, deferredToolTokens },
    { agentTokens, agentDetails },
    { slashCommandTokens, commandInfo },
    messageBreakdown,
  ] = await Promise.all([
    computeSystemPromptTokens(model, /* ... */),   // YVf
    computeMemoryTokens(),                          // XVf
    computeBuiltInToolTokens(/* ... */),             // JVf
    computeMcpToolTokens(/* ... */),                 // e9f
    computeAgentTokens(/* ... */),                   // t9f  (NOTE: order in source is builtin, mcp, agents, matching destructure order above)
    computeSlashCommandTokens(/* ... */),             // QVf
    computeMessageBreakdown(rawMessages, model, tools), // s9f
  ]);

  let { skillInfo } = await computeSkillTokens(/* ... */); // ZVf — separate call
  let skillTokens = skillInfo.skillFrontmatter.reduce((sum, s) => sum + s.tokens, 0);

  let categories = [];
  if (systemPromptTokens > 0) categories.push({ name: "System prompt", tokens: systemPromptTokens, color: "promptBorder" });
  let systemToolsNonSkill = builtInToolTokens - skillTokens;
  if (systemToolsNonSkill > 0) categories.push({ name: "System tools", tokens: systemToolsNonSkill, color: "inactive" });
  if (mcpToolTokens > 0) categories.push({ name: "MCP tools", tokens: mcpToolTokens, color: "cyan_FOR_SUBAGENTS_ONLY" });
  if (deferredToolTokens > 0) categories.push({ name: "MCP tools (deferred)", tokens: deferredToolTokens, color: "inactive", isDeferred: true });
  if (deferredBuiltinTokens > 0) categories.push({ name: "System tools (deferred)", tokens: deferredBuiltinTokens, color: "inactive", isDeferred: true });
  if (agentTokens > 0) categories.push({ name: "Custom agents", tokens: agentTokens, color: "permission" });
  if (claudeMdTokens > 0) categories.push({ name: "Memory files", tokens: claudeMdTokens, color: "claude" });
  if (skillTokens > 0) categories.push({ name: "Skills", tokens: skillTokens, color: "warning" });

  // ... autocompact/compact buffer + Messages + Free space category pushes ...
  // ... grid square layout ...

  return {
    categories, totalTokens /* fe */, maxTokens, autocompactSource,
    percentage: Math.round(/* fe/maxTokens*100 */ 0),
    gridRows: [], model, memoryFiles: memoryFileDetails, mcpTools: mcpToolDetails,
    agents: agentDetails,
    slashCommands: slashCommandTokens > 0 ? { totalCommands: commandInfo.totalCommands, includedCommands: commandInfo.includedCommands, tokens: slashCommandTokens } : undefined,
    skills: skillTokens > 0 ? { totalSkills: skillInfo.totalSkills, includedSkills: skillInfo.includedSkills, tokens: skillTokens, skillFrontmatter: skillInfo.skillFrontmatter } : undefined,
    messageBreakdown, apiUsage: /* actual API usage object, see below */ undefined,
  };
}

// ─── Buffer Constants — CONFIRMED unchanged ────────────────────────────────
// deobfuscated.js:619918-619919 (ZWl / e5l), category names at 621325-621326

var AUTOCOMPACT_BUFFER_TOKENS = 13000; // ZWl — used when auto-compact is ON: threshold = contextLimit - 13000
var COMPACT_BUFFER_TOKENS = 3000;      // e5l — used when auto-compact is OFF (manual /compact only)
var AUTOCOMPACT_BUFFER_NAME = "Autocompact buffer"; // $3o
var COMPACT_BUFFER_NAME = "Compact buffer";         // O3o

// ─── Actual API Usage for Message Totals — CONFIRMED unchanged ────────────
// deobfuscated.js:621052-621054, 621154-621159
//
// When the most recent assistant message carries a non-zero usage block
// (input_tokens + cache_creation_input_tokens + cache_read_input_tokens > 0),
// that real API accounting is used to derive the "Messages" category total
// instead of the locally-estimated token count — CONFIRMED still the model:
//   apiTotal = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
//   if (apiTotal > 0) use it (via `S`/`b` in Bar()) to reconcile Q (messages tokens)

// ─── Grid Dimensions — CONFIRMED unchanged formula, now regularly hits the
// ─── >=1M branch because Sonnet 5 defaults to a native 1M context window ──
// deobfuscated.js:621183-621186
//
//   isNarrow = terminalColumns && terminalColumns < 80
//   cols = maxTokens >= 1_000_000 ? (isNarrow ? 5 : 20) : (isNarrow ? 5 : 10)
//   rows = maxTokens >= 1_000_000 ? 10                  : (isNarrow ? 5 : 10)
//
// i.e. >=1M-token window -> 20x10 grid (5x10 narrow); <1M -> 10x10 grid
// (5x5 narrow). The window itself comes from resolveContextWindow() (A3(),
// deobfuscated.js:620032-620087), which layers env override ->
// per-session settings -> client-reported window -> experiment override ->
// model-declared default, in that priority order — this is where a
// Sonnet-5-class model's native 1M window flows in as `maxTokens` and
// automatically lands in the 20x10 branch without any /context-specific code
// change being needed.

function computeGridDimensions(maxTokens, terminalColumns) {
  let isNarrow = terminalColumns && terminalColumns < 80;
  let cols = maxTokens >= 1000000 ? (isNarrow ? 5 : 20) : (isNarrow ? 5 : 10);
  let rows = maxTokens >= 1000000 ? 10 : (isNarrow ? 5 : 10);
  return { cols, rows };
}

// ─── Grid Glyphs — CHANGED: partial-fullness glyph added ───────────────────
// deobfuscated.js:665296, 665786, 665792, 665797
//
// v2.1.34 documented ⛁ (filled) / ⛶ (empty-ish) / ⛝ (deferred). v2.1.201
// still uses those three, PLUS a fourth glyph for partially-filled squares:
//   squareFullness >= 0.7 ? "⛁ " : "⛀ "   (deobfuscated.js:665797)
// "⛀" is new relative to the old doc's glyph inventory — squares whose
// fractional fill is below 0.7 render as the lighter "⛀" instead of solid
// "⛁". Deferred-category squares still render as "⛝"; the flat legend
// squares use "⛶".

// ─── Category List — CONFIRMED unchanged names/colors ──────────────────────
// deobfuscated.js:621084-621181
//   "System prompt" (promptBorder), "System tools" (inactive),
//   "MCP tools" (cyan_FOR_SUBAGENTS_ONLY), "MCP tools (deferred)" (inactive,
//   isDeferred), "System tools (deferred)" (inactive, isDeferred),
//   "Custom agents" (permission), "Memory files" (claude), "Skills" (warning),
//   "Messages" (purple_FOR_SUBAGENTS_ONLY), "Autocompact buffer" / "Compact
//   buffer" (inactive), "Free space" (promptBorder).

// ─── Per-Skill Token Estimates — CONFIRMED, uses a real tokenizer ──────────
// deobfuscated.js:620792-620854 (ZVf)
//
// Each included skill's rendered frontmatter text (name + description,
// possibly truncated under a token budget) is passed through Rf(text, model)
// — the same token-estimation helper used elsewhere for message/tool tokens,
// not a flat heuristic — to produce a per-skill `tokens` field surfaced in
// `skillFrontmatter`. Skills can be budget-truncated ("priority" mode) or
// reduced to name-only ("names-only" mode) depending on a size budget
// computed from the model's context window (bE(model, ...)).

// ─── "Actionable suggestions" UI slot — present but currently a no-op ──────
// deobfuscated.js:665054-665057, referenced at 665266
//
// The interactive grid conditionally renders a suggestions component when
// not connected remotely:
//   me = !isRemote && React.createElement(ContextSuggestions, {})
// but ContextSuggestions itself (CQf) is a two-line stub:
//   function ContextSuggestions() { let cache = ...; return null; }
// It takes no props and unconditionally returns null. Grepping the whole
// bundle for suggestion-related identifiers near the context calculator
// found no separate "context-heavy tool" or "memory bloat" advisory logic
// wired to this slot. Read literally, whatever populated actionable
// suggestions around 2.1.74 is either feature-flagged off with the check
// stripped out of this build, or was reverted, leaving only the render slot.
// This should be treated as CHANGED-TO-DEAD until proven otherwise by a
// targeted flag search.

function ContextSuggestions() {
  return null; // deobfuscated.js:665054-665057 — verified literal stub
}
