// /insights command — annotated extract
// Source: /tmp/claude-code-npm/webcrack-output/deobfuscated.js (v2.1.201, built 2026-07-03T19:53:38Z,
//   git 5bb45156ece6b12214696c88adec695b2dca1338), lines 772760-775096 (module `_Hc`, ~2337 lines)
// Compared against prior deep-dive of v2.1.34. Renamed identifiers to readable names; original
// mangled names + line numbers kept as `// deobfuscated.js:NNNNN` refs. `/* uncertain */` = inferred,
// not directly read. READ-ONLY extract, no source edits made.
//
// Module boundary: `var _Hc = {}` (deobfuscated.js:772760) ... ends just before
// `var NJo = {}` (workflow-commands module) at deobfuscated.js:775099.
// Exports (deobfuscated.js:772761-772770): normalizeSessionMeta, generateUsageReport,
//   extractToolStats, detectMultiClauding, deduplicateSessionBranches, buildInsightsResponsePrompt,
//   buildExportData, aggregateData, default (the command definition).

// ---------------------------------------------------------------------------
// Paths (deobfuscated.js:772772-772781)
// ---------------------------------------------------------------------------
function usageDataDir() {          // von(), :772777
  return path.join(configDir(), "usage-data"); // configDir() = rr(), same helper used elsewhere for ~/.claude
}
function facetsDir() {             // ohr(), :772779 -- ~/.claude/usage-data/facets
  return path.join(usageDataDir(), "facets");
}
function sessionMetaDir() {        // MJo(), :772780 -- ~/.claude/usage-data/session-meta
  return path.join(usageDataDir(), "session-meta");
}
// CONFIRMED unchanged from 2.1.34: facets cache dir, session-meta cache dir, report dir all under
// ~/.claude/usage-data/. Cache files written with `mode: 384` (=0o600) at :773170, :773208, :774710, :774714.

// ---------------------------------------------------------------------------
// Model selection — THE HEADLINE FINDING
// ---------------------------------------------------------------------------
// deobfuscated.js:773228-773236 (general opus resolver, model-tier-agnostic; NOT insights-specific)
function X_() {
  if (process.env.ANTHROPIC_DEFAULT_OPUS_MODEL) {
    return normalizeModelId(process.env.ANTHROPIC_DEFAULT_OPUS_MODEL); // ZI(...)
  }
  return resolveOpusModel(); // W0e()
}
function resolveOpusModel(providerMap = getModelIdsForProvider()) { // W0e, :773231; Wd() = getModelIdsForProvider
  return lookupByTier("opus", providerMap) ?? providerMap.opus48; // dIn("opus", e) ?? e.opus48
}
// providerMap.opus48 resolves (deobfuscated.js:119948, 119571-119579) to the literal string
// "claude-opus-4-8" across first_party/bedrock/vertex/foundry/anthropic_aws providers.
//
// deobfuscated.js:772763-772766 — insights' own thin wrappers, BOTH delegate straight to X_():
function uHc() { return X_(); }   // used by chunk-summarize + facet-extract calls
function Pvm() { return X_(); }   // used by the 7 narrative + at_a_glance calls
//
// ==> ALL THREE LLM call types in /insights (chunk-summarize, facet-extract, narrative) resolve to
//     the SAME model: Claude Opus 4.8 ("claude-opus-4-8"), overridable via ANTHROPIC_DEFAULT_OPUS_MODEL.
//     This is UNCHANGED in kind from 2.1.34 (still Opus, still same env override name), but the
//     concrete default model has moved from claude-opus-4-6 -> claude-opus-4-8.
//
// NOTE: the binary also ships a distinct "fable" tier resolver (Kit()/YVr(), :773216-773224,
// env ANTHROPIC_DEFAULT_FABLE_MODEL, providerMap.fable5 = "claude-fable-5") used elsewhere in the
// CLI (e.g. auto mode / background classifier candidates, :952472). /insights does NOT use it —
// it explicitly calls the opus-tier resolver, not the fable-tier one. Confirms Opus, not Fable 5,
// still powers the deep per-session facet extraction and narrative writing.

