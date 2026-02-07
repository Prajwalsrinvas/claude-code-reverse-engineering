// =============================================================================
// /context Command — Annotated Source
// Source: Claude Code v2.1.34 (deobfuscated.js)
// =============================================================================
//
// Two command variants:
//   1. Interactive (local-jsx): Renders a colored grid visualization in terminal
//   2. Non-interactive (local): Returns markdown text output
//
// Both call the same core context calculator GP6() which computes token usage
// breakdown across all categories (system prompt, tools, MCP tools, agents,
// memory files, skills, messages, free space, autocompact buffer).
// =============================================================================

// ─── Command Definitions ────────────────────────────────────────────────────
// deobfuscated.js:563987-564021

// Interactive visual version (default in interactive mode)
var contextVisualCommand = {
  name: "context",
  description: "Visualize current context usage as a colored grid",
  isEnabled: () => !isNonInteractive(), // q4 — only in interactive mode
  isHidden: false,
  type: "local-jsx",
  load: () =>
    Promise.resolve().then(() => {
      initContextJSXModule();
      return ContextJSXModule;
    }),
  userFacingName() {
    return this.name;
  },
};

// Text version (for non-interactive / piped mode)
var contextTextCommand = {
  type: "local",
  name: "context",
  supportsNonInteractive: true,
  description: "Show current context usage",
  get isHidden() {
    return !isNonInteractive(); // Hidden when in interactive mode (visual version takes precedence)
  },
  isEnabled() {
    return isNonInteractive(); // Only enabled in non-interactive mode
  },
  load: () =>
    Promise.resolve().then(() => {
      initContextTextModule();
      return ContextTextModule;
    }),
  userFacingName() {
    return "context";
  },
};

// ─── Interactive (JSX) Entry Point ──────────────────────────────────────────
// deobfuscated.js:563760-563793

var ContextJSXModule = {};
uA(ContextJSXModule, {
  call: () => renderContextVisual,
});

async function renderContextVisual(onClose, toolUseContext) {
  let {
    messages,
    getAppState,
    options: { mainLoopModel, tools },
  } = toolUseContext;

  trackCommand("context"); // Q4

  let internalMessages = convertToInternalMessages(messages); // wN
  let { messages: apiMessages } = await formatForAPI(internalMessages); // Ym
  let terminalWidth = process.stdout.columns || 80;
  let appState = await getAppState();

  let contextData = await calculateContextUsage(
    apiMessages,
    mainLoopModel,
    async () => appState.toolPermissionContext,
    tools,
    appState.agentDefinitions,
    terminalWidth,
    toolUseContext,
    undefined,
    internalMessages,
  );

  // Render JSX to terminal string via Ink's renderToStaticMarkup equivalent
  let rendered = await renderToString(
    React.createElement(ContextGrid, { data: contextData }),
  );
  onClose(rendered);
  return null;
}

// ─── Non-Interactive (Text) Entry Point ─────────────────────────────────────
// deobfuscated.js:563808-563832

var ContextTextModule = {};
uA(ContextTextModule, {
  call: () => renderContextText,
});

async function renderContextText(args, toolUseContext) {
  let {
    messages,
    getAppState,
    options: { mainLoopModel, tools, agentDefinitions },
  } = toolUseContext;

  let internalMessages = convertToInternalMessages(messages);
  let { messages: apiMessages } = await formatForAPI(internalMessages);
  let appState = await getAppState();

  let contextData = await calculateContextUsage(
    apiMessages,
    mainLoopModel,
    async () => appState.toolPermissionContext,
    tools,
    agentDefinitions,
    undefined,
    toolUseContext,
    undefined,
    internalMessages,
  );

  return {
    type: "text",
    value: formatContextAsMarkdown(contextData),
  };
}

// ─── Markdown Text Formatter ────────────────────────────────────────────────
// deobfuscated.js:563833-563966

