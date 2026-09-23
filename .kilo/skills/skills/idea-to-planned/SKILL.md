---
name: idea-to-planned
description: Takes a raw idea/feature/bug report and runs it all the way to a Planned ticket — orchestrator (classify/debate/plan) → tracker (draft the ticket locally) → dispatcher (Backlog→Planned) — chained with no approval pause in between. Use when a human explicitly says to just "do it and dispatch it" / "handle this end to end" for a specific idea, without wanting to confirm each step. Never triggers on its own — always requires an explicit human instruction carrying the idea itself.
---

# Idea to Planned

This skill removes the per-step approval pauses between classification, ticket drafting, and backlog planning — but the human's instruction to invoke this skill, with the idea in hand, **is** the approval. It never runs speculatively, on a schedule, or without a human handing it a concrete idea in the current turn.

## Scope — where this stops

This skill takes an idea to a `Planned` ticket and nothing further. It never invokes `implementer`. Writing actual code is a separate, always-human-triggered step (see `chained-implementation` for that, invoked separately by name once the ticket is ready). Do not extend this skill's reach into implementation without the human explicitly asking for that broader scope.

## What you do

1. Invoke `orchestrator` (via the `task` tool, targeting the `orchestrator` subagent) with the raw idea, exactly as you would for a normal recommendation request.
2. Read its output.
   - **If `BLOCKING_TENSION` is not "none"**: stop here. Do not invoke `tracker`. Surface the tension to the human — an unresolved tension between debate angles is exactly the kind of judgment call this pipeline was built to route to a human, not to paper over.
   - **If `SIZE` is trivial** (orchestrator skips straight to a one-paragraph description, no ADR): still proceed to `tracker` — trivial doesn't mean "not worth tracking," it means "didn't need the debate panel."
3. Invoke `tracker` (via the `task` tool, targeting the `tracker` subagent) with the title/body/label/size/priority derived from `orchestrator`'s output — same as the manual flow, just without a separate confirmation round-trip first. Populate the ticket body with the plan/recommendation `orchestrator` returned, same as when a human manually asks for a ticket to be created.
4. Invoke `dispatcher` (via the `task` tool, targeting the `dispatcher` subagent) scoped to the newly drafted ticket — same pattern as `chained-implementation`'s dispatcher step: tell it explicitly which ticket to plan, not to run a full-backlog ranking pass.
5. Report back to the human: the ticket file path, its Status/Priority/Size, and whether it landed in `Planned` or stayed in `Backlog` (if `dispatcher` judged something else should come first — report that ranking decision, don't override it).

## Delegating

Every delegation is blocking: wait for the other agent's result in the same turn before going on. If you can't delegate natively here (no subagent mechanism in this session, or you are yourself running as a subagent that isn't allowed to start another), write the request to a temporary file and run `litecode run <agent> --prompt-file <file>` (or `bunx litecodeagent run …` if `litecode` isn't on your PATH) via `Bash`: it runs that agent through this project's configured API runner (`runner` in `litecode.config.json`), waits for it, and prints its report. If you have no `Bash`, or the runner isn't configured, stop and say so in your report. Never do the other agent's work yourself in its place, and never write its report for it.

## Hard rule

Every invocation of this skill must originate from an explicit human instruction that includes the idea itself, in the current turn. It does not scan for ideas, does not run periodically, and does not chain into `implementer` under any circumstance — that boundary was deliberately kept human-gated and this skill does not change that.