// ---------------------------------------------------------------------------
// Chunk-summarize call (long-session pre-summarization before facet extraction)
// ---------------------------------------------------------------------------
// deobfuscated.js:773100-773120 (Gvm)
async function summarizeChunk(chunkText) {
  try {
    const res = await runQuery({
      systemPrompt: emptySystemPrompt(),       // Sc([])
      userPrompt: CHUNK_SUMMARY_PROMPT + chunkText, // jvm, :773157-165 in prompt block below
      options: {
        model: uHc(),                          // -> claude-opus-4-8
        querySource: "insights",
        isNonInteractiveSession: true,
        maxOutputTokensOverride: 500,           // CONFIRMED unchanged: 500
        agentContext: getAgentContext()         // Ef()
      }
    });
    return extractText(res.message.content) || chunkText.slice(0, 2000);
  } catch { return chunkText.slice(0, 2000); }
}
// Chunking threshold (deobfuscated.js:773125-773135, Wvm): CONFIRMED unchanged
//   transcript text > 30000 chars -> split into 25000-char chunks, summarized in parallel, then joined.

// ---------------------------------------------------------------------------
// Facet extraction call (per-session)
// ---------------------------------------------------------------------------
// deobfuscated.js:774509-774544 (Yvm)
async function extractFacets(sessionLog, sessionId) {
  try {
    const transcript = await buildTranscriptForExtraction(sessionLog); // Wvm(e) — chunks+summarizes if long
    const prompt = FACET_SYSTEM_PREAMBLE + transcript + FACET_JSON_SCHEMA_BLOCK; // Ovm + ... , :774523-774536
    const res = await runQuery({
      systemPrompt: emptySystemPrompt(),
      userPrompt: prompt,
      options: {
        model: uHc(),                          // -> claude-opus-4-8
        querySource: "insights",
        isNonInteractiveSession: true,
        maxOutputTokensOverride: 4096,          // CONFIRMED unchanged: 4096
        agentContext: getAgentContext()
      }
    });
    const parsed = JSON.parse(extractText(res.message.content).match(/\{[\s\S]*\}/)[0]);
    if (!validateFacetShape(parsed)) return null;  // yHc(a), :774767-774774
    return { ...parsed, session_id: sessionId };
  } catch (e) { logError(`Facet extraction failed: ${e.message}`); return null; }
}

// FACET JSON SCHEMA (deobfuscated.js:774528-774537) — CONFIRMED, byte-identical field set to 2.1.34:
//   underlying_goal (string), goal_categories (object of counts), outcome (enum),
//   user_satisfaction_counts (object of counts), claude_helpfulness (enum), session_type (enum),
//   friction_counts (object of counts), friction_detail (string), primary_success (enum),
//   brief_summary (string).
// validateFacetShape() (:774767-774774) only type-checks underlying_goal, outcome, brief_summary
// (strings) + goal_categories/user_satisfaction_counts/friction_counts (objects). Loose validation,
// unchanged.
//
// ODDITY (new observation, not in 2.1.34 notes): Jvm's narrative-prompt builder (:774516-774519)
// reads `_.user_instructions_to_claude || []` off each cached facet object to build a
// "USER INSTRUCTIONS TO CLAUDE" block — but `user_instructions_to_claude` is NOT part of the facet
// JSON schema above and is never set anywhere in Yvm/validateFacetShape. This field is always
// undefined in practice, so that prompt section always renders "None captured". Looks like a
// vestigial/half-wired field (either removed from the extraction prompt without removing the
// consumer, or a field planned but not yet shipped).

// ---------------------------------------------------------------------------
// Facet-extraction session cap ("MAX_EXTRACT")
// ---------------------------------------------------------------------------
// deobfuscated.js:774504-774650 (gHc, generateUsageReport) — more nuanced than a flat "50/run" cap:
//   o = 50   -- batch size for reading session-meta cache across all discovered sessions
//   s = 200  -- cap on how many *uncached* sessions get their raw transcript loaded/parsed at all
//              (split ~evenly between "genuinely new" and "meta changed" buckets, :774524-774537)
//   b = 50   -- CONFIRMED: hard cap on sessions that get a *new LLM facet-extraction call* this run
//              (_.length < b, :774631-774637); sessions beyond this stay unanalyzed until a later run
//   H = 50   -- batch size for running those <=50 facet extractions in parallel chunks (:774648)
// So: up to 200 sessions may get transcript-level processing/session-meta caching per run, but only
// up to 50 of those get a fresh Opus facet-extraction call per run. Sessions with an already-cached
// facet are unaffected by either cap. This refines (not contradicts) the old "50 sessions/run" claim.

