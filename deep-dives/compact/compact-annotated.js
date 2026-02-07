// ============================================================
// COMPACT COMMAND — CLEAN (RENAMED IDENTIFIERS)
// Source: deobfuscated.js (webcrack output)
// ============================================================

// === CONSTANTS ===

var MAX_COMPACT_OUTPUT_TOKENS = 20000;

var AUTO_COMPACT_RESERVE = 13000;
var WARNING_THRESHOLD_OFFSET = 20000;
var ERROR_THRESHOLD_OFFSET = 20000;
var BLOCKING_LIMIT_OFFSET = 3000;

var DEFAULT_COMPACT_CONFIG = {
  minTokens: 10000,
  minTextBlockMessages: 5,
  maxTokens: 40000,
};

// === COMPACT COMMAND DEFINITION ===
// Registered as a "local" type command (not "prompt" or "local-jsx")

var compactCommandDef;
var compactCommand;
var initCompactCommand = lazyInit(() => {
  initUtils();
  compactCommandDef = {
    type: "local",
    name: "compact",
    description:
      "Clear conversation history but keep a summary in context. Optional: /compact [instructions for summarization]",
    isEnabled: () => !isTruthy(process.env.DISABLE_COMPACT),
    isHidden: false,
    supportsNonInteractive: true,
    argumentHint: "<optional custom summarization instructions>",
    load: () =>
      Promise.resolve().then(() => {
        initCompactModule();
        return compactModule;
      }),
    userFacingName() {
      return "compact";
    },
  };
  compactCommand = compactCommandDef;
});

// === MODULE EXPORT ===

var compactModule = {};
registerExports(compactModule, {
  call: () => compactEntryPoint,
});

// === CONTEXT BUILDER ===
// Builds system prompt + user/system context for the forked compaction call

async function buildCompactContext(toolUseContext, forkMessages) {
  let appState = await toolUseContext.getAppState();
  let defaultSystemPrompt = await buildToolPrompts(
    toolUseContext.options.tools,
    toolUseContext.options.mainLoopModel,
    Array.from(appState.toolPermissionContext.additionalWorkingDirectories.keys()),
    toolUseContext.options.mcpClients,
  );
  let systemPrompt = buildSystemPrompt({
    mainThreadAgentDefinition: undefined,
    toolUseContext: toolUseContext,
    customSystemPrompt: toolUseContext.options.customSystemPrompt,
    defaultSystemPrompt: defaultSystemPrompt,
    appendSystemPrompt: toolUseContext.options.appendSystemPrompt,
  });
  let [userContext, systemContext] = await Promise.all([
    getUserContext(),
    getSystemContext(),
  ]);
  return {
    systemPrompt,
    userContext,
    systemContext,
    toolUseContext,
    forkContextMessages: forkMessages,
  };
}

// === COMPACT ENTRY POINT ===
// This is the `call` export — invoked when user runs `/compact [args]`

var compactEntryPoint = async (userArgs, context) => {
  trackFeatureUsage("compact");
  let { abortController, messages } = context;
  if (messages.length === 0) {
    throw Error("No messages to compact");
  }
  let customInstructions = userArgs.trim();
  try {
    // ── FAST PATH: Session-memory compaction (no LLM call needed) ──
    // Only attempted when no custom instructions are provided.
    // Uses stored session memory template to rebuild context without an API call.
    if (!customInstructions) {
      let sessionMemoryResult = await trySessionMemoryCompact(messages, context.agentId);
      if (sessionMemoryResult) {
        getUserContext.cache.clear?.();
        getProjectContext.cache.clear?.();
        resetReadFileState();
        let tip = getRandomTip("tip");
        let transcriptKeybind = getKeybindDisplay("app:toggleTranscript", "Global", "ctrl+o");
        let statusLines = [
          ...(context.options.verbose ? [] : [`(${transcriptKeybind} to see full summary)`]),
          ...(tip ? [tip] : []),
        ];
        return {
          type: "compact",
          compactionResult: sessionMemoryResult,
          displayText: chalk.dim("Compacted " + statusLines.join(`\n`)),
        };
      }
    }

    // ── STANDARD PATH: LLM-based summarization ──
    // 1. Pre-process messages (micro-compact large tool results)
    let preprocessedMessages = (await microCompactMessages(messages, undefined, context)).messages;

    // 2. Call the LLM to generate a summary
    let compactionResult = await performCompaction(
      preprocessedMessages,
      context,
      await buildCompactContext(context, preprocessedMessages),
      false,                   // isAutoCompact = false
      customInstructions,      // user's custom instructions (or empty)
      false,                   // isPartialCompact = false
    );

    // 3. Clean up state
    clearSessionMemoryId(undefined);
    resetReadFileState();
    getUserContext.cache.clear?.();
    getProjectContext.cache.clear?.();
    resetToolResultCache();

    let tip = getRandomTip("tip");
    let transcriptKeybind = getKeybindDisplay("app:toggleTranscript", "Global", "ctrl+o");
    let statusLines = [
      ...(context.options.verbose ? [] : [`(${transcriptKeybind} to see full summary)`]),
      ...(compactionResult.userDisplayMessage ? [compactionResult.userDisplayMessage] : []),
      ...(tip ? [tip] : []),
    ];
    return {
      type: "compact",
      compactionResult,
      displayText: chalk.dim("Compacted " + statusLines.join(`\n`)),
    };
  } catch (error) {
    if (abortController.signal.aborted) {
      throw Error("Compaction canceled.");
    } else if (error instanceof Error && error.message === EMPTY_MESSAGES_ERROR) {
      throw Error(EMPTY_MESSAGES_ERROR);
    } else {
      logError(error instanceof Error ? error : Error(String(error)));
      throw Error(`Error during compaction: ${error}`);
    }
  }
};

