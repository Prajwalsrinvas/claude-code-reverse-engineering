// ============================================================================
// Claude Code /compact — annotated extraction
// Source: Claude Code npm package v2.1.201, webcrack --no-jsx + prettier
// Date extracted: 2026-07-04
// Previous pass covered v2.1.34 (see README.md's old excerpts) — this file is
// a full rewrite: the architecture changed substantially between the two
// versions (see /tmp/.../scratchpad/ev-compact.md for the full diff).
//
// Identifiers below are RENAMED from the mangled source for readability.
// Every renamed symbol carries a `// deobfuscated.js:NNNNN` line reference to
// the original. Renames are inferred from string literals, telemetry event
// names, and call-site usage; anything not fully certain is flagged
// `/* uncertain */`.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. Command registration — deobfuscated.js:647809-647825
// ----------------------------------------------------------------------------
var compactCommandDefinition;              // was HYf
var compactCommandExport;                  // was bcr
var registerCompactCommand = E(() => {     // was X6l
  cr();
  compactCommandDefinition = {
    type: "local",
    name: "compact",
    // CHANGED from 2.1.34: was "Clear conversation history but keep a summary
    // in context. Optional: /compact [instructions for summarization]"
    description: "Free up context by summarizing the conversation so far",
    isEnabled: () => !ke.DISABLE_COMPACT,
    supportsNonInteractive: true,
    argumentHint: "<optional custom summarization instructions>",
    // NEW field vs 2.1.34: generic thin-client routing tag shared by ~15
    // other commands, not compact-specific.
    thinClientDispatch: "post-text",
    load: () => Promise.resolve().then(() => {
      loadCompactModule();                 // was Y6l
      return compactModule;                // was K6l
    })
  };
  compactCommandExport = compactCommandDefinition;
});

// NEW in 2.1.201: a companion `/autocompact` command didn't exist in 2.1.34.
// Two registrations share the name "autocompact" — an interactive slider UI
// and a non-interactive setter — both let the user configure the auto-compact
// window directly. deobfuscated.js:648280-648316
var autocompactSliderCommand;               // was nzl (type: "local-jsx")
var autocompactSetterCommand;                // was Scr (type: "local")
var registerAutocompactCommand = E(() => {  // was rzl
  dt();
  A2();
  autocompactSliderCommand = {
    type: "local-jsx",
    name: "autocompact",
    description: "Set how full the context gets before auto-summarizing",
    isEnabled: () => autocompactCommandAvailable() && !isRemoteSurface(), // tzl(), mr()
    isHidden: false,
    argumentHint: "[auto|<tokens>]",
    load: () => Promise.resolve().then(() => {
      loadAutocompactSliderModule();        // was ezl
      return autocompactSliderModule;       // was Z6l
    }),
    userFacingName() { return "autocompact"; }
  };
  autocompactSetterCommand = {
    type: "local",
    name: "autocompact",
    supportsNonInteractive: true,
    thinClientDispatch: "post-text",
    description: "Configure the auto-compact window size",
    get isHidden() { return !isRemoteSurface() && !isNonInteractiveSession(); }, // mr(), na()
    isEnabled() { return autocompactCommandAvailable() && (isRemoteSurface() || isNonInteractiveSession()); },
    argumentHint: "[auto|<tokens>]",
    load: () => Promise.resolve().then(() => {
      loadAutocompactSetterModule();        // was gqo
      return autocompactSetterModule;       // was J6l
    }),
    userFacingName() { return "autocompact"; }
  };
});

// ----------------------------------------------------------------------------
// 2. Entry point + manual-compact orchestration — deobfuscated.js:647519-647784
// ----------------------------------------------------------------------------
var compactModule = {};                     // was K6l
at(compactModule, { call: () => compactEntryPoint }); // was _Yf

