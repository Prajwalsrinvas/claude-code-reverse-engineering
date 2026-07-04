/**
 * Claude Code — Remote Control & claude.ai bridging
 * Reverse-engineered from v2.1.201 (deobfuscated.js, webcrack --no-jsx + prettier)
 * Source: /tmp/claude-code-npm/webcrack-output/deobfuscated.js (965,378 lines)
 * Date: 2026-07-04
 *
 * Identifiers below are renamed from the mangled originals for readability;
 * original names are noted inline as `// orig: X`. Line numbers refer to the
 * canonical deobfuscated.js. This file is a hand-annotated EXTRACT, not a
 * drop-in replacement — read it alongside the companion README.md.
 *
 * BIG PICTURE
 * There are (at least) two distinct bridging subsystems that both get called
 * "Remote Control" in user-facing strings:
 *
 *   1. REPL bridge ("bridge:repl") — a live WebSocket between a running local
 *      `claude` TUI process and claude.ai/code (web) or the mobile app. This
 *      is what `claude remote-control` / `--remote-control`/`--rc` starts.
 *      It carries "control_request" / "control_response" JSON frames.
 *
 *   2. Environment worker bridge ("bridge:api", "bridge:poll", "bridge:work")
 *      — an HTTP long-poll loop used by *headless cloud environments*
 *      (`claude.ai/code` background/cowork sessions, multi-session workers).
 *      This is the one whose poll interval changed ~300x (2.1.70).
 *
 *   3. Teleport (`--teleport`, `/teleport`) — DISTINCT from #1: moves a git
 *      checkout + task INTO a cloud environment (outbound) or pulls an
 *      existing cloud session back to the local machine (inbound resume).
 *      Confirmed independent of Remote Control by a literal client string:
 *      "--teleport sessions start without Remote Control. Use
 *      /remote-control to enable it." (line 959085).
 *
 * Both #1 and #2 are gated by the same "first-party Anthropic API + claude.ai
 * OAuth, not an API key" precondition (see GATING section). #3 shares the
 * claude.ai-account requirement but its own isEnabled()-style gate wasn't
 * isolated in this pass.
 */

// =========================================================================
// 1. REPL BRIDGE — CONTROL-REQUEST DISPATCH (thin-client callback style)
//    function Syc(e, t)  @ line 750935
//    This is the *callback-registration* flavor of the dispatcher: used when
//    the CLI process registers a fixed set of on* handlers (onSetModel,
//    onReadFile, onGetContextUsage, ...) rather than routing into full REPL
//    state. Seen from SDK-embedding hosts (IDE extension style thin clients).
// =========================================================================

function dispatchControlRequestThinClient(request, ctx) {
  // orig: Syc(e, t)  @ 750935
  let {
    transport: n,                 // orig: n — the bridge transport (WS wrapper), .write(frame)
    sessionId: r,
    outboundOnly: o,               // true => only "initialize" is answered; everything else rejected
    getInitializeState: s,
    onInterrupt: i,
    onDialogKindsDeclared: a,      // <- elicitation/dialog capability negotiation (2.1.76 elicitation-over-remote)
    onSetModel: l,
    onSetMaxThinkingTokens: c,
    onSetPermissionMode: u,
    onRenameSession: d,            // session-title sync -> rename_session control request
    onSetColor: p,
    onFileSuggestions: f,
    onReadFile: m,
    onGetContextUsage: g,          // get_context_usage -- same subtype /context and /usage dives found
    onGetUsage: h,
    onMcpAuthenticate: y,
    onMcpOauthCallbackUrl: _,
    onMcpReconnect: b,
    onMcpStatus: S
  } = ctx;

  if (!n) {
    log("[bridge:repl] Cannot respond to control_request: transport not configured"); // 750958
    return;
  }

  // outbound-only sessions reject everything except "initialize" (750962-750977)
  if (o && request.request.subtype !== "initialize") {
    sendControlResponse(n, r, errorResponse(request.request_id, OUTBOUND_ONLY_ERROR));
    log(`[bridge:repl] Rejected ${request.request.subtype} (outbound-only) request_id=${request.request_id}`);
    return;
  }

  switch (request.request.subtype) {           // 750979
    case "initialize":                          // 750980 — handshake; returns commands/agents/models/account/pid
    case "set_model":                            // 751009
    case "set_max_thinking_tokens":               // 751032
    case "set_permission_mode":                   // 751042
    case "rename_session":                        // 751068 — session-title control request
    case "set_color":                             // 751094 — session accent color
    case "file_suggestions":                      // 751120 — @-mention autocomplete over the wire
    case "read_file":                             // 751159 — remote sidebar file viewer, gated by Read-tool perms
    case "get_context_usage":                     // 751196 — /context breakdown for the remote client
    case "get_usage":                             // 751235 — /usage cost + plan rate-limit data
    case "mcp_status":                             // 751274
    case "mcp_authenticate":                       // 751286
    case "mcp_oauth_callback_url":                 // 751287
    case "mcp_reconnect":                          // 751288
    case "interrupt":                              // 751331 — remote Esc/Ctrl+C
      // each case: call the matching on* callback, then n.write({...response, session_id: r})
      // and log(`[bridge:repl] Sent control_response for ${subtype} request_id=... result=...`)
      break;
    default:                                       // 751341 — unrecognized subtype -> control_response error
  }
}

