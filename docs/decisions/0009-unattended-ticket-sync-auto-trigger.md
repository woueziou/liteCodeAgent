---
generated_by: implementer
task: "#31"
---

# 0009. Unattended `ticket sync --auto`: trigger, conflict handling, anti-runaway

Status: superseded by ADR 0012 (local-first tickets, lot 7/9)
Date: 2026-09-19

> **Note (2026-09-21):** parts of this ADR (the `--auto` trigger and anti-runaway
> cooldown) still describe live behaviour in `litecode ticket sync --auto`. But any
> conflict-handling reasoning here that assumed a live GitHub Project board (Status
> pushed/pulled against it) is stale — that mechanism was removed from the codebase
> entirely; `status` is now a plain local field never synced anywhere. Marked superseded
> wholesale rather than partially, to avoid leaving readers to guess which paragraphs
> still hold. See the forthcoming ADR 0012 for the current model.


> **Superseded (2026-09-23) by ADR 0015.** There is no ticket sync any more: tickets are
> purely local, so there is nothing to trigger. The text below is the historical record.

## Context

Issue #31 asks that the local ticket buffer sync itself "intelligently" instead of a human
having to type `litecode ticket sync --apply` every time. The ticket body explicitly flags
three sub-decisions as **not to be decided unilaterally** by whoever implements it: the
trigger mechanism, what happens when an unattended run hits a detect-and-block conflict,
and how to stop a failing trigger from retrying in a loop and burning `gh` quota.

The ticket originally also assumed `synced: false` carries lock semantics from ticket 0008
(the old numbering — issue #26). That ticket was closed "not planned" and never
implemented; the current code (`src/tickets/spec.ts`, `store.ts`, `sync.ts`) treats `synced`
as a plain dirty/pushed-or-not flag with no lock concept. `triage` re-scoped issue #31 to
drop that dependency (see the issue's edit history and
https://github.com/woueziou/liteCodeAgent/issues/31#issuecomment-5745408296); this ADR only
covers the three remaining, now-independent decisions.

Already-settled constraints this ADR does not re-derive: `applyTicketSync` returns a typed
`PerTicketResult[]` (ticket 0007 / issue #25, merged); conflict policy is detect-and-block,
never auto-resolved; `sync.ts` persists the ticket file after every mutation so a crash
mid-batch is resumable; ADR 0001 already sets a proactive delay between individual `gh`
calls within one sync run (`LITECODE_TICKET_SYNC_DELAY_MS`).

## Decision 1: trigger is a `--auto` flag on the existing command, not a new scheduler

`litecode ticket sync` gains a `--auto` flag rather than a standalone daemon, polling loop,
or a Claude-Code-hook-specific entry point. `--auto` implies `--apply` (an unattended dry
run accomplishes nothing) and is meant to be called wherever the ticket buffer already gets
dirtied or an agent's work session reaches a natural checkpoint — the same call sites
`github-project-sync` already documents for the `sync` agent ("after `tracker` drafts a
ticket, or on a schedule/human request"), now made safe to call opportunistically instead of
only on a human's say-so.

**Why not a Claude Code hook:** hooks live in the *calling* project's own
`.claude/settings.json` (see the `update-config` skill), a layer this CLI does not own or
control. Baking a hook registration into `litecode`'s own install step would blur who is
responsible for scheduling — this repo already treats that as the harness's job, not a
business-logic concern. `--auto` only supplies the safety rails (Decisions 2 and 3) that
make frequent, opportunistic calling non-destructive; *how often* to call it stays the
caller's decision, same as it already implicitly is for the `sync` agent today.

**Why not a time-based debounce inside the CLI itself:** a debounce needs a persistent
process to hold the timer, which a one-shot CLI invocation doesn't have. The cooldown in
Decision 3 achieves the same practical effect (no two runs closer together than
`autoMinIntervalMs`) without requiring `litecode` to run as a long-lived process.

## Decision 2: an unattended detect-and-block conflict is written to a local trace file, not (only) stdout

`ticket sync --auto` persists new or changed `plan.blockers` to
`tickets.autoStateFile` (default `.claude/data/ticket-sync-auto-state.json`), keyed by
ticket id, with `problem`, `fix`, `firstSeenAt`, `lastSeenAt`, and an `attempts` counter.
A blocker already recorded with the same `problem` on a prior run is not re-announced (only
`attempts`/`lastSeenAt` bump); a resolved blocker (no longer present in `plan.blockers`)
drops out of the trace on the next run.

**Why not a `gh issue comment`:** every blocker `planTicketSync` currently produces is a
pre-creation blocker (`ticket.issue` is still `undefined` — no board option exists yet for
the ticket's Priority/Size), so there is no GitHub issue to comment on yet. If a
content-conflict blocker on an *already-created* ticket is added later, that would need its
own decision (issue comment vs. trace file vs. both) — not assumed here.

**Why not a queue/notification:** nothing in this repo currently has a delivery channel for
proactive notification (no chat integration, no email). A durable local file that the next
`ticket list`/`ticket sync` invocation — human or agent — can inspect is the smallest thing
that actually satisfies "must not silently disappear," without inventing a delivery
mechanism this ADR has no mandate to design.

## Decision 3: anti-runaway is a persisted cooldown between whole `--auto` runs

`ticket sync --auto` reads `tickets.autoStateFile`'s `lastAttemptAt` before doing anything
else. If `now - lastAttemptAt < tickets.autoMinIntervalMs` (default 60_000ms, overridable
via `LITECODE_TICKET_AUTO_SYNC_MIN_INTERVAL_MS`), the run no-ops immediately — before
`ensureAuth()`, before any `gh` call — and exits 0. Otherwise it records the new
`lastAttemptAt` *before* touching `gh`, so a crash mid-run still counts as an attempt and
is still bounded by the same cooldown as an ordinary failure.

**Why this instead of relying on ADR 0001's per-call throttle:** `LITECODE_TICKET_SYNC_DELAY_MS`
paces individual `gh` calls *within* a run that has already started; it does nothing to stop
a caller from starting a brand-new run immediately after the previous one failed. The
runaway ticket #31 warns about is at the level of whole runs, not individual calls, so the
guard has to live at that level too.

**Why a fixed interval instead of exponential backoff:** the caller here is not `board/gh.ts`
reacting to a rate-limit response (that reactive backoff already exists and is untouched by
this change) — it's an unattended trigger deciding whether to *start* a new batch at all. A
fixed floor is simpler to reason about and configure per project, and composes with the
existing reactive backoff rather than duplicating it: proactive cooldown reduces how often
the reactive path is ever reached, same relationship ADR 0001 already describes between its
own proactive delay and `onGhRetry`.
