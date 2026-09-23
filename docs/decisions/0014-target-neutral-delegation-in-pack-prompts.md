---
generated_by: claude
task: "0020 (#49)"
---

# 0014. Pack prompts delegate through a per-target helper, with the runner as fallback

Status: proposed
Date: 2026-09-23

## Context

The `core` pack is a pipeline of agents handing work to each other, and it installs into
five targets: `claude-code`, `codex`, `opencode`, `kilo-code` and `pi` (ticket 0020). The
prompt bodies were written in Claude Code's vocabulary — "via `Agent`, subagent_type
`reviewer`" — and `src/install.ts` patched them per target with a blind regex:
`\bAgent\b` became `task` (OpenCode, Kilo) or `Codex subagent` (Codex).

That regex rewrote every use of the word, not just the tool: the `Agent: implementer`
commit trailer that the `agent-attribution` skill requires became `task: implementer` or
`Codex subagent: implementer`, and `reviewer`'s attribution check looked for the wrong
trailer. It also never ran on skill files, so `chained-implementation` and
`idea-to-planned` told every target to use Claude Code's `Agent` tool.

What each target actually offers, checked against its documentation in September 2026:

| Target | Delegation | Waits for the result | Skills |
|---|---|---|---|
| claude-code | `Agent` tool (`subagent_type`) | yes | `Skill` tool |
| runner (`litecode run`, Pi's entry point) | `Agent` tool (`subagent_type`, `prompt`), recursive | yes | `Skill` tool |
| opencode | `task` tool (`subagent_type`) | yes | `skill` tool |
| kilo-code | `task` tool / `@name` | yes (foreground) | not documented |
| codex | spawn a custom agent by name | yes | `.agents/skills` convention |
| pi | none — no agents installed | — | — |

Codex's custom-agent spawning has open reports of nested spawning being limited and of
results not always reaching the parent.

## Decision

1. **The minimal contract a target must offer is tool execution plus a blocking
   delegation**: start another agent and get its result back in the same turn. Skills are
   optional — a target without them loses expert guidance, not the pipeline.
2. **Pack prompts name no harness's delegation tool.** They write
   `{{> delegate reviewer}}` inline, and `{{> delegation}}` once per delegating agent or
   skill. `src/delegation.ts` supplies the exact wording per target (`Agent`, `task`,
   Codex spawn-by-name, `litecode run`), including each harness's own built-in worker for
   `general-purpose`. The template engine gained a `{{> helper arg}}` form for this; an
   unknown helper, a malformed call, or delegating to an agent no installed pack provides
   fails the render, naming the file. The blind `Agent` rewrites in the
   Codex, OpenCode and Kilo renderers are gone, so the `Agent:` trailer and every other
   ordinary use of the word survive unchanged.
3. **When native delegation isn't available, the fallback is the project's own API runner,
   never doing the other agent's work inline.** `{{> delegation}}` tells the agent to run
   `litecode run <agent> --prompt-file <file>` via `Bash` (or `bunx litecodeagent run …`
   when `litecode` isn't on PATH) — synchronous everywhere — and,
   without `Bash` or a configured runner, to stop and say so. Pi, which has no subagents,
   delegates this way directly. The Codex planning workflow no longer says "otherwise
   follow its sequence directly".
4. **A test renders every pack file for every target** (`tests/targets-render.test.ts`)
   and fails on another harness's wording, an unrendered helper, a lost `Agent:` trailer,
   or a missing runner fallback.

## Consequences

- Review passes stay independent on every target: an agent that can't delegate
  falls back to another process, not to impersonating `reviewer` or `bug-hunter`.
- The runner fallback needs a configured `runner` block and an API key. Without them, a
  target that can't delegate stops with an explicit report instead of degrading silently.
- New delegation sites must use the helper. A literal "via `Agent`" in a pack prompt now
  fails the render test on the four non-Claude targets.
- **Known gap:** `orchestrator`, whose whole job is delegating, has no `Bash` (and runs
  read-only on Codex), so the runner fallback can't reach it. Where a harness forbids a
  sub-agent from starting another, it stops with an explicit report rather than
  degrading. This predates this ADR and needs its own decision.
- The per-target wording in `src/delegation.ts` encodes what each harness documents
  today. When a harness changes its delegation mechanism, that table is the one place to
  update.
