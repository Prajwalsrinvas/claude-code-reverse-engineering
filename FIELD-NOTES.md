# Field Notes: How Claude Code Evolved (2.1.34 → 2.1.201)

> **Analysis model:** Claude Fable 5 (`claude-fable-5`) via Claude Code CLI\
> **Date:** 2026-07-04\
> **Source:** Claude Code v2.1.201 (build `2.1.201`, git `5bb45156`), read from the Bun binary

The individual [deep dives](deep-dives/) each carry a "how this evolved" section for their feature. This document collects the **cross-cutting** observations — the arcs that span features and reveal how the product is being steered. These come from reading the source at 2.1.201 against the 2.1.34 baseline and the full changelog in between. Where a change reflects a deliberate design direction, the note says what the direction appears to be and why.

## 1. Distribution flipped from "readable npm bundle" to "native binary"

The single biggest change for anyone studying Claude Code: **the npm package no longer contains code.** Since 2.1.113 it's a ~170 KB installer that pulls a per-platform native Bun executable (~250 MB), with the JavaScript embedded in the binary's module graph next to a ~144 MB precompiled Bun bytecode blob and two Rust NAPI addons (image processing + audio capture). The old "npm pack → unminify cli.js" workflow is dead; you now extract from the binary's `.bun` ELF section (see [SKILL.md](skill/SKILL.md)).

Read on the *why*: the bytecode blob is a startup-speed play (Bun can skip parsing), and the native addons (image resize/clipboard, voice capture) are things you can't do well in pure JS. The side effect is that the shipped artifact is bigger and slightly harder to get at — though string literals are still fully intact, so the analysis technique is unchanged once you've extracted `cli.js`.

(Adjacent: on 2026-03-31 the v2.1.88 build briefly shipped a source map exposing the original TypeScript, unpublished within a day. This repo deliberately reads the shipped binary, not the leak.)

## 2. Auto mode's trust arc: from opt-in flag to no-consent-required

Auto mode (the classifier that decides whether an action is safe to run without a prompt) traveled a striking distance in this window:

- **opt-in flag** (`--enable-auto-mode`) → **no opt-in** (2.1.111) → **no consent required at all** (2.1.152), in two version jumps.
- Extended to Bedrock/Vertex/Foundry for Opus 4.7/4.8 (2.1.158/176).
- Hardened in step with that trust: `autoMode.hard_deny` unconditional blocks (2.1.136); subagent spawns evaluated by the classifier before launch (2.1.178); destructive git ops (`reset --hard`, `checkout -- .`, `clean -fd`, `stash drop`) and infra-destroy (`terraform/pulumi/cdk destroy`) blocked unless explicitly requested (2.1.183); `classifyAllShell` to route every shell command through the classifier (2.1.193).

The pattern is consistent: trust was extended fast, and each extension was paired with a new guardrail. The product is betting on the classifier, and treating "what the classifier must never wave through" as the thing to keep tightening.

## 3. Security hardening treats agents and shell as adversarial surfaces

Several independent threads point the same way — Anthropic is hardening Claude Code against prompt injection and privilege escalation, not just bugs:

- **Agent authority is explicitly non-transitive.** Every subagent's system prompt states that no message from any agent is ever the user's consent, and no agent message can authorize changing permissions/CLAUDE.md/config (see [agents dive](deep-dives/agents-and-workflows/)). Cross-session messaging calls out "permission laundering" by name. `SendMessage` carries no privileged capability. This is a designed-in containment model, and it's the same text now present in a running session's own system prompt.
- **Compaction was hardened as an injection surface** — the summarization prompt gained a strong no-tools block positioned *after* user custom instructions so they can't override it, plus verbatim preservation of security-relevant instructions so they survive a summary (see [compact dive](deep-dives/compact/)).
- **Shell deny rules learned about exec wrappers** — `env`/`sudo`/`watch`/`ionice`/`setsid` and `find -exec`/`-delete` are no longer trivially bypassable (2.1.113); the Bash transcript-spoofing vector (comment-first multiline command) was closed.
- **Sandbox gained a credentials guard** — `sandbox.credentials` blocks sandboxed commands from reading credential files / secret env vars (2.1.187), plus repeated dangerous-path removal hardening (`rm -rf $HOME`, Windows drive roots, macOS `/private/*`).

