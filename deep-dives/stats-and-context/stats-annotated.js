// =============================================================================
// /stats Command — Annotated Source
// Source: Claude Code v2.1.34 (deobfuscated.js)
// =============================================================================
//
// Command type: local-jsx (renders React/Ink UI)
// Entry: /stats → StatsModule.call → renderStatsDialog()
//
// The /stats command shows historical usage statistics aggregated from session
// JSONL files stored on disk. It has two tabs: "Overview" (activity heatmap,
// streaks, session counts) and "Models" (per-model token breakdown chart).
//
// Data is loaded from ~/.claude/projects/*/*.jsonl session files, with a
// stats-cache.json file for incremental computation.
// =============================================================================

// ─── Command Definition ─────────────────────────────────────────────────────
// deobfuscated.js:627471-627487

var statsCommand = {
  type: "local-jsx",
  name: "stats",
  description: "Show your Claude Code usage statistics and activity",
  isEnabled: () => true,
  isHidden: false,
  load: () =>
    Promise.resolve().then(() => {
      initStatsModule();
      return StatsModule;
    }),
  userFacingName() {
    return "stats";
  },
};

// ─── Module Export ───────────────────────────────────────────────────────────
// deobfuscated.js:627454-627463

var StatsModule = {};
uA(StatsModule, {
  call: () => renderStatsDialog,
});

var renderStatsDialog = async (onClose) => {
  return React.createElement(StatsDialogWrapper, {
    onClose: onClose,
  });
};

// ─── Constants ──────────────────────────────────────────────────────────────
// deobfuscated.js:627307-627452

var TIME_PERIOD_LABELS = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

var TIME_PERIODS = ["all", "7d", "30d"]; // Cycle order for 'r' key

// Fun comparisons for token counts — "You've used ~Nx more tokens than <book>"
// deobfuscated.js:627313-627410
var TOKEN_COMPARISONS = [
  { name: "The Little Prince", tokens: 22000 },
  { name: "The Old Man and the Sea", tokens: 35000 },
  { name: "A Christmas Carol", tokens: 37000 },
  { name: "Animal Farm", tokens: 39000 },
  { name: "Fahrenheit 451", tokens: 60000 },
  { name: "The Great Gatsby", tokens: 62000 },
  { name: "Slaughterhouse-Five", tokens: 64000 },
  { name: "Brave New World", tokens: 83000 },
  { name: "The Catcher in the Rye", tokens: 95000 },
  { name: "Harry Potter and the Philosopher's Stone", tokens: 103000 },
  { name: "The Hobbit", tokens: 123000 },
  { name: "1984", tokens: 123000 },
  { name: "To Kill a Mockingbird", tokens: 130000 },
  { name: "Pride and Prejudice", tokens: 156000 },
  { name: "Dune", tokens: 244000 },
  { name: "Moby-Dick", tokens: 268000 },
  { name: "Crime and Punishment", tokens: 274000 },
  { name: "A Game of Thrones", tokens: 381000 },
  { name: "Anna Karenina", tokens: 468000 },
  { name: "Don Quixote", tokens: 520000 },
  { name: "The Lord of the Rings", tokens: 576000 },
  { name: "The Count of Monte Cristo", tokens: 603000 },
  { name: "Les Misérables", tokens: 689000 },
  { name: "War and Peace", tokens: 730000 },
];

// Fun comparisons for session duration
// deobfuscated.js:627411-627452
var DURATION_COMPARISONS = [
  { name: "a TED talk", minutes: 18 },
  { name: "an episode of The Office", minutes: 22 },
  { name: "listening to Abbey Road", minutes: 47 },
  { name: "a yoga class", minutes: 60 },
  { name: "a World Cup soccer match", minutes: 90 },
  { name: "a half marathon (average time)", minutes: 120 },
  { name: "the movie Inception", minutes: 148 },
  { name: "watching Titanic", minutes: 195 },
  { name: "a transatlantic flight", minutes: 420 },
  { name: "a full night of sleep", minutes: 480 },
];

