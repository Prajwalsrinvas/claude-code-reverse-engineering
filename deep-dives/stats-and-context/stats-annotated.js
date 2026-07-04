// =============================================================================
// /stats (now /usage) Command — Annotated Source
// Source: Claude Code v2.1.201 (deobfuscated.js, 2026-07-04)
// Supersedes the v2.1.34 analysis in this same file.
// =============================================================================
//
// REALITY CHECK (do this first): /stats was NOT removed and its guts were NOT
// folded into /usage's cost logic. Instead, "stats", "cost", and "usage" are
// now three aliases of ONE command (name: "usage", aliases: ["cost","stats"])
// that opens the same Settings-style modal (rFe / deobfuscated.js:664446) with
// a defaultTab of "Stats" or "Usage" depending on which alias was typed:
//
//   defaultTab: r === "stats" ? "Stats" : "Usage"      (deobfuscated.js:730018)
//
// The modal (title "Settings dialog dismissed" on Esc) has 4 tabs: Status,
// Config, Usage, Stats. The "Stats" tab is exactly the old /stats content
// (heatmap, streaks, fun facts, Overview/Models sub-tabs) — it did not go
// anywhere, it is just reached through /usage's alias plumbing now. The old
// analysis's framing ("stats" is its own top-level jsx command) is CHANGED in
// form but not in substance: same UI, reached one alias-hop differently.
//
// There are still two runtime variants, gated by mr() = !isInteractive():
//   - local-jsx variant (name:"usage", immediate:true, thinClientDispatch:
//     "control-request") — used in the interactive TUI. deobfuscated.js:730166-730184
//   - local variant (name:"usage", supportsNonInteractive:true, isHidden when
//     interactive) — markdown/text output for `claude -p` / piped mode, folds
//     in cost + plan usage + "what's contributing to your limits" behaviors.
//     deobfuscated.js:730185-730199
// =============================================================================

// ─── Command Definitions ────────────────────────────────────────────────────
// deobfuscated.js:730166-730200

var usageJSXCommand = {
  type: "local-jsx",
  name: "usage",
  aliases: ["cost", "stats"],
  description: "Show session cost, plan usage, and activity stats",
  thinClientDispatch: "control-request",
  immediate: true,
  requires: { ink: true },
  load: () =>
    Promise.resolve().then(() => {
      initSettingsModalModule();
      return SettingsModalModule;
    }),
};

var usageTextCommand = {
  type: "local",
  name: "usage",
  aliases: ["cost", "stats"],
  supportsNonInteractive: true,
  description: "Show session cost, plan usage, and what's contributing to your limits",
  isEnabled: () => isNonInteractive(), // mr()
  get isHidden() {
    return !isNonInteractive();
  },
  load: () =>
    Promise.resolve().then(() => {
      initUsageTextModule();
      return UsageTextModule;
    }),
};

// The dispatcher that picks the modal's starting tab from which alias fired.
// deobfuscated.js:730010-730023
var SettingsModalModule = {};
uA(SettingsModalModule, { call: () => openSettingsModal });

var openSettingsModal = async (onClose, context, /* toolUseContext */ _t, aliasUsed) =>
  React.createElement(SettingsDialog, {
    onClose,
    context,
    defaultTab: aliasUsed === "stats" ? "Stats" : "Usage",
  });

// ─── Settings Dialog Shell — 4 tabs: Status / Config / Usage / Stats ───────
// deobfuscated.js:664446-664565 (rFe)
//
// Tab order in the JSX children array is [Status, Config, Usage, Stats]. The
// "Stats" tab (title: "Stats") renders <StatsTabContent onClose /> — this is
// the direct continuation of what v2.1.34 called the whole /stats command.
function SettingsDialog({ onClose, context, defaultTab }) {
  // ...header/close-confirmation wiring omitted (unchanged shell)...
  return TabbedPane({
    tabs: [
      { title: "Status", children: StatusTab({ context }) },
      { title: "Config", children: ConfigTab({ context, onClose }) },
      { title: "Usage", children: UsageTabContent() }, // deobfuscated.js:664533-664536 (bYl)
      { title: "Stats", children: StatsTabContent({ onClose }) }, // deobfuscated.js:664543-664548 (XYl)
    ],
  });
}

// ─── Stats Tab Content ──────────────────────────────────────────────────────
// deobfuscated.js:663019-663085 (XYl)

