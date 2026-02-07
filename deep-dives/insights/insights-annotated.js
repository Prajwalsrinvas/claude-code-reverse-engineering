// ============================================================================
// Claude Code /insights command — cleaned & renamed for readability
// Original: lines 627488-629715 of deobfuscated cli.js v2.1.34
// Identifiers renamed from minified names to descriptive names
// ============================================================================

// --- EXTERNAL DEPENDENCIES (defined elsewhere in cli.js) ---
//
// getOpusModel() → Model selector. Returns opus46 model ID ("claude-opus-4-6" for firstParty).
//   Checks ANTHROPIC_DEFAULT_OPUS_MODEL env var first, then resolves via provider.
//   Both getFacetModel() and getNarrativeModel() are thin wrappers that just call getOpusModel().
//   So all 3 LLM calls in insights use the same model: opus 4.6
//   (Line 167358 in deobfuscated.js)
//
// callLLM({ systemPrompt, userPrompt, signal, options }) → Core API call helper.
//   Sends a single-turn LLM request. Returns { message: { content: [...] } }.
//   Used 3 times in insights: summarization (summarizeChunk), facet extraction (extractFacets),
//   and narrative section generation (generateNarrativeSection).
//
// loadAllSessions(projectPath, { skipIndex }) → Session loader.
//   When skipIndex=true, loads all sessions from disk without indexing.
//   Returns array of session log objects with .messages, .sessionId, .fullPath,
//   .created, .modified, .projectPath, .firstPrompt, .summary, etc.
//   (Line 645661 in deobfuscated.js)
//
// getSessionId(session) → Gets session ID. Returns session.sessionId or session.messages[0]?.sessionId
//   (Line 645420 in deobfuscated.js)
//
// getClaudeConfigDir() → Returns Claude config dir: process.env.CLAUDE_CONFIG_DIR ?? ~/.claude
//   (Line 4106 in deobfuscated.js)
//
// getFs() → Returns the fs module (node:fs)
// writeFileSync() → fs.writeFileSync equivalent
// jsonParse() → JSON.parse
// jsonStringify() → JSON.stringify
// logError() → Error logger
// debug()  → Debug logger
//
// --- END EXTERNAL DEPENDENCIES ---