var compactEntryPoint = async (argsText, ctx) => {  // was _Yf
  let { abortController } = ctx;
  let { messages } = ctx;
  messages = dropAttachmentOnly(messages);          // was jh
  if (messages.length === 0) {
    throw Error("No messages to compact");
  }
  let customInstructions = argsText.trim();
  try {
    return await runManualCompaction(messages, ctx, customInstructions); // was bYf
  } catch (err) {
    if (abortController.signal.aborted) {
      throw new CanceledError("Compaction canceled.");                  // was tl
    } else if (isErrorMatching(err, PROMPT_TOO_LONG_MSG)) {              // was Lle(s, Uyt)
      return { type: "text", value: PROMPT_TOO_LONG_MSG };
    } else if (err instanceof CompactionUserFacingError) {               // was aV
      return { type: "text", value: err.message };
    } else {
      reportError(err);                                                 // was Re
      throw Error(`Error during compaction: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  }
};

// runManualCompaction — was bYf, deobfuscated.js:647523-647654
// This is the actual body of the OLD 2-path pipeline (session-memory fast
// path vs standard LLM path). That framing is GONE in 2.1.201: there is no
// zero-LLM fast path anymore. Instead it's a precompute/borrow scheme — the
// LLM compaction may already be running/done in the background, and this
// function just tries to reuse that result before doing a fresh one.
async function runManualCompaction(messages, ctx, customInstructions) {
  ctx.onCompactEvent?.({ type: "compact_progress", event: { type: "hooks_start", hookType: "pre_compact" } });
  ctx.onCompactEvent?.({ type: "sdk_status", status: "compacting" });
  let startTime = performance.now();
  let postTokens;
  let preTokens = countTokens(messages);              // was Lw
  let reuseKind;
  try {
    let [hookResult, contextBundle] = await Promise.all([
      runPreCompactHooks({ trigger: "manual", customInstructions: customInstructions || null }, ctx.abortController.signal), // was wZ
      buildCompactionContext(ctx, messages)             // was AYf
    ]);
    forwardHookNotifications(hookResult, g => ctx.onQueryEvent?.({ type: "notification", notification: g })); // was z9n
    let mergedInstructions = mergeCustomInstructions(customInstructions, hookResult.newCustomInstructions); // was pwo
    ctx.onCompactEvent?.({ type: "stream_mode", mode: "requesting" });
    ctx.onQueryEvent?.({ type: "response_length", op: "reset" });
    ctx.onCompactEvent?.({ type: "compact_progress", event: { type: "compact_start" } });

    // Check whether a precomputed (background) compaction is ready to reuse.
    let precompute = await tryReusePrecomputedCompact(               // was SYf
      customInstructions, hookResult.newCustomInstructions, messages, ctx.abortController.signal
    );
    reuseKind = precompute.reuse;
    let result = await (precompute.hit
      ? finalizeCompactionResult({ ...precompute.finalize, startTime, cacheSafeParams: contextBundle }) // was l8n
      : runFreshReactiveCompaction(messages, contextBundle, {                                            // was Dwo
          customInstructions: mergedInstructions,
          trigger: "manual",
          manualPrecomputeReuse: precompute.reuse,
          userWaitStartedAt: startTime,
          precomputedKind: precompute.precomputedKind,
          precomputedFailureCause: precompute.precomputedFailureCause
        })
    ).catch(g => {
      reportError(g);
      return { ok: false, reason: "error", detail: describeError(g) };
    });

    if (!result.ok) {
      switch (result.reason) {
        case "too_few_groups": throw Error(TOO_FEW_MESSAGES_MSG);
        case "aborted": throw Error(ABORTED_MSG);
        case "exhausted": throw new CompactionUserFacingError("Compaction failed · conversation could not be reduced below the context limit");
        case "media_unstrippable": throw new CompactionUserFacingError("Compaction failed · attached media exceeds size limits");
        case "error": throw new CompactionUserFacingError(`Error during compaction: ${result.detail || "unknown error"}`);
      }
    }

    let boundaryMarker = result.result.boundaryMarker;
    if (boundaryMarker.subtype === "compact_boundary" && "compactMetadata" in boundaryMarker) {
      postTokens = boundaryMarker.compactMetadata.postTokens;
    }
    clearAppStateAfterCompact(undefined, ctx.setAppState);  // was Ife
    clearPromptCaches();                                     // was Vyt
    contextCache.cache.clear?.();                            // was vA
    let displayMsg = [hookResult.userDisplayMessage, result.result.userDisplayMessage].filter(Boolean).join("\n") || undefined;
    return {
      type: "compact",
      compactionResult: { ...result.result, userDisplayMessage: displayMsg },
      displayText: formatCompactedDisplayText(ctx, displayMsg)  // was EYf
    };
  } catch (err) {
    reuseKind = err instanceof Error ? err.message : "reactive compaction failed";
    throw err;
  } finally {
    ctx.onCompactEvent?.({ type: "stream_mode", mode: "requesting" });
    ctx.onQueryEvent?.({ type: "response_length", op: "reset" });
    ctx.onCompactEvent?.({ type: "compact_progress", event: { type: "compact_end" } });
    recordCompactTelemetry({                                  // was GDe
      trigger: "manual", success: !reuseKind, durationMs: performance.now() - startTime,
      preTokens, postTokens, error: reuseKind, precomputeReuse: reuseKind
    });
    ctx.onCompactEvent?.({
      type: "sdk_status", status: null,
      metadata: { compactResult: reuseKind ? "failed" : "success", ...(reuseKind && { compactError: reuseKind }) }
    });
  }
}

// tryReusePrecomputedCompact — was SYf, deobfuscated.js:647655-647723
// Checks the precomputed-compact cache for a hit/miss/pending result.
async function tryReusePrecomputedCompact(customInstructions, hookInstructions, messages, signal) {
  if (customInstructions) return { hit: false, reuse: "miss_custom_instructions" };
  if (hookInstructions) return { hit: false, reuse: "miss_hook" };
  let waitStart = performance.now();
  let precomputed = await consumePrecomputedCompact(undefined, signal); // was Two
  let waitMs = performance.now() - waitStart;
  if (precomputed === null) {
    logPrecomputeConsumed("none", precomputed, waitMs);      // was Xyt
    return { hit: false, reuse: "miss_not_ready", precomputedKind: "none" };
  }
  if (precomputed.kind === "turn_aborted") {
    logPrecomputeConsumed("aborted", precomputed, waitMs);
    throw Error(ABORTED_MSG);
  }
  if (precomputed.kind === "failed") {
    logPrecomputeConsumed("failed", precomputed, waitMs);
    return { hit: false, reuse: "miss_not_ready", precomputedKind: "failed", precomputedFailureCause: precomputed.failure.cause };
  }
  let messagesSince = messagesSinceBoundary(messages, precomputed.ready.precomputedAtUuid); // was Cwo
  if (messagesSince === null) {
    logPrecomputeConsumed("none", precomputed, waitMs);
    logPrecomputedCompactDiscarded(precomputed.ready, "boundary_uuid_missing", undefined); // was r8n
    return { hit: false, reuse: "miss_not_ready", precomputedKind: "none" };
  }
  logPrecomputeConsumed("applied", precomputed, waitMs);
  return {
    hit: true, reuse: "hit",
    finalize: {
      compactResult: precomputed.ready.result,
      messagesToPreserve: [...precomputed.ready.result.messagesToPreserve, ...messagesSince],
      preCompactMessages: messages, querySource: undefined, trigger: "manual",
      precomputed: true, manualPrecomputeReuse: "hit",
      precomputeTelemetry: {
        statusAtPTL: precomputed.statusAtPTL === "ready" ? "ready" : "pending",
        leadMs: waitStart - precomputed.ready.startedAt,
        totalMs: precomputed.ready.readyDurationMs,
        borrowed: false,
        messagesSinceTokens: countTokens(messagesSince)
      }
    }
  };
}

// consumePrecomputedCompact — was Two, deobfuscated.js:403481-403523
// Reads (and removes) an entry from the precomputed-compact cache `oB`.
async function consumePrecomputedCompact(agentKey, signal) {
  let cacheKey = precomputeCacheKey(agentKey);           // was Yyt
  let entry = precomputedCompactCache.get(cacheKey);     // was oB
  if (entry === undefined || signal.aborted) return null;
  let statusAtPTL = entry.status;
  if (entry.status === "pending") {
    log(`precomputed compact: awaiting in-flight (${cacheKey})`);
    let abortedWhileWaiting = await Promise.race([
      entry.settled.then(() => false),
      new Promise(resolve => signal.addEventListener("abort", () => resolve(true), { once: true }))
    ]);
    if (abortedWhileWaiting) {
      log(`precomputed compact: turn aborted while awaiting (${cacheKey}) — leaving entry`);
      return { kind: "turn_aborted", statusAtPTL };
    }
  }
  let finalEntry = precomputedCompactCache.get(cacheKey);
  precomputedCompactCache.delete(cacheKey);
  releasePrecomputeResources(finalEntry);                // was bza
  log(`precomputed compact: consumed (${cacheKey}, ${finalEntry?.status ?? "gone"})`);
  switch (finalEntry?.status) {
    case "ready": return { kind: "ready", ready: finalEntry, statusAtPTL };
    case "failed": return { kind: "failed", failure: finalEntry.failure, statusAtPTL };
    case "pending":
    case undefined: return null;
  }
}

var precomputedCompactCache;                  // was oB — Map<agentKey, PrecomputeEntry>
var MAX_REACTIVE_COMPACT_ATTEMPTS_PER_AGENT = 3; // was mza, deobfuscated.js:403709
var PRECOMPUTE_CACHE_TTL_MS = 604800000;      // was rYp (7 days), deobfuscated.js:403713
var PRECOMPUTE_STALE_MS = 150000;             // was oYp, deobfuscated.js:403714

// ----------------------------------------------------------------------------
// 3. Reactive/grouped-retry compaction engine — deobfuscated.js:402608-404061
//    This REPLACES both the old micro-compact pre-trim and the old
//    performCompaction() LLM call as a single unified function.
// ----------------------------------------------------------------------------

// runFreshReactiveCompaction — was Dwo, deobfuscated.js:404003-404061
async function runFreshReactiveCompaction(messages, cacheSafeParams, opts) {
  let preTokens = countTokens(messages);
  let waitStart = opts?.userWaitStartedAt ?? performance.now();
  let querySource = opts?.querySource;
  let trigger = opts?.trigger ?? "auto";
  let attemptResult = await runGroupedReactiveCompaction(messages, cacheSafeParams, { // was Q9n
    customInstructions: opts?.customInstructions,
    initialTokenGap: opts?.initialTokenGap
  });
  if (!attemptResult.ok) {
    reportEvent("tengu_reactive_compact_failed", {
      querySource: normalizeQuerySource(querySource),
      reason: normalizeEnum(attemptResult.reason),
      trigger: normalizeEnum(trigger),
      preCompactTokens: preTokens,
      attempts: attemptResult.attempts,
      totalGroups: attemptResult.totalGroups,
      durationMs: Math.round(performance.now() - waitStart)
      /* ...additional fields omitted for brevity */
    });
    return { ok: false, reason: attemptResult.reason, detail: attemptResult.detail };
  }
  return finalizeCompactionResult({
    compactResult: attemptResult.result,
    messagesToPreserve: attemptResult.result.messagesToPreserve,
    preCompactMessages: messages, preCompactTokens: preTokens, startTime: waitStart,
    cacheSafeParams, querySource, trigger,
    thresholdSource: opts?.thresholdSource, precomputed: false,
    manualPrecomputeReuse: opts?.manualPrecomputeReuse
  });
}

// runGroupedReactiveCompaction — was Q9n, deobfuscated.js:402608-402770
// NEW ARCHITECTURE vs 2.1.34: instead of a fixed "drop oldest 20%, retry up
// to 3 times" loop, messages are grouped by assistant turn (`groupMessages`,
// was p6t) and the retry walks the group boundary inward. Two notable new
// behaviors:
//   (a) SEEDED FIRST STEP: if `initialTokenGap` (the actual overflow size
//       that triggered this compaction) is known, the very first attempt's
//       drop-step is computed from that real number via `computeSeededDropStep`
//       instead of starting from the smallest possible drop.
//   (b) ADAPTIVE STEP SIZING: each subsequent prompt-too-long failure reports
//       back a `tokenGap`, and `computeNextDropStep` uses that to size the
//       next drop — not a fixed percentage.
async function runGroupedReactiveCompaction(messages, cacheSafeParams, opts) {
  let groups = groupMessagesForReactiveCompact(messages); // was p6t
  let totalGroups = groups.length;
  if (totalGroups < 2) {
    log("Reactive compact: fewer than 2 groups, nothing to compact");
    return { ok: false, reason: "too_few_groups", attempts: 0, totalGroups };
  }
  let signal = cacheSafeParams.toolUseContext.abortController.signal;
  let groupsToPreserve = 1;
  let attempts = 0;
  let stepInfo;
  let groupTokenSizes;
  let mediaStripped = false;
  let viaCreditsBoundary = false;

  // (a) seed the first step from the real overflow size, when known.
  if (opts?.initialTokenGap !== undefined && totalGroups > 3) {
    groupTokenSizes = groups.map(g => countTokens(g));
    let gap = opts.initialTokenGap - (groupTokenSizes[totalGroups - 1] ?? 0);
    if (gap > 0) {
      let seededStep = computeSeededDropStep(groupTokenSizes, totalGroups - 1, gap); // was tza
      groupsToPreserve = 1 + seededStep;
      stepInfo = { mode: "seeded", step: seededStep, tokenGap: opts.initialTokenGap };
    }
  }

  while (groupsToPreserve < totalGroups) {
    if (signal.aborted) return { ok: false, reason: "aborted", attempts, totalGroups };
    attempts++;
    let preserveCount = totalGroups - groupsToPreserve;
    let toSummarize = groups.slice(0, preserveCount);
    let toPreserve = groups.slice(preserveCount);
    let flatSummarize = toSummarize.flat();
    if (!flatSummarize.some(m => m.type === "assistant")) {
      log("Reactive compact: no assistant messages in summarize set, bailing");
      return { ok: false, reason: attempts > 1 ? "exhausted" : "too_few_groups", attempts: attempts - 1, totalGroups };
    }
    reportEvent("tengu_reactive_compact_attempt", {
      attempt: attempts, groupsToSummarize: toSummarize.length, groupsToPreserve: toPreserve.length,
      strippedMedia: mediaStripped, stepMode: normalizeEnum(stepInfo?.mode), stepSize: stepInfo?.step, tokenGap: stepInfo?.tokenGap
    });
    let summarizeResult = await attemptGroupSummarization(flatSummarize, cacheSafeParams, opts?.customInstructions, mediaStripped); // was QKp
    if (summarizeResult.ok) {
      return {
        ok: true,
        result: {
          summaryMessages: summarizeResult.messages, summaryText: summarizeResult.summaryText,
          messagesToPreserve: toPreserve.flat(), attempt: attempts,
          totalUsage: summarizeResult.totalUsage, groupsPreserved: groupsToPreserve, totalGroups
        }
      };
    }
    switch (summarizeResult.reason) {
      case "aborted": return { ok: false, reason: "aborted", attempts, totalGroups };
      case "error":
        return { ok: false, reason: "error", attempts, totalGroups, detail: summarizeResult.detail, status: summarizeResult.status, isTimeout: summarizeResult.isTimeout };
      case "media_too_large":
        // (new) retry once with media stripped before giving up.
        if (!mediaStripped) { mediaStripped = true; attempts--; continue; }
        return { ok: false, reason: "media_unstrippable", attempts, totalGroups };
      case "prompt_too_long": break;
    }
    if (summarizeResult.viaCreditsBoundary) viaCreditsBoundary = true;
    groupTokenSizes ??= groups.map(g => countTokens(g));
    let nextStep = computeNextDropStep(summarizeResult.tokenGap, groupTokenSizes, preserveCount); // was ZKp
    stepInfo = { ...nextStep, tokenGap: summarizeResult.tokenGap };
    groupsToPreserve += nextStep.step;
  }
  return { ok: false, reason: "exhausted", attempts, totalGroups };
}

// ----------------------------------------------------------------------------
// 4. Legacy full-conversation compactor — deobfuscated.js:401420-401700ish
//    Still used for SUBAGENT auto-compact (called from the in-process runner,
//    deobfuscated.js:593471) — the main conversation loop no longer calls it
//    directly for manual /compact, but subagents do. Confirms the old PTL
//    retry cap of 3, dropping the oldest ~20% of messages per retry.
// ----------------------------------------------------------------------------
var LEGACY_PTL_RETRY_CAP = 3;                 // was Y6a, deobfuscated.js:402394
var LEGACY_PTL_DROP_FRACTION = 0.2;           // inferred from Math.floor(r.length*0.2), deobfuscated.js:401346

async function runLegacyFullCompaction(messages, ctx, contextBundle, customInstructions, boundaryUuid, isAuto = false /* ...more params */) { // was K9n
  // ... (full body at deobfuscated.js:401420-401700; omitted here — see
  // README for the still-accurate high-level pipeline description: hooks ->
  // build prompt -> stream API call w/ PTL retry loop -> restore files/memory
  // /todos -> lifecycle hooks -> assemble boundary marker.)
}

// ----------------------------------------------------------------------------
// 5. Auto-compact thresholds + circuit breakers — deobfuscated.js:619860-620530
// ----------------------------------------------------------------------------
var AUTO_COMPACT_RESERVE_TOKENS = 13000;      // was ZWl, deobfuscated.js:619918 — UNCHANGED since 2.1.34
var BLOCKING_RESERVE_TOKENS = 3000;           // was e5l, deobfuscated.js:619919 — UNCHANGED since 2.1.34

function computeAutoCompactThreshold(effectiveWindow, overrideOpts) { // was $ar, deobfuscated.js:619878-619884
  let reserved = effectiveWindow - AUTO_COMPACT_RESERVE_TOKENS;
  let pctOverride = overrideOpts.testPctOverride;
  if (pctOverride !== undefined && !isNaN(pctOverride) && pctOverride > 0 && pctOverride <= 100) {
    return Math.min(Math.floor(effectiveWindow * (pctOverride / 100)), reserved);
  }
  return reserved;
}

// computePrecomputeTriggerThreshold — was C3o, deobfuscated.js:619886-619888
// NEW vs 2.1.34: layers a per-model/surface `precomputeBufferFraction` on top
// of the classic -13000 mark so background precomputation can kick in earlier.
function computePrecomputeTriggerThreshold(effectiveWindow, overrideOpts) {
  return Math.min(
    effectiveWindow - Math.round(effectiveWindow * overrideOpts.precomputeBufferFraction),
    computeAutoCompactThreshold(effectiveWindow, overrideOpts)
  );
}

// classifyContextLevel — was r5l, deobfuscated.js:619889-619916
// Returns "blocked" | "compact" | "warn" | "ok". blocked = contextWindow-3000,
// warn = effectiveWindow-20000, compact(auto) = precompute/auto threshold.
function classifyContextLevel(usedTokens, effectiveWindow, overrideOpts, rawContextWindow = effectiveWindow) {
  let autoThreshold = computeAutoCompactThreshold(effectiveWindow, overrideOpts);
  let thresholdSource = overrideOpts.enabled ? autoThreshold : effectiveWindow;
  let warnThreshold = thresholdSource - 20000;
  let blockOverride = overrideOpts.testBlockingOverride;
  let blockThreshold = (blockOverride !== undefined && !isNaN(blockOverride) && blockOverride > 0) ? blockOverride : rawContextWindow - 3000;
  let pctLeft = Math.max(0, Math.round((thresholdSource - usedTokens) / thresholdSource * 100));
  if (usedTokens >= blockThreshold) return { level: "blocked", pctLeft };
  if (overrideOpts.enabled && usedTokens >= autoThreshold) return { level: "compact", pctLeft };
  if (usedTokens >= warnThreshold) return { level: "warn", pctLeft };
  return { level: "ok" };
}

// recordAutoCompactFailure — was u5l, deobfuscated.js:620266-620288
// NEW: session-scoped circuit breaker distinct from any per-call retry cap.
var AUTO_COMPACT_CIRCUIT_BREAKER_THRESHOLD = 3; // was d5l, deobfuscated.js:620526
function recordAutoCompactFailure(state, isReactivePath, thresholdSource) {
  let consecutiveFailures = (state?.consecutiveFailures ?? 0) + 1;
  if (consecutiveFailures >= AUTO_COMPACT_CIRCUIT_BREAKER_THRESHOLD) {
    log(`autocompact: circuit breaker tripped after ${consecutiveFailures} consecutive failures${isReactivePath ? " (reactive path)" : ""} — skipping future attempts this session`, { level: "warn" });
    reportEvent("tengu_auto_compact_circuit_breaker", { consecutiveFailures, routedThroughReactive: isReactivePath, thresholdSource: normalizeEnum(thresholdSource) });
  }
  return { kind: "failed", consecutiveFailures, routedThroughReactive: isReactivePath, thresholdSource };
}

// checkRapidRefillThrash — was rar/UVf, deobfuscated.js:620238-620260
// NEW: a *separate* detector from the circuit breaker above — fires a
// user-facing warning (not a silent skip) when context keeps refilling to
// the limit right after each compact.
var THRASH_TRIP_COUNT = 3;                    // was c5l, deobfuscated.js:620261
var THRASH_MESSAGE =                          // was EGo, deobfuscated.js:620262
  "Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row. " +
  "A file being read or a tool output is likely too large for the context window. Try reading in smaller chunks, or use /clear to start fresh.";

function countConsecutiveRapidRefills(turnState) { // was UVf
  if (turnState?.compacted === true && turnState.turnCounter < 3) {
    return (turnState?.consecutiveRapidRefills ?? 0) + 1;
  }
  return 0;
}
function checkRapidRefillThrash(turnState) {        // was rar
  let count = countConsecutiveRapidRefills(turnState);
  return { action: count >= THRASH_TRIP_COUNT ? "trip" : "proceed", consecutiveRapidRefills: count };
}

// Incidental find: current default context-window table entry for the
// generally-available flagship model. deobfuscated.js:620223-620236
var MODEL_CONTEXT_WINDOW_TABLE = {            // was o5l
  "claude-sonnet-5": {
    surfaces: { remote_cowork: { default: 500000 }, "local-agent": { default: 500000 } },
    default: 967000
  }
};

// ----------------------------------------------------------------------------
// 6. Summarization prompts — deobfuscated.js:400760-401106
//    9 sections UNCHANGED since 2.1.34. Tool-refusal language hardened. New:
//    explicit security-instruction-preservation clause in all 3 variants.
// ----------------------------------------------------------------------------

// buildRecentOnlyPrompt — was DKp (assigned inside iwo E(()=>{...}))
// Used for "summarize only the recent portion" (partial-compact / rewind).
var buildRecentOnlyPromptText; // = `Your task is to create a detailed summary of the RECENT portion...`
// Sections: 1 Primary Request and Intent, 2 Key Technical Concepts,
// 3 Files and Code Sections, 4 Errors and fixes, 5 Problem Solving,
// 6 All user messages, 7 Pending Tasks, 8 Current Work, 9 Optional Next Step.
// NEW clause (also present in the other two prompt variants below):
//   "Note any security-relevant instructions or constraints the user stated
//    (e.g., sensitive files or data to avoid, operations that must not be
//    performed, credential or secret handling rules). These MUST be
//    preserved verbatim in the summary so they continue to apply after
//    compaction."                                    // deobfuscated.js:401044
//   "...Preserve any security-relevant instructions or constraints verbatim
//    so they remain in effect after compaction."      // deobfuscated.js:401054

// buildMainSummaryPrompt — was W9n, deobfuscated.js:400873-400985
// This is the primary prompt used for a full-conversation /compact.
function buildMainSummaryPrompt(customInstructions) {
  let prompt = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

Your task is to create a detailed summary of the conversation so far, ...
` /* full text at deobfuscated.js:400874-400977 — 9 sections + example block,
     plus new trailing note that additional summarization instructions may
     come from included context (e.g. CLAUDE.md), with two illustrative
     examples (deobfuscated.js:400967-400976) */;
  if (customInstructions && customInstructions.trim() !== "") {
    prompt += `\n\nAdditional Instructions:\n${customInstructions}`;
  }
  // Trailing reminder appended AFTER custom instructions — deliberately
  // positioned so injected/custom instructions cannot suppress the
  // no-tool-use rule.
  prompt += TOOL_REFUSAL_REMINDER; // was G6a
  return prompt;
}

// TOOL_REFUSAL_REMINDER — was G6a, deobfuscated.js:401103-401106
var TOOL_REFUSAL_REMINDER =
  "\n\nREMINDER: Do NOT call any tools. Respond with plain text only — an <analysis> block followed by a <summary> block. Tool calls will be rejected and you will fail the task.";

// System prompt for the compaction API call — UNCHANGED, verbatim.
// deobfuscated.js:402099
var COMPACT_SYSTEM_PROMPT = "You are a helpful AI assistant tasked with summarizing conversations.";

// ----------------------------------------------------------------------------
// 7. Compact API call with prompt-cache sharing — deobfuscated.js:401989-402180
//    NEW in 2.1.201: tries to reuse existing conversation prompt cache before
//    falling back to a full fresh call.
// ----------------------------------------------------------------------------
async function callCompactionLLM({ messages, summaryRequest, cacheSafeParams, stripNonEssential = false, onResponseLength }) { // was Z6a
  let cacheSharingEnabled = !stripNonEssential && featureFlag("tengu_compact_cache_prefix", true); // was nt(...)
  if (cacheSharingEnabled) {
    try {
      // Fork the existing conversation's cache and ask only the summary
      // question as a 1-turn continuation — cheaper than resending the
      // whole compaction prompt as fresh input.
      let forkResult = await forkQuery({                 // was dD
        promptMessages: [summaryRequest], cacheSafeParams, maxTurns: 1,
        forkLabel: "compact", skipCacheWrite: true, skipTranscript: true
      });
      // ... on success: reportEvent("tengu_compact_cache_sharing_success", {...})
      // ... on failure: reportEvent("tengu_compact_cache_sharing_fallback", { reason, ... })
    } catch (e) { /* falls through to full call below */ }
  }
  // Full call path: builds messages, resolves model + fallback chain,
  // requires either default model or Fable-5-with-credits consent
  // (deobfuscated.js:402072-402084), then streams via callModel (Gyt) with
  // COMPACT_SYSTEM_PROMPT and tool use disabled unless stripNonEssential.
}

// ----------------------------------------------------------------------------
// 8. PreCompact hook — deobfuscated.js:627034-627070 — UNCHANGED shape
// ----------------------------------------------------------------------------
async function runPreCompactHooks(opts, signal, timeoutMs = DEFAULT_HOOK_TIMEOUT) { // was wZ
  let hookInput = {
    ...baseHookFields(undefined),
    hook_event_name: "PreCompact",
    trigger: opts.trigger,              // "manual" | "auto" — CONFIRMED unchanged
    custom_instructions: opts.customInstructions
  };
  let results = await runHooks({ hookInput, matchQuery: opts.trigger, signal, timeoutMs }); // was S0
  if (results.length === 0) return {};
  let newInstructions = results.filter(r => r.succeeded && !r.blocked && r.output.trim().length > 0).map(r => r.output.trim());
  // ... builds userDisplayMessage summarizing each hook's outcome, and
  // returns { newCustomInstructions, userDisplayMessage, blockedBy? }
  return { newCustomInstructions: newInstructions.length > 0 ? newInstructions.join("\n\n") : undefined /*, ... */ };
}

// ----------------------------------------------------------------------------
// 9. Post-compact context restoration — deobfuscated.js:402207-402300+
//    UNCHANGED: recently-read files, agent memory, todos, "compact" hooks.
//    NEW: plan-file reference + recently-invoked-skill restoration.
// ----------------------------------------------------------------------------
async function assemblePostCompactRestoration(readFileState, ctx, extraFiles, callSite) { // was Y9n
  let [recentFiles, recentTools] = await Promise.all([
    restoreRecentlyReadFiles(readFileState, ctx, MAX_RESTORE_FILES, extraFiles), // was WKp
    /* KKp-equivalent tool-restoration helper */ Promise.resolve([])
  ]);
  let agentId = ctx.agentId;
  let planReference = restorePlanFileReference(agentId);      // was qKp — NEW, deobfuscated.js:402263-402274
  let agentMemory = await restoreAgentMemoryContext(ctx);      // was zKp/related
  let skillReference = restoreRecentSkillContent(agentId);    // was VKp — NEW, deobfuscated.js:402275-402296
  let toolAttachments = [
    ...describeAvailableTools(ctx.options.tools, ctx.options.mainLoopModel, extraFiles, { callSite }),
    // ...mcp tool attachments
  ];
  ctx.onCompactEvent?.({ type: "compact_progress", event: { type: "hooks_start", hookType: "session_start" } });
  let hookResults = await runLifecycleHooks("compact", { model: ctx.options.mainLoopModel }); // was Tfe
  return {
    attachments: [...recentFiles, ...recentTools, ...(planReference ? [planReference] : []), ...(agentMemory ? [agentMemory] : []), ...(skillReference ? [skillReference] : []), ...toolAttachments],
    hookResults
  };
}

// restorePlanFileReference — was qKp, deobfuscated.js:402263-402274 — NEW
// Restores the active Plan-mode file after compaction (Plan mode postdates
// 2.1.34's analysis window).
function restorePlanFileReference(agentId) {
  let planContent = getActivePlanContent(agentId);   // was mD
  if (!planContent) return null;
  let planPath = getActivePlanPath(agentId);          // was fD
  return wrapAttachment({ type: "plan_file_reference", planFilePath: planPath, planContent });
}

// restoreRecentSkillContent — was VKp, deobfuscated.js:402275-402296 — NEW
// Restores content of recently-invoked Skills, capped by a token budget.
function restoreRecentSkillContent(agentId) {
  let invokedSkills = getInvokedSkills(agentId);      // was lIr
  if (invokedSkills.size === 0) return null;
  let budget = 0;
  let restored = Array.from(invokedSkills.values())
    .sort((a, b) => b.invokedAt - a.invokedAt)
    .map(s => ({ name: s.skillName, path: s.skillPath, content: truncateSkillContent(s.content, MAX_SKILL_CONTENT_CHARS) }))
    .filter(s => {
      let size = estimateTokens(s.content);
      if (budget + size > MAX_RESTORED_SKILL_TOKENS) return false; // was BKp
      budget += size;
      return true;
    });
  if (restored.length === 0) return null;
  return wrapAttachment({ /* ...restored skills payload */ });
}

// ----------------------------------------------------------------------------
// 10. Micro-compact — MOVED OUT of the manual /compact pipeline in 2.1.201.
//     Old: pre-trim invoked at the start of /compact, gated by
//     DISABLE_MICROCOMPACT (env var now GONE — zero hits in source).
//     New: a statsig-gated, reactive "time-based microcompact" triggered by
//     server context_hint rejects (422/424), independent of the user typing
//     /compact. deobfuscated.js:597188-597277, 615914-616029.
// ----------------------------------------------------------------------------
var OLD_TOOL_RESULT_PLACEHOLDER = "[Old tool result content cleared]"; // was cir, deobfuscated.js:597277ish
var MIN_TOKENS_SAVED_TO_APPLY = 20000;        // was u4o, deobfuscated.js:597278

// applyKeepRecentMicroCompact — was F2l, deobfuscated.js:597188-597230ish
// Clears older tool_result content (keeping the most recent `keepRecent`),
// optionally persisting cleared content via a callback before replacing it.
async function applyKeepRecentMicroCompact(messages, agentId, { keepRecent, persist }) {
  let { keepSet, tokensSaved, candidates } = pickToolResultsToClear(messages, keepRecent); // was d4o
  if (tokensSaved < MIN_TOKENS_SAVED_TO_APPLY) return null;
  let clearedIds = new Set(candidates.map(c => c.tool_use_id));
  let persistedRefs = new Map();
  for (let c of candidates) {
    let ref = c.content ? await persist?.(c.content, c.tool_use_id) : null;
    persistedRefs.set(c.tool_use_id, ref ?? OLD_TOOL_RESULT_PLACEHOLDER);
  }
  let newMessages = replaceToolResultContent(messages, clearedIds, persistedRefs); // was fZt
  reportEvent("tengu_time_based_microcompact", { toolsCleared: clearedIds.size, toolsKept: keepSet.size, keepRecent, tokensSaved, trigger: normalizeEnum("context_hint") });
  return { messages: newMessages, tokensSaved, clearedIds, clearedContent: persistedRefs };
}

// persistToFileReference — was iVf, deobfuscated.js:615983-615991
// Reference text format UNCHANGED in spirit from 2.1.34's micro-compact,
// just re-homed to this new reactive system.
async function persistToFileReference(content, toolUseId) {
  let saved = await persistToolResultToFile(content, toolUseId); // was JPe
  if (isPersistFailure(saved)) return null;                       // was ZPe
  return `<persisted-output>Tool result saved to: ${saved.filepath}\n\nUse Read to view</persisted-output>`;
}