// === MICRO-COMPACT / PRE-PROCESSING ===
// Trims large tool results (Read, Bash, etc.) before sending to LLM.
// Replaces large tool_result blocks with references to saved files.
// Only kicks in when context is above warning threshold.

async function microCompactMessages(allMessages, targetTokens, context) {
  resetMicroCompactState();
  if (
    isTruthy(process.env.DISABLE_MICROCOMPACT) ||
    getFeatureFlag("tengu_cache_plum_violet", false)
  ) {
    return { messages: allMessages };
  }
  isTruthy(process.env.USE_API_CONTEXT_MANAGEMENT);
  let hasExplicitTarget = targetTokens !== undefined;
  let tokenBudget = hasExplicitTarget ? targetTokens : DEFAULT_MICRO_TOKEN_BUDGET;

  // Identify large tool_use/tool_result pairs from compactible tools
  let compactibleToolUseIds = [];
  let tokensByToolUse = new Map();
  for (let msg of allMessages) {
    if ((msg.type === "user" || msg.type === "assistant") && Array.isArray(msg.message.content)) {
      for (let block of msg.message.content) {
        if (block.type === "tool_use" && COMPACTIBLE_TOOLS.has(block.name)) {
          if (!alreadyCompacted.has(block.id)) {
            compactibleToolUseIds.push(block.id);
          }
        } else if (block.type === "tool_result" && compactibleToolUseIds.includes(block.tool_use_id)) {
          let tokenCount = estimateToolResultTokens(block.tool_use_id, block);
          tokensByToolUse.set(block.tool_use_id, tokenCount);
        }
      }
    }
  }

  // Keep the most recent N tool uses intact
  let recentToolUses = compactibleToolUseIds.slice(-RECENT_TOOL_USE_KEEP_COUNT);
  let totalToolTokens = Array.from(tokensByToolUse.values()).reduce((a, b) => a + b, 0);
  let tokensFreed = 0;
  let toolUsesToCompact = new Set();

  // Mark older tool uses for compaction until we're under budget
  for (let id of compactibleToolUseIds) {
    if (recentToolUses.includes(id)) continue;
    if (totalToolTokens - tokensFreed > tokenBudget) {
      toolUsesToCompact.add(id);
      tokensFreed += tokensByToolUse.get(id) || 0;
    }
  }

  // Only compact if above warning threshold (unless explicit target)
  if (!hasExplicitTarget) {
    let currentTokens = countTokens(allMessages);
    let model = context?.options.mainLoopModel ?? getDefaultModel();
    if (!getContextStatus(currentTokens, model).isAboveWarningThreshold || tokensFreed < MIN_FREED_TOKENS) {
      toolUsesToCompact.clear();
      tokensFreed = 0;
    }
  }

  // Replace compacted tool results with file references
  // ... (builds new message array with truncated tool results)
}

// === MAIN COMPACTION FUNCTION ===
// Orchestrates the full compaction pipeline: hooks → API call → post-processing