// =========================================================================
// 2. REPL BRIDGE — MAIN CONTROL-REQUEST SWITCH (full REPL, in-process)
//    Large `else if (yt.request.subtype === "...")` chain @ ~933390-935xxx
//    This is the *real* worker-side handler used when a whole `claude`
//    session is running as the remote worker (claude.ai/code web session,
//    cowork). It has a much larger surface than the thin-client callback
//    version above — confirms /rewind-over-remote, MCP passthrough, plan
//    reads, cwd changes, dialog rendering, elicitation, etc.
// =========================================================================

// Representative subset (see README.md "The control-request protocol" for the full list):
//
//   "mcp_status"            933390  -> mcpServers: On()
//   "get_binary_version"    933394  -> { version, buildTime }  (used by /version in --remote mode)
//   "get_context_usage"     933417  -> full WTt() context breakdown (same helper /context uses)
//   "list_models"           933442  -> selectable model catalog (thin client can't read its own worker's models)
//   "get_session_cost"      933450  -> formatted /usage text (thin-client /usage dialog)
//   "get_usage"             933454  -> structured usage + claude.ai rate-limit windows
//   "mcp_message"           933463  -> raw JSON-RPC passthrough to a connected MCP server transport
//   "rewind_files"          933470  -> xQc(user_message_id, appState, dry_run)   [[ /rewind file rewind, 2.1.191 ]]
//   "cancel_async_message"  933478  -> dequeue a pending async user message by uuid
//   "rewind_conversation"   933487  -> target_message_uuid; interrupt_if_running;
//                                      aborts in-flight turn (up to 10s wait, 20ms poll) then rewinds
//                                      [[ /rewind conversation-rewind over remote, 2.1.191 ]]
//
// Additional subtypes with full Zod schemas (924390-925050), not all wired
// into the excerpt read above but present in the shared schema module:
//   set_cwd (924777) — headless twin of /cd, with a needs_trust round-trip
//                      for untrusted directories (SDK hosts like Claude Desktop)
//   mcp_call (924636) — invoke an MCP tool with NO permission check
//                      ("control channel is trusted, same as other subtypes")
//   mcp_set_servers, mcp_reconnect, mcp_toggle
//   get_workspace_diff (924684) — thin-client /diff dialog
//   get_plan (924716) — thin-client plan-mode viewer
//   seed_read_state (924724) — cache-seeding for Edit validation across clients
//   hook_callback (924729)
//   reload_plugins / reload_skills (924749/924763)
//   register_repo_root (924769)
//   elicitation (924838) — MCP elicitation (user input) surfaced to SDK/remote consumer
//   request_user_dialog (924854) — generic blocking dialog render request
//                      ("Used by tools that previously rendered Ink JSX via
//                       setToolJSX with an onDone callback" — i.e. this IS
//                       the elicitation-over-remote-control mechanism)
//   submit_feedback, message_rated, oauth_token_refresh, host_auth_token_refresh
//   apply_flag_settings, get_settings, background_tasks, stop_task
//   set_mcp_permission_mode_override
//   keep_alive / control_cancel_request / update_environment_variables (frame types, not subtypes)