import { join, extname, basename } from "path";
function getFacetModel() {
  return getOpusModel();
}
function getNarrativeModel() {
  return getOpusModel();
}
function getLanguageFromPath(A) {
  let q = extname(A).toLowerCase();
  return EXTENSION_TO_LANGUAGE[q] || null;
}
function extractSessionMetrics(session) {
  let toolCnts = {};
  let langs = {};
  let gitCommits = 0;
  let gitPushes = 0;
  let inTokens = 0;
  let outputTokens = 0;
  let userInterruptions = 0;
  let respTimes = [];
  let toolErrors = 0;
  let errorCategories = {};
  let usesTaskAgent = false;
  let linesAdded = 0;
  let linesRemoved = 0;
  let modifiedFiles = new Set();
  let msgHours = [];
  let userMsgTimestamps = [];
  let usesMcp = false;
  let usesWebSearch = false;
  let usesWebFetch = false;
  let lastAssistantTs = null;
  for (let msg of session.messages) {
    let ts = msg.timestamp;
    if (msg.type === "assistant" && msg.message) {
      if (ts) {
        lastAssistantTs = ts;
      }
      let msgData = msg.message.usage;
      if (msgData) {
        inTokens += msgData.input_tokens || 0;
        outputTokens += msgData.output_tokens || 0;
      }
      let msgContent = msg.message.content;
      if (Array.isArray(msgContent)) {
        for (let block of msgContent) {
          if (block.type === "tool_use" && "name" in block) {
            let toolName = block.name;
            toolCnts[toolName] = (toolCnts[toolName] || 0) + 1;
            if (toolName === "Task") {
              usesTaskAgent = true;
            }
            if (toolName.startsWith("mcp__")) {
              usesMcp = true;
            }
            if (toolName === "WebSearch") {
              usesWebSearch = true;
            }
            if (toolName === "WebFetch") {
              usesWebFetch = true;
            }
            let toolInput = block.input;
            if (toolInput) {
              let U = toolInput.file_path || "";
              if (U) {
                let B = getLanguageFromPath(U);
                if (B) {
                  langs[B] = (langs[B] || 0) + 1;
                }
                if (toolName === "Edit" || toolName === "Write") {
                  modifiedFiles.add(U);
                }
              }
              if (toolName === "Edit") {
                let B = toolInput.old_string || "";
                let p = toolInput.new_string || "";
                let r = B
                  ? B.split(`
`).length
                  : 0;
                let c = p
                  ? p.split(`
`).length
                  : 0;
                linesRemoved += r;
                linesAdded += c;
              }
              if (toolName === "Write") {
                let B = toolInput.content || "";
                if (B) {
                  linesAdded += B.split(`
`).length;
                }
              }
              let g = toolInput.command || "";
              if (g.includes("git commit")) {
                gitCommits++;
              }
              if (g.includes("git push")) {
                gitPushes++;
              }
            }
          }
        }
      }
    }
    if (msg.type === "user" && msg.message) {
      let msgData = msg.message.content;
      let msgContent = false;
      if (typeof msgData === "string" && msgData.trim()) {
        msgContent = true;
      } else if (Array.isArray(msgData)) {
        for (let block of msgData) {
          if (block.type === "text" && "text" in block) {
            msgContent = true;
            break;
          }
        }
      }
      if (msgContent) {
        if (ts) {
          try {
            let hour = new Date(ts).getHours();
            msgHours.push(hour);
            userMsgTimestamps.push(ts);
          } catch {}
        }
        if (lastAssistantTs && ts) {
          let assistantTime = new Date(lastAssistantTs).getTime();
          let responseTimeSec = (new Date(ts).getTime() - assistantTime) / 1000;
          if (responseTimeSec > 2 && responseTimeSec < 3600) {
            respTimes.push(responseTimeSec);
          }
        }
      }
      if (Array.isArray(msgData)) {
        for (let block of msgData) {
          if (block.type === "tool_result" && "content" in block) {
            if (block.is_error) {
              toolErrors++;
              let toolInput = block.content;
              let U = "Other";
              if (typeof toolInput === "string") {
                let g = toolInput.toLowerCase();
                if (g.includes("exit code")) {
                  U = "Command Failed";
                } else if (
                  g.includes("rejected") ||
                  g.includes("doesn't want")
                ) {
                  U = "User Rejected";
                } else if (
                  g.includes("string to replace not found") ||
                  g.includes("no changes")
                ) {
                  U = "Edit Failed";
                } else if (g.includes("modified since read")) {
                  U = "File Changed";
                } else if (
                  g.includes("exceeds maximum") ||
                  g.includes("too large")
                ) {
                  U = "File Too Large";
                } else if (
                  g.includes("file not found") ||
                  g.includes("does not exist")
                ) {
                  U = "File Not Found";
                }
              }
              errorCategories[U] = (errorCategories[U] || 0) + 1;
            }
          }
        }
      }
      if (typeof msgData === "string") {
        if (msgData.includes("[Request interrupted by user")) {
          userInterruptions++;
        }
      } else if (Array.isArray(msgData)) {
        for (let block of msgData) {
          if (
            block.type === "text" &&
            "text" in block &&
            block.text.includes("[Request interrupted by user")
          ) {
            userInterruptions++;
            break;
          }
        }
      }
    }
  }
  return {
    toolCounts: toolCnts,
    languages: langs,
    gitCommits: gitCommits,
    gitPushes: gitPushes,
    inputTokens: inTokens,
    outputTokens: outputTokens,
    userInterruptions: userInterruptions,
    userResponseTimes: respTimes,
    toolErrors: toolErrors,
    toolErrorCategories: errorCategories,
    usesTaskAgent: usesTaskAgent,
    usesMcp: usesMcp,
    usesWebSearch: usesWebSearch,
    usesWebFetch: usesWebFetch,
    linesAdded: linesAdded,
    linesRemoved: linesRemoved,
    filesModified: modifiedFiles,
    messageHours: msgHours,
    userMessageTimestamps: userMsgTimestamps,
  };
}
function hasValidTimestamps(session) {
  return (
    !Number.isNaN(session.created.getTime()) && !Number.isNaN(session.modified.getTime())
  );
}
function buildSessionMeta(session) {
  let metrics = extractSessionMetrics(session);
  let sessionId = getSessionId(session) || "unknown";
  let startTime = session.created.toISOString();
  let durationMin = Math.round((session.modified.getTime() - session.created.getTime()) / 1000 / 60);
  let userMsgCount = 0;
  let assistantMsgCount = 0;
  for (let $ of session.messages) {
    if ($.type === "assistant") {
      assistantMsgCount++;
    }
    if ($.type === "user" && $.message) {
      let contentArr = $.message.content;
      let _ = false;
      if (typeof contentArr === "string" && contentArr.trim()) {
        _ = true;
      } else if (Array.isArray(contentArr)) {
        for (let textBlock of contentArr) {
          if (textBlock.type === "text" && "text" in textBlock) {
            _ = true;
            break;
          }
        }
      }
      if (_) {
        userMsgCount++;
      }
    }
  }
  return {
    session_id: sessionId,
    project_path: session.projectPath || "",
    start_time: startTime,
    duration_minutes: durationMin,
    user_message_count: userMsgCount,
    assistant_message_count: assistantMsgCount,
    tool_counts: metrics.toolCounts,
    languages: metrics.languages,
    git_commits: metrics.gitCommits,
    git_pushes: metrics.gitPushes,
    input_tokens: metrics.inputTokens,
    output_tokens: metrics.outputTokens,
    first_prompt: session.firstPrompt || "",
    summary: session.summary,
    user_interruptions: metrics.userInterruptions,
    user_response_times: metrics.userResponseTimes,
    tool_errors: metrics.toolErrors,
    tool_error_categories: metrics.toolErrorCategories,
    uses_task_agent: metrics.usesTaskAgent,
    uses_mcp: metrics.usesMcp,
    uses_web_search: metrics.usesWebSearch,
    uses_web_fetch: metrics.usesWebFetch,
    lines_added: metrics.linesAdded,
    lines_removed: metrics.linesRemoved,
    files_modified: metrics.filesModified.size,
    message_hours: metrics.messageHours,
    user_message_timestamps: metrics.userMessageTimestamps,
  };
}
function deduplicateSessions(sessions) {
  let bestById = new Map();
  for (let entry of sessions) {
    let sid = entry.meta.session_id;
    let existing = bestById.get(sid);
    if (
      !existing ||
      entry.meta.user_message_count > existing.meta.user_message_count ||
      (entry.meta.user_message_count === existing.meta.user_message_count &&
        entry.meta.duration_minutes > existing.meta.duration_minutes)
    ) {
      bestById.set(sid, entry);
    }
  }
  return [...bestById.values()];
}
function formatTranscript(session) {
  let lines = [];
  let meta = buildSessionMeta(session);
  lines.push(`Session: ${meta.session_id.slice(0, 8)}`);
  lines.push(`Date: ${meta.start_time}`);
  lines.push(`Project: ${meta.project_path}`);
  lines.push(`Duration: ${meta.duration_minutes} min`);
  lines.push("");
  for (let msg of session.messages) {
    if (msg.type === "user" && msg.message) {
      let content = msg.message.content;
      if (typeof content === "string") {
        lines.push(`[User]: ${content.slice(0, 500)}`);
      } else if (Array.isArray(content)) {
        for (let textBlock of content) {
          if (textBlock.type === "text" && "text" in textBlock) {
            lines.push(`[User]: ${textBlock.text.slice(0, 500)}`);
          }
        }
      }
    } else if (msg.type === "assistant" && msg.message) {
      let content = msg.message.content;
      if (Array.isArray(content)) {
        for (let textBlock of content) {
          if (textBlock.type === "text" && "text" in textBlock) {
            lines.push(`[Assistant]: ${textBlock.text.slice(0, 300)}`);
          } else if (textBlock.type === "tool_use" && "name" in textBlock) {
            lines.push(`[Tool: ${textBlock.name}]`);
          }
        }
      }
    }
  }
  return lines.join(`
`);
}
async function summarizeChunk(text) {
  try {
    return (
      (
        await callLLM({
          systemPrompt: [],
          userPrompt: CHUNK_SUMMARIZATION_PROMPT + text,
          signal: new AbortController().signal,
          options: {
            model: getFacetModel(),
            querySource: "insights",
            agents: [],
            isNonInteractiveSession: true,
            hasAppendSystemPrompt: false,
            mcpTools: [],
            maxOutputTokensOverride: 500,
          },
        })
      ).message.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("") || text.slice(0, 2000)
    );
  } catch {
    return text.slice(0, 2000);
  }
}
async function prepareSessionTranscript(session) {
  let fullText = formatTranscript(session);
  if (fullText.length <= 30000) {
    return fullText;
  }
  let CHUNK_SIZE = 25000;
  let chunks = [];
  for (let $ = 0; $ < fullText.length; $ += CHUNK_SIZE) {
    chunks.push(fullText.slice($, $ + CHUNK_SIZE));
  }
  let summaries = await Promise.all(chunks.map(summarizeChunk));
  let meta = buildSessionMeta(session);
  return (
    [
      `Session: ${meta.session_id.slice(0, 8)}`,
      `Date: ${meta.start_time}`,
      `Project: ${meta.project_path}`,
      `Duration: ${meta.duration_minutes} min`,
      `[Long session - ${chunks.length} parts summarized]`,
      "",
    ].join(`
`) +
    summaries.join(`

---

`)
  );
}
function readCachedFacets(sessionId) {
  let fs = getFs();
  let filePath = join(FACETS_DIR, `${sessionId}.json`);
  try {
    let raw = fs.readFileSync(filePath, {
      encoding: "utf-8",
    });
    return jsonParse(raw);
  } catch {
    return null;
  }
}
function writeFacetCache(facets) {
  try {
    getFs().mkdirSync(FACETS_DIR);
  } catch {}
  let filePath = join(FACETS_DIR, `${facets.session_id}.json`);
  writeFileSync(filePath, jsonStringify(facets, null, 2), {
    encoding: "utf-8",
    flush: true,
    mode: 384,
  });
}
async function extractFacets(session, sessionId) {
  try {
    let transcript = await prepareSessionTranscript(session);
    let prompt = `${FACET_EXTRACTION_PROMPT}${transcript}

RESPOND WITH ONLY A VALID JSON OBJECT matching this schema:
{
  "underlying_goal": "What the user fundamentally wanted to achieve",
  "goal_categories": {"category_name": count, ...},
  "outcome": "fully_achieved|mostly_achieved|partially_achieved|not_achieved|unclear_from_transcript",
  "user_satisfaction_counts": {"level": count, ...},
  "claude_helpfulness": "unhelpful|slightly_helpful|moderately_helpful|very_helpful|essential",
  "session_type": "single_task|multi_task|iterative_refinement|exploration|quick_question",
  "friction_counts": {"friction_type": count, ...},
  "friction_detail": "One sentence describing friction or empty",
  "primary_success": "none|fast_accurate_search|correct_code_edits|good_explanations|proactive_help|multi_file_changes|good_debugging",
  "brief_summary": "One sentence: what user wanted and whether they got it"
}`;
    let jsonMatch = (
      await callLLM({
        systemPrompt: [],
        userPrompt: prompt,
        signal: new AbortController().signal,
        options: {
          model: getFacetModel(),
          querySource: "insights",
          agents: [],
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          mcpTools: [],
          maxOutputTokensOverride: 4096,
        },
      })
    ).message.content
      .filter((textPart) => textPart.type === "text")
      .map((textPart) => textPart.text)
      .join("")
      .match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }
    let facets = jsonParse(jsonMatch[0]);
    facets.session_id = sessionId;
    return facets;
  } catch (err) {
    logError(err instanceof Error ? err : Error("Facet extraction failed"));
    return null;
  }
}
function aggregateStats(sessionMetas, facetsMap) {
  let stats = {
    total_sessions: sessionMetas.length,
    sessions_with_facets: facetsMap.size,
    date_range: {
      start: "",
      end: "",
    },
    total_messages: 0,
    total_duration_hours: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    tool_counts: {},
    languages: {},
    git_commits: 0,
    git_pushes: 0,
    projects: {},
    goal_categories: {},
    outcomes: {},
    satisfaction: {},
    helpfulness: {},
    session_types: {},
    friction: {},
    success: {},
    session_summaries: [],
    total_interruptions: 0,
    total_tool_errors: 0,
    tool_error_categories: {},
    user_response_times: [],
    median_response_time: 0,
    avg_response_time: 0,
    sessions_using_task_agent: 0,
    sessions_using_mcp: 0,
    sessions_using_web_search: 0,
    sessions_using_web_fetch: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    total_files_modified: 0,
    days_active: 0,
    messages_per_day: 0,
    message_hours: [],
    multi_clauding: {
      overlap_events: 0,
      sessions_involved: 0,
      user_messages_during: 0,
    },
  };
  let timestamps = [];
  let allRespTimes = [];
  let allHours = [];
  for (let meta of sessionMetas) {
    timestamps.push(meta.start_time);
    stats.total_messages += meta.user_message_count;
    stats.total_duration_hours += meta.duration_minutes / 60;
    stats.total_input_tokens += meta.input_tokens;
    stats.total_output_tokens += meta.output_tokens;
    stats.git_commits += meta.git_commits;
    stats.git_pushes += meta.git_pushes;
    stats.total_interruptions += meta.user_interruptions;
    stats.total_tool_errors += meta.tool_errors;
    for (let [key, val] of Object.entries(meta.tool_error_categories)) {
      stats.tool_error_categories[key] = (stats.tool_error_categories[key] || 0) + val;
    }
    allRespTimes.push(...meta.user_response_times);
    if (meta.uses_task_agent) {
      stats.sessions_using_task_agent++;
    }
    if (meta.uses_mcp) {
      stats.sessions_using_mcp++;
    }
    if (meta.uses_web_search) {
      stats.sessions_using_web_search++;
    }
    if (meta.uses_web_fetch) {
      stats.sessions_using_web_fetch++;
    }
    stats.total_lines_added += meta.lines_added;
    stats.total_lines_removed += meta.lines_removed;
    stats.total_files_modified += meta.files_modified;
    allHours.push(...meta.message_hours);
    for (let [key, val] of Object.entries(meta.tool_counts)) {
      stats.tool_counts[key] = (stats.tool_counts[key] || 0) + val;
    }
    for (let [key, val] of Object.entries(meta.languages)) {
      stats.languages[key] = (stats.languages[key] || 0) + val;
    }
    if (meta.project_path) {
      stats.projects[meta.project_path] = (stats.projects[meta.project_path] || 0) + 1;
    }
    let facet = facetsMap.get(meta.session_id);
    if (facet) {
      for (let [key, val] of Object.entries(facet.goal_categories)) {
        if (val > 0) {
          stats.goal_categories[key] = (stats.goal_categories[key] || 0) + val;
        }
      }
      stats.outcomes[facet.outcome] = (stats.outcomes[facet.outcome] || 0) + 1;
      for (let [key, val] of Object.entries(facet.user_satisfaction_counts)) {
        if (val > 0) {
          stats.satisfaction[key] = (stats.satisfaction[key] || 0) + val;
        }
      }
      stats.helpfulness[facet.claude_helpfulness] =
        (stats.helpfulness[facet.claude_helpfulness] || 0) + 1;
      stats.session_types[facet.session_type] =
        (stats.session_types[facet.session_type] || 0) + 1;
      for (let [key, val] of Object.entries(facet.friction_counts)) {
        if (val > 0) {
          stats.friction[key] = (stats.friction[key] || 0) + val;
        }
      }
      if (facet.primary_success !== "none") {
        stats.success[facet.primary_success] = (stats.success[facet.primary_success] || 0) + 1;
      }
    }
    if (stats.session_summaries.length < 50) {
      stats.session_summaries.push({
        id: meta.session_id.slice(0, 8),
        date: meta.start_time.split("T")[0] || "",
        summary: meta.summary || meta.first_prompt.slice(0, 100),
        goal: facet?.underlying_goal,
      });
    }
  }
  timestamps.sort();
  stats.date_range.start = timestamps[0]?.split("T")[0] || "";
  stats.date_range.end = timestamps[timestamps.length - 1]?.split("T")[0] || "";
  stats.user_response_times = allRespTimes;
  if (allRespTimes.length > 0) {
    let sorted = [...allRespTimes].sort((a, b) => a - b);
    stats.median_response_time = sorted[Math.floor(sorted.length / 2)] || 0;
    stats.avg_response_time = allRespTimes.reduce((a, b) => a + b, 0) / allRespTimes.length;
  }
  let daysSet = new Set(timestamps.map((ts) => ts.split("T")[0]));
  stats.days_active = daysSet.size;
  stats.messages_per_day =
    stats.days_active > 0
      ? Math.round((stats.total_messages / stats.days_active) * 10) / 10
      : 0;
  stats.message_hours = allHours;
  let OVERLAP_WINDOW_MINUTES = 30;
  let allMsgs = [];
  for (let entry of sessionMetas) {
    for (let timestamp of entry.user_message_timestamps) {
      try {
        let epochMs = new Date(timestamp).getTime();
        allMsgs.push({
          ts: epochMs,
          sessionId: entry.session_id,
        });
      } catch {}
    }
  }
  allMsgs.sort((a, b) => a.ts - b.ts);
  let overlapPairs = new Set();
  let msgsInOverlap = new Set();
  for (let i = 0; i < allMsgs.length; i++) {
    let msgA = allMsgs[i];
    if (!msgA) {
      continue;
    }
    for (let j = i + 1; j < allMsgs.length; j++) {
      let msgB = allMsgs[j];
      if (!msgB) {
        continue;
      }
      if ((msgB.ts - msgA.ts) / 60000 > OVERLAP_WINDOW_MINUTES) {
        break;
      }
      if (msgB.sessionId !== msgA.sessionId) {
        for (let k = j + 1; k < allMsgs.length; k++) {
          let msgC = allMsgs[k];
          if (!msgC) {
            continue;
          }
          if ((msgC.ts - msgA.ts) / 60000 > OVERLAP_WINDOW_MINUTES) {
            break;
          }
          if (msgC.sessionId === msgA.sessionId) {
            let pairKey = [msgA.sessionId, msgB.sessionId].sort().join(":");
            overlapPairs.add(pairKey);
            msgsInOverlap.add(`${msgA.ts}:${msgA.sessionId}`);
            msgsInOverlap.add(`${msgB.ts}:${msgB.sessionId}`);
            msgsInOverlap.add(`${msgC.ts}:${msgC.sessionId}`);
            break;
          }
        }
      }
    }
  }
  let sessionsInOverlap = new Set();
  for (let pair of overlapPairs) {
    let [sid1, sid2] = pair.split(":");
    if (sid1) {
      sessionsInOverlap.add(sid1);
    }
    if (sid2) {
      sessionsInOverlap.add(sid2);
    }
  }
  stats.multi_clauding = {
    overlap_events: overlapPairs.size,
    sessions_involved: sessionsInOverlap.size,
    user_messages_during: msgsInOverlap.size,
  };
  return stats;
}
async function generateNarrativeSection(sectionDef, data) {
  try {
    let respText = (
      await callLLM({
        systemPrompt: [],
        userPrompt: `${sectionDef.prompt}

DATA:
${data}`,
        signal: new AbortController().signal,
        options: {
          model: getNarrativeModel(),
          querySource: "insights",
          agents: [],
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          mcpTools: [],
          maxOutputTokensOverride: sectionDef.maxTokens,
        },
      })
    ).message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (respText) {
      let jsonMatch = respText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return {
            name: sectionDef.name,
            result: jsonParse(jsonMatch[0]),
          };
        } catch {
          return {
            name: sectionDef.name,
            result: null,
          };
        }
      }
    }
    return {
      name: sectionDef.name,
      result: null,
    };
  } catch (err) {
    logError(err instanceof Error ? err : Error(`${sectionDef.name} failed`));
    return {
      name: sectionDef.name,
      result: null,
    };
  }
}
async function generateAllNarratives(stats, facetsMap) {
  let summariesTxt = Array.from(facetsMap.values())
    .slice(0, 50)
    .map((f) => `- ${f.brief_summary} (${f.outcome}, ${f.claude_helpfulness})`)
    .join(`
`);
  let frictionTxt = Array.from(facetsMap.values())
    .filter((f) => f.friction_detail)
    .slice(0, 20)
    .map((f) => `- ${f.friction_detail}`).join(`
`);
  let instructionsTxt = Array.from(facetsMap.values())
    .flatMap((f) => f.user_instructions_to_claude || [])
    .slice(0, 15)
    .map((item) => `- ${item}`).join(`
`);
  let dataPayload = `${jsonStringify(
    {
      sessions: stats.total_sessions,
      analyzed: stats.sessions_with_facets,
      date_range: stats.date_range,
      messages: stats.total_messages,
      hours: Math.round(stats.total_duration_hours),
      commits: stats.git_commits,
      top_tools: Object.entries(stats.tool_counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8),
      top_goals: Object.entries(stats.goal_categories)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8),
      outcomes: stats.outcomes,
      satisfaction: stats.satisfaction,
      friction: stats.friction,
      success: stats.success,
      languages: stats.languages,
    },
    null,
    2,
  )}

SESSION SUMMARIES:
${summariesTxt}

FRICTION DETAILS:
${frictionTxt}

USER INSTRUCTIONS TO CLAUDE:
${instructionsTxt || "None captured"}`;
  let sectionResults = await Promise.all(NARRATIVE_SECTION_DEFS.map((def) => generateNarrativeSection(def, dataPayload)));
  let narratives = {};
  for (let { name, result } of sectionResults) {
    if (result) {
      narratives[name] = result;
    }
  }
  let areasText =
    narratives.project_areas?.areas?.map((a) => `- ${a.name}: ${a.description}`).join(`
`) || "";
  let worksText =
    narratives.what_works?.impressive_workflows?.map(
      (w) => `- ${w.title}: ${w.description}`,
    ).join(`
`) || "";
  let frictionCatText =
    narratives.friction_analysis?.categories?.map(
      (c) => `- ${c.category}: ${c.description}`,
    ).join(`
`) || "";
  let featuresTxt =
    narratives.suggestions?.features_to_try?.map((f) => `- ${f.feature}: ${f.one_liner}`)
      .join(`
`) || "";
  let patternsTxt =
    narratives.suggestions?.usage_patterns?.map((p) => `- ${p.title}: ${p.suggestion}`)
      .join(`
`) || "";
  let horizonTxt =
    narratives.on_the_horizon?.opportunities?.map(
      (o) => `- ${o.title}: ${o.whats_possible}`,
    ).join(`
`) || "";
  let atGlanceDef = {
    name: "at_a_glance",
    prompt: `You're writing an "At a Glance" summary for a Claude Code usage insights report for Claude Code users. The goal is to help them understand their usage and improve how they can use Claude better, especially as models improve.

Use this 4-part structure:

1. **What's working** - What is the user's unique style of interacting with Claude and what are some impactful things they've done? You can include one or two details, but keep it high level since things might not be fresh in the user's memory. Don't be fluffy or overly complimentary. Also, don't focus on the tool calls they use.

2. **What's hindering you** - Split into (a) Claude's fault (misunderstandings, wrong approaches, bugs) and (b) user-side friction (not providing enough context, environment issues -- ideally more general than just one project). Be honest but constructive.

3. **Quick wins to try** - Specific Claude Code features they could try from the examples below, or a workflow technique if you think it's really compelling. (Avoid stuff like "Ask Claude to confirm before taking actions" or "Type out more context up front" which are less compelling.)

4. **Ambitious workflows for better models** - As we move to much more capable models over the next 3-6 months, what should they prepare for? What workflows that seem impossible now will become possible? Draw from the appropriate section below.

Keep each section to 2-3 not-too-long sentences. Don't overwhelm the user. Don't mention specific numerical stats or underlined_categories from the session data below. Use a coaching tone.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "whats_working": "(refer to instructions above)",
  "whats_hindering": "(refer to instructions above)",
  "quick_wins": "(refer to instructions above)",
  "ambitious_workflows": "(refer to instructions above)"
}

SESSION DATA:
${dataPayload}

## Project Areas (what user works on)
${areasText}

## Big Wins (impressive accomplishments)
${worksText}

## Friction Categories (where things go wrong)
${frictionCatText}

## Features to Try
${featuresTxt}

## Usage Patterns to Adopt
${patternsTxt}

## On the Horizon (ambitious workflows for better models)
${horizonTxt}`,
    maxTokens: 8192,
  };
  let atGlanceResult = await generateNarrativeSection(atGlanceDef, "");
  if (atGlanceResult.result) {
    narratives.at_a_glance = atGlanceResult.result;
  }
  return narratives;
}
function escapeHtml(A) {
  return A.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeHtmlWithBold(A) {
  return escapeHtml(A).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
function renderBarChart(data, color, maxBars = 6, orderedKeys) {
  let entries;
  if (orderedKeys) {
    entries = orderedKeys.filter((key) => key in data && (data[key] ?? 0) > 0).map((key) => [key, data[key] ?? 0]);
  } else {
    entries = Object.entries(data)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxBars);
  }
  if (entries.length === 0) {
    return '<p class="empty">No data</p>';
  }
  let maxVal = Math.max(...entries.map((e) => e[1]));
  return entries.map(([key, count]) => {
    let pct = (count / maxVal) * 100;
    let label =
      LABEL_DISPLAY_NAMES[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return `<div class="bar-row">
        <div class="bar-label">${escapeHtml(label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="bar-value">${count}</div>
      </div>`;
  }).join(`
`);
}
function renderResponseTimeChart(times) {
  if (times.length === 0) {
    return '<p class="empty">No response time data</p>';
  }
  let buckets = {
    "2-10s": 0,
    "10-30s": 0,
    "30s-1m": 0,
    "1-2m": 0,
    "2-5m": 0,
    "5-15m": 0,
    ">15m": 0,
  };
  for (let sec of times) {
    if (sec < 10) {
      buckets["2-10s"] = (buckets["2-10s"] ?? 0) + 1;
    } else if (sec < 30) {
      buckets["10-30s"] = (buckets["10-30s"] ?? 0) + 1;
    } else if (sec < 60) {
      buckets["30s-1m"] = (buckets["30s-1m"] ?? 0) + 1;
    } else if (sec < 120) {
      buckets["1-2m"] = (buckets["1-2m"] ?? 0) + 1;
    } else if (sec < 300) {
      buckets["2-5m"] = (buckets["2-5m"] ?? 0) + 1;
    } else if (sec < 900) {
      buckets["5-15m"] = (buckets["5-15m"] ?? 0) + 1;
    } else {
      buckets[">15m"] = (buckets[">15m"] ?? 0) + 1;
    }
  }
  let maxCount = Math.max(...Object.values(buckets));
  if (maxCount === 0) {
    return '<p class="empty">No response time data</p>';
  }
  return Object.entries(buckets).map(([sec, count]) => {
    let pct = (count / maxCount) * 100;
    return `<div class="bar-row">
        <div class="bar-label">${sec}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:#6366f1"></div></div>
        <div class="bar-value">${count}</div>
      </div>`;
  }).join(`
`);
}
function renderTimeOfDayChart(hours) {
  if (hours.length === 0) {
    return '<p class="empty">No time data</p>';
  }
  let periods = [
    {
      label: "Morning (6-12)",
      range: [6, 7, 8, 9, 10, 11],
    },
    {
      label: "Afternoon (12-18)",
      range: [12, 13, 14, 15, 16, 17],
    },
    {
      label: "Evening (18-24)",
      range: [18, 19, 20, 21, 22, 23],
    },
    {
      label: "Night (0-6)",
      range: [0, 1, 2, 3, 4, 5],
    },
  ];
  let hourCounts = {};
  for (let hour of hours) {
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  }
  let periodCounts = periods.map((period) => ({
    label: period.label,
    count: period.range.reduce((sum, h) => sum + (hourCounts[h] || 0), 0),
  }));
  let maxCount = Math.max(...periodCounts.map((hour) => hour.count)) || 1;
  return `<div id="hour-histogram">${periodCounts.map(
    (hour) => `
      <div class="bar-row">
        <div class="bar-label">${hour.label}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(hour.count / maxCount) * 100}%;background:#8b5cf6"></div></div>
        <div class="bar-value">${hour.count}</div>
      </div>`,
  ).join(`
`)}</div>`;
}
function serializeHourCounts(hours) {
  let counts = {};
  for (let hour of hours) {
    counts[hour] = (counts[hour] || 0) + 1;
  }
  return jsonStringify(counts);
}
function generateHtmlReport(stats, narratives) {
  let K = (S) => {
    if (!S) {
      return "";
    }
    return S.split(
      `

`,
    ).map((m) => {
      let x = escapeHtml(m);
      x = x.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      x = x.replace(/^- /gm, "• ");
      x = x.replace(/\n/g, "<br>");
      return `<p>${x}</p>`;
    }).join(`
`);
  };
  let Y = narratives.at_a_glance;
  let z = Y
    ? `
    <div class="at-a-glance">
      <div class="glance-title">At a Glance</div>
      <div class="glance-sections">
        ${Y.whats_working ? `<div class="glance-section"><strong>What's working:</strong> ${escapeHtmlWithBold(Y.whats_working)} <a href="#section-wins" class="see-more">Impressive Things You Did →</a></div>` : ""}
        ${Y.whats_hindering ? `<div class="glance-section"><strong>What's hindering you:</strong> ${escapeHtmlWithBold(Y.whats_hindering)} <a href="#section-friction" class="see-more">Where Things Go Wrong →</a></div>` : ""}
        ${Y.quick_wins ? `<div class="glance-section"><strong>Quick wins to try:</strong> ${escapeHtmlWithBold(Y.quick_wins)} <a href="#section-features" class="see-more">Features to Try →</a></div>` : ""}
        ${Y.ambitious_workflows ? `<div class="glance-section"><strong>Ambitious workflows:</strong> ${escapeHtmlWithBold(Y.ambitious_workflows)} <a href="#section-horizon" class="see-more">On the Horizon →</a></div>` : ""}
      </div>
    </div>
    `
    : "";
  let w = narratives.project_areas?.areas || [];
  let H =
    w.length > 0
      ? `
    <h2 id="section-work">What You Work On</h2>
    <div class="project-areas">
      ${w
        .map(
          (S) => `
        <div class="project-area">
          <div class="area-header">
            <span class="area-name">${escapeHtml(S.name)}</span>
            <span class="area-count">~${S.session_count} sessions</span>
          </div>
          <div class="area-desc">${escapeHtml(S.description)}</div>
        </div>
      `,
        )
        .join("")}
    </div>
    `
      : "";
  let $ = narratives.interaction_style;
  let O = $?.narrative
    ? `
    <h2 id="section-usage">How You Use Claude Code</h2>
    <div class="narrative">
      ${K($.narrative)}
      ${$.key_pattern ? `<div class="key-insight"><strong>Key pattern:</strong> ${escapeHtml($.key_pattern)}</div>` : ""}
    </div>
    `
    : "";
  let _ = narratives.what_works;
  let J =
    _?.impressive_workflows && _.impressive_workflows.length > 0
      ? `
    <h2 id="section-wins">Impressive Things You Did</h2>
    ${_.intro ? `<p class="section-intro">${escapeHtml(_.intro)}</p>` : ""}
    <div class="big-wins">
      ${_.impressive_workflows
        .map(
          (S) => `
        <div class="big-win">
          <div class="big-win-title">${escapeHtml(S.title || "")}</div>
          <div class="big-win-desc">${escapeHtml(S.description || "")}</div>
        </div>
      `,
        )
        .join("")}
    </div>
    `
      : "";
  let X = narratives.friction_analysis;
  let D =
    X?.categories && X.categories.length > 0
      ? `
    <h2 id="section-friction">Where Things Go Wrong</h2>
    ${X.intro ? `<p class="section-intro">${escapeHtml(X.intro)}</p>` : ""}
    <div class="friction-categories">
      ${X.categories
        .map(
          (S) => `
        <div class="friction-category">
          <div class="friction-title">${escapeHtml(S.category || "")}</div>
          <div class="friction-desc">${escapeHtml(S.description || "")}</div>
          ${S.examples ? `<ul class="friction-examples">${S.examples.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>` : ""}
        </div>
      `,
        )
        .join("")}
    </div>
    `
      : "";
  let M = narratives.suggestions;
  let j = M
    ? `
    ${
      M.claude_md_additions && M.claude_md_additions.length > 0
        ? `
    <h2 id="section-features">Existing CC Features to Try</h2>
    <div class="claude-md-section">
      <h3>Suggested CLAUDE.md Additions</h3>
      <p style="font-size: 12px; color: #64748b; margin-bottom: 12px;">Just copy this into Claude Code to add it to your CLAUDE.md.</p>
      <div class="claude-md-actions">
        <button class="copy-all-btn" onclick="copyAllCheckedClaudeMd()">Copy All Checked</button>
      </div>
      ${M.claude_md_additions
        .map(
          (S, m) => `
        <div class="claude-md-item">
          <input type="checkbox" id="cmd-${m}" class="cmd-checkbox" checked data-text="${escapeHtml(S.prompt_scaffold || S.where || "Add to CLAUDE.md")}\\n\\n${escapeHtml(S.addition)}">
          <label for="cmd-${m}">
            <code class="cmd-code">${escapeHtml(S.addition)}</code>
            <button class="copy-btn" onclick="copyCmdItem(${m})">Copy</button>
          </label>
          <div class="cmd-why">${escapeHtml(S.why)}</div>
        </div>
      `,
        )
        .join("")}
    </div>
    `
        : ""
    }
    ${
      M.features_to_try && M.features_to_try.length > 0
        ? `
    <p style="font-size: 13px; color: #64748b; margin-bottom: 12px;">Just copy this into Claude Code and it'll set it up for you.</p>
    <div class="features-section">
      ${M.features_to_try
        .map(
          (S) => `
        <div class="feature-card">
          <div class="feature-title">${escapeHtml(S.feature || "")}</div>
          <div class="feature-oneliner">${escapeHtml(S.one_liner || "")}</div>
          <div class="feature-why"><strong>Why for you:</strong> ${escapeHtml(S.why_for_you || "")}</div>
          ${
            S.example_code
              ? `
          <div class="feature-examples">
            <div class="feature-example">
              <div class="example-code-row">
                <code class="example-code">${escapeHtml(S.example_code)}</code>
                <button class="copy-btn" onclick="copyText(this)">Copy</button>
              </div>
            </div>
          </div>
          `
              : ""
          }
        </div>
      `,
        )
        .join("")}
    </div>
    `
        : ""
    }
    ${
      M.usage_patterns && M.usage_patterns.length > 0
        ? `
    <h2 id="section-patterns">New Ways to Use Claude Code</h2>
    <p style="font-size: 13px; color: #64748b; margin-bottom: 12px;">Just copy this into Claude Code and it'll walk you through it.</p>
    <div class="patterns-section">
      ${M.usage_patterns
        .map(
          (S) => `
        <div class="pattern-card">
          <div class="pattern-title">${escapeHtml(S.title || "")}</div>
          <div class="pattern-summary">${escapeHtml(S.suggestion || "")}</div>
          ${S.detail ? `<div class="pattern-detail">${escapeHtml(S.detail)}</div>` : ""}
          ${
            S.copyable_prompt
              ? `
          <div class="copyable-prompt-section">
            <div class="prompt-label">Paste into Claude Code:</div>
            <div class="copyable-prompt-row">
              <code class="copyable-prompt">${escapeHtml(S.copyable_prompt)}</code>
              <button class="copy-btn" onclick="copyText(this)">Copy</button>
            </div>
          </div>
          `
              : ""
          }
        </div>
      `,
        )
        .join("")}
    </div>
    `
        : ""
    }
    `
    : "";
  let W = narratives.on_the_horizon;
  let G =
    W?.opportunities && W.opportunities.length > 0
      ? `
    <h2 id="section-horizon">On the Horizon</h2>
    ${W.intro ? `<p class="section-intro">${escapeHtml(W.intro)}</p>` : ""}
    <div class="horizon-section">
      ${W.opportunities
        .map(
          (S) => `
        <div class="horizon-card">
          <div class="horizon-title">${escapeHtml(S.title || "")}</div>
          <div class="horizon-possible">${escapeHtml(S.whats_possible || "")}</div>
          ${S.how_to_try ? `<div class="horizon-tip"><strong>Getting started:</strong> ${escapeHtml(S.how_to_try)}</div>` : ""}
          ${S.copyable_prompt ? `<div class="pattern-prompt"><div class="prompt-label">Paste into Claude Code:</div><code>${escapeHtml(S.copyable_prompt)}</code><button class="copy-btn" onclick="copyText(this)">Copy</button></div>` : ""}
        </div>
      `,
        )
        .join("")}
    </div>
    `
      : "";
  let P = [];
  let V = [];
  let Z =
    P.length > 0 || V.length > 0
      ? `
    <h2 id="section-feedback" class="feedback-header">Closing the Loop: Feedback for Other Teams</h2>
    <p class="feedback-intro">Suggestions for the CC product and model teams based on your usage patterns. Click to expand.</p>
    ${
      P.length > 0
        ? `
    <div class="collapsible-section">
      <div class="collapsible-header" onclick="toggleCollapsible(this)">
        <span class="collapsible-arrow">▶</span>
        <h3>Product Improvements for CC Team</h3>
      </div>
      <div class="collapsible-content">
        <div class="suggestions-section">
          ${P.map(
            (S) => `
            <div class="feedback-card team-card">
              <div class="feedback-title">${escapeHtml(S.title || "")}</div>
              <div class="feedback-detail">${escapeHtml(S.detail || "")}</div>
              ${S.evidence ? `<div class="feedback-evidence"><em>Evidence:</em> ${escapeHtml(S.evidence)}</div>` : ""}
            </div>
          `,
          ).join("")}
        </div>
      </div>
    </div>
    `
        : ""
    }
    ${
      V.length > 0
        ? `
    <div class="collapsible-section">
      <div class="collapsible-header" onclick="toggleCollapsible(this)">
        <span class="collapsible-arrow">▶</span>
        <h3>Model Behavior Improvements</h3>
      </div>
      <div class="collapsible-content">
        <div class="suggestions-section">
          ${V.map(
            (S) => `
            <div class="feedback-card model-card">
              <div class="feedback-title">${escapeHtml(S.title || "")}</div>
              <div class="feedback-detail">${escapeHtml(S.detail || "")}</div>
              ${S.evidence ? `<div class="feedback-evidence"><em>Evidence:</em> ${escapeHtml(S.evidence)}</div>` : ""}
            </div>
          `,
          ).join("")}
        </div>
      </div>
    </div>
    `
        : ""
    }
    `
      : "";
  let N = narratives.fun_ending;
  let T = N?.headline
    ? `
    <div class="fun-ending">
      <div class="fun-headline">"${escapeHtml(N.headline)}"</div>
      ${N.detail ? `<div class="fun-detail">${escapeHtml(N.detail)}</div>` : ""}
    </div>
    `
    : "";
  let k = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #f8fafc; color: #334155; line-height: 1.65; padding: 48px 24px; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 32px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
    h2 { font-size: 20px; font-weight: 600; color: #0f172a; margin-top: 48px; margin-bottom: 16px; }
    .subtitle { color: #64748b; font-size: 15px; margin-bottom: 32px; }
    .nav-toc { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0 32px 0; padding: 16px; background: white; border-radius: 8px; border: 1px solid #e2e8f0; }
    .nav-toc a { font-size: 12px; color: #64748b; text-decoration: none; padding: 6px 12px; border-radius: 6px; background: #f1f5f9; transition: all 0.15s; }
    .nav-toc a:hover { background: #e2e8f0; color: #334155; }
    .stats-row { display: flex; gap: 24px; margin-bottom: 40px; padding: 20px 0; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; }
    .stat { text-align: center; }
    .stat-value { font-size: 24px; font-weight: 700; color: #0f172a; }
    .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; }
    .at-a-glance { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 1px solid #f59e0b; border-radius: 12px; padding: 20px 24px; margin-bottom: 32px; }
    .glance-title { font-size: 16px; font-weight: 700; color: #92400e; margin-bottom: 16px; }
    .glance-sections { display: flex; flex-direction: column; gap: 12px; }
    .glance-section { font-size: 14px; color: #78350f; line-height: 1.6; }
    .glance-section strong { color: #92400e; }
    .see-more { color: #b45309; text-decoration: none; font-size: 13px; white-space: nowrap; }
    .see-more:hover { text-decoration: underline; }
    .project-areas { display: flex; flex-direction: column; gap: 12px; margin-bottom: 32px; }
    .project-area { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .area-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .area-name { font-weight: 600; font-size: 15px; color: #0f172a; }
    .area-count { font-size: 12px; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 4px; }
    .area-desc { font-size: 14px; color: #475569; line-height: 1.5; }
    .narrative { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
    .narrative p { margin-bottom: 12px; font-size: 14px; color: #475569; line-height: 1.7; }
    .key-insight { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 16px; margin-top: 12px; font-size: 14px; color: #166534; }
    .section-intro { font-size: 14px; color: #64748b; margin-bottom: 16px; }
    .big-wins { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
    .big-win { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; }
    .big-win-title { font-weight: 600; font-size: 15px; color: #166534; margin-bottom: 8px; }
    .big-win-desc { font-size: 14px; color: #15803d; line-height: 1.5; }
    .friction-categories { display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px; }
    .friction-category { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 16px; }
    .friction-title { font-weight: 600; font-size: 15px; color: #991b1b; margin-bottom: 6px; }
    .friction-desc { font-size: 13px; color: #7f1d1d; margin-bottom: 10px; }
    .friction-examples { margin: 0 0 0 20px; font-size: 13px; color: #334155; }
    .friction-examples li { margin-bottom: 4px; }
    .claude-md-section { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
    .claude-md-section h3 { font-size: 14px; font-weight: 600; color: #1e40af; margin: 0 0 12px 0; }
    .claude-md-actions { margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #dbeafe; }
    .copy-all-btn { background: #2563eb; color: white; border: none; border-radius: 4px; padding: 6px 12px; font-size: 12px; cursor: pointer; font-weight: 500; transition: all 0.2s; }
    .copy-all-btn:hover { background: #1d4ed8; }
    .copy-all-btn.copied { background: #16a34a; }
    .claude-md-item { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; padding: 10px 0; border-bottom: 1px solid #dbeafe; }
    .claude-md-item:last-child { border-bottom: none; }
    .cmd-checkbox { margin-top: 2px; }
    .cmd-code { background: white; padding: 8px 12px; border-radius: 4px; font-size: 12px; color: #1e40af; border: 1px solid #bfdbfe; font-family: monospace; display: block; white-space: pre-wrap; word-break: break-word; flex: 1; }
    .cmd-why { font-size: 12px; color: #64748b; width: 100%; padding-left: 24px; margin-top: 4px; }
    .features-section, .patterns-section { display: flex; flex-direction: column; gap: 12px; margin: 16px 0; }
    .feature-card { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px; }
    .pattern-card { background: #f0f9ff; border: 1px solid #7dd3fc; border-radius: 8px; padding: 16px; }
    .feature-title, .pattern-title { font-weight: 600; font-size: 15px; color: #0f172a; margin-bottom: 6px; }
    .feature-oneliner { font-size: 14px; color: #475569; margin-bottom: 8px; }
    .pattern-summary { font-size: 14px; color: #475569; margin-bottom: 8px; }
    .feature-why, .pattern-detail { font-size: 13px; color: #334155; line-height: 1.5; }
    .feature-examples { margin-top: 12px; }
    .feature-example { padding: 8px 0; border-top: 1px solid #d1fae5; }
    .feature-example:first-child { border-top: none; }
    .example-desc { font-size: 13px; color: #334155; margin-bottom: 6px; }
    .example-code-row { display: flex; align-items: flex-start; gap: 8px; }
    .example-code { flex: 1; background: #f1f5f9; padding: 8px 12px; border-radius: 4px; font-family: monospace; font-size: 12px; color: #334155; overflow-x: auto; white-space: pre-wrap; }
    .copyable-prompt-section { margin-top: 12px; padding-top: 12px; border-top: 1px solid #e2e8f0; }
    .copyable-prompt-row { display: flex; align-items: flex-start; gap: 8px; }
    .copyable-prompt { flex: 1; background: #f8fafc; padding: 10px 12px; border-radius: 4px; font-family: monospace; font-size: 12px; color: #334155; border: 1px solid #e2e8f0; white-space: pre-wrap; line-height: 1.5; }
    .feature-code { background: #f8fafc; padding: 12px; border-radius: 6px; margin-top: 12px; border: 1px solid #e2e8f0; display: flex; align-items: flex-start; gap: 8px; }
    .feature-code code { flex: 1; font-family: monospace; font-size: 12px; color: #334155; white-space: pre-wrap; }
    .pattern-prompt { background: #f8fafc; padding: 12px; border-radius: 6px; margin-top: 12px; border: 1px solid #e2e8f0; }
    .pattern-prompt code { font-family: monospace; font-size: 12px; color: #334155; display: block; white-space: pre-wrap; margin-bottom: 8px; }
    .prompt-label { font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; margin-bottom: 6px; }
    .copy-btn { background: #e2e8f0; border: none; border-radius: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; color: #475569; flex-shrink: 0; }
    .copy-btn:hover { background: #cbd5e1; }
    .charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
    .chart-card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .chart-title { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; margin-bottom: 12px; }
    .bar-row { display: flex; align-items: center; margin-bottom: 6px; }
    .bar-label { width: 100px; font-size: 11px; color: #475569; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar-track { flex: 1; height: 6px; background: #f1f5f9; border-radius: 3px; margin: 0 8px; }
    .bar-fill { height: 100%; border-radius: 3px; }
    .bar-value { width: 28px; font-size: 11px; font-weight: 500; color: #64748b; text-align: right; }
    .empty { color: #94a3b8; font-size: 13px; }
    .horizon-section { display: flex; flex-direction: column; gap: 16px; }
    .horizon-card { background: linear-gradient(135deg, #faf5ff 0%, #f5f3ff 100%); border: 1px solid #c4b5fd; border-radius: 8px; padding: 16px; }
    .horizon-title { font-weight: 600; font-size: 15px; color: #5b21b6; margin-bottom: 8px; }
    .horizon-possible { font-size: 14px; color: #334155; margin-bottom: 10px; line-height: 1.5; }
    .horizon-tip { font-size: 13px; color: #6b21a8; background: rgba(255,255,255,0.6); padding: 8px 12px; border-radius: 4px; }
    .feedback-header { margin-top: 48px; color: #64748b; font-size: 16px; }
    .feedback-intro { font-size: 13px; color: #94a3b8; margin-bottom: 16px; }
    .feedback-section { margin-top: 16px; }
    .feedback-section h3 { font-size: 14px; font-weight: 600; color: #475569; margin-bottom: 12px; }
    .feedback-card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .feedback-card.team-card { background: #eff6ff; border-color: #bfdbfe; }
    .feedback-card.model-card { background: #faf5ff; border-color: #e9d5ff; }
    .feedback-title { font-weight: 600; font-size: 14px; color: #0f172a; margin-bottom: 6px; }
    .feedback-detail { font-size: 13px; color: #475569; line-height: 1.5; }
    .feedback-evidence { font-size: 12px; color: #64748b; margin-top: 8px; }
    .fun-ending { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 1px solid #fbbf24; border-radius: 12px; padding: 24px; margin-top: 40px; text-align: center; }
    .fun-headline { font-size: 18px; font-weight: 600; color: #78350f; margin-bottom: 8px; }
    .fun-detail { font-size: 14px; color: #92400e; }
    .collapsible-section { margin-top: 16px; }
    .collapsible-header { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 12px 0; border-bottom: 1px solid #e2e8f0; }
    .collapsible-header h3 { margin: 0; font-size: 14px; font-weight: 600; color: #475569; }
    .collapsible-arrow { font-size: 12px; color: #94a3b8; transition: transform 0.2s; }
    .collapsible-content { display: none; padding-top: 16px; }
    .collapsible-content.open { display: block; }
    .collapsible-header.open .collapsible-arrow { transform: rotate(90deg); }
    @media (max-width: 640px) { .charts-row { grid-template-columns: 1fr; } .stats-row { justify-content: center; } }
  `;
  let u = `
    function toggleCollapsible(header) {
      header.classList.toggle('open');
      const content = header.nextElementSibling;
      content.classList.toggle('open');
    }
    function copyText(btn) {
      const code = btn.previousElementSibling;
      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      });
    }
    function copyCmdItem(idx) {
      const checkbox = document.getElementById('cmd-' + idx);
      if (checkbox) {
        const text = checkbox.dataset.text;
        navigator.clipboard.writeText(text).then(() => {
          const btn = checkbox.nextElementSibling.querySelector('.copy-btn');
          if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 2000); }
        });
      }
    }
    function copyAllCheckedClaudeMd() {
      const checkboxes = document.querySelectorAll('.cmd-checkbox:checked');
      const texts = [];
      checkboxes.forEach(cb => {
        if (cb.dataset.text) { texts.push(cb.dataset.text); }
      });
      const combined = texts.join('\\n');
      const btn = document.querySelector('.copy-all-btn');
      if (btn) {
        navigator.clipboard.writeText(combined).then(() => {
          btn.textContent = 'Copied ' + texts.length + ' items!';
          btn.classList.add('copied');
          setTimeout(() => { btn.textContent = 'Copy All Checked'; btn.classList.remove('copied'); }, 2000);
        });
      }
    }
    // Timezone selector for time of day chart (data is from our own analytics, not user input)
    const rawHourCounts = ${serializeHourCounts(stats.message_hours)};
    function updateHourHistogram(offsetFromPT) {
      const periods = [
        { label: "Morning (6-12)", range: [6,7,8,9,10,11] },
        { label: "Afternoon (12-18)", range: [12,13,14,15,16,17] },
        { label: "Evening (18-24)", range: [18,19,20,21,22,23] },
        { label: "Night (0-6)", range: [0,1,2,3,4,5] }
      ];
      const adjustedCounts = {};
      for (const [hour, count] of Object.entries(rawHourCounts)) {
        const newHour = (parseInt(hour) + offsetFromPT + 24) % 24;
        adjustedCounts[newHour] = (adjustedCounts[newHour] || 0) + count;
      }
      const periodCounts = periods.map(p => ({
        label: p.label,
        count: p.range.reduce((sum, h) => sum + (adjustedCounts[h] || 0), 0)
      }));
      const maxCount = Math.max(...periodCounts.map(p => p.count)) || 1;
      const container = document.getElementById('hour-histogram');
      container.textContent = '';
      periodCounts.forEach(p => {
        const row = document.createElement('div');
        row.className = 'bar-row';
        const label = document.createElement('div');
        label.className = 'bar-label';
        label.textContent = p.label;
        const track = document.createElement('div');
        track.className = 'bar-track';
        const fill = document.createElement('div');
        fill.className = 'bar-fill';
        fill.style.width = (p.count / maxCount) * 100 + '%';
        fill.style.background = '#8b5cf6';
        track.appendChild(fill);
        const value = document.createElement('div');
        value.className = 'bar-value';
        value.textContent = p.count;
        row.appendChild(label);
        row.appendChild(track);
        row.appendChild(value);
        container.appendChild(row);
      });
    }
    document.getElementById('timezone-select').addEventListener('change', function() {
      const customInput = document.getElementById('custom-offset');
      if (this.value === 'custom') {
        customInput.style.display = 'inline-block';
        customInput.focus();
      } else {
        customInput.style.display = 'none';
        updateHourHistogram(parseInt(this.value));
      }
    });
    document.getElementById('custom-offset').addEventListener('change', function() {
      const offset = parseInt(this.value) + 8;
      updateHourHistogram(offset);
    });
  `;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Claude Code Insights</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #f8fafc; color: #334155; line-height: 1.65; padding: 48px 24px; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 32px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
    h2 { font-size: 20px; font-weight: 600; color: #0f172a; margin-top: 48px; margin-bottom: 16px; }
    .subtitle { color: #64748b; font-size: 15px; margin-bottom: 32px; }
    .nav-toc { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0 32px 0; padding: 16px; background: white; border-radius: 8px; border: 1px solid #e2e8f0; }
    .nav-toc a { font-size: 12px; color: #64748b; text-decoration: none; padding: 6px 12px; border-radius: 6px; background: #f1f5f9; transition: all 0.15s; }
    .nav-toc a:hover { background: #e2e8f0; color: #334155; }
    .stats-row { display: flex; gap: 24px; margin-bottom: 40px; padding: 20px 0; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; }
    .stat { text-align: center; }
    .stat-value { font-size: 24px; font-weight: 700; color: #0f172a; }
    .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; }
    .at-a-glance { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 1px solid #f59e0b; border-radius: 12px; padding: 20px 24px; margin-bottom: 32px; }
    .glance-title { font-size: 16px; font-weight: 700; color: #92400e; margin-bottom: 16px; }
    .glance-sections { display: flex; flex-direction: column; gap: 12px; }
    .glance-section { font-size: 14px; color: #78350f; line-height: 1.6; }
    .glance-section strong { color: #92400e; }
    .see-more { color: #b45309; text-decoration: none; font-size: 13px; white-space: nowrap; }
    .see-more:hover { text-decoration: underline; }
    .project-areas { display: flex; flex-direction: column; gap: 12px; margin-bottom: 32px; }
    .project-area { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .area-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .area-name { font-weight: 600; font-size: 15px; color: #0f172a; }
    .area-count { font-size: 12px; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 4px; }
    .area-desc { font-size: 14px; color: #475569; line-height: 1.5; }
    .narrative { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
    .narrative p { margin-bottom: 12px; font-size: 14px; color: #475569; line-height: 1.7; }
    .key-insight { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 16px; margin-top: 12px; font-size: 14px; color: #166534; }
    .section-intro { font-size: 14px; color: #64748b; margin-bottom: 16px; }
    .big-wins { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
    .big-win { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; }
    .big-win-title { font-weight: 600; font-size: 15px; color: #166534; margin-bottom: 8px; }
    .big-win-desc { font-size: 14px; color: #15803d; line-height: 1.5; }
    .friction-categories { display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px; }
    .friction-category { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 16px; }
    .friction-title { font-weight: 600; font-size: 15px; color: #991b1b; margin-bottom: 6px; }
    .friction-desc { font-size: 13px; color: #7f1d1d; margin-bottom: 10px; }
    .friction-examples { margin: 0 0 0 20px; font-size: 13px; color: #334155; }
    .friction-examples li { margin-bottom: 4px; }
    .claude-md-section { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
    .claude-md-section h3 { font-size: 14px; font-weight: 600; color: #1e40af; margin: 0 0 12px 0; }
    .claude-md-actions { margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #dbeafe; }
    .copy-all-btn { background: #2563eb; color: white; border: none; border-radius: 4px; padding: 6px 12px; font-size: 12px; cursor: pointer; font-weight: 500; transition: all 0.2s; }
    .copy-all-btn:hover { background: #1d4ed8; }
    .copy-all-btn.copied { background: #16a34a; }
    .claude-md-item { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; padding: 10px 0; border-bottom: 1px solid #dbeafe; }
    .claude-md-item:last-child { border-bottom: none; }
    .cmd-checkbox { margin-top: 2px; }
    .cmd-code { background: white; padding: 8px 12px; border-radius: 4px; font-size: 12px; color: #1e40af; border: 1px solid #bfdbfe; font-family: monospace; display: block; white-space: pre-wrap; word-break: break-word; flex: 1; }
    .cmd-why { font-size: 12px; color: #64748b; width: 100%; padding-left: 24px; margin-top: 4px; }
    .features-section, .patterns-section { display: flex; flex-direction: column; gap: 12px; margin: 16px 0; }
    .feature-card { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px; }
    .pattern-card { background: #f0f9ff; border: 1px solid #7dd3fc; border-radius: 8px; padding: 16px; }
    .feature-title, .pattern-title { font-weight: 600; font-size: 15px; color: #0f172a; margin-bottom: 6px; }
    .feature-oneliner { font-size: 14px; color: #475569; margin-bottom: 8px; }
    .pattern-summary { font-size: 14px; color: #475569; margin-bottom: 8px; }
    .feature-why, .pattern-detail { font-size: 13px; color: #334155; line-height: 1.5; }
    .feature-examples { margin-top: 12px; }
    .feature-example { padding: 8px 0; border-top: 1px solid #d1fae5; }
    .feature-example:first-child { border-top: none; }
    .example-desc { font-size: 13px; color: #334155; margin-bottom: 6px; }
    .example-code-row { display: flex; align-items: flex-start; gap: 8px; }
    .example-code { flex: 1; background: #f1f5f9; padding: 8px 12px; border-radius: 4px; font-family: monospace; font-size: 12px; color: #334155; overflow-x: auto; white-space: pre-wrap; }
    .copyable-prompt-section { margin-top: 12px; padding-top: 12px; border-top: 1px solid #e2e8f0; }
    .copyable-prompt-row { display: flex; align-items: flex-start; gap: 8px; }
    .copyable-prompt { flex: 1; background: #f8fafc; padding: 10px 12px; border-radius: 4px; font-family: monospace; font-size: 12px; color: #334155; border: 1px solid #e2e8f0; white-space: pre-wrap; line-height: 1.5; }
    .feature-code { background: #f8fafc; padding: 12px; border-radius: 6px; margin-top: 12px; border: 1px solid #e2e8f0; display: flex; align-items: flex-start; gap: 8px; }
    .feature-code code { flex: 1; font-family: monospace; font-size: 12px; color: #334155; white-space: pre-wrap; }
    .pattern-prompt { background: #f8fafc; padding: 12px; border-radius: 6px; margin-top: 12px; border: 1px solid #e2e8f0; }
    .pattern-prompt code { font-family: monospace; font-size: 12px; color: #334155; display: block; white-space: pre-wrap; margin-bottom: 8px; }
    .prompt-label { font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; margin-bottom: 6px; }
    .copy-btn { background: #e2e8f0; border: none; border-radius: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; color: #475569; flex-shrink: 0; }
    .copy-btn:hover { background: #cbd5e1; }
    .charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
    .chart-card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .chart-title { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; margin-bottom: 12px; }
    .bar-row { display: flex; align-items: center; margin-bottom: 6px; }
    .bar-label { width: 100px; font-size: 11px; color: #475569; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar-track { flex: 1; height: 6px; background: #f1f5f9; border-radius: 3px; margin: 0 8px; }
    .bar-fill { height: 100%; border-radius: 3px; }
    .bar-value { width: 28px; font-size: 11px; font-weight: 500; color: #64748b; text-align: right; }
    .empty { color: #94a3b8; font-size: 13px; }
    .horizon-section { display: flex; flex-direction: column; gap: 16px; }
    .horizon-card { background: linear-gradient(135deg, #faf5ff 0%, #f5f3ff 100%); border: 1px solid #c4b5fd; border-radius: 8px; padding: 16px; }
    .horizon-title { font-weight: 600; font-size: 15px; color: #5b21b6; margin-bottom: 8px; }
    .horizon-possible { font-size: 14px; color: #334155; margin-bottom: 10px; line-height: 1.5; }
    .horizon-tip { font-size: 13px; color: #6b21a8; background: rgba(255,255,255,0.6); padding: 8px 12px; border-radius: 4px; }
    .feedback-header { margin-top: 48px; color: #64748b; font-size: 16px; }
    .feedback-intro { font-size: 13px; color: #94a3b8; margin-bottom: 16px; }
    .feedback-section { margin-top: 16px; }
    .feedback-section h3 { font-size: 14px; font-weight: 600; color: #475569; margin-bottom: 12px; }
    .feedback-card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .feedback-card.team-card { background: #eff6ff; border-color: #bfdbfe; }
    .feedback-card.model-card { background: #faf5ff; border-color: #e9d5ff; }
    .feedback-title { font-weight: 600; font-size: 14px; color: #0f172a; margin-bottom: 6px; }
    .feedback-detail { font-size: 13px; color: #475569; line-height: 1.5; }
    .feedback-evidence { font-size: 12px; color: #64748b; margin-top: 8px; }
    .fun-ending { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 1px solid #fbbf24; border-radius: 12px; padding: 24px; margin-top: 40px; text-align: center; }
    .fun-headline { font-size: 18px; font-weight: 600; color: #78350f; margin-bottom: 8px; }
    .fun-detail { font-size: 14px; color: #92400e; }
    .collapsible-section { margin-top: 16px; }
    .collapsible-header { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 12px 0; border-bottom: 1px solid #e2e8f0; }
    .collapsible-header h3 { margin: 0; font-size: 14px; font-weight: 600; color: #475569; }
    .collapsible-arrow { font-size: 12px; color: #94a3b8; transition: transform 0.2s; }
    .collapsible-content { display: none; padding-top: 16px; }
    .collapsible-content.open { display: block; }
    .collapsible-header.open .collapsible-arrow { transform: rotate(90deg); }
    @media (max-width: 640px) { .charts-row { grid-template-columns: 1fr; } .stats-row { justify-content: center; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>Claude Code Insights</h1>
    <p class="subtitle">${stats.total_messages.toLocaleString()} messages across ${stats.total_sessions} sessions | ${stats.date_range.start} to ${stats.date_range.end}</p>

    ${z}

    <nav class="nav-toc">
      <a href="#section-work">What You Work On</a>
      <a href="#section-usage">How You Use CC</a>
      <a href="#section-wins">Impressive Things</a>
      <a href="#section-friction">Where Things Go Wrong</a>
      <a href="#section-features">Features to Try</a>
      <a href="#section-patterns">New Usage Patterns</a>
      <a href="#section-horizon">On the Horizon</a>
      <a href="#section-feedback">Team Feedback</a>
    </nav>

    <div class="stats-row">
      <div class="stat"><div class="stat-value">${stats.total_messages.toLocaleString()}</div><div class="stat-label">Messages</div></div>
      <div class="stat"><div class="stat-value">+${stats.total_lines_added.toLocaleString()}/-${stats.total_lines_removed.toLocaleString()}</div><div class="stat-label">Lines</div></div>
      <div class="stat"><div class="stat-value">${stats.total_files_modified}</div><div class="stat-label">Files</div></div>
      <div class="stat"><div class="stat-value">${stats.days_active}</div><div class="stat-label">Days</div></div>
      <div class="stat"><div class="stat-value">${stats.messages_per_day}</div><div class="stat-label">Msgs/Day</div></div>
    </div>

    ${H}

    <div class="charts-row">
      <div class="chart-card">
        <div class="chart-title">What You Wanted</div>
        ${renderBarChart(stats.goal_categories, "#2563eb")}
      </div>
      <div class="chart-card">
        <div class="chart-title">Top Tools Used</div>
        ${renderBarChart(stats.tool_counts, "#0891b2")}
      </div>
    </div>

    <div class="charts-row">
      <div class="chart-card">
        <div class="chart-title">Languages</div>
        ${renderBarChart(stats.languages, "#10b981")}
      </div>
      <div class="chart-card">
        <div class="chart-title">Session Types</div>
        ${renderBarChart(stats.session_types || {}, "#8b5cf6")}
      </div>
    </div>

    ${O}

    <!-- Response Time Distribution -->
    <div class="chart-card" style="margin: 24px 0;">
      <div class="chart-title">User Response Time Distribution</div>
      ${renderResponseTimeChart(stats.user_response_times)}
      <div style="font-size: 12px; color: #64748b; margin-top: 8px;">
        Median: ${stats.median_response_time.toFixed(1)}s &bull; Average: ${stats.avg_response_time.toFixed(1)}s
      </div>
    </div>

    <!-- Multi-clauding Section (matching Python reference) -->
    <div class="chart-card" style="margin: 24px 0;">
      <div class="chart-title">Multi-Clauding (Parallel Sessions)</div>
      ${
        stats.multi_clauding.overlap_events === 0
          ? `
        <p style="font-size: 14px; color: #64748b; padding: 8px 0;">
          No parallel session usage detected. You typically work with one Claude Code session at a time.
        </p>
      `
          : `
        <div style="display: flex; gap: 24px; margin: 12px 0;">
          <div style="text-align: center;">
            <div style="font-size: 24px; font-weight: 700; color: #7c3aed;">${stats.multi_clauding.overlap_events}</div>
            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Overlap Events</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 24px; font-weight: 700; color: #7c3aed;">${stats.multi_clauding.sessions_involved}</div>
            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Sessions Involved</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 24px; font-weight: 700; color: #7c3aed;">${stats.total_messages > 0 ? Math.round((stats.multi_clauding.user_messages_during * 100) / stats.total_messages) : 0}%</div>
            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Of Messages</div>
          </div>
        </div>
        <p style="font-size: 13px; color: #475569; margin-top: 12px;">
          You run multiple Claude Code sessions simultaneously. Multi-clauding is detected when sessions
          overlap in time, suggesting parallel workflows.
        </p>
      `
      }
    </div>

    <!-- Time of Day & Tool Errors -->
    <div class="charts-row">
      <div class="chart-card">
        <div class="chart-title" style="display: flex; align-items: center; gap: 12px;">
          User Messages by Time of Day
          <select id="timezone-select" style="font-size: 12px; padding: 4px 8px; border-radius: 4px; border: 1px solid #e2e8f0;">
            <option value="0">PT (UTC-8)</option>
            <option value="3">ET (UTC-5)</option>
            <option value="8">London (UTC)</option>
            <option value="9">CET (UTC+1)</option>
            <option value="17">Tokyo (UTC+9)</option>
            <option value="custom">Custom offset...</option>
          </select>
          <input type="number" id="custom-offset" placeholder="UTC offset" style="display: none; width: 80px; font-size: 12px; padding: 4px; border-radius: 4px; border: 1px solid #e2e8f0;">
        </div>
        ${renderTimeOfDayChart(stats.message_hours)}
      </div>
      <div class="chart-card">
        <div class="chart-title">Tool Errors Encountered</div>
        ${Object.keys(stats.tool_error_categories).length > 0 ? renderBarChart(stats.tool_error_categories, "#dc2626") : '<p class="empty">No tool errors</p>'}
      </div>
    </div>

    ${J}

    <div class="charts-row">
      <div class="chart-card">
        <div class="chart-title">What Helped Most (Claude's Capabilities)</div>
        ${renderBarChart(stats.success, "#16a34a")}
      </div>
      <div class="chart-card">
        <div class="chart-title">Outcomes</div>
        ${renderBarChart(stats.outcomes, "#8b5cf6", 6, OUTCOME_ORDER)}
      </div>
    </div>

    ${D}

    <div class="charts-row">
      <div class="chart-card">
        <div class="chart-title">Primary Friction Types</div>
        ${renderBarChart(stats.friction, "#dc2626")}
      </div>
      <div class="chart-card">
        <div class="chart-title">Inferred Satisfaction (model-estimated)</div>
        ${renderBarChart(stats.satisfaction, "#eab308", 6, SATISFACTION_ORDER)}
      </div>
    </div>

    ${j}

    ${G}

    ${T}

    ${Z}
  </div>
  <script>${u}</script>
</body>
</html>`;
}
async function runInsightsPipeline(opts) {
  let remoteStats;
  let allSessions = await loadAllSessions(undefined, {
    skipIndex: true,
  });
  let isAgentSession = (sess) => {
    if (sess.fullPath) {
      return basename(sess.fullPath).startsWith("agent-");
    } else {
      return false;
    }
  };
  let isInsightsSession = (sess) => {
    for (let entry of sess.messages.slice(0, 5)) {
      if (entry.type === "user" && entry.message) {
        let sid = entry.message.content;
        if (typeof sid === "string") {
          if (
            sid.includes("RESPOND WITH ONLY A VALID JSON OBJECT") ||
            sid.includes("record_facets")
          ) {
            return true;
          }
        }
      }
    }
    return false;
  };
  let filtered = allSessions.filter((sess) => !isAgentSession(sess) && !isInsightsSession(sess) && hasValidTimestamps(sess));
  let deduped = deduplicateSessions(
    filtered.map((sess) => ({
      log: sess,
      meta: buildSessionMeta(sess),
    })),
  ).sort((sess, entry) => entry.meta.start_time.localeCompare(sess.meta.start_time));
  let $ = (sess) => {
    if (sess.user_message_count < 2) {
      return false;
    }
    if (sess.duration_minutes < 1) {
      return false;
    }
    return true;
  };
  let substantial = deduped.filter((sess) => $(sess.meta));
  let _ = substantial.map((sess) => sess.meta);
  let J = new Map();
  let toExtract = [];
  let MAX_EXTRACT = 50;
  for (let { log: sess, meta: entry } of substantial) {
    let sid = entry.session_id;
    let sesId = readCachedFacets(sid);
    if (sesId) {
      J.set(sid, sesId);
    } else if (toExtract.length < MAX_EXTRACT) {
      toExtract.push({
        log: sess,
        sessionId: sid,
      });
    }
  }
  let BATCH_SIZE = 50;
  for (let sess = 0; sess < toExtract.length; sess += BATCH_SIZE) {
    let entry = toExtract.slice(sess, sess + BATCH_SIZE);
    let sid = await Promise.all(
      entry.map(async ({ log: sesId, sessionId: newFacets }) => {
        let extracted = await extractFacets(sesId, newFacets);
        return {
          sessionId: newFacets,
          newFacets: extracted,
        };
      }),
    );
    for (let { sessionId: sesId, newFacets: newFacets } of sid) {
      if (newFacets) {
        J.set(sesId, newFacets);
        writeFacetCache(newFacets);
      }
    }
  }
  let isWarmupOnly = (sess) => {
    let entry = J.get(sess);
    if (!entry) {
      return false;
    }
    let sid = entry.goal_categories;
    let sesId = Object.keys(sid).filter((newFacets) => (sid[newFacets] ?? 0) > 0);
    return sesId.length === 1 && sesId[0] === "warmup_minimal";
  };
  let nonWarmupMetas = _.filter((sess) => !isWarmupOnly(sess.session_id));
  let nonWarmupFacets = new Map();
  for (let [sess, entry] of J) {
    if (!isWarmupOnly(sess)) {
      nonWarmupFacets.set(sess, entry);
    }
  }
  let aggregated = aggregateStats(nonWarmupMetas, nonWarmupFacets);
  let narratives = await generateAllNarratives(aggregated, J);
  let html = generateHtmlReport(aggregated, narratives);
  try {
    getFs().mkdirSync(USAGE_DATA_DIR);
  } catch {}
  let reportPath = join(USAGE_DATA_DIR, "report.html");
  writeFileSync(reportPath, html, {
    encoding: "utf-8",
    flush: true,
    mode: 384,
  });
  return {
    insights: narratives,
    htmlPath: reportPath,
    data: aggregated,
    remoteStats: remoteStats,
    facets: nonWarmupFacets,
  };
}
var EXTENSION_TO_LANGUAGE;
var LABEL_DISPLAY_NAMES;
var USAGE_DATA_DIR;
var FACETS_DIR;
var FACET_EXTRACTION_PROMPT = `Analyze this Claude Code session and extract structured facets.

CRITICAL GUIDELINES:

1. **goal_categories**: Count ONLY what the USER explicitly asked for.
   - DO NOT count Claude's autonomous codebase exploration
   - DO NOT count work Claude decided to do on its own
   - ONLY count when user says "can you...", "please...", "I need...", "let's..."

2. **user_satisfaction_counts**: Base ONLY on explicit user signals.
   - "Yay!", "great!", "perfect!" → happy
   - "thanks", "looks good", "that works" → satisfied
   - "ok, now let's..." (continuing without complaint) → likely_satisfied
   - "that's not right", "try again" → dissatisfied
   - "this is broken", "I give up" → frustrated

3. **friction_counts**: Be specific about what went wrong.
   - misunderstood_request: Claude interpreted incorrectly
   - wrong_approach: Right goal, wrong solution method
   - buggy_code: Code didn't work correctly
   - user_rejected_action: User said no/stop to a tool call
   - excessive_changes: Over-engineered or changed too much

4. If very short or just warmup, use warmup_minimal for goal_category

SESSION:
`;
var CHUNK_SUMMARIZATION_PROMPT = `Summarize this portion of a Claude Code session transcript. Focus on:
1. What the user asked for
2. What Claude did (tools used, files modified)
3. Any friction or issues
4. The outcome

Keep it concise - 3-5 sentences. Preserve specific details like file names, error messages, and user feedback.

TRANSCRIPT CHUNK:
`;
var NARRATIVE_SECTION_DEFS;
var SATISFACTION_ORDER;
var OUTCOME_ORDER;
var INSIGHTS_COMMAND_DEF;
var insightsCommand;
var initInsights = v(() => {
  oq();
  o7();
  K8();
  I6();
  yA();
  L6();
  aH();
  I6();
  EXTENSION_TO_LANGUAGE = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".py": "Python",
    ".rb": "Ruby",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java",
    ".md": "Markdown",
    ".json": "JSON",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".sh": "Shell",
    ".css": "CSS",
    ".html": "HTML",
  };
  LABEL_DISPLAY_NAMES = {
    debug_investigate: "Debug/Investigate",
    implement_feature: "Implement Feature",
    fix_bug: "Fix Bug",
    write_script_tool: "Write Script/Tool",
    refactor_code: "Refactor Code",
    configure_system: "Configure System",
    create_pr_commit: "Create PR/Commit",
    analyze_data: "Analyze Data",
    understand_codebase: "Understand Codebase",
    write_tests: "Write Tests",
    write_docs: "Write Docs",
    deploy_infra: "Deploy/Infra",
    warmup_minimal: "Cache Warmup",
    fast_accurate_search: "Fast/Accurate Search",
    correct_code_edits: "Correct Code Edits",
    good_explanations: "Good Explanations",
    proactive_help: "Proactive Help",
    multi_file_changes: "Multi-file Changes",
    handled_complexity: "Multi-file Changes",
    good_debugging: "Good Debugging",
    misunderstood_request: "Misunderstood Request",
    wrong_approach: "Wrong Approach",
    buggy_code: "Buggy Code",
    user_rejected_action: "User Rejected Action",
    claude_got_blocked: "Claude Got Blocked",
    user_stopped_early: "User Stopped Early",
    wrong_file_or_location: "Wrong File/Location",
    excessive_changes: "Excessive Changes",
    slow_or_verbose: "Slow/Verbose",
    tool_failed: "Tool Failed",
    user_unclear: "User Unclear",
    external_issue: "External Issue",
    frustrated: "Frustrated",
    dissatisfied: "Dissatisfied",
    likely_satisfied: "Likely Satisfied",
    satisfied: "Satisfied",
    happy: "Happy",
    unsure: "Unsure",
    neutral: "Neutral",
    delighted: "Delighted",
    single_task: "Single Task",
    multi_task: "Multi Task",
    iterative_refinement: "Iterative Refinement",
    exploration: "Exploration",
    quick_question: "Quick Question",
    fully_achieved: "Fully Achieved",
    mostly_achieved: "Mostly Achieved",
    partially_achieved: "Partially Achieved",
    not_achieved: "Not Achieved",
    unclear_from_transcript: "Unclear",
    unhelpful: "Unhelpful",
    slightly_helpful: "Slightly Helpful",
    moderately_helpful: "Moderately Helpful",
    very_helpful: "Very Helpful",
    essential: "Essential",
  };
  USAGE_DATA_DIR = join(getClaudeConfigDir(), "usage-data");
  FACETS_DIR = join(USAGE_DATA_DIR, "facets");
  NARRATIVE_SECTION_DEFS = [
    {
      name: "project_areas",
      prompt: `Analyze this Claude Code usage data and identify project areas.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "areas": [
    {"name": "Area name", "session_count": N, "description": "2-3 sentences about what was worked on and how Claude Code was used."}
  ]
}

Include 4-5 areas. Skip internal CC operations.`,
      maxTokens: 8192,
    },
    {
      name: "interaction_style",
      prompt: `Analyze this Claude Code usage data and describe the user's interaction style.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "narrative": "2-3 paragraphs analyzing HOW the user interacts with Claude Code. Use second person 'you'. Describe patterns: iterate quickly vs detailed upfront specs? Interrupt often or let Claude run? Include specific examples. Use **bold** for key insights.",
  "key_pattern": "One sentence summary of most distinctive interaction style"
}`,
      maxTokens: 8192,
    },
    {
      name: "what_works",
      prompt: `Analyze this Claude Code usage data and identify what's working well for this user. Use second person ("you").

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "intro": "1 sentence of context",
  "impressive_workflows": [
    {"title": "Short title (3-6 words)", "description": "2-3 sentences describing the impressive workflow or approach. Use 'you' not 'the user'."}
  ]
}

Include 3 impressive workflows.`,
      maxTokens: 8192,
    },
    {
      name: "friction_analysis",
      prompt: `Analyze this Claude Code usage data and identify friction points for this user. Use second person ("you").

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "intro": "1 sentence summarizing friction patterns",
  "categories": [
    {"category": "Concrete category name", "description": "1-2 sentences explaining this category and what could be done differently. Use 'you' not 'the user'.", "examples": ["Specific example with consequence", "Another example"]}
  ]
}

Include 3 friction categories with 2 examples each.`,
      maxTokens: 8192,
    },
    {
      name: "suggestions",
      prompt: `Analyze this Claude Code usage data and suggest improvements.

## CC FEATURES REFERENCE (pick from these for features_to_try):
1. **MCP Servers**: Connect Claude to external tools, databases, and APIs via Model Context Protocol.
   - How to use: Run \`claude mcp add <server-name> -- <command>\`
   - Good for: database queries, Slack integration, GitHub issue lookup, connecting to internal APIs

2. **Custom Skills**: Reusable prompts you define as markdown files that run with a single /command.
   - How to use: Create \`.claude/skills/commit/SKILL.md\` with instructions. Then type \`/commit\` to run it.
   - Good for: repetitive workflows - /commit, /review, /test, /deploy, /pr, or complex multi-step workflows

3. **Hooks**: Shell commands that auto-run at specific lifecycle events.
   - How to use: Add to \`.claude/settings.json\` under "hooks" key.
   - Good for: auto-formatting code, running type checks, enforcing conventions

4. **Headless Mode**: Run Claude non-interactively from scripts and CI/CD.
   - How to use: \`claude -p "fix lint errors" --allowedTools "Edit,Read,Bash"\`
   - Good for: CI/CD integration, batch code fixes, automated reviews

5. **Task Agents**: Claude spawns focused sub-agents for complex exploration or parallel work.
   - How to use: Claude auto-invokes when helpful, or ask "use an agent to explore X"
   - Good for: codebase exploration, understanding complex systems

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "claude_md_additions": [
    {"addition": "A specific line or block to add to CLAUDE.md based on workflow patterns. E.g., 'Always run tests after modifying auth-related files'", "why": "1 sentence explaining why this would help based on actual sessions", "prompt_scaffold": "Instructions for where to add this in CLAUDE.md. E.g., 'Add under ## Testing section'"}
  ],
  "features_to_try": [
    {"feature": "Feature name from CC FEATURES REFERENCE above", "one_liner": "What it does", "why_for_you": "Why this would help YOU based on your sessions", "example_code": "Actual command or config to copy"}
  ],
  "usage_patterns": [
    {"title": "Short title", "suggestion": "1-2 sentence summary", "detail": "3-4 sentences explaining how this applies to YOUR work", "copyable_prompt": "A specific prompt to copy and try"}
  ]
}

IMPORTANT for claude_md_additions: PRIORITIZE instructions that appear MULTIPLE TIMES in the user data. If user told Claude the same thing in 2+ sessions (e.g., 'always run tests', 'use TypeScript'), that's a PRIME candidate - they shouldn't have to repeat themselves.

IMPORTANT for features_to_try: Pick 2-3 from the CC FEATURES REFERENCE above. Include 2-3 items for each category.`,
      maxTokens: 8192,
    },
    {
      name: "on_the_horizon",
      prompt: `Analyze this Claude Code usage data and identify future opportunities.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "intro": "1 sentence about evolving AI-assisted development",
  "opportunities": [
    {"title": "Short title (4-8 words)", "whats_possible": "2-3 ambitious sentences about autonomous workflows", "how_to_try": "1-2 sentences mentioning relevant tooling", "copyable_prompt": "Detailed prompt to try"}
  ]
}

Include 3 opportunities. Think BIG - autonomous workflows, parallel agents, iterating against tests.`,
      maxTokens: 8192,
    },
    ...[],
    {
      name: "fun_ending",
      prompt: `Analyze this Claude Code usage data and find a memorable moment.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "headline": "A memorable QUALITATIVE moment from the transcripts - not a statistic. Something human, funny, or surprising.",
  "detail": "Brief context about when/where this happened"
}

Find something genuinely interesting or amusing from the session summaries.`,
      maxTokens: 8192,
    },
  ];
  SATISFACTION_ORDER = [
    "frustrated",
    "dissatisfied",
    "likely_satisfied",
    "satisfied",
    "happy",
    "unsure",
  ];
  OUTCOME_ORDER = [
    "not_achieved",
    "partially_achieved",
    "mostly_achieved",
    "fully_achieved",
    "unclear_from_transcript",
  ];
  INSIGHTS_COMMAND_DEF = {
    type: "prompt",
    name: "insights",
    description: "Generate a report analyzing your Claude Code sessions",
    contentLength: 0,
    isEnabled: () => true,
    isHidden: false,
    progressMessage: "analyzing your sessions",
    source: "builtin",
    async getPromptForCommand(args) {
      let collectRemote = false;
      let tags = [];
      let isHeadless = false;
      let {
        insights: insights,
        htmlPath: htmlPath,
        data: data,
        remoteStats: $,
      } = await runInsightsPipeline({
        collectRemote: collectRemote,
      });
      let reportUrl = `file://${htmlPath}`;
      let _ = "";
      let statsLine = [
        `${data.total_sessions} sessions`,
        `${data.total_messages.toLocaleString()} messages`,
        `${Math.round(data.total_duration_hours)}h`,
        `${data.git_commits} commits`,
      ].join(" · ");
      let remoteLine = "";
      let atAGlance = insights.at_a_glance;
      let glanceText = atAGlance
        ? `## At a Glance

${atAGlance.whats_working ? `**What's working:** ${atAGlance.whats_working} See _Impressive Things You Did_.` : ""}

${atAGlance.whats_hindering ? `**What's hindering you:** ${atAGlance.whats_hindering} See _Where Things Go Wrong_.` : ""}

${atAGlance.quick_wins ? `**Quick wins to try:** ${atAGlance.quick_wins} See _Features to Try_.` : ""}

${atAGlance.ambitious_workflows ? `**Ambitious workflows:** ${atAGlance.ambitious_workflows} See _On the Horizon_.` : ""}`
        : "_No insights generated_";
      let fullMsg = `${`# Claude Code Insights

${statsLine}
${data.date_range.start} to ${data.date_range.end}
${remoteLine}
`}${glanceText}

Your full shareable insights report is ready: ${reportUrl}${_}`;
      return [
        {
          type: "text",
          text: `The user just ran /insights to generate a usage report analyzing their Claude Code sessions.

Here is the full insights data:
${jsonStringify(insights, null, 2)}

Report URL: ${reportUrl}
HTML file: ${htmlPath}
Facets directory: ${FACETS_DIR}

Here is what the user sees:
${fullMsg}

Now output the following message exactly:

<message>
Your shareable insights report is ready:
${reportUrl}${_}

Want to dig into any section or try one of the suggestions?
</message>`,
        },
      ];
    },
    userFacingName() {
      return "insights";
    },
  };
  insightsCommand = INSIGHTS_COMMAND_DEF;
});