// ─── Data Loading Pipeline ──────────────────────────────────────────────────

// Top-level data loader called by the React component
// Returns { type: "success"|"error"|"empty", data?, message? }
// deobfuscated.js:625812-625831
function loadAllTimeStats() {
  return loadStatsForPeriod("all")
    .then((data) => {
      if (!data || data.totalSessions === 0) {
        return { type: "empty" };
      }
      return { type: "success", data: data };
    })
    .catch((err) => {
      return {
        type: "error",
        message: err instanceof Error ? err.message : "Failed to load stats",
      };
    });
}

// Main time-period dispatcher
// deobfuscated.js:624360-624377
async function loadStatsForPeriod(timePeriod) {
  if (timePeriod === "all") {
    return loadAllTimeStatsWithCache(); // l7z
  }
  // For "7d" or "30d", load session files and filter by date
  let sessionFiles = await discoverSessionFiles(); // vbA
  if (sessionFiles.length === 0) {
    return emptyStats(); // wwq
  }
  let now = new Date();
  let days = timePeriod === "7d" ? 7 : 30;
  let startDate = new Date(now);
  startDate.setDate(now.getDate() - days + 1);
  let fromDateStr = formatDate(startDate); // ym
  let rawData = await loadSessionData(sessionFiles, { fromDate: fromDateStr }); // dP1
  return processRawStats(rawData); // i7z
}

// All-time stats with disk cache for incremental updates
// deobfuscated.js:624315-624359
async function loadAllTimeStatsWithCache() {
  let sessionFiles = await discoverSessionFiles();
  if (sessionFiles.length === 0) {
    return emptyStats();
  }

  // Load and update the cache under a mutex lock (fbA)
  let cachedData = await withCacheLock(async () => {
    let cache = readStatsCache();        // VbA — reads stats-cache.json
    let yesterday = getYesterdayDate();  // NbA
    let result = cache;

    if (!cache.lastComputedDate) {
      // Cache empty: process ALL historical sessions
      debugLog("Stats cache empty, processing all historical data");
      let allData = await loadSessionData(sessionFiles, { toDate: yesterday });
      if (allData.sessionStats.length > 0) {
        result = mergeStatsData(cache, allData, yesterday); // wp1
        writeStatsCache(result); // w91 — atomic write to stats-cache.json
      }
    } else if (isDateBefore(cache.lastComputedDate, yesterday)) {
      // Cache stale: load incremental data since last computed date
      let nextDay = getNextDay(cache.lastComputedDate); // Ywq
      debugLog(`Stats cache stale (${cache.lastComputedDate}), processing ${nextDay} to ${yesterday}`);
      let newData = await loadSessionData(sessionFiles, {
        fromDate: nextDay,
        toDate: yesterday,
      });
      if (newData.sessionStats.length > 0 || newData.dailyActivity.length > 0) {
        result = mergeStatsData(cache, newData, yesterday);
        writeStatsCache(result);
      } else {
        // No new data, just update the date marker
        result = { ...cache, lastComputedDate: yesterday };
        writeStatsCache(result);
      }
    }
    // else: cache is up-to-date for yesterday
    return result;
  });

  // Always load today's data fresh (not cached, since day is still in progress)
  let todayStr = getTodayDate(); // qwq
  let todayData = await loadSessionData(sessionFiles, {
    fromDate: todayStr,
    toDate: todayStr,
  });

  // Merge cached historical data with today's live data
  return mergeStatsResults(cachedData, todayData); // c7z
}

// ─── Session File Discovery ─────────────────────────────────────────────────
// deobfuscated.js:624125-624172