function formatContextAsMarkdown(data) {
  let {
    categories,
    totalTokens,
    rawMaxTokens,
    percentage,
    model,
    memoryFiles,
    mcpTools,
    agents,
    skills,
    messageBreakdown,
  } = data;

  let text = `## Context Usage\n\n`;
  text += `**Model:** ${model}  \n`;
  text += `**Tokens:** ${formatTokenCount(totalTokens)} / ${formatTokenCount(rawMaxTokens)} (${percentage}%)\n\n`;

  // ── Category Breakdown Table ──
  let activeCategories = categories.filter(
    (cat) => cat.tokens > 0 && cat.name !== "Free space" && cat.name !== "Autocompact buffer",
  );

  if (activeCategories.length > 0) {
    text += `### Estimated usage by category\n\n`;
    text += `| Category | Tokens | Percentage |\n`;
    text += `|----------|--------|------------|\n`;
    for (let cat of activeCategories) {
      let pct = ((cat.tokens / rawMaxTokens) * 100).toFixed(1);
      text += `| ${cat.name} | ${formatTokenCount(cat.tokens)} | ${pct}% |\n`;
    }
    // Free space at bottom
    let freeSpace = categories.find((c) => c.name === "Free space");
    if (freeSpace && freeSpace.tokens > 0) {
      let pct = ((freeSpace.tokens / rawMaxTokens) * 100).toFixed(1);
      text += `| Free space | ${formatTokenCount(freeSpace.tokens)} | ${pct}% |\n`;
    }
    // Autocompact buffer at bottom
    let autocompactBuf = categories.find((c) => c.name === "Autocompact buffer");
    if (autocompactBuf && autocompactBuf.tokens > 0) {
      let pct = ((autocompactBuf.tokens / rawMaxTokens) * 100).toFixed(1);
      text += `| Autocompact buffer | ${formatTokenCount(autocompactBuf.tokens)} | ${pct}% |\n`;
    }
    text += `\n`;
  }

  // ── MCP Tools Table ──
  if (mcpTools.length > 0) {
    text += `### MCP Tools\n\n`;
    text += `| Tool | Server | Tokens |\n`;
    text += `|------|--------|--------|\n`;
    for (let tool of mcpTools) {
      text += `| ${tool.name} | ${tool.serverName} | ${formatTokenCount(tool.tokens)} |\n`;
    }
    text += `\n`;
  }

  // ── Custom Agents Table ──
  if (agents.length > 0) {
    text += `### Custom Agents\n\n`;
    text += `| Agent Type | Source | Tokens |\n`;
    text += `|------------|--------|--------|\n`;
    for (let agent of agents) {
      let sourceLabel;
      switch (agent.source) {
        case "projectSettings": sourceLabel = "Project"; break;
        case "userSettings":    sourceLabel = "User"; break;
        case "localSettings":   sourceLabel = "Local"; break;
        case "flagSettings":    sourceLabel = "Flag"; break;
        case "policySettings":  sourceLabel = "Policy"; break;
        case "plugin":          sourceLabel = "Plugin"; break;
        case "built-in":        sourceLabel = "Built-in"; break;
        default:                sourceLabel = String(agent.source);
      }
      text += `| ${agent.agentType} | ${sourceLabel} | ${formatTokenCount(agent.tokens)} |\n`;
    }
    text += `\n`;
  }

  // ── Memory Files Table ──
  if (memoryFiles.length > 0) {
    text += `### Memory Files\n\n`;
    text += `| Type | Path | Tokens |\n`;
    text += `|------|------|--------|\n`;
    for (let mem of memoryFiles) {
      text += `| ${mem.type} | ${mem.path} | ${formatTokenCount(mem.tokens)} |\n`;
    }
    text += `\n`;
  }

  // ── Skills Table ──
  if (skills && skills.tokens > 0 && skills.skillFrontmatter.length > 0) {
    text += `### Skills\n\n`;
    text += `| Skill | Source | Tokens |\n`;
    text += `|-------|--------|--------|\n`;
    for (let skill of skills.skillFrontmatter) {
      text += `| ${skill.name} | ${formatSourceLabel(skill.source)} | ${formatTokenCount(skill.tokens)} |\n`;
    }
    text += `\n`;
  }

  return text;
}

// ─── Core Context Calculator ────────────────────────────────────────────────
// deobfuscated.js:539032-539280
//
// GP6 — the heart of the /context command. Calculates token usage for every
// category of context that Claude Code sends to the API.
//
// Parameters:
//   messages      — current conversation messages (API format)
//   model         — the main loop model identifier
//   getPermCtx    — async fn returning permission context (mode, etc.)
//   tools         — available tool definitions
//   agentDefs     — custom agent definitions
//   terminalWidth — for grid sizing (undefined for text mode)
//   toolUseCtx    — full tool use context
//   agentDef      — main thread agent definition (optional)
//   internalMsgs  — internal message format (for API usage extraction)