// =========================================================================
// 3. ENVIRONMENT WORKER POLL LOOP  (headless cloud/cowork bridge)
//    var tIt = {...}  @ 763984   /   function nUe() @ 763997
//    THIS is the "/poll rate cut ~300x, 1-2s -> 10min while connected" fix.
// =========================================================================

const DEFAULT_POLL_CONFIG = {                 // orig: tIt  @ 763986
  poll_interval_ms_not_at_capacity: 2000,             // 2s  (was reportedly ~1-2s pre-2.1.70)
  poll_interval_ms_at_capacity: 600000,               // 10 min  <-- the ~300x cut destination
  non_exclusive_heartbeat_interval_ms: 0,             // 0 = disabled by default
  multisession_poll_interval_ms_not_at_capacity: 2000,
  multisession_poll_interval_ms_partial_capacity: 2000,
  multisession_poll_interval_ms_at_capacity: 600000,
  reclaim_older_than_ms: 5000,
  session_keepalive_interval_v2_ms: 120000
};

function getBridgePollConfig() {              // orig: nUe()  @ 763997
  // GrowthBook-overridable; "tengu_bridge_poll_interval_config" feature flag,
  // falls back to DEFAULT_POLL_CONFIG, default-flag-value 300000 (unused
  // fallback for the flag call itself, not an actual interval).
  let remote = growthbookFlag("tengu_bridge_poll_interval_config", DEFAULT_POLL_CONFIG, 300000); // 763998
  let parsed = pollConfigSchema().safeParse(remote);
  return parsed.success ? parsed.data : DEFAULT_POLL_CONFIG;
}

// Poll driver, abbreviated from the loop @ 764911-764995:
async function bridgePollLoop(env, aborter, maxSessions, activeSessions) {
  while (!aborter.aborted) {
    let cfg = getBridgePollConfig();
    let work = await api.pollForWork(env, token, aborter, cfg.reclaim_older_than_ms); // 764914
    if (!work) {
      if (activeSessions.size >= maxSessions) {
        // AT CAPACITY: either heartbeat-poll on a short interval, or sleep
        // for poll_interval_ms_at_capacity (default 600000 = 10 min) —
        // this branch is the literal "poll while connected -> 10 min" path.
        if (cfg.non_exclusive_heartbeat_interval_ms > 0) {
          // heartbeat mode: loop calling a lightweight keepalive every
          // non_exclusive_heartbeat_interval_ms until capacity frees up
          // or poll_interval_ms_at_capacity elapses (764930-764968)
        } else if (cfg.multisession_poll_interval_ms_at_capacity > 0) {
          await sleep(cfg.multisession_poll_interval_ms_at_capacity, aborter); // 764971 -> default 600000ms
        }
      } else {
        // NOT AT CAPACITY: fast poll, default 2000ms (764975-764976)
        let interval = activeSessions.size > 0
          ? cfg.multisession_poll_interval_ms_partial_capacity
          : cfg.multisession_poll_interval_ms_not_at_capacity;
        await sleep(interval, aborter);
      }
      continue;
    }
    // ... dispatch work.data.type: "healthcheck", session work, etc. (765027+)
  }
}

// =========================================================================
// 4. PUSH NOTIFICATION TOOL
//    var wz = "PushNotification"  @ 297637
//    Tool object `xBf` @ 569251, module `gOl` @ 569221
// =========================================================================