function StatsTabContent({ onClose }) {
  let allTimePromise = loadAllTimeStatsWithCache(); // qJf — kicked off once, cached in useState
  let activeTimePromise = loadActiveTimeStats(); // zJf
  return Suspense(
    { fallback: "Loading your Claude Code stats…" },
    StatsBody({ allTimePromise, activeTimePromise, onClose }),
  );
}

// ─── Stats Body: date-range switch, tabs, key handling ─────────────────────
// deobfuscated.js:663086-663394 (KJf)
//
// Sub-tabs: "Overview" (deobfuscated.js:663300, YJf) and "Models"
// (deobfuscated.js:663321, QJf) — UNCHANGED from v2.1.34 (same two tab names).
//
// Key handling (deobfuscated.js:663178-663193):
//   up          -> focus the outer tab header ("stats" vs "tabs" navigation)
//   r           -> cycle the date range (see TIME_PERIODS below)
//   ctrl+s      -> export current tab as a copied screenshot (see below).
//                  NOTE: no longer mac-only (see "Copy/Export" section).
// Footer hint text (deobfuscated.js:663360-663369):
//   "↓ stats" / "↑ tabs" · "r to cycle dates" · "ctrl+s to copy"
// — the old claim of a bare "Esc" hint and a mac-only ctrl+s annotation is
// GONE; the hint string itself carries no platform qualifier anymore because
// the copy path now works cross-platform (see below).

function StatsBody({ allTimePromise, activeTimePromise, onClose }) {
  let [dateRange, setDateRange] = useState("all"); // a / l
  let [rangeCache, setRangeCache] = useState({});   // u / d — per-range fetch cache
  let [selectedTab, setSelectedTab] = useState("Overview"); // m / g

  function onKeyDown(key) {
    if (key.up) { focusHeader(); return; }
    if (key.r && !key.ctrl && !key.meta) {
      setDateRange(cycleDateRange(dateRange)); // WJf
      return;
    }
    if (key.ctrl && key.s) {
      copyStatsScreenshot(currentStats, activeTimeStats, selectedTab, setStatusMessage, clock); // sQf
    }
  }
  // ...
}

// ─── Date Range Cycling ─────────────────────────────────────────────────────
// deobfuscated.js:664324-664329

var TIME_PERIOD_LABELS = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};
var TIME_PERIODS = ["all", "7d", "30d"]; // cycle order for 'r' key — UNCHANGED

// ─── Copy / Export (ctrl+s) — CHANGED: no longer mac-only ──────────────────
// deobfuscated.js:664193-664220 (sQf/iQf) build the text/asciichart export and
// append a right-aligned "/stats" watermark; deobfuscated.js:662294-662337
// (FYl/OJf) render it to a PNG screenshot and push it to the OS clipboard:
//
//   macOS:   osascript -e 'set the clipboard to (read (POSIX file ...))'
//   Linux:   xclip -selection clipboard -t image/png -i <file>   (NEW)
//   Windows: powershell -Command "[System.Windows.Forms.Clipboard]::SetImage(...)" (NEW)
//   other:   { success: false, message: "... not supported on <platform>" }
//
// deobfuscated.js:662356-662388. The v2.1.34 doc's "Ctrl+S (mac only)" claim
// is CHANGED — Linux and Windows clipboard-image paths now exist alongside
// the original AppleScript path.

// ─── Fun Facts: Book & Duration Comparisons — CONFIRMED unchanged ──────────
// deobfuscated.js:664341-664444

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
]; // 24 books, exact match to v2.1.34

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
]; // 10 durations, exact match to v2.1.34

// ─── GONE: speculative-decoding time-saved tracking ────────────────────────
// v2.1.34 tracked `entry.type === "speculation-accept"` and surfaced
// totalSpeculationTimeSavedMs. In v2.1.201 the raw-data loader (gur,
// deobfuscated.js:662435-662629) no longer reads that entry type at all, and
// its return object ends in a bare `...{}` spread (deobfuscated.js:662627) —
// a dead remnant of where that field used to be spliced in. Grepping the
// entire deobfuscated bundle for "speculation-accept" / "SpeculationTimeSaved"
// returns zero hits. This is a real removal, not a rename.

// ─── Overview Tab: streaks, heatmap, favorite model, peak hour ─────────────
// deobfuscated.js:664221-664260 (aQf) — CONFIRMED, same fields as v2.1.34:
//   Favorite model / Total tokens, Sessions / Longest session,
//   Current streak / Longest streak, Active days / Peak hour,
//   then the heatmap (TVo) and a "Stats from the last N days" footer.
// Streak calc (GYl, deobfuscated.js:662900+) — CONFIRMED unchanged algorithm.