async function discoverSessionFiles() {
  let sessionsDir = getProjectsDir(); // rd → joins cacheDir + "projects"
  let fs = getFileSystem();           // x1
  try {
    await fs.stat(sessionsDir);
  } catch {
    return []; // Directory doesn't exist
  }

  // List project directories
  let projectDirs = (await fs.readdir(sessionsDir))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(sessionsDir, entry.name));

  // For each project dir, find all .jsonl files (including subagent files)
  return (
    await Promise.all(
      projectDirs.map(async (projDir) => {
        try {
          let entries = await fs.readdir(projDir);
          // Direct .jsonl files in project dir
          let mainFiles = entries
            .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
            .map((e) => join(projDir, e.name));
          // Subagent directories: look for agent-*.jsonl in subagents/
          let subdirs = entries.filter((e) => e.isDirectory());
          let subagentFiles = await Promise.all(
            subdirs.map(async (subdir) => {
              let subagentPath = join(projDir, subdir.name, "subagents");
              try {
                return (await fs.readdir(subagentPath))
                  .filter(
                    (f) => f.isFile() && f.name.endsWith(".jsonl") && f.name.startsWith("agent-"),
                  )
                  .map((f) => join(subagentPath, f.name));
              } catch {
                return [];
              }
            }),
          );
          return [...mainFiles, ...subagentFiles.flat()];
        } catch (err) {
          debugLog(`Failed to read project directory ${projDir}: ${err instanceof Error ? err.message : String(err)}`);
          return [];
        }
      }),
    )
  ).flat();
}

// ─── Core Session Data Loader ───────────────────────────────────────────────
// deobfuscated.js:623957-624124
//
// Reads session JSONL files in batches of 20, extracts messages, aggregates by
// date/hour/model. Filters by date range. Skips files whose mtime is before
// fromDate for efficiency.