async function calculateContextUsage(
  messages, model, getPermCtx, tools, agentDefs,
  terminalWidth, toolUseCtx, agentDef, internalMsgs,
) {
  // ── 1. Resolve model and context window ──
  let resolvedModel = resolveModel({
    permissionMode: (await getPermCtx()).mode,
    mainLoopModel: model,
  }); // N81
  let contextWindow = getContextWindowSize(resolvedModel, getProvider()); // HP

  // ── 2. Build the default system prompt ──
  let defaultSystemPrompt = await buildDefaultSystemPrompt(tools, resolvedModel); // aV
  let systemPromptConfig = buildSystemPromptConfig({
    mainThreadAgentDefinition: agentDef,
    toolUseContext: toolUseCtx ?? { options: {} },
    customSystemPrompt: toolUseCtx?.options.customSystemPrompt,
    defaultSystemPrompt,
    appendSystemPrompt: toolUseCtx?.options.appendSystemPrompt,
  }); // $51

  // ── 3. Count tokens for each category IN PARALLEL ──
  let [
    systemPromptTokens,                                        // vQY
    { claudeMdTokens, memoryFileDetails },                     // EQY — CLAUDE.md + memory files
    { builtInToolTokens, deferredBuiltinDetails,               // kQY — built-in tools
      deferredBuiltinTokens },
    { mcpToolTokens, mcpToolDetails, deferredToolTokens },     // JU1 — MCP tools
    { agentTokens, agentDetails },                             // yQY — custom agents
    { slashCommandTokens, commandInfo },                       // LQY — slash commands
    messageTokenInfo,                                           // CQY — conversation messages
  ] = await Promise.all([
    countSystemPromptTokens(systemPromptConfig),
    countMemoryFileTokens(),
    countBuiltInToolTokens(tools, getPermCtx, agentDefs, resolvedModel, messages),
    countMCPToolTokens(tools, getPermCtx, agentDefs, resolvedModel, messages),
    countAgentTokens(agentDefs),
    countSlashCommandTokens(tools, getPermCtx, agentDefs),
    countMessageTokens(messages),
  ]);

  // ── 4. Count skill tokens ──
  let skillInfo = (await countSkillTokens(tools, getPermCtx, agentDefs)).skillInfo; // RQY
  let skillTokens = skillInfo.skillFrontmatter.reduce((sum, s) => sum + s.tokens, 0);

  // ── 5. Get message token count ──
  let messageTokens = messageTokenInfo.totalTokens;

  // ── 6. Determine autocompact threshold ──
  let isAutoCompactEnabled = isAutoCompactOn(); // Td
  let autocompactThreshold = isAutoCompactEnabled
    ? getAutocompactThreshold(model) - AUTOCOMPACT_BUFFER  // i31(model) - sRA (13000 tokens)
    : undefined;

  // ── 7. Build category list with colors ──
  let categories = [];

  if (systemPromptTokens > 0) {
    categories.push({ name: "System prompt", tokens: systemPromptTokens, color: "promptBorder" });
  }
  // System tools = builtInToolTokens minus skill tokens (skills shown separately)
  let systemToolTokens = builtInToolTokens - skillTokens;
  if (systemToolTokens > 0) {
    categories.push({ name: "System tools", tokens: systemToolTokens, color: "inactive" });
  }
  if (mcpToolTokens > 0) {
    categories.push({ name: "MCP tools", tokens: mcpToolTokens, color: "cyan_FOR_SUBAGENTS_ONLY" });
  }
  if (deferredToolTokens > 0) {
    categories.push({ name: "MCP tools (deferred)", tokens: deferredToolTokens, color: "inactive", isDeferred: true });
  }
  if (deferredBuiltinTokens > 0) {
    categories.push({ name: "System tools (deferred)", tokens: deferredBuiltinTokens, color: "inactive", isDeferred: true });
  }
  if (agentTokens > 0) {
    categories.push({ name: "Custom agents", tokens: agentTokens, color: "permission" });
  }
  if (claudeMdTokens > 0) {
    categories.push({ name: "Memory files", tokens: claudeMdTokens, color: "claude" });
  }
  if (skillTokens > 0) {
    categories.push({ name: "Skills", tokens: skillTokens, color: "warning" });
  }
  if (messageTokens !== null && messageTokens > 0) {
    categories.push({ name: "Messages", tokens: messageTokens, color: "purple_FOR_SUBAGENTS_ONLY" });
  }

  // ── 8. Calculate consumed vs free space ──
  // Non-deferred tokens = actual context used
  let consumedTokens = categories.reduce(
    (sum, cat) => sum + (cat.isDeferred ? 0 : cat.tokens), 0,
  );

  // Reserve space for autocompact/compact buffer
  let bufferTokens = 0;
  if (isAutoCompactEnabled && autocompactThreshold !== undefined) {
    bufferTokens = contextWindow - autocompactThreshold;
    categories.push({ name: "Autocompact buffer", tokens: bufferTokens, color: "inactive" });
    // AUTOCOMPACT_BUFFER_LABEL = "Autocompact buffer" (deobfuscated.js:539281)
  } else if (!isAutoCompactEnabled) {
    bufferTokens = COMPACT_BUFFER; // tRA = 3000 tokens
    categories.push({ name: "Compact buffer", tokens: bufferTokens, color: "inactive" });
    // COMPACT_BUFFER_LABEL = "Compact buffer" (deobfuscated.js:539282)
  }

  let freeSpace = Math.max(0, contextWindow - consumedTokens - bufferTokens);
  categories.push({ name: "Free space", tokens: freeSpace, color: "promptBorder" });

  // ── 9. Get actual token count from API usage if available ──
  // Uses the last API response's usage data for more accurate total
  let apiUsage = getLastAPIUsage(internalMsgs ?? messages); // sz6
  let displayTotal = (apiUsage
    ? apiUsage.input_tokens + apiUsage.cache_creation_input_tokens + apiUsage.cache_read_input_tokens
    : null) ?? consumedTokens;

  // ── 10. Build visual grid ──
  let isNarrow = terminalWidth && terminalWidth < 80;
  let gridCols = contextWindow >= 1000000 ? (isNarrow ? 5 : 20) : (isNarrow ? 5 : 10);
  let gridRows = contextWindow >= 1000000 ? 10 : (isNarrow ? 5 : 10);
  let totalSquares = gridCols * gridRows;

  // Map categories to grid squares (proportional to token count)
  let squareCategories = categories
    .filter((cat) => !cat.isDeferred)
    .map((cat) => ({
      ...cat,
      squares: cat.name === "Free space"
        ? Math.round((cat.tokens / contextWindow) * totalSquares)
        : Math.max(1, Math.round((cat.tokens / contextWindow) * totalSquares)),
      percentageOfTotal: Math.round((cat.tokens / contextWindow) * 100),
    }));

  // Build individual square objects with color info
  function buildSquares(category) {
    let squares = [];
    let exactSquares = (category.tokens / contextWindow) * totalSquares;
    let wholeSquares = Math.floor(exactSquares);
    let fractional = exactSquares - wholeSquares;
    for (let i = 0; i < category.squares; i++) {
      let fullness = 1;
      if (i === wholeSquares && fractional > 0) fullness = fractional;
      squares.push({
        color: category.color,
        isFilled: true,
        categoryName: category.name,
        tokens: category.tokens,
        percentage: category.percentageOfTotal,
        squareFullness: fullness,
      });
    }
    return squares;
  }

  // Assemble grid: content categories → free space → buffer
  let allSquares = [];
  let bufferCategory = squareCategories.find(
    (c) => c.name === "Autocompact buffer" || c.name === "Compact buffer",
  );
  let contentCategories = squareCategories.filter(
    (c) => c.name !== "Autocompact buffer" && c.name !== "Compact buffer" && c.name !== "Free space",
  );

  // Content squares first
  for (let cat of contentCategories) {
    for (let sq of buildSquares(cat)) {
      if (allSquares.length < totalSquares) allSquares.push(sq);
    }
  }

  // Fill remaining with free space (up to buffer start)
  let bufferSquareCount = bufferCategory ? bufferCategory.squares : 0;
  let freeSpaceEnd = totalSquares - bufferSquareCount;
  let freeSpaceCat = categories.find((c) => c.name === "Free space");
  while (allSquares.length < freeSpaceEnd) {
    allSquares.push({
      color: "promptBorder",
      isFilled: true,
      categoryName: "Free space",
      tokens: freeSpaceCat?.tokens || 0,
      percentage: freeSpaceCat ? Math.round((freeSpaceCat.tokens / contextWindow) * 100) : 0,
      squareFullness: 1,
    });
  }

  // Buffer squares last
  if (bufferCategory) {
    for (let sq of buildSquares(bufferCategory)) {
      if (allSquares.length < totalSquares) allSquares.push(sq);
    }
  }

  // Reshape into 2D grid rows
  let gridRowsArray = [];
  for (let row = 0; row < gridRows; row++) {
    gridRowsArray.push(allSquares.slice(row * gridCols, (row + 1) * gridCols));
  }

  return {
    categories,
    totalTokens: displayTotal,
    maxTokens: contextWindow,
    rawMaxTokens: contextWindow,
    percentage: Math.round((displayTotal / contextWindow) * 100),
    gridRows: gridRowsArray,
    model: resolvedModel,
    memoryFiles: memoryFileDetails,
    mcpTools: mcpToolDetails,
    deferredBuiltinTools: deferredBuiltinDetails,
    agents: agentDetails,
    slashCommands: slashCommandTokens > 0 ? {
      totalCommands: commandInfo.totalCommands,
      includedCommands: commandInfo.includedCommands,
      tokens: slashCommandTokens,
    } : undefined,
    skills: skillTokens > 0 ? {
      totalSkills: skillInfo.totalSkills,
      includedSkills: skillInfo.includedSkills,
      tokens: skillTokens,
      skillFrontmatter: skillInfo.skillFrontmatter,
    } : undefined,
    autoCompactThreshold: autocompactThreshold,
    isAutoCompactEnabled,
    messageBreakdown: undefined, // S1 — unused in current version
    apiUsage: apiUsage,
  };
}

