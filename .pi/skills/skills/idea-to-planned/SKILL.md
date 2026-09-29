---
name: idea-to-planned
description: Runs an idea to a Planned ticket via orchestrator, tracker, dispatcher. Only on explicit human instruction.
---

# Idea to Planned

This skill removes the per-step approval pauses between classification, ticket drafting, and backlog planning — but the human's instruction to invoke this skill, with the idea in hand, **is** the approval. It never runs speculatively, on a schedule, or without a human handing it a concrete idea in the current turn.

## Scope — where this stops

This skill takes an idea to a `Planned` ticket and nothing further. It never invokes `implementer`. Writing actual code is a separate, always-human-triggered step (see `chained-implementation` for that, invoked separately by name once the ticket is ready). Do not extend this skill's reach into implementation without the human explicitly asking for that broader scope.

## What you do

1. Invoke `orchestrator` (via `litecode run orchestrator --prompt-file <file>` via `Bash`) with the raw idea, exactly as you would for a normal recommendation request.
2. Read its output.
   - **If `BLOCKING_TENSION` is not "none"**: stop here. Do not invoke `tracker`. Surface the tension to the human — an unresolved tension between debate angles is exactly the kind of judgment call this pipeline was built to route to a human, not to paper over.
   - **If `SIZE` is trivial** (orchestrator skips straight to a one-paragraph description, no ADR): still proceed to `tracker` — trivial doesn't mean "not worth tracking," it means "didn't need the debate panel."
3. Invoke `tracker` (via `litecode run tracker --prompt-file <file>` via `Bash`) with the title/body/label/size/priority derived from `orchestrator`'s output — same as the manual flow, just without a separate confirmation round-trip first. Hand `tracker` `orchestrator`'s `PLAN`, requirements/`RECOMMENDATION`, `OPEN_QUESTIONS:` and `EPIC:` output verbatim (not your own paraphrase of it), so it can recopy the plan and requirements verbatim into the ticket's `## Plan` and `## Critères d'acceptation` sections per its own body contract (ticket 0035), and write any `OPEN_QUESTIONS:` in as `[À CLARIFIER]` lines (ticket 0043) — same as when a human manually asks for a ticket to be created.
4. Read `tracker`'s report. **If it says the ticket body carries a `[À CLARIFIER]` marker**: stop here, do not invoke `dispatcher` — `litecode ticket move <id> planned` refuses that transition outright while the marker is present, so dispatching it would just fail (or, worse, tempt a paraphrase around the refusal). Skip straight to step 6's report, and tell the human plainly: the ticket was drafted in `Backlog` with an open question still in its body, and only a human or `triage` removing the marker can unblock it into `Planned`. This is expected behavior, not a broken run.
5. Otherwise, invoke `dispatcher` (via `litecode run dispatcher --prompt-file <file>` via `Bash`) scoped to the newly drafted ticket — same pattern as `chained-implementation`'s dispatcher step: tell it explicitly which ticket to plan, not to run a full-backlog ranking pass.
6. Report back to the human: the ticket file path, its Status/Priority/Size, and whether it landed in `Planned`, stayed in `Backlog` because `dispatcher` judged something else should come first (report that ranking decision, don't override it), or stayed in `Backlog` because of an unresolved `[À CLARIFIER]` marker per step 4 (quote the open question(s), so the human knows exactly what to resolve).

## Delegating

Pi has no subagents, so every delegation here goes through `litecode run <agent> --prompt-file <file>` (or `bunx litecodeagent run …` if `litecode` isn't on your PATH) via `Bash`, which runs the agent through this project's configured API runner and waits for it. If the runner isn't configured, stop and say so in your report. Never do the other agent's work yourself in its place, and never write its report for it.

## Hard rule

Every invocation of this skill must originate from an explicit human instruction that includes the idea itself, in the current turn. It does not scan for ideas, does not run periodically, and does not chain into `implementer` under any circumstance — that boundary was deliberately kept human-gated and this skill does not change that.