// ─── Activity Heatmap ───────────────────────────────────────────────────────
// deobfuscated.js:661686-661752 (TVo) — CONFIRMED unchanged:
//   - up to 52 weeks x 7 days, GitHub-style grid
//   - month labels on top row, Sun/Mon/Wed/Fri row labels
//   - percentile buckets p25/p50/p75 (bJf, deobfuscated.js:661675-661685) map
//     message-count-per-day to one of 5 intensities (0..4)
//   - glyphs: 0 "·" (dim), 1 "░", 2 "▒", 3 "▓", 4 "█" — all in brand color
//     #da7756 except the empty dot (deobfuscated.js:661768-661789)

function dayIntensity(messageCount, percentiles) {
  if (messageCount === 0 || !percentiles) return 0;
  if (messageCount >= percentiles.p75) return 4;
  if (messageCount >= percentiles.p50) return 3;
  if (messageCount >= percentiles.p25) return 2;
  return 1;
}

// ─── Stats Cache — CHANGED: version bumped 2 -> 4, migration path added ────
// deobfuscated.js:661662-661665
//   var CACHE_VERSION = 4;        // rJe  — was 2 in v2.1.34
//   var CACHE_MIN_VERSION = 1;    // hJf  — oldest version still migratable
//   var CACHE_FILENAME = "stats-cache.json"; // yJf — unchanged path/name
//
// Migration (deobfuscated.js:661510-661534, wYl):
//   - if stored version !== CACHE_VERSION, attempt _Jf() migration (adds any
//     new fields with safe defaults, re-stamps version: CACHE_VERSION)
//   - if version < CACHE_MIN_VERSION or structurally invalid -> log + return a
//     fresh empty cache (EVo, deobfuscated.js:661474-661488) instead of
//     crashing
//   - successful migration is immediately persisted back to disk and logged:
//     "Migrated stats cache from v{old} to v{new}"
//
// NEW field in the cache schema: `shotDistribution` (deobfuscated.js:661486,
// 661507) is present in both the empty-cache shape and the migrated shape,
// but nothing in the file populates or reads it — it's a reserved/half-wired
// field, not yet surfaced in any UI.
//
// Atomic write + mutex — CONFIRMED unchanged:
//   - vYl (deobfuscated.js:661456-661470): a promise-chained in-process mutex
//     (not a cross-process lockfile) serializing read-modify-write cycles.
//   - Ttn (deobfuscated.js:661535-661548): writes via
//     Qs().atomicWrite(path, JSON.stringify(cache, null, 2), 384) — mode 384
//     decimal = 0o600.
//
// Incremental compute (FJf, deobfuscated.js:662787-662830) — CONFIRMED
// unchanged behavior: cache holds everything through *yesterday*;
// *today's* data is always recomputed fresh on every call and merged in
// (BJf, deobfuscated.js:662663-662763), never persisted to the cache.

var CACHE_VERSION = 4;
var CACHE_MIN_VERSION = 1;
var CACHE_FILENAME = "stats-cache.json";

// ─── Session File Discovery — CONFIRMED unchanged ──────────────────────────
// deobfuscated.js:662630-662662 (jYl)
//   ~/.claude/projects/*/*.jsonl (main session files) plus
//   ~/.claude/projects/*/**/subagents/agent-*.jsonl (subagent transcripts).

// ─── Raw Session Data Loader — CONFIRMED unchanged batch size ──────────────
// deobfuscated.js:662435-662629 (gur)
//   - reads files in batches of 20 (var BATCH_SIZE = 20 at deobfuscated.js:662449)
//   - skips a file early via mtime check when it predates `fromDate`
//   - subagent files (`.../subagents/...`) contribute to modelUsage/token
//     aggregation but are excluded from sessionStats/streak/heatmap counts
//     (the `!I` guards, where I = path includes "/subagents/")
//   - excludes the hidden/internal model id from modelUsage
//     (`if (V === px) continue` at deobfuscated.js:662587 — px is the same
//     hidden-model sentinel used elsewhere in the bundle)

// ─── Date-range dispatch (all / 7d / 30d) — CONFIRMED unchanged ───────────
// deobfuscated.js:662832-662849 (xVo): "all" goes through the cached path
// (FJf); "7d"/"30d" always do a fresh uncached gur() scan over the trailing
// N days and post-process via UJf (deobfuscated.js:662850-662889).