// Constants
// deobfuscated.js:539281-539283
var AUTOCOMPACT_BUFFER_LABEL = "Autocompact buffer";
var COMPACT_BUFFER_LABEL = "Compact buffer";
var COMPACT_BUFFER = 3000;   // tRA — tokens reserved when compact (not autocompact) is active
// deobfuscated.js:533182
var AUTOCOMPACT_BUFFER = 13000; // sRA — tokens subtracted from autocompact threshold

// ─── Visual Grid Component (React/Ink) ──────────────────────────────────────
// deobfuscated.js:562723-563416
//
// E6q — Renders a colored grid in the terminal showing context usage.
//
// Layout:
//   Context Usage
//   ┌───────────────────┐
//   │  [grid of colored  │  model · 123k/200k tokens (62%)
//   │   squares showing   │
//   │   context usage]    │  Estimated usage by category
//   └───────────────────┘  ⛁ System prompt: 5.2k tokens (2.6%)
//                          ⛁ System tools: 28k tokens (14%)
//                          ⛁ MCP tools: 3.4k tokens (1.7%)
//                          ⛁ Custom agents: 1.2k tokens (0.6%)
//                          ⛁ Memory files: 4.8k tokens (2.4%)
//                          ⛁ Messages: 82k tokens (41%)
//                          ⛶ Free space: 75k (37.5%)
//                          ⛝ Autocompact buffer: 13k tokens (6.5%)
//
//   MCP tools · /mcp (loaded on-demand)
//   Loaded
//     tool1 (server1) · 200 tokens
//     tool2 (server2) · 150 tokens
//   Available
//     tool3 (server3) · deferred
//
//   Custom agents · /agents
//     Project: agent1 · 300 tokens
//     User: agent2 · 200 tokens
//
//   Memory files · /memory
//     CLAUDE.md · /path/to/file · 2.4k tokens
//
//   Skills · /skills
//     skill1 · User · 500 tokens
//
// Grid characters:
//   ⛁ = filled category square
//   ⛶ = empty (free space) square
//   ⛝ = buffer square (autocompact/compact)
//
// Category colors (from theme):
//   "promptBorder"             → System prompt, Free space
//   "inactive"                 → System tools, deferred tools, buffer
//   "cyan_FOR_SUBAGENTS_ONLY"  → MCP tools
//   "permission"               → Custom agents
//   "claude"                   → Memory files
//   "warning"                  → Skills
//   "purple_FOR_SUBAGENTS_ONLY"→ Messages