// ---------------------------------------------------------------------------
// Multi-clauding detection — 30-min sliding window, A→B→A interleave
// ---------------------------------------------------------------------------
// deobfuscated.js:773270-773320 (fHc, detectMultiClauding) — CONFIRMED unchanged in algorithm shape:
function detectMultiClauding(sessions) {
  // Flattens all user_message_timestamps across sessions, sorts by time, then slides a window
  // dropping events older than 1800000 ms (30 min, :773288 `c.ts - n[s].ts > 1800000`).
  // For each new event from session C, checks whether another session's event previously appeared
  // inside the still-open window since C's own last event index in the window map -- i.e. detects
  // the A -> B -> A (or A -> B) interleave pattern within the 30-min window, and returns:
  return { overlap_events, sessions_involved, user_messages_during };
}

// ---------------------------------------------------------------------------
// Narrative calls — 7 sections + at_a_glance synthesis
// ---------------------------------------------------------------------------
// deobfuscated.js:774924-775050 (Xvm array) — CONFIRMED 7 entries, names unchanged in spirit from
// the anchors given (project_areas / friction_analysis / on_the_horizon / fun_ending), full current
// list (in order, each maxTokens: 8192 == CONFIRMED narrative max unchanged):
//   1. project_areas        — 4-5 project areas, session_count + description
//   2. interaction_style     — 2-3 paragraph narrative on HOW the user works with Claude Code
//   3. what_works             — 3 "impressive workflows"
//   4. friction_analysis      — 3 friction categories x 2 examples
//   5. suggestions            — claude_md_additions / features_to_try / usage_patterns
//                               (features_to_try picks from an inlined "CC FEATURES REFERENCE" —
//                               MCP Servers, Custom Skills, Hooks, Headless Mode, Task Agents)
//   6. on_the_horizon         — 3 ambitious/future-workflow opportunities
//   [ ...[] spread, :775017 — an empty array spliced into the list; dead/no-op today, but shape
//     suggests a conditionally-included 8th narrative section existed or is planned and is
//     currently gated off / feature-flagged to empty]
//   7. fun_ending             — one memorable/human moment from the transcripts
// at_a_glance (deobfuscated.js:773565-773618, Jvm) is a SEPARATE 8th call, run AFTER the 7 above
// complete, synthesizing their outputs (project_areas, what_works, friction_analysis, suggestions,
// on_the_horizon are all interpolated into its prompt) into a 4-part
// whats_working / whats_hindering / quick_wins / ambitious_workflows structure. maxTokens: 8192.
// All 8 calls go through cHc() (deobfuscated.js:773467-773509), model: Pvm() -> claude-opus-4-8.

// ---------------------------------------------------------------------------
// Aggregation (mHc / aggregateData, :773330-773463)
// ---------------------------------------------------------------------------
// Walks normalized per-session metadata + the facets map, accumulating: totals (messages, duration,
// tokens, commits/pushes, interruptions, tool errors + tool_error_categories, lines added/removed,
// files modified), tool_counts, languages, projects, and (from facets) goal_categories/outcomes/
// satisfaction/helpfulness/session_types/friction/success. Computes median/avg response time,
// days_active, messages_per_day, message_hours histogram, and calls detectMultiClauding(). Caps
// session_summaries at 50 entries (:773447 `n.session_summaries.length < 50`). CONFIRMED unchanged.

// ---------------------------------------------------------------------------
// Warmup filtering
// ---------------------------------------------------------------------------
// deobfuscated.js:774683-774686 — a session is "warmup_minimal" and filtered out of both the
// narrative-eligible set (I) and the facets map used for aggregation (x) iff its goal_categories
// has exactly one nonzero key and that key is "warmup_minimal". CONFIRMED unchanged.

// ---------------------------------------------------------------------------
// HTML report + Team Feedback
// ---------------------------------------------------------------------------
// Template function rTm (deobfuscated.js:773732-~774400, ~670 lines) builds the full report.
// Written to BOTH a timestamped file and the stable path (deobfuscated.js:774662-774673):
//   ~/.claude/usage-data/report-YYYY-MM-DD-HHmmss.html   AND
//   ~/.claude/usage-data/report.html                     (both mode 384 = 0o600)
// CONFIRMED unchanged: "Team Feedback" section (:773893-773932) is hardcoded dead —
//   `let y = []; let _ = [];` (productFeedback / modelFeedback) with no populating code anywhere in
//   the module, so `y.length > 0 || _.length > 0` is always false and the whole
//   <h2 id="section-feedback">Closing the Loop: Feedback for Other Teams</h2> block never renders.
// Template covers (by id, in order): at-a-glance, section-work (project_areas), section-usage
// (interaction_style), section-wins (what_works), section-friction (friction_analysis),
// section-features/suggestions, section-horizon (on_the_horizon), section-feedback (dead), fun_ending.
// Export data (oTm/buildExportData, :774422-774463) embeds VERSION "2.1.201", BUILD_TIME
// "2026-07-03T19:53:38Z", GIT_SHA "5bb45156ece6b12214696c88adec695b2dca1338" plus username, facets_summary.