async function loadSessionData(sessionFiles, { fromDate, toDate } = {}) {
  let fs = getFileSystem();
  let dailyActivityMap = new Map();     // date → { date, messageCount, sessionCount, toolCallCount }
  let dailyModelTokensMap = new Map();  // date → { model → tokenCount }
  let sessionStats = [];                // [{ sessionId, duration, messageCount, timestamp }]
  let hourCounts = new Map();           // hour(0-23) → count
  let totalMessages = 0;
  let speculationTimeSaved = 0;
  let modelUsage = {};
  let longestSession = undefined;
  let processedSessions = new Set();
  let BATCH_SIZE = 20;

  for (let i = 0; i < sessionFiles.length; i += BATCH_SIZE) {
    let batch = sessionFiles.slice(i, i + BATCH_SIZE);
    let results = await Promise.all(
      batch.map(async (filePath) => {
        try {
          // OPTIMIZATION: Check file mtime before reading contents
          if (fromDate) {
            try {
              let stat = await fs.stat(filePath);
              let fileDateStr = formatDate(stat.mtime);
              if (isDateBefore(fileDateStr, fromDate)) {
                return { sessionFile: filePath, entries: null, error: null, skipped: true };
              }
            } catch {}
          }
          let entries = await readJsonlFile(filePath); // Y61
          return { sessionFile: filePath, entries, error: null, skipped: false };
        } catch (err) {
          return { sessionFile: filePath, entries: null, error: err, skipped: false };
        }
      }),
    );

    for (let { sessionFile, entries, error, skipped } of results) {
      if (skipped) continue;
      if (error || !entries) {
        debugLog(`Failed to read session file ${sessionFile}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      let sessionId = basename(sessionFile, ".jsonl");
      let messages = [];
      for (let entry of entries) {
        if (isMessage(entry)) {          // eh — checks if entry is a message type
          messages.push(entry);
        } else if (entry.type === "speculation-accept") {
          speculationTimeSaved += entry.timeSavedMs;
        }
      }
      if (messages.length === 0) continue;

      // Filter out sidechain messages (subagent messages)
      let mainMessages = messages.filter((m) => !m.isSidechain);
      if (mainMessages.length === 0) continue;

      let firstMsg = mainMessages[0];
      let lastMsg = mainMessages[mainMessages.length - 1];
      let startTime = new Date(firstMsg.timestamp);
      let endTime = new Date(lastMsg.timestamp);
      let dateStr = formatDate(startTime);

      // Date range filtering
      if (fromDate && isDateBefore(dateStr, fromDate)) continue;
      if (toDate && isDateBefore(toDate, dateStr)) continue;

      let durationMs = endTime.getTime() - startTime.getTime();
      sessionStats.push({
        sessionId,
        duration: durationMs,
        messageCount: mainMessages.length,
        timestamp: firstMsg.timestamp,
      });
      totalMessages += mainMessages.length;

      // Aggregate daily activity
      let dayData = dailyActivityMap.get(dateStr) || {
        date: dateStr, messageCount: 0, sessionCount: 0, toolCallCount: 0,
      };
      dayData.sessionCount++;
      dayData.messageCount += mainMessages.length;
      dailyActivityMap.set(dateStr, dayData);

      // Aggregate by hour
      let hour = startTime.getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);

      // Aggregate model usage from assistant messages with usage data
      for (let msg of mainMessages) {
        if (msg.type === "assistant") {
          // Count tool calls
          let content = msg.message?.content;
          if (Array.isArray(content)) {
            for (let block of content) {
              if (block.type === "tool_use") {
                dailyActivityMap.get(dateStr).toolCallCount++;
              }
            }
          }
          // Aggregate token usage by model
          if (msg.message?.usage) {
            let usage = msg.message.usage;
            let model = msg.message.model || "unknown";
            if (model === HIDDEN_MODEL_ID) continue; // aX1 — skip hidden/internal model
            if (!modelUsage[model]) {
              modelUsage[model] = {
                inputTokens: 0, outputTokens: 0,
                cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
                webSearchRequests: 0, costUSD: 0,
                contextWindow: 0, maxOutputTokens: 0,
              };
            }
            modelUsage[model].inputTokens += usage.input_tokens || 0;
            modelUsage[model].outputTokens += usage.output_tokens || 0;
            modelUsage[model].cacheReadInputTokens += usage.cache_read_input_tokens || 0;
            modelUsage[model].cacheCreationInputTokens += usage.cache_creation_input_tokens || 0;

            let totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
            if (totalTokens > 0) {
              let dayModelTokens = dailyModelTokensMap.get(dateStr) || {};
              dayModelTokens[model] = (dayModelTokens[model] || 0) + totalTokens;
              dailyModelTokensMap.set(dateStr, dayModelTokens);
            }
          }
        }
      }
    }
  }

  return {
    dailyActivity: Array.from(dailyActivityMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    dailyModelTokens: Array.from(dailyModelTokensMap.entries())
      .map(([date, tokensByModel]) => ({ date, tokensByModel }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    modelUsage,
    sessionStats,
    hourCounts: Object.fromEntries(hourCounts),
    totalMessages,
    totalSpeculationTimeSavedMs: speculationTimeSaved,
  };
}

// ─── Stats Processing ───────────────────────────────────────────────────────
// deobfuscated.js:624378-624445

function processRawStats(rawData) {
  let sortedDaily = [...rawData.dailyActivity].sort((a, b) => a.date.localeCompare(b.date));
  let sortedModelTokens = [...rawData.dailyModelTokens].sort((a, b) => a.date.localeCompare(b.date));
  let streaks = calculateStreaks(sortedDaily); // zwq

  // Find longest session
  let longestSession = null;
  for (let session of rawData.sessionStats) {
    if (!longestSession || session.duration > longestSession.duration) {
      longestSession = session;
    }
  }

  // Find first and last session timestamps
  let firstTimestamp = null;
  let lastTimestamp = null;
  for (let session of rawData.sessionStats) {
    if (!firstTimestamp || session.timestamp < firstTimestamp) firstTimestamp = session.timestamp;
    if (!lastTimestamp || session.timestamp > lastTimestamp) lastTimestamp = session.timestamp;
  }

  // Peak activity day (most messages)
  let peakDay = sortedDaily.length > 0
    ? sortedDaily.reduce((best, curr) => curr.messageCount > best.messageCount ? curr : best).date
    : null;

  // Peak activity hour
  let hourEntries = Object.entries(rawData.hourCounts);
  let peakHour = hourEntries.length > 0
    ? parseInt(hourEntries.reduce((best, [hour, count]) => count > parseInt(best[1].toString()) ? [hour, count] : best)[0], 10)
    : null;

  let totalDays = firstTimestamp && lastTimestamp
    ? Math.ceil((new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()) / 86400000) + 1
    : 0;

  return {
    totalSessions: rawData.sessionStats.length,
    totalMessages: rawData.totalMessages,
    totalDays,
    activeDays: rawData.dailyActivity.length,
    streaks,
    dailyActivity: sortedDaily,
    dailyModelTokens: sortedModelTokens,
    longestSession,
    modelUsage: rawData.modelUsage,
    firstSessionDate: firstTimestamp,
    lastSessionDate: lastTimestamp,
    peakActivityDay: peakDay,
    peakActivityHour: peakHour,
    totalSpeculationTimeSavedMs: rawData.totalSpeculationTimeSavedMs,
  };
}

// ─── Streak Calculator ──────────────────────────────────────────────────────
// deobfuscated.js:624485-624545

function calculateStreaks(dailyActivity) {
  if (dailyActivity.length === 0) {
    return {
      currentStreak: 0, longestStreak: 0,
      currentStreakStart: null, longestStreakStart: null, longestStreakEnd: null,
    };
  }

  // Current streak: count backwards from today
  let today = new Date();
  today.setHours(0, 0, 0, 0);
  let currentStreak = 0;
  let currentStreakStart = null;
  let checkDate = new Date(today);
  let activeDates = new Set(dailyActivity.map((d) => d.date));

  while (true) {
    let dateStr = formatDate(checkDate);
    if (!activeDates.has(dateStr)) break;
    currentStreak++;
    currentStreakStart = dateStr;
    checkDate.setDate(checkDate.getDate() - 1);
  }

  // Longest streak: scan all dates for consecutive runs
  let longestStreak = 0;
  let longestStart = null;
  let longestEnd = null;
  if (dailyActivity.length > 0) {
    let sortedDates = Array.from(activeDates).sort();
    let runLength = 1;
    let runStart = sortedDates[0];
    for (let i = 1; i < sortedDates.length; i++) {
      let prevDate = new Date(sortedDates[i - 1]);
      let currDate = new Date(sortedDates[i]);
      if (Math.round((currDate.getTime() - prevDate.getTime()) / 86400000) === 1) {
        runLength++;
      } else {
        if (runLength > longestStreak) {
          longestStreak = runLength;
          longestStart = runStart;
          longestEnd = sortedDates[i - 1];
        }
        runLength = 1;
        runStart = sortedDates[i];
      }
    }
    if (runLength > longestStreak) {
      longestStreak = runLength;
      longestStart = runStart;
      longestEnd = sortedDates[sortedDates.length - 1];
    }
  }

  return {
    currentStreak, longestStreak,
    currentStreakStart, longestStreakStart: longestStart, longestStreakEnd: longestEnd,
  };
}

// ─── Activity Heatmap (GitHub-style) ────────────────────────────────────────
// deobfuscated.js:624591-624672

function renderActivityHeatmap(dailyActivity, { terminalWidth = 80, showMonthLabels = true } = {}) {
  let LABEL_WIDTH = 4;
  let chartWidth = terminalWidth - LABEL_WIDTH;
  let numWeeks = Math.min(52, Math.max(10, chartWidth)); // 10-52 weeks

  // Build date→activity lookup
  let activityMap = new Map();
  for (let entry of dailyActivity) {
    activityMap.set(entry.date, entry);
  }

  let percentiles = calculatePercentiles(dailyActivity); // n7z

  // Start from numWeeks ago, aligned to week boundaries
  let today = new Date();
  today.setHours(0, 0, 0, 0);
  let startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay()); // Sunday
  let startDate = new Date(startOfWeek);
  startDate.setDate(startDate.getDate() - (numWeeks - 1) * 7);

  // Build 7×numWeeks grid (rows=days of week, cols=weeks)
  let grid = Array.from({ length: 7 }, () => Array(numWeeks).fill(""));
  let monthLabels = [];
  let lastMonth = -1;
  let currentDate = new Date(startDate);

  for (let week = 0; week < numWeeks; week++) {
    for (let day = 0; day < 7; day++) {
      if (currentDate > today) {
        grid[day][week] = " ";
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }
      let dateStr = formatDate(currentDate);
      let entry = activityMap.get(dateStr);

      // Track month boundaries for labels
      if (day === 0) {
        let month = currentDate.getMonth();
        if (month !== lastMonth) {
          monthLabels.push({ month, week });
          lastMonth = month;
        }
      }

      let level = getActivityLevel(entry?.messageCount || 0, percentiles); // r7z
      grid[day][week] = getHeatmapChar(level); // o7z
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  // ... renders grid rows with month labels below
}

// Percentile calculator for heatmap thresholds
// deobfuscated.js:624578-624590
function calculatePercentiles(dailyActivity) {
  let counts = dailyActivity
    .map((d) => d.messageCount)
    .filter((c) => c > 0)
    .sort((a, b) => a - b);
  if (counts.length === 0) return null;
  return {
    p25: counts[Math.floor(counts.length * 0.25)],
    p50: counts[Math.floor(counts.length * 0.5)],
    p75: counts[Math.floor(counts.length * 0.75)],
  };
}

// Activity level classification (0-4)
// deobfuscated.js:624674-624688
function getActivityLevel(messageCount, percentiles) {
  if (messageCount === 0 || !percentiles) return 0;
  if (messageCount >= percentiles.p75) return 4;
  if (messageCount >= percentiles.p50) return 3;
  if (messageCount >= percentiles.p25) return 2;
  return 1;
}

// Heatmap character mapping
// deobfuscated.js:624689-624705
function getHeatmapChar(level) {
  switch (level) {
    case 0: return chalk.gray("·");  // No activity
    case 1: return colorize("░");    // Low (< p25)
    case 2: return colorize("▒");    // Medium (p25-p50)
    case 3: return colorize("▓");    // High (p50-p75)
    case 4: return colorize("█");    // Very high (>= p75)
    default: return chalk.gray("·");
  }
}

// ─── Fun Fact Generator ─────────────────────────────────────────────────────
// deobfuscated.js:626719-626748
//
// Generates random "fun fact" comparisons like:
//   "You've used ~3x more tokens than The Great Gatsby"
//   "Your longest session is ~2x longer than a TED talk"

function generateFunFact(stats, totalTokens) {
  let facts = [];

  // Token comparisons
  if (totalTokens > 0) {
    let matchingBooks = TOKEN_COMPARISONS.filter((book) => totalTokens >= book.tokens);
    for (let book of matchingBooks) {
      let ratio = totalTokens / book.tokens;
      if (ratio >= 2) {
        facts.push(`You've used ~${Math.floor(ratio)}x more tokens than ${book.name}`);
      } else {
        facts.push(`You've used the same number of tokens as ${book.name}`);
      }
    }
  }

  // Duration comparisons
  if (stats.longestSession) {
    let durationMinutes = stats.longestSession.duration / 60000;
    for (let comp of DURATION_COMPARISONS) {
      let ratio = durationMinutes / comp.minutes;
      if (ratio >= 2) {
        facts.push(`Your longest session is ~${Math.floor(ratio)}x longer than ${comp.name}`);
      }
    }
  }

  if (facts.length === 0) return "";
  // Return a random fact
  return facts[Math.floor(Math.random() * facts.length)];
}

// ─── Stacked Area Chart (Models Tab) ────────────────────────────────────────
// deobfuscated.js:627068-627128
//
// Uses the `asciichart` library (vwq/e2q) to plot a stacked area chart of
// tokens per day, broken down by top 3 models.

function renderModelChart(dailyModelTokens, modelNames, terminalWidth) {
  if (dailyModelTokens.length < 2 || modelNames.length === 0) return null;

  let LABEL_WIDTH = 7;
  let chartWidth = terminalWidth - LABEL_WIDTH;
  let numPoints = Math.min(52, Math.max(20, chartWidth));

  // Resample data to fit chart width
  let data;
  if (dailyModelTokens.length >= numPoints) {
    data = dailyModelTokens.slice(-numPoints);
  } else {
    // Stretch data by repeating points
    let repeatFactor = Math.floor(numPoints / dailyModelTokens.length);
    data = [];
    for (let entry of dailyModelTokens) {
      for (let i = 0; i < repeatFactor; i++) data.push(entry);
    }
  }

  let theme = getThemeColors(getUserSettings().theme);
  let chartColors = [resolveColor(theme.suggestion), resolveColor(theme.success), resolveColor(theme.warning)];

  // Build series for top 3 models
  let series = [];
  let legend = [];
  let topModels = modelNames.slice(0, 3);
  for (let i = 0; i < topModels.length; i++) {
    let model = topModels[i];
    let values = data.map((d) => d.tokensByModel[model] || 0);
    if (values.some((v) => v > 0)) {
      series.push(values);
      legend.push({
        model: getShortModelName(model), // EP — friendly model name
        coloredBullet: colorize("●", [theme.suggestion, theme.success, theme.warning][i % 3]),
      });
    }
  }

  if (series.length === 0) return null;

  // Render using asciichart library
  let chart = asciichart.plot(series, {
    height: 8,
    colors: chartColors.slice(0, series.length),
    format: (val) => {
      let label;
      if (val >= 1000000) label = (val / 1000000).toFixed(1) + "M";
      else if (val >= 1000) label = (val / 1000).toFixed(0) + "k";
      else label = val.toFixed(0);
      return label.padStart(6);
    },
  });

  let xAxisLabels = renderXAxisLabels(data, data.length, LABEL_WIDTH);
  return { chart, legend, xAxisLabels };
}

// ─── React Components (Ink UI) ──────────────────────────────────────────────

// Wrapper component — loads data via React.use() (Suspense)
// deobfuscated.js:625832-625875
function StatsDialogWrapper({ onClose }) {
  let allTimePromise = loadAllTimeStats(); // Memoized via React Compiler
  return React.createElement(
    React.Suspense,
    { fallback: /* <Box><Spinner/> Loading your Claude Code stats…</Box> */ },
    React.createElement(StatsDialog, { allTimePromise, onClose }),
  );
}

// Main stats dialog component
// deobfuscated.js:625876-626176
//
// State:
//   - timePeriod: "all" | "7d" | "30d" (cycled with 'r' key)
//   - periodCache: {} — caches loaded data per period
//   - isLoading: bool — shows spinner while loading new period
//   - activeTab: "Overview" | "Models" (toggled with Tab key)
//   - copyStatus: null | "copying…" | "copied!" | "copy failed"
//
// Key bindings:
//   - Esc / ctrl+c / ctrl+d → close dialog
//   - Tab → toggle between Overview and Models tabs
//   - r → cycle time period (all → 7d → 30d → all)
//   - ctrl+s → copy stats to clipboard (macOS only, checked via E9/isMac)
//   - ↑/↓ → scroll model list (Models tab, when > 4 models)
//
// Layout:
//   <Box flexDirection="column" marginX=1 marginTop=1>
//     <TabView title="" color="claude" defaultTab="Overview">
//       <Tab title="Overview"> <OverviewTab stats dateRange isLoading /> </Tab>
//       <Tab title="Models">   <ModelsTab stats dateRange isLoading />   </Tab>
//     </TabView>
//     <Box paddingLeft=1>
//       <Text dimColor>Esc to cancel · r to cycle dates · ctrl+s to copy</Text>
//     </Box>
//   </Box>

// ─── Copy to Clipboard ──────────────────────────────────────────────────────
// deobfuscated.js:627157-627279

// Text formatters for clipboard copy (Q4z = Overview, U4z = Models)
// These produce plain-text representations with chalk styling for terminal paste

function formatOverviewForCopy(stats) {
  // deobfuscated.js:627188-627242
  let lines = [];
  let theme = getThemeColors(getUserSettings().theme);
  let highlight = (text) => colorize(text, theme.claude);

  if (stats.dailyActivity.length > 0) {
    lines.push(renderActivityHeatmap(stats.dailyActivity, { terminalWidth: 56 }));
    lines.push("");
  }

  let sortedModels = Object.entries(stats.modelUsage).sort(
    ([, a], [, b]) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens),
  );
  let topModel = sortedModels[0];
  let totalTokens = sortedModels.reduce((sum, [, u]) => sum + u.inputTokens + u.outputTokens, 0);

  if (topModel) {
    lines.push(formatRow("Favorite model", getShortModelName(topModel[0]), "Total tokens", formatNumber(totalTokens)));
  }
  lines.push("");
  lines.push(formatRow("Sessions", formatNumber(stats.totalSessions), "Longest session", stats.longestSession ? formatDuration(stats.longestSession.duration) : "N/A"));
  // ... current streak, longest streak, active days, peak hour
  lines.push("");
  lines.push(highlight(generateFunFact(stats, totalTokens)));
  lines.push(chalk.gray(`Stats from the last ${stats.totalDays} days`));
  return lines;
}