const PushNotificationTool = {                // orig: xBf  @ 569251
  name: "PushNotification",                   // orig: wz
  searchHint: "send a notification to the user via terminal and optionally mobile",
  maxResultSizeChars: 1000,
  isEnabled() {
    return growthbookFlag("tengu_kairos_push_notifications", false, 300000);  // 569264
  },
  isReadOnly() { return true; },
  inputSchema: {                               // orig: wBf @ 569240
    message: "string, min 1 — notification body, keep < 200 chars (mobile OS truncates)",
    status: "'proactive' (literal)"
  },
  outputSchema: {                              // orig: CBf @ 569244
    message: "string",
    pushSent: "boolean?",
    localSent: "boolean?",
    disabledReason: "'config_off' | 'user_present' | 'no_transport' | undefined",
    sentAt: "ISO timestamp?"
  },
  async call({ message }, ctx) {               // 569300
    let isRemoteWorker = env.CLAUDE_CODE_REMOTE || isCloudSession();      // 569304, orig: i
    let hasRemoteOrLocalPresence = isRemoteWorker || hasLocalPresence();  // orig: a = i || NI()

    // config_off: local interactive session, user hasn't opted into agentPushNotifEnabled
    if (hasRemoteOrLocalPresence && !isRemoteWorker && !userSetting("agentPushNotifEnabled", false)) {
      return { disabledReason: "config_off", pushSent: false, localSent: false };  // 569315-569326
    }
    // user_present: terminal is active and watching -> a push would be redundant
    if (!isRemoteWorker && !env.CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK && isUserPresent()) {
      return { disabledReason: "user_present", pushSent: false, localSent: false }; // 569327-569337
    }
    emitOsNotification(message);               // 569339 — always fires the local terminal/OS notification path
    if (!hasRemoteOrLocalPresence) {
      // no_transport: Remote Control isn't connected, so there's no mobile
      // device to push to — local-only notification.
      return { disabledReason: "no_transport", pushSent: false, localSent: !ctx.isNonInteractiveSession };
    }
    return { pushSent: true, localSent: !ctx.isNonInteractiveSession, sentAt: new Date().toISOString() };
  }
};
// Setting gate: `agentPushNotifEnabled` in settings ("Allow Claude to push
// proactive mobile notifications") @ schema line 76460.

// =========================================================================
// 5. SCHEDULING — TWO SEPARATE MECHANISMS
// =========================================================================

// 5a. CronCreate / CronDelete / CronList — LOCAL, in-session or file-backed.
//     var qv = "CronCreate", XU = "CronDelete", hmt = "CronList"  @ 298731-298733
//     Tool objects @ 567488 (Create), 567609 (Delete), ~567679+ (List)
const CronCreateTool = {                      // orig: jNf @ 567488
  name: "CronCreate",
  inputSchema: {                              // orig: FNf @ 567476
    cron: "5-field cron expr, local time: 'M H DoM Mon DoW'",
    prompt: "string — prompt to enqueue at each fire",
    recurring: "boolean, default true. false = one-shot, auto-delete after firing",
    durable: "boolean — persist to .claude/scheduled_tasks.json vs session-only"
  },
  isEnabled() { return isSchedulingEnabled(); },     // orig: hO()  @ 567500
  async validateInput(input) {
    // max 50 concurrent scheduled jobs (m$l @ 567461)
    // durable crons rejected for teammates ("do not persist across sessions")
  },
  // Auto-expires: recurring jobs auto-expire after `ase` days (constant not
  // fully traced in this pass — see README.md "Open questions").
};
// CronDelete requires ownership match: `n.agentId !== r.agentId` -> rejected
// (567644-567650) — a cron job can only be cancelled by the agent that owns it.

// 5b. RemoteTrigger — CLOUD, hits claude.ai's routine/trigger API directly.
//     var cve = "RemoteTrigger"  @ 418725
//     Tool object `JNf` @ 567875 (note: reuses identifier JNf in a different
//     module scope than CronCreateTool above — webcrack per-module reuse)
const RemoteTriggerTool = {
  name: "RemoteTrigger",                      // orig: cve @ 418725
  description: "Manage scheduled remote Claude Code agents (routines) via the claude.ai CCR API. Auth is handled in-process — the token never reaches the shell.",  // 418726
  // Actions -> REST calls against claude.ai (418730-418736):
  //   list:   GET  /v1/code/triggers
  //   get:    GET  /v1/code/triggers/{trigger_id}
  //   create: POST /v1/code/triggers            (body required)
  //   update: POST /v1/code/triggers/{trigger_id} (partial body)
  //   run:    POST /v1/code/triggers/{trigger_id}/run
  isEnabled() {                                // 567886-567887
    return isFirstPartyAnthropicApi()           // orig: ic()
        && isClaudeAiOAuthAuthed()               // orig: Eo()
        && !env.CLAUDE_CODE_REMOTE               // not itself already a remote worker
        && growthbookFlag("tengu_surreal_dali", false)
        && orgPolicyAllows("allow_remote_sessions"); // orig: Vs("allow_remote_sessions")
  },
  maxResultSizeChars: 100000
};
// Result view: `${CLAUDE_AI_ORIGIN}/code/routines/${id}` (567826) — this is
// the literal "claude.ai/code/routines" URL from the security-rules prose.