// ---------------------------------------------------------------------------
// Remote-host collection — present but currently dead
// ---------------------------------------------------------------------------
// The top-level command handler (aTm.getPromptForCommand, :774916 area) hardcodes
// `let t = false;` and calls `gHc({ collectRemote: t })` (deobfuscated.js:775063). Inside gHc,
// the `collectRemote` property of its argument is NEVER read (grep confirms the only occurrence
// of the string "collectRemote" in the whole file is that one call-site), and gHc's `let t;` (its
// own local, unrelated to the caller's `t`) is declared but never assigned, so `remoteStats` is
// always `undefined`. buildExportData's `remote_hosts_collected` metadata field (:774448-774450,
// `s = r?.hosts...`) can therefore never populate today. Vestigial/disabled remote-hosts feature.

// ---------------------------------------------------------------------------
// Tool-error taxonomy (deobfuscated.js:772918-772935) — CONFIRMED, string-matched on lowercased
// tool_result content:
//   "exit code" -> Command Failed | "rejected"/"doesn't want" -> User Rejected |
//   "string to replace not found"/"no changes" -> Edit Failed | "modified since read" -> File Changed |
//   "exceeds maximum"/"too large" -> File Too Large | "file not found"/"does not exist" -> File Not Found |
//   (default) -> Other

// ---------------------------------------------------------------------------
// Crash-guard style code (defensive coding consistent with 2.1.113/2.1.149 fixes)
// ---------------------------------------------------------------------------
// Hon(e) (:772769-772773 area) coerces any non-string tool-input field (file_path/command/etc) to ""
// instead of throwing. Number.isFinite(u) guards on parsed timestamps in detectMultiClauding
// (:773274). Bvm(e) (:772962) requires both created/modified Dates to be non-NaN before a session
// is treated as usable. These match the "guard against malformed timestamps / tool inputs" shape
// described for prior crash fixes; could not pin exact version each guard first landed in.

// ---------------------------------------------------------------------------
// Taxonomy display-name map ($vm, deobfuscated.js:774856-774921) — single flat lookup table,
// CONFIRMED (compare against 2.1.34 list; no removals found, no additions found either):
//   goal categories: debug_investigate, implement_feature, fix_bug, write_script_tool,
//     refactor_code, configure_system, create_pr_commit, analyze_data, understand_codebase,
//     write_tests, write_docs, deploy_infra, warmup_minimal
//   primary_success: fast_accurate_search, correct_code_edits, good_explanations, proactive_help,
//     multi_file_changes (alias handled_complexity -> same label), good_debugging
//   friction: misunderstood_request, wrong_approach, buggy_code, user_rejected_action,
//     claude_got_blocked, user_stopped_early, wrong_file_or_location, excessive_changes,
//     slow_or_verbose, tool_failed, user_unclear, external_issue
//   satisfaction: frustrated, dissatisfied, likely_satisfied, satisfied, happy, unsure (+neutral, delighted
//     present in map but not in Qvm's 6-value ordering below)
//   session_type: single_task, multi_task, iterative_refinement, exploration, quick_question
//   outcome: fully_achieved, mostly_achieved, partially_achieved, not_achieved, unclear_from_transcript
//   claude_helpfulness: unhelpful, slightly_helpful, moderately_helpful, very_helpful, essential
// Ordered value lists for charts: Qvm (satisfaction, :775051) = [frustrated, dissatisfied,
//   likely_satisfied, satisfied, happy, unsure]; Zvm (outcome, :775052) = [not_achieved,
//   partially_achieved, mostly_achieved, fully_achieved, unclear_from_transcript].

// ---------------------------------------------------------------------------
// Language map (Mvm, deobfuscated.js:774825-774845) — CONFIRMED, extensions: .ts/.tsx->TypeScript,
// .js/.jsx->JavaScript, .py->Python, .rb->Ruby, .go->Go, .rs->Rust, .java->Java, .c/.h->C,
// .cpp/.cc/.cxx/.hpp/.hh/.hxx/.ipp->C++, .md->Markdown, .json->JSON, .yaml/.yml->YAML, .sh->Shell,
// .css->CSS, .html->HTML.