async function performCompaction(messages, context, cacheSafeParams, isAutoResume, customInstructions, isAutoCompact = false) {
  try {
    if (messages.length === 0) {
      throw Error(EMPTY_MESSAGES_ERROR);
    }
    let preCompactTokenCount = countTokens(messages);
    let messageStats = computeMessageStats(messages);
    let usageBreakdown = {};
    try {
      usageBreakdown = computeUsageBreakdown(messageStats);
    } catch (err) {
      logError(err);
    }
    let appState = await context.getAppState();
    updateToolPermissions(appState.toolPermissionContext, "summary");

    // ── Phase 1: Fire pre-compact hooks ──
    context.onCompactProgress?.({ type: "hooks_start", hookType: "pre_compact" });
    context.setSDKStatus?.("compacting");
    let hookResult = await runPreCompactHooks(
      {
        trigger: isAutoCompact ? "auto" : "manual",
        customInstructions: customInstructions ?? null,
      },
      context.abortController.signal,
    );
    // Hook output can inject additional summarization instructions
    if (hookResult.newCustomInstructions) {
      customInstructions = customInstructions
        ? `${customInstructions}\n\n${hookResult.newCustomInstructions}`
        : hookResult.newCustomInstructions;
    }
    let hookDisplayMessage = hookResult.userDisplayMessage;

    // ── Phase 2: Build the summarization prompt ──
    context.setStreamMode?.("requesting");
    context.setResponseLength?.(() => 0);
    context.onCompactProgress?.({ type: "compact_start" });

    let cacheEnabled = getFeatureFlag("tengu_compact_cache_prefix", false);
    let summarizationPrompt = buildSummarizationPrompt(customInstructions);
    let summaryRequestMessage = createUserMessage({ content: summarizationPrompt });

    // ── Phase 3: Call the LLM ──
    let apiResponse = await callCompactionLLM({
      messages: messages,
      summaryRequest: summaryRequestMessage,
      appState: appState,
      context: context,
      preCompactTokenCount: preCompactTokenCount,
      cacheSafeParams: cacheSafeParams,
    });

    // ── Phase 4: Validate the response ──
    let summaryText = extractTextFromResponse(apiResponse);
    if (!summaryText) {
      logDebug(`Compact failed: no summary text in response. Response: ${JSON.stringify(apiResponse)}`, { level: "error" });
      trackEvent("tengu_compact_failed", { reason: "no_summary", preCompactTokenCount, promptCacheSharingEnabled: cacheEnabled });
      throw Error("Failed to generate conversation summary - response did not contain valid text content");
    } else if (summaryText.startsWith(API_ERROR_PREFIX)) {
      trackEvent("tengu_compact_failed", { reason: "api_error", preCompactTokenCount, promptCacheSharingEnabled: cacheEnabled });
      throw Error(summaryText);
    } else if (summaryText.startsWith(PROMPT_TOO_LONG_PREFIX)) {
      trackEvent("tengu_compact_failed", { reason: "prompt_too_long", preCompactTokenCount, promptCacheSharingEnabled: cacheEnabled });
      throw Error(PROMPT_TOO_LONG_ERROR);
    }

    // ── Phase 5: Re-read recently accessed files ──
    // After compaction, re-read files that were accessed during the session
    // so they remain in context for future turns.
    let readFileSnapshot = snapshotReadFileState(context.readFileState);
    context.readFileState.clear();
    clearFileCache();
    let [restoredFiles, sessionAttachments] = await Promise.all([
      restoreRecentFiles(readFileSnapshot, context, MAX_RESTORED_FILES),
      getSessionAttachments(context),
    ]);
    let attachments = [...restoredFiles, ...sessionAttachments];

    // Add agent memory if exists
    let agentMemory = getAgentMemory(context.agentId ?? getSessionId());
    if (agentMemory) attachments.push(agentMemory);
    let agentContext = getAgentContextMessage(context.agentId);
    if (agentContext) attachments.push(agentContext);
    let todoContext = getTodoContext();
    if (todoContext) attachments.push(todoContext);

    // ── Phase 6: Fire session_start hooks ──
    context.onCompactProgress?.({ type: "hooks_start", hookType: "session_start" });
    let sessionHookResults = await runLifecycleHooks("compact", {
      model: context.options.mainLoopModel,
    });

    // ── Phase 7: Calculate metrics & build result ──
    let postCompactTokenCount = countTokens([apiResponse]);
    let compactionUsage = getUsageFromResponse(apiResponse);
    trackEvent("tengu_compact", {
      preCompactTokenCount,
      postCompactTokenCount,
      compactionInputTokens: compactionUsage?.input_tokens,
      compactionOutputTokens: compactionUsage?.output_tokens,
      compactionCacheReadTokens: compactionUsage?.cache_read_input_tokens ?? 0,
      compactionCacheCreationTokens: compactionUsage?.cache_creation_input_tokens ?? 0,
      compactionTotalTokens: compactionUsage
        ? compactionUsage.input_tokens +
          (compactionUsage.cache_creation_input_tokens ?? 0) +
          (compactionUsage.cache_read_input_tokens ?? 0) +
          compactionUsage.output_tokens
        : 0,
      promptCacheSharingEnabled: cacheEnabled,
      ...usageBreakdown,
    });

    // Create the boundary marker (visible in the transcript)
    let boundaryMarker = createCompactBoundary(
      isAutoCompact ? "auto" : "manual",
      preCompactTokenCount ?? 0,
      messages[messages.length - 1]?.uuid,
    );

    let transcriptPath = getTranscriptPath(getSessionId());

    // Format the summary as a user-role message with continuation context
    let summaryMessages = [
      createUserMessage({
        content: formatSummaryForContinuation(summaryText, isAutoResume, transcriptPath),
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true,
      }),
    ];

    resetQuerySource(context.options.querySource ?? "compact", context.agentId);

    return {
      boundaryMarker,
      summaryMessages,
      attachments,
      hookResults: sessionHookResults,
      userDisplayMessage: hookDisplayMessage,
      preCompactTokenCount,
      postCompactTokenCount,
      compactionUsage,
    };
  } catch (error) {
    handleCompactError(error, context);
    throw error;
  } finally {
    context.setStreamMode?.("requesting");
    context.setResponseLength?.(() => 0);
    context.onCompactProgress?.({ type: "compact_end" });
    context.setSDKStatus?.(null);
  }
}