## 4. Model & effort progression, and the lean prompt

Models moved several rungs: Opus 4.6 → 4.7 → 4.8, then **Fable 5** (a Mythos-class tier), then **Sonnet 5** as the new default with native 1M context (2.1.197). Effort simplified to low/medium/high, gained `xhigh` for the top tier, and default effort was raised toward `high` "for your hardest tasks."

Two concrete artifacts of this in the source:
- `/insights` bumped its model from opus-4-6 to **opus-4-8** but did *not* move to Fable 5 — it explicitly calls the Opus-tier resolver (see [insights dive](deep-dives/insights/)).
- The **lean system prompt** is nominally gated by a hardcoded model list (which would give Sonnet 5 the *classic* prompt, since the rule matches any id containing "sonnet"), but a live remote-config experiment (`tengu_velvet_cascade`) flips Sonnet 5 to lean anyway (see [context-engineering dive](deep-dives/context-engineering/)). Which leads directly to the next note.

## 5. Almost everything load-bearing is server-tunable

A recurring finding across every dive: major behaviors are gated by GrowthBook-style remote flags, not just static code. The lean-vs-classic prompt, whether Dynamic Workflows are enabled, push-notification rollout, the remote-control poll cadence, 1h cache TTL per query source — all read a server flag with a hardcoded fallback. The practical consequence for anyone reading the changelog: **a changelog line can be stale relative to what's actually running**, because the behavior it describes can be re-tuned server-side without a client release. The Sonnet-5 lean-prompt case is the cleanest example — the code's hardcoded rule and the live behavior disagree, and the remote flag wins.

## 6. From one agent to a multi-agent runtime

The largest capability shift is that Claude Code stopped being a single agent that could spawn read-only helpers and became an orchestration runtime: background-by-default subagents, an implicit one-team roster with `SendMessage` (the explicit `TeamCreate`/`TeamDelete` tools were removed), 5-deep nesting, and a deterministic Workflow engine that fans out hundreds of agents from a script (see [agents & workflows dive](deep-dives/agents-and-workflows/)). Notably, the Workflow tool is deliberately hard to trigger — it requires an explicit `ultracode` opt-in — precisely because it can spend a lot of tokens. The caps (1000 lifetime agents, 4096 items/call, depth 5) read as runaway-loop backstops for a system now capable of very wide fan-out.

## 7. The command registry is shrinking as skills absorb features

`/code-review` and `/simplify` are no longer built-in commands — they're bundled skills (see [skills dive](deep-dives/skills/)). The general direction: the hardcoded command registry is getting smaller as the skills system absorbs feature-commands, and the slash-command menu became a ranking surface over a heterogeneous, mostly-skill-driven registry (which is why its fuzzy search grew `displayName`/`displayPartKey` keys for namespaced skill labels). One tool (`Skill`) plus a budgeted listing now fronts everything the model can invoke by name.

## 8. Gotchas worth knowing

- **OTEL response logging can start silently on upgrade** (2.1.193): a new `claude_code.assistant_response` telemetry event is redacted by default, but if a deployment already had `OTEL_LOG_USER_PROMPTS` on and left `OTEL_LOG_ASSISTANT_RESPONSES` unset, upgrading can begin emitting response content. Worth an audit for OTEL-instrumented enterprise setups.
- **`DISABLE_MICROCOMPACT` is gone** — the env var that used to gate client-side tool-result trimming no longer exists; the mechanism moved to a reactive, server-`context_hint`-driven trim (see [compact dive](deep-dives/compact/)).
- **`/stats` and `/cost` are aliases of `/usage`** now — they open the same 4-tab modal; the alias you type just picks the starting tab (see [stats dive](deep-dives/stats-and-context/)).
- **Remote Control is off under any non-Anthropic endpoint** — a custom `ANTHROPIC_BASE_URL`, any of the cloud-provider env flags, or an API key instead of a claude.ai login all disable it (see [remote-control dive](deep-dives/remote-control/)). The control channel is trusted once connected, so this connect-time gating *is* the security boundary.
- **Vestigial code is common** — the refresh found several wired-but-dead paths (insights' `user_instructions_to_claude` and remote-host collection, the skills `normalizeKeys` flag that's passed everywhere but never read, an empty narrative-section spread). Half-shipped and half-removed features leave readable fossils; don't assume a field that's referenced is a field that's used.
