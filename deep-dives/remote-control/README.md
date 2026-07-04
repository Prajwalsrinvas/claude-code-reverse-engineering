# How Claude Code's Remote Control & claude.ai Bridging Works

> **Analysis model:** Claude Fable 5 (`claude-fable-5`) via Claude Code CLI\
> **Date:** 2026-07-04\
> **Source:** Claude Code v2.1.201, extracted from the Bun standalone binary, unminified with webcrack (`--no-jsx`) + prettier\
> **Annotated files:** `remote-control-annotated.js`\
> **Build:** `2.1.201`, git `5bb45156`

Remote Control lets a phone or browser drive a running local `claude` session, and lets cloud environments run Claude Code as a background worker. This dive covers the client-side machinery: the two bridge transports, the control-request protocol, poll timing, push notifications, scheduling, teleport, and — most importantly — the multi-condition gating chain that decides when any of this is even allowed to turn on. Everything here is **client-side evidence**; what claude.ai's backend does with these requests isn't visible from the binary and is flagged as such.

## Table of Contents

1. [Two bridges](#two-bridges)
2. [The control-request protocol](#the-control-request-protocol)
3. [Poll intervals (the ~300× cut)](#poll-intervals-the-300-cut)
4. [Push notifications](#push-notifications)
5. [Scheduling: Cron vs RemoteTrigger](#scheduling-cron-vs-remotetrigger)
6. [Teleport](#teleport)
7. [The gating chain (security)](#the-gating-chain-security)
8. [Open questions](#open-questions)

---

## Two bridges

Two distinct transports share the "Remote Control" branding:

- **REPL bridge** (`bridge:repl`) — a live **WebSocket** between a running local TUI and claude.ai/mobile (confirmed by `tengu_bridge_repl_ws_connected` / `_ws_closed` telemetry). Frames are JSON tagged `control_request` / `control_response` / `user`. This is what lets a phone drive your terminal.
- **Environment worker bridge** (`bridge:api` / `bridge:poll`) — **HTTP polling**, for cloud environments running Claude Code as a worker. A worker registers (`POST /v1/environments/bridge` with machine name, directory, branch, repo URL, max sessions), long-polls for work (`GET …/work/poll`), acks (`…/work/{id}/ack`), and stops (`…/work/{id}/stop`).

There's also a **peer directory** (`bridge:peers`): `GET /v1/sessions` lists other active sessions the user owns, and a post-message endpoint delivers a cross-machine `SendMessage` to a peer session — gated by the `isolatePeerMachines` setting ("Require explicit approval before SendMessage can reach a peer session on another machine").

The REPL bridge has two dispatcher implementations: a thin-client callback style (a fixed set of `on*` handlers, for SDK-embedding hosts) and a full-REPL style (a large subtype switch, for when an entire `claude` session is the remote worker — this is where `/rewind`, `set_cwd`, MCP passthrough, and dialog forwarding live).

## The control-request protocol

Control requests are typed by a `subtype`. The thin-client dispatcher handles a smaller set; the full-REPL dispatcher adds many more. The full recognized set includes:

`initialize`, `set_model`, `set_max_thinking_tokens`, `set_permission_mode`, `rename_session`, `set_color`, `file_suggestions`, `read_file`, `get_context_usage`, `get_usage`, `mcp_status`, `mcp_authenticate`, `mcp_reconnect`, `interrupt`, `set_cwd`, `mcp_call`, `mcp_set_servers`, `mcp_toggle`, `get_workspace_diff`, `get_plan`, `reload_plugins`, `reload_skills`, `elicitation`, `request_user_dialog`, `apply_flag_settings`, `get_settings`, `background_tasks`, `stop_task`, `list_models`, `get_session_cost`, `rewind_files`, `rewind_conversation`, and more.

Two schema comments are unusually revealing:

- **`mcp_call`**: *"Invokes an MCP tool via the subprocess MCP client without a model turn. No permission check (control channel is trusted, same as other subtypes)."* — the entire control channel is a **trusted-caller surface** once connected; most subtypes carry no extra per-request permission prompt. This is why the gating chain (below) is where the security actually lives.
- **`get_context_usage` / `initialize`**: the response carries `current_model` and `current_permission_mode` so *"Remote Control clients sync their model dropdown TO this value on connect instead of sending set_model with their own default — without it, connecting from a phone silently switches the terminal's model (CC-2659)."* A real bug the field was added to fix.

Concrete features that ride this protocol: `set_cwd` is "the headless twin of `/cd`" (with a `needs_trust` round-trip for untrusted directories); `request_user_dialog` / `elicitation` serialize a dialog to the remote host and return `{behavior, result}` (this is what makes "elicitation over Remote Control", 2.1.76, concrete); and `rewind_conversation` aborts an in-flight turn (polling up to 10s) before rewinding — the pre-`/clear` resume feature (2.1.191) working remotely.

## Poll intervals (the ~300× cut)

The environment-worker poll config (`deobfuscated.js:763984`), server-overridable via `tengu_bridge_poll_interval_config` with these hardcoded defaults:

```js
{
  poll_interval_ms_not_at_capacity: 2000,     //  2s  — room for more work
  poll_interval_ms_at_capacity:     600000,   // 10min — fully connected/busy
  non_exclusive_heartbeat_interval_ms: 0,     // optional liveness ping, off by default
  reclaim_older_than_ms: 5000,                // server reclaims orphaned work after 5s
  session_keepalive_interval_v2_ms: 120000,   // 2min keepalive
}
```

This is the 2.1.70 "~300× cut" made concrete: **2s fast-poll while there's capacity, 10-minute slow-poll once at capacity** (2000 → 600000 is exactly 300×). The pre-2.1.70 "1–2s always" baseline isn't a constant in this build — only the post-fix tiers exist.

## Push notifications

The `PushNotification` tool (`deobfuscated.js:569251`, added 2.1.110), gated by the `tengu_kairos_push_notifications` rollout flag. Input is `{ message (<200 chars — "mobile OSes truncate"), status: "proactive" }`. It reports a `disabledReason` when it can't push:

- `config_off` — the user hasn't enabled `agentPushNotifEnabled`.
- `user_present` — the terminal is actively watched, so a push would be redundant (overridable via `CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK`).
- `no_transport` — Remote Control isn't connected, so there's no phone to reach.

The **local** terminal/OS notification always fires (subject to those gates); only the **mobile push** leg depends on Remote Control connectivity plus the setting.

## Scheduling: Cron vs RemoteTrigger

Two separate scheduling mechanisms, and the split is security-relevant enough that the harness's own safety classifier documents it:

- **CronCreate / CronDelete / CronList** — **local** scheduling. `CronCreate` takes `{ cron, prompt, recurring?, durable? }`. `recurring: false` is one-shot (auto-deletes after firing); `durable: true` persists to `.claude/scheduled_tasks.json`, otherwise it's session-only. Capped at 50 concurrent jobs; a job can only be cancelled by the agent that created it; `durable` crons are rejected for teammates ("teammates do not persist across sessions").
- **RemoteTrigger** — **cloud** scheduling via the claude.ai CCR API (`/v1/code/triggers`), surfaced at `claude.ai/code/routines`. Its description notes "Auth is handled in-process — the token never reaches the shell." Its `isEnabled` is a five-way AND: first-party API, claude.ai OAuth with scopes, not itself a remote worker, a rollout flag, and an org policy flag.

## Teleport

Teleport is a distinct cloud feature (not the same as Remote Control), confirmed by a literal string: *"--teleport sessions start without Remote Control. Use /remote-control to enable it."* Where Remote Control lets a phone drive a *local* session, **Teleport moves a unit of work — a git checkout plus a session — into a cloud environment**.

- **Outbound** (`--teleport`): requires a clean git working directory (with an interactive stash-and-continue prompt otherwise) and a claude.ai account. It uploads a **git bundle** of local changes when the repo can't be fetched fresh, can auto-create a default cloud environment, and fails fast with "Repo is too large to teleport" past a size cap.
- **Inbound** (`claude --teleport <session-id>` or `/teleport`): pulls a cloud session back down, fetching and checking out its branch locally. It refuses to resume into an unrelated checkout ("You must run claude --teleport {id} from a checkout of {repo}") and has a second dialog for unverifiable git hosts.

Teleport also doubles as the **plan handoff** primitive: an "Ultraplan" plan sent for remote refinement is returned to the terminal via a `__ULTRAPLAN_TELEPORT_LOCAL__` sentinel that tells the cloud agent to stop and respond only "Plan teleported. Return to your terminal to continue." The bridge teardown enum lists `/teleport` (alongside `/update` and respawn) as an intentional, silent-by-design worker-lifecycle handoff.

## The gating chain (security)

This is the security-relevant core. Because the control channel is trusted once connected (no per-request permission prompt for most subtypes), the protection is entirely in **whether the bridge is allowed to connect at all**. `getBridgeDisabledReason` (`deobfuscated.js:791248`) is a 10-condition precedence chain, each short-circuiting to a specific message:

| # | Requirement to pass | If it fails |
|---|---------------------|-------------|
| 1 | **First-party provider only** — none of `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`/`_FOUNDRY`/`_ANTHROPIC_AWS`/`_MANTLE`, and `ANTHROPIC_BASE_URL` unset or exactly `api.anthropic.com` | "Remote Control is only available when using Claude via api.anthropic.com." |
| 2 | Not inside a cloud session | "not available inside a cloud session" |
| 3 | `disableRemoteControl` setting not true | "disabled by your organization's policy" |
| 4 | OAuth token has the claude.ai inference scope | "requires a claude.ai subscription" |
| 5 | Using OAuth, **not** an API key / `apiKeyHelper` / `ANTHROPIC_AUTH_TOKEN` | "using API-key auth — unset it" |
| 6 | Full-scope login (not a `setup-token` / inference-only token) | "requires a full-scope login token" |
| 7 | Org resolvable from the account | "Unable to determine your organization" |
| 8 | `allow_remote_control` org compliance flag | org compliance-policy denial |
| 9 | Feature-flag service reachable | "feature-flag evaluation disabled/unavailable" |
| 10 | `tengu_ccr_bridge` rollout flag | "not yet enabled for your account" |

Conditions #1 and #5 are the ones that match the changelog's security notes exactly: Remote Control is off whenever a non-Anthropic base URL or a cloud provider (Bedrock/Vertex/Foundry/…) is in play (2.1.181/197), and off whenever an API key or auth token is set instead of a claude.ai login (2.1.126). Verified directly: the base-URL check (`deobfuscated.js:120086`) is literally `new URL(baseUrl).host === "api.anthropic.com"`.

Managed-settings controls: `disableRemoteControl` (hard off switch, typically a managed setting), `remoteControlAtStartup` (auto-start toggle), and `isolatePeerMachines` (require approval before cross-machine SendMessage). A `getBridgeDoctorInfo` diagnostic walks the same 10 points with per-item `ok` booleans.

## Open questions

Client-side analysis can't see the server, so several things are genuinely opaque:

1. **Server-side behavior** — what claude.ai does with `/v1/environments/bridge`, `/v1/code/triggers`, or how `worker_jwt`/`worker_epoch` are validated is invisible from the binary.
2. **Code-sessions vs environment-worker orchestration** — both the `/v1/code/sessions` API and the `/v1/environments/bridge` worker API exist client-side, but how a code session attaches to an environment wasn't traced.
3. **WebSocket reconnect/backoff schedule** — the connect/close/reconnect telemetry exists, but no specific backoff constants were located.
4. **Pre-2.1.70 poll baseline** — the "1–2s always" figure is only in the changelog; the current build shows only the post-fix tiers.