// === LLM API CALL ===
// Makes the actual Claude API call for summarization

async function callCompactionLLM({
  messages,
  summaryRequest,
  appState,
  context,
  preCompactTokenCount,
  cacheSafeParams,
}) {
  // ── Try cache-sharing path first (if feature flag enabled) ──
  if (getFeatureFlag("tengu_compact_cache_prefix", false)) {
    try {
      let cacheResult = await runForkAgent({
        promptMessages: [summaryRequest],
        cacheSafeParams,
        canUseTool: denyAllTools(),
        querySource: "compact",
        forkLabel: "compact",
        maxTurns: 1,
      });
      let lastMessage = getLastAssistantMessage(cacheResult.messages);
      if (lastMessage && extractTextFromResponse(lastMessage)) {
        trackEvent("tengu_compact_cache_sharing_success", { /* metrics */ });
        return lastMessage;
      }
    } catch (err) {
      // fallback to standard path
    }
  }

  // ── Standard streaming compaction ──
  let retryEnabled = getFeatureFlag("tengu_compact_streaming_retry", false);
  let maxAttempts = retryEnabled ? MAX_RETRY_ATTEMPTS : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let hasStartedStreaming = false;
    let assistantResponse;
    context.setResponseLength?.(() => 0);

    // Determine tool list (may include tool definitions for tool-aware summaries)
    let tools = (await shouldIncludeTools(
      context.options.mainLoopModel,
      context.options.tools,
      async () => appState.toolPermissionContext,
      context.options.agentDefinitions.activeAgents,
      "compact",
    ))
      ? deduplicateByKey([BASH_TOOL, TEXT_EDITOR_TOOL, ...appState.mcp.tools], "name")
      : [BASH_TOOL];

    // Create streaming API call
    let stream = createStreamingAPICall({
      messages: toAPIMessages([...toConversationMessages(messages), summaryRequest]),
      systemPrompt: [
        "You are a helpful AI assistant tasked with summarizing conversations.",
      ],
      maxThinkingTokens: 0,
      tools,
      signal: context.abortController.signal,
      options: {
        async getToolPermissionContext() {
          return (await context.getAppState()).toolPermissionContext;
        },
        model: context.options.mainLoopModel,
        toolChoice: undefined,
        isNonInteractiveSession: context.options.isNonInteractiveSession,
        hasAppendSystemPrompt: !!context.options.appendSystemPrompt,
        maxOutputTokensOverride: MAX_COMPACT_OUTPUT_TOKENS, // 20,000
        querySource: "compact",
        agents: context.options.agentDefinitions.activeAgents,
        mcpTools: [],
        effortValue: appState.effortValue,
      },
    })[Symbol.asyncIterator]();

    // Process stream events
    let chunk = await stream.next();
    while (!chunk.done) {
      let event = chunk.value;
      if (!hasStartedStreaming && event.type === "stream_event" &&
          event.event.type === "content_block_start" &&
          event.event.content_block.type === "text") {
        hasStartedStreaming = true;
        context.setStreamMode?.("responding");
      }
      if (event.type === "stream_event" &&
          event.event.type === "content_block_delta" &&
          event.event.delta.type === "text_delta") {
        let len = event.event.delta.text.length;
        context.setResponseLength?.((prev) => prev + len);
      }
      if (event.type === "assistant") {
        assistantResponse = event;
      }
      chunk = await stream.next();
    }

    if (assistantResponse) return assistantResponse;

    // Retry if streaming failed
    if (attempt < maxAttempts) {
      trackEvent("tengu_compact_streaming_retry", { attempt, preCompactTokenCount, hasStartedStreaming });
      await sleepWithAbort(exponentialBackoff(attempt), context.abortController.signal);
      continue;
    }
    throw Error(COMPACT_STREAMING_FAILED);
  }
  throw Error(COMPACT_STREAMING_FAILED);
}

// === SESSION-MEMORY FAST PATH ===
// Attempts to compact using stored session memory (no LLM call).
// Returns null if session memory is not available or not suitable.