// =========================================================================
// 6. GATING — WHEN REMOTE CONTROL IS DISABLED (security-relevant)
//    See README.md "The gating chain (security)" for the full precedence chain.
// =========================================================================

function isRemoteControlDisabledByOrgPolicy() {  // orig: Zon()  @ 791227
  return currentSettings()?.disableRemoteControl === true;
}

function isFirstPartyAnthropicApi() {           // orig: ic()  @ 120036
  return resolvedProvider() === "firstParty";   // orig: fr() — "bedrock"|"vertex"|"foundry"|"anthropicAws"|"mantle"|"firstParty"
}

function resolvedProvider() {                   // orig: fr()  (defs around 120015-120031)
  if (env.CLAUDE_CODE_USE_BEDROCK) return "bedrock";
  if (env.CLAUDE_CODE_USE_FOUNDRY) return "foundry";
  if (env.CLAUDE_CODE_USE_ANTHROPIC_AWS) return "anthropicAws";
  if (env.CLAUDE_CODE_USE_MANTLE) return "mantle";
  if (env.CLAUDE_CODE_USE_VERTEX) return "vertex";
  return "firstParty";
}

function isPointedAtFirstPartyBaseUrl() {       // orig: wwn()  @ 120079
  let base = env.ANTHROPIC_BASE_URL;
  if (!base) return true;
  return new URL(base).host === "api.anthropic.com";  // qce()  @ 120086
}

function isRemoteControlSocketEligible() {      // orig: Qon()  @ 791200
  if (!isFirstPartyAnthropicApi()) return false;
  return !!env.ANTHROPIC_UNIX_SOCKET || isPointedAtFirstPartyBaseUrl();
}

function isUsingApiKeyAuth() {                  // consulted via rGn() @ 791414-791444
  // Any of these being set routes auth through an API key instead of OAuth,
  // which disqualifies Remote Control (2.1.126):
  //   env.ANTHROPIC_API_KEY
  //   apiKeyHelper (settings)
  //   env.ANTHROPIC_AUTH_TOKEN
  //   env.ANTHROPIC_UNIX_SOCKET  (claude ssh remote, local proxy is API-key-authed)
}

function isClaudeAiOAuthAuthed() {              // orig: EIt()  @ 791453 -> Eo()  @ 171225
  if (!isUsingOAuthNotApiKey()) return false;    // orig: CS()
  return hasRequiredOauthScopes(oauthConfig()?.scopes); // H4()
}

function isRemoteControlOrgPolicyAllowed() {    // orig: qnn()  @ 791503
  try { return growthbookFlagBool("allow_remote_control") ? "allowed" : "denied"; }
  catch { return "unavailable"; }
}

// Full precedence chain (fgr() @ 791248 — "getBridgeDisabledReason"), in order:
//   1. isRemoteControlSocketEligible() false -> "only available via api.anthropic.com"
//   2. isCloudSession() (ZU() @ 791527: env.CLAUDE_CODE_REMOTE || na()) -> "not available inside a cloud session"
//   3. disableRemoteControl managed setting -> org policy message
//   4. Zhr() (has claude.ai inference scope) false -> "requires a claude.ai subscription"
//   5. EIt() (OAuth+scopes) false -> "requires claude.ai subscription auth" (API key / setup-token detail via rGn())
//   6. eyr() (has user:profile scope) false -> "requires a full-scope login token" (setup-token / OAUTH_TOKEN are inference-only)
//   7. no organizationUuid -> "unable to determine your organization"
//   8. qnn() === "denied" -> org compliance policy block (Yce() lists reasons)
//   9. GrowthBook unavailable ($5()) -> feature-flag evaluation disabled (DISABLE_GROWTHBOOK, or telemetry-disabled reason)
//  10. "tengu_ccr_bridge" rollout flag false -> "not yet enabled for your account"