// ─── Token Counting Functions (called in parallel by GP6) ───────────────────
//
// These are external functions called by calculateContextUsage. They compute
// tokens for different parts of the context:
//
// vQY(systemPromptConfig)      → system prompt tokens
// EQY()                        → CLAUDE.md + memory file tokens + details
// kQY(tools, perm, agents, model, msgs) → built-in tool tokens + deferred details
// JU1(tools, perm, agents, model, msgs) → MCP tool tokens + details + deferred
// yQY(agentDefs)               → custom agent tokens + details
// LQY(tools, perm, agents)     → slash command tokens + command info
// CQY(messages)                → message tokens { totalTokens }
// RQY(tools, perm, agents)     → skill tokens { skillInfo }
//
// Each returns an object with token counts and optional detail arrays for
// rendering in the UI (tool names, server names, sources, etc.)

// ─── Helper: Format token count ─────────────────────────────────────────────
// deobfuscated.js:166731-166740 ($0)
function formatTokenCount(n) {
  if (n < 1000) return String(n);
  let k = (n / 1000).toFixed(1);
  if (k.endsWith(".0")) return `${k.slice(0, -2)}k`;
  return `${k}k`;
}

// deobfuscated.js:562697-562699 (dcY) — simpler version used in grid
function formatTokenCountSimple(n) {
  return `${Math.round(n / 1000)}k`;
}