async function trySessionMemoryCompact(messages, agentId, autoCompactThreshold) {
  if (!isSessionMemoryEnabled()) return null;
  await loadSessionMemory();
  await syncSessionMemoryState();
  let lastSummarizedId = getLastSummarizedMessageId();
  let sessionMemoryTemplate = getSessionMemoryTemplate();
  if (!sessionMemoryTemplate) {
    trackEvent("tengu_sm_compact_no_session_memory", {});
    return null;
  }
  if (await isTemplateEmpty(sessionMemoryTemplate)) {
    trackEvent("tengu_sm_compact_empty_template", {});
    return null;
  }
  try {
    let splitIndex;
    if (lastSummarizedId) {
      splitIndex = messages.findIndex((msg) => msg.uuid === lastSummarizedId);
      if (splitIndex === -1) {
        trackEvent("tengu_sm_compact_summarized_id_not_found", {});
        return null;
      }
    } else {
      splitIndex = messages.length - 1;
      trackEvent("tengu_sm_compact_resumed_session", {});
    }
    let startIndex = findCompactStartIndex(messages, splitIndex);
    let recentMessages = messages.slice(startIndex).filter((msg) => !isSystemMeta(msg));
    let hookResults = await runLifecycleHooks("compact", { model: getDefaultModel() });
    let transcriptPath = getTranscriptPath(getSessionId());
    let compactionResult = buildSessionMemoryCompaction(
      messages, sessionMemoryTemplate, recentMessages, hookResults, transcriptPath, agentId,
    );
    let assembledMessages = assembleCompactedMessages(compactionResult);
    let postTokenCount = countTokensForMessages(assembledMessages);
    if (autoCompactThreshold !== undefined && postTokenCount >= autoCompactThreshold) {
      trackEvent("tengu_sm_compact_threshold_exceeded", {
        postCompactTokenCount: postTokenCount,
        autoCompactThreshold,
      });
      return null;
    }
    return { ...compactionResult, postCompactTokenCount: postTokenCount };
  } catch (err) {
    trackEvent("tengu_sm_compact_error", {});
    return null;
  }
}

// === SUMMARIZATION PROMPT ===
// Builds the detailed prompt asking the LLM to summarize the conversation.