// =========================================================================
// 7. SESSION TITLE / FOOTER STATE SYNC
// =========================================================================
// - `rename_session` control request (924438-924441, dispatch @ 751068 and
//   933509-ish) sets session_title; hooks can also supply `hookSpecificOutput.sessionTitle`
//   (628376/628385/630275-630278) which gets applied and cached (779220).
// - `initialize` response schema (924390-924403) carries `current_model` /
//   `current_permission_mode` explicitly so a *newly connecting* remote
//   client (phone) syncs its dropdowns TO the running session instead of
//   overwriting it — comment cites bug CC-2659 ("connecting from a phone
//   silently switches the terminal's model").

// =========================================================================
// 8. TELEPORT — session/work handoff to a cloud environment
//    `--teleport [session]` CLI flag @ 960545; `/teleport` command
//    @ 704432/729682/742647. Distinct feature from Remote Control (#1).
// =========================================================================

// Outbound: send the current local session/task to a cloud environment.
async function teleportToRemote(opts) {          // orig: $V  @ ~510518 (see also _Oo wrapper)
  await assertGitWorkingDirClean();               // yOo()  @ 510607 — 510611: throws unless clean
  //   "Git working directory is not clean. Please commit or stash your
  //   changes before using --teleport." — interactive stash offer also
  //   exists (508143-508210: "Would you like to stash these changes and
  //   continue with teleport?").
  await assertClaudeAiAccount();                  // "Teleport requires a Claude.ai account." (508353, 729313)

  logPhase("env-select");                         // 511529
  let env = opts.environmentId ?? (await autoCreateDefaultCloudEnv());  // teleport_default_environment_create @ 428369
  logPhase("branch-detect");                      // 511583
  logPhase("bundle-upload");                       // 511652 — only when the repo can't just be fetched fresh
  //   git-bundle upload with fallback strategies (510378-510474):
  //     fallback_head | fallback_squashed
  //   fails fast: "Repo is too large to teleport" (511672)
  logPhase("POST-sent");                           // 511762
  logPhase("POST-response");                       // 511768 — status=${W.status}
}

// Inbound: resume/pull an existing cloud session back to the local machine.
async function teleportResumeCodeSession(sessionId) {  // orig: YYe  @ 510519
  let sessions = await listTeleportSessions();     // teleport_sessions_list -> GET /v1/code/sessions (181076-181129)
  // repo-mismatch guard (510867-510878, dialog @ TeleportRepoMismatchDialog 918462-918567):
  //   "You must run claude --teleport {id} from a checkout of {repo}."
  // host-unverified guard: TeleportHostUnverifiedDialog (918608-918672)

  await checkOutTeleportedSessionBranch(branchFromCloud);  // orig: vXt  @ 510705
  //   git fetch origin <branch> -> git checkout <branch>
  //   (falls back to checkout -b --track origin/<branch>, 510616-510695)
  //   then sets upstream tracking (510646-510671)

  setTeleportedSessionInfo({ isTeleported: true, hasLoggedFirstMessage: false }); // 4181-4192
  // purely for first-turn telemetry: tengu_teleport_first_message_error/success (608943-609389)
}

// Confirms Teleport and Remote Control are orthogonal (959080-959099):
//   if (isCloudSession())       -> "Remote Control is not available inside a cloud session."
//   else if (isTeleportSession) -> "--teleport sessions start without Remote Control. Use /remote-control to enable it."
//   else                        -> normal getBridgeDisabledReason() chain

// Bridge teardown-reason schema comment (923999) explicitly lists Teleport as
// a first-class graceful-handoff path, alongside /update and daemon respawn:
//   "handoffs (/update, /teleport, respawn), auto-disable, mode transitions,
//    and internal fatal-error paths emit nothing by design"

// Ultraplan uses Teleport as its cloud-refinement handoff primitive (847555,
// 719016-719067): the local session tells the user "I have the option to
// teleport the plan back here for implementation post-approval," and the
// cloud-side plan-mode prompt recognizes a sentinel in rejection feedback —
// `__ULTRAPLAN_TELEPORT_LOCAL__` — meaning "stop revising, the plan has
// already been teleported back to the user's terminal."