function formatModelsForCopy(stats) {
  // deobfuscated.js:627243-627279
  // Renders tokens-per-day chart + top 3 models with token breakdown
}

// ─── Cache Infrastructure ───────────────────────────────────────────────────

// Mutex lock for cache operations (prevents concurrent writes)
// deobfuscated.js:623726-623738
var cacheLockPromise = null; // vV6

async function withCacheLock(callback) {
  while (cacheLockPromise) {
    await cacheLockPromise;
  }
  let resolve;
  cacheLockPromise = new Promise((r) => { resolve = r; });
  try {
    return await callback();
  } finally {
    cacheLockPromise = null;
    resolve?.();
  }
}

// Cache read — reads stats-cache.json, validates version
// deobfuscated.js:623760-623794
function readStatsCache() {
  let fs = getFileSystem();
  let cachePath = getStatsCachePath(); // Awq
  try {
    if (!fs.existsSync(cachePath)) return emptyCacheObject(); // EV6
    let json = fs.readFileSync(cachePath, { encoding: "utf-8" });
    let parsed = JSON.parse(json);
    if (parsed.version !== CACHE_VERSION) return emptyCacheObject(); // kV6 = 2
    // Validate structure
    if (!Array.isArray(parsed.dailyActivity) || !Array.isArray(parsed.dailyModelTokens) ||
        typeof parsed.totalSessions !== "number" || typeof parsed.totalMessages !== "number") {
      return emptyCacheObject();
    }
    return parsed;
  } catch {
    return emptyCacheObject();
  }
}

// Cache write — atomic write (temp file + rename)
// deobfuscated.js:623795-623822
function writeStatsCache(data) {
  let fs = getFileSystem();
  let cachePath = getStatsCachePath();
  let tmpPath = `${cachePath}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    let dir = getCacheDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    let json = JSON.stringify(data, null, 2);
    writeFileSync(tmpPath, json, { encoding: "utf-8", mode: 0o600, flush: true });
    fs.renameSync(tmpPath, cachePath); // Atomic rename
  } catch (err) {
    logError(err);
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
  }
}