function buildSummarizationPrompt(customInstructions) {
  let prompt = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - full code snippets
     - function signatures
     - file edits
  - Errors that you ran into and how you fixed them
  - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.

Your summary should include the following sections:

1. Primary Request and Intent
2. Key Technical Concepts
3. Files and Code Sections
4. Errors and fixes
5. Problem Solving
6. All user messages (non tool results)
7. Pending Tasks
8. Current Work
9. Optional Next Step (with direct quotes from recent conversation)

[...template and examples...]

IMPORTANT: Do NOT use any tools. You MUST respond with ONLY the <summary>...</summary> block as your text output.`;

  if (customInstructions && customInstructions.trim() !== "") {
    prompt += `\n\nAdditional Instructions:\n${customInstructions}`;
  }
  prompt += `\n\nIMPORTANT: Do NOT use any tools. You MUST respond with ONLY the <summary>...</summary> block as your text output.`;
  return prompt;
}

// === SUMMARY FORMATTER ===
// Strips <analysis>/<summary> XML tags from the LLM output, converts to plaintext.

function cleanSummaryXML(text) {
  let result = text;
  let analysisMatch = result.match(/<analysis>([\s\S]*?)<\/analysis>/);
  if (analysisMatch) {
    let content = analysisMatch[1] || "";
    result = result.replace(/<analysis>[\s\S]*?<\/analysis>/, `Analysis:\n${content.trim()}`);
  }
  let summaryMatch = result.match(/<summary>([\s\S]*?)<\/summary>/);
  if (summaryMatch) {
    let content = summaryMatch[1] || "";
    result = result.replace(/<summary>[\s\S]*?<\/summary>/, `Summary:\n${content.trim()}`);
  }
  result = result.replace(/\n\n+/g, `\n\n`);
  return result.trim();
}

// === SUMMARY MESSAGE BUILDER ===
// Wraps the summary in a continuation message that tells the LLM
// it's resuming from a previous conversation.

function formatSummaryForContinuation(summaryText, isAutoResume, transcriptPath, hasPreservedMessages) {
  let message = `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

${cleanSummaryXML(summaryText)}`;

  if (transcriptPath) {
    message += `\n\nIf you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: ${transcriptPath}`;
  }
  if (hasPreservedMessages) {
    message += `\n\nRecent messages are preserved verbatim.`;
  }
  if (isAutoResume) {
    return `${message}\nPlease continue the conversation from where we left it off without asking the user any further questions. Continue with the last task that you were asked to work on.`;
  }
  return message;
}

// === COMPACT BOUNDARY MARKER ===
// A system message that marks where compaction happened in the transcript.

function createCompactBoundary(trigger, preTokenCount, lastMessageUuid, userContext, messagesSummarized) {
  return {
    type: "system",
    subtype: "compact_boundary",
    content: "Conversation compacted",
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: generateUUID(),
    level: "info",
    compactMetadata: {
      trigger,            // "manual" | "auto"
      preTokens: preTokenCount,
      userContext,
      messagesSummarized,
    },
    ...(lastMessageUuid ? { logicalParentUuid: lastMessageUuid } : {}),
  };
}

// === ASSEMBLE FINAL MESSAGES ===
// Combines all pieces into the new conversation state after compaction.

function assembleCompactedMessages(result) {
  return [
    result.boundaryMarker,     // System message marking the compaction point
    ...result.summaryMessages, // The summary as a user-role message
    ...(result.messagesToKeep ?? []),  // Messages preserved verbatim (partial compact)
    ...result.attachments,     // Re-read files, agent memory, todos
    ...result.hookResults,     // Results from session_start hooks
  ];
}

// === PRE-COMPACT HOOK ===
// Runs user-configured pre-compact hooks. Hook output can inject
// additional summarization instructions.

async function runPreCompactHooks(params, abortSignal, timeoutMs = DEFAULT_HOOK_TIMEOUT) {
  let hookInput = {
    ...getBaseHookInput(undefined),
    hook_event_name: "PreCompact",
    trigger: params.trigger,              // "manual" | "auto"
    custom_instructions: params.customInstructions,
  };
  let results = await executeHooks({
    hookInput,
    matchQuery: params.trigger,
    signal: abortSignal,
    timeoutMs,
  });
  if (results.length === 0) return {};
  let successOutputs = results
    .filter((r) => r.succeeded && r.output.trim().length > 0)
    .map((r) => r.output.trim());
  let displayLines = [];
  for (let r of results) {
    if (r.succeeded) {
      displayLines.push(r.output.trim()
        ? `PreCompact [${r.command}] completed successfully: ${r.output.trim()}`
        : `PreCompact [${r.command}] completed successfully`);
    } else {
      displayLines.push(r.output.trim()
        ? `PreCompact [${r.command}] failed: ${r.output.trim()}`
        : `PreCompact [${r.command}] failed`);
    }
  }
  return {
    newCustomInstructions: successOutputs.length > 0 ? successOutputs.join(`\n\n`) : undefined,
    userDisplayMessage: displayLines.length > 0 ? displayLines.join(`\n`) : undefined,
  };
}

// === TOOL USE DENIAL ===
// During compaction, all tool use is denied — the LLM can only produce text.

function denyAllTools() {
  return async () => ({
    behavior: "deny",
    message: "Tool use is not allowed during compaction",
    decisionReason: {
      type: "other",
      reason: "compaction agent should only produce text summary",
    },
  });
}

// === AUTO-COMPACT THRESHOLD ===
// Determines when to trigger automatic compaction based on token count.

function getEffectiveContextWindow(model) {
  let reserved = Math.min(getReservedTokens(model), MAX_RESERVED);
  return getModelContextWindow(model, getProvider()) - reserved;
}

function getAutoCompactThreshold(model) {
  let effectiveWindow = getEffectiveContextWindow(model);
  let threshold = effectiveWindow - AUTO_COMPACT_RESERVE; // effective - 13000
  let envOverride = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
  if (envOverride) {
    let pct = parseFloat(envOverride);
    if (!isNaN(pct) && pct > 0 && pct <= 100) {
      let overrideThreshold = Math.floor(effectiveWindow * (pct / 100));
      return Math.min(overrideThreshold, threshold);
    }
  }
  return threshold;
}

function getContextStatus(tokenCount, model) {
  let autoThreshold = getAutoCompactThreshold(model);
  let effectiveWindow = isAutoCompactEnabled() ? autoThreshold : getEffectiveContextWindow(model);
  let percentLeft = Math.max(0, Math.round(((effectiveWindow - tokenCount) / effectiveWindow) * 100));
  let warningLevel = effectiveWindow - WARNING_THRESHOLD_OFFSET;   // -20000
  let errorLevel = effectiveWindow - ERROR_THRESHOLD_OFFSET;       // -20000
  let isAboveAutoCompactThreshold = isAutoCompactEnabled() && tokenCount >= autoThreshold;
  let blockingLimit = getModelContextWindow(model, getProvider()) - BLOCKING_LIMIT_OFFSET;
  let envBlockingOverride = process.env.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE;
  let parsedOverride = envBlockingOverride ? parseInt(envBlockingOverride, 10) : NaN;
  let effectiveBlockingLimit = !isNaN(parsedOverride) && parsedOverride > 0 ? parsedOverride : blockingLimit;
  let isAtBlockingLimit = tokenCount >= effectiveBlockingLimit;

  return {
    percentLeft,
    isAboveWarningThreshold: tokenCount >= warningLevel,
    isAboveErrorThreshold: tokenCount >= errorLevel,
    isAboveAutoCompactThreshold,
    isAtBlockingLimit,
  };
}

function isAutoCompactEnabled() {
  if (isTruthy(process.env.DISABLE_COMPACT)) return false;
  if (isTruthy(process.env.DISABLE_AUTO_COMPACT)) return false;
  return getSettings().autoCompactEnabled;
}

async function shouldAutoCompact(messages, model, querySource) {
  if (querySource === "session_memory" || querySource === "compact") return false;
  if (!isAutoCompactEnabled()) return false;
  let tokenCount = countTokens(messages);
  let threshold = getAutoCompactThreshold(model);
  let effectiveWindow = getEffectiveContextWindow(model);
  logDebug(`autocompact: tokens=${tokenCount} threshold=${threshold} effectiveWindow=${effectiveWindow}`);
  let { isAboveAutoCompactThreshold } = getContextStatus(tokenCount, model);
  return isAboveAutoCompactThreshold;
}


// ============================================================
// SLASH COMMAND MENU SYSTEM
// ============================================================

// === COMMAND REGISTRY ===
// builtinCommands is a lazy-initialized array of all built-in command objects.
// Each is a variable defined via separate lazy initializers (like compactCommand above).

builtinCommands = lazyCompute(() => [
  // ...60+ built-in command objects including:
  // compactCommand (J1q), clearCommand, contextCommand, helpCommand,
  // exitCommand, configCommand, resumeCommand, etc.
  // (full list at deobfuscated.js:629929-629994)
]);

// builtinCommandNames = set of all built-in command names
builtinCommandNames = lazyCompute(() => new Set(builtinCommands().map((cmd) => cmd.name)));

// getAllCommands = full command list (built-in + user skills + plugins + MCP)
getAllCommands = lazyCompute(async (mcpClients) => {
  let [{ skillDirCommands, pluginSkills, bundledSkills }, mcpCommands, policyCommands] =
    await Promise.all([loadSkillDirectories(mcpClients), loadMcpCommands(), loadPolicyCommands()]);
  let remoteCommands = getRemoteCommands();
  let allCommands = [...bundledSkills, ...skillDirCommands, ...mcpCommands, ...pluginSkills, ...policyCommands, ...builtinCommands()]
    .filter((cmd) => cmd.isEnabled());
  if (remoteCommands.length === 0) return allCommands;

  // Insert remote commands before built-in commands
  let existingNames = new Set(allCommands.map((cmd) => cmd.name));
  let newRemoteCommands = remoteCommands.filter((cmd) => !existingNames.has(cmd.name) && cmd.isEnabled());
  if (newRemoteCommands.length === 0) return allCommands;
  let builtinNames = new Set(builtinCommands().map((cmd) => cmd.name));
  let insertIndex = allCommands.findIndex((cmd) => builtinNames.has(cmd.name));
  if (insertIndex === -1) return [...allCommands, ...newRemoteCommands];
  return [...allCommands.slice(0, insertIndex), ...newRemoteCommands, ...allCommands.slice(insertIndex)];
});

// === COMMAND LOOKUP ===

function isCommandRegistered(name, commands) {
  return commands.some(
    (cmd) => cmd.name === name || cmd.userFacingName() === name || cmd.aliases?.includes(name),
  );
}

function findCommand(name, commands) {
  let found = commands.find(
    (cmd) => cmd.name === name || cmd.userFacingName() === name || cmd.aliases?.includes(name),
  );
  if (!found) {
    throw ReferenceError(
      `Command ${name} not found. Available commands: ${commands
        .map((cmd) => {
          let displayName = cmd.userFacingName();
          if (cmd.aliases) return `${displayName} (aliases: ${cmd.aliases.join(", ")})`;
          return displayName;
        })
        .sort((a, b) => a.localeCompare(b))
        .join(", ")}`,
    );
  }
  return found;
}

// === AUTOCOMPLETE / SLASH MENU ===
// This is the function that builds the dropdown when you type "/"

function getCommandSuggestions(inputText, allCommands) {
  // Only show suggestions for inputs starting with "/"
  if (!inputText.startsWith("/")) return [];
  // Don't show suggestions once a space is typed after the command
  if (inputText.includes(" ") && !inputText.endsWith(" ") /* ... */) return [];

  let searchTerm = inputText.slice(1).toLowerCase().trim();

  // ── EMPTY SLASH (just "/") → Show all visible commands ──
  if (searchTerm === "") {
    let visibleCommands = allCommands.filter((cmd) => !cmd.isHidden);
    let recentlyUsed = [];

    // Top 5 recently-used prompt commands (sorted by recency score)
    let recentPrompts = visibleCommands
      .filter((cmd) => cmd.type === "prompt")
      .map((cmd) => ({
        cmd,
        score: getRecencyScore(cmd.userFacingName()),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    for (let item of recentPrompts.slice(0, 5)) {
      recentlyUsed.push(item.cmd);
    }

    // Remaining commands grouped by source, then alphabetically
    let recentIds = new Set(recentlyUsed.map((cmd) => getCommandId(cmd)));
    let userSettingsCommands = [];    // from ~/.claude/commands/
    let projectSettingsCommands = []; // from .claude/commands/
    let policyCommands = [];          // from policy settings
    let otherCommands = [];           // built-in, MCP, etc.

    visibleCommands.forEach((cmd) => {
      if (recentIds.has(getCommandId(cmd))) return;
      if (cmd.type === "prompt" && (cmd.source === "userSettings" || cmd.source === "localSettings")) {
        userSettingsCommands.push(cmd);
      } else if (cmd.type === "prompt" && cmd.source === "projectSettings") {
        projectSettingsCommands.push(cmd);
      } else if (cmd.type === "prompt" && cmd.source === "policySettings") {
        policyCommands.push(cmd);
      } else {
        otherCommands.push(cmd);
      }
    });

    let sortAlpha = (a, b) => a.userFacingName().localeCompare(b.userFacingName());
    userSettingsCommands.sort(sortAlpha);
    projectSettingsCommands.sort(sortAlpha);
    policyCommands.sort(sortAlpha);
    otherCommands.sort(sortAlpha);

    // Order: recently used → user settings → project settings → policy → built-in/other
    return [...recentlyUsed, ...userSettingsCommands, ...projectSettingsCommands, ...policyCommands, ...otherCommands]
      .map((cmd) => buildSuggestionItem(cmd));
  }

  // ── PARTIAL MATCH → Fuse.js fuzzy search ──
  let searchableCommands = allCommands
    .filter((cmd) => !cmd.isHidden)
    .map((cmd) => {
      let name = cmd.userFacingName();
      let nameParts = name.split(/[-_:]/).filter(Boolean);
      return {
        nameKey: name,
        descriptionKey: cmd.description.split(" ").map(stemWord).filter(Boolean),
        partKey: nameParts.length > 1 ? nameParts : undefined,
        commandName: name,
        command: cmd,
        aliasKey: cmd.aliases,
      };
    });

  return [
    ...new Fuse(searchableCommands, {
      includeScore: true,
      threshold: 0.3,
      location: 0,
      distance: 100,
      keys: [
        { name: "commandName", weight: 3 },    // Command name has highest weight
        { name: "partKey", weight: 2 },         // Hyphenated parts
        { name: "aliasKey", weight: 2 },        // Aliases
        { name: "descriptionKey", weight: 0.5 }, // Description words (lowest weight)
      ],
    }).search(searchTerm),
  ]
    .sort((a, b) => {
      let aName = a.item.commandName.toLowerCase();
      let bName = b.item.commandName.toLowerCase();
      let aAliases = a.item.aliasKey?.map((x) => x.toLowerCase()) ?? [];
      let bAliases = b.item.aliasKey?.map((x) => x.toLowerCase()) ?? [];

      // 1. Exact name match wins
      if (aName === searchTerm && bName !== searchTerm) return -1;
      if (bName === searchTerm && aName !== searchTerm) return 1;
      // 2. Exact alias match
      if (aAliases.some((x) => x === searchTerm) && !bAliases.some((x) => x === searchTerm)) return -1;
      if (bAliases.some((x) => x === searchTerm) && !aAliases.some((x) => x === searchTerm)) return 1;
      // 3. Starts-with name
      if (aName.startsWith(searchTerm) && !bName.startsWith(searchTerm)) return -1;
      if (bName.startsWith(searchTerm) && !aName.startsWith(searchTerm)) return 1;
      // 4. Starts-with alias
      if (aAliases.some((x) => x.startsWith(searchTerm)) && !bAliases.some((x) => x.startsWith(searchTerm))) return -1;
      if (bAliases.some((x) => x.startsWith(searchTerm)) && !aAliases.some((x) => x.startsWith(searchTerm))) return 1;
      // 5. Fuzzy score (lower is better)
      let scoreDiff = (a.score ?? 0) - (b.score ?? 0);
      if (Math.abs(scoreDiff) > 0.1) return scoreDiff;
      // 6. Recency (higher is better)
      let aRecency = a.item.command.type === "prompt" ? getRecencyScore(a.item.command.userFacingName()) : 0;
      let bRecency = b.item.command.type === "prompt" ? getRecencyScore(b.item.command.userFacingName()) : 0;
      return bRecency - aRecency;
    })
    .map((result) => {
      let cmd = result.item.command;
      let matchedAlias = findMatchingAlias(searchTerm, cmd.aliases);
      return buildSuggestionItem(cmd, matchedAlias);
    });
}

// === SUGGESTION ITEM BUILDER ===

function buildSuggestionItem(command, matchedAlias) {
  let name = command.userFacingName();
  let aliasSuffix = matchedAlias ? ` (${matchedAlias})` : "";
  let description =
    getCommandDescription(command) +
    (command.type === "prompt" && command.argNames?.length
      ? ` (arguments: ${command.argNames.join(", ")})`
      : "");
  return {
    id: getCommandId(command),
    displayText: `/${name}${aliasSuffix}`,
    description,
    metadata: command,
  };
}

// === RECENCY SCORING ===
// Commands you've used recently appear higher in the list.
// Uses exponential decay with a 7-day half-life.

function getRecencyScore(commandName) {
  let usage = getSettings().skillUsage?.[commandName];
  if (!usage) return 0;
  let daysSinceLastUse = (Date.now() - usage.lastUsedAt) / 86400000;
  let decayFactor = Math.pow(0.5, daysSinceLastUse / 7); // half-life = 7 days
  return usage.usageCount * Math.max(decayFactor, 0.1);
}
