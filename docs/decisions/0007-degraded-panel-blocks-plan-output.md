---
generated_by: implementer
task: "#29"
---

# 0007. A degraded debate panel blocks `orchestrator`'s plan output, structurally

Status: proposed
Date: 2026-09-19

## Context

`orchestrator` coordinates `classifier`, `panel-selector`, `debate-angle` (once per
selected angle), and `synthesizer` before handing a synthesized recommendation to
`planner`. The harness relay between a sub-agent and its caller can silently drop or
garble a hand-back — the sub-agent runs and produces a real result, but what actually
reaches the caller is empty, truncated, or unreadable.

Two same-day occurrences (session logs referenced in issue #29) showed `orchestrator`
absorbing that loss invisibly: when `classifier`'s or a `debate-angle`'s hand-back didn't
arrive legibly, `orchestrator` substituted its own judgment (its own size estimate, its own
paraphrase of a lost angle's position) and rendered a plan of normal shape — a classification
and a two-of-three-angle debate that were never actually validated by anyone but
`orchestrator` itself. In both cases, the only reason the degradation was caught at all was
an agent choosing to mention it in free prose at the end of an unrelated report (once in
`orchestrator`'s own closing note, once surfacing only during `implementer`'s work in ADR
0006, written after the ticket the degraded plan produced had already been tracked and
picked up). Root-causing the relay loss itself is out of scope — it is plausibly a harness
transport issue, not something fixable in this repo's agent prompts — but presenting a
degraded panel as an ordinary one is fully within scope, and is the actual failure this ADR
addresses.

The repository owner has already ruled on the central trade-off directly in the ticket: a
degraded panel **blocks** plan output; it does not merely get annotated and passed through.
What's left to decide is the mechanism.

## Decision 1: a mandatory `PANEL:` sentinel, not a note in prose

`orchestrator`'s output already carries fixed sentinel lines (`SIZE:`, `BLOCKING_TENSION:`,
`ADR:`) that the calling session is expected to parse and relay mechanically, not read as
free text. Panel completeness gets the same treatment: a new `PANEL: complete` /
`PANEL: degraded (<detail>)` line, always present, never conditional on whether
`orchestrator` "remembers" to mention it.

**Alternative considered and rejected: keep it as an optional closing note.** This is the
status quo the ticket was filed against. It already failed twice in one day specifically
because it depends on an agent's discretion, not its output contract — a free-text note is
something a reader can skim past, and something an agent under pressure to "just finish" can
omit without violating any explicit rule. A required sentinel is checkable structurally by
the calling session (and, eventually, by tooling) in a way prose never is.

## Decision 2: legibility is checked per hand-off, against each sub-agent's own sentinel contract

Every sub-agent in the panel (`classifier`, `panel-selector`, each `debate-angle`,
`synthesizer`) already has a fixed output contract of its own (`SIZE:`/`ROUTE:`,
`ANGLES:`/`REASON:`, `ANGLE:`/`VERDICT:`/`POSITION:`, `STATUS:`/`SUMMARY:` respectively).
"Degraded" is defined as: the expected sentinel fields for that specific sub-agent are
missing, empty, or the response is otherwise not parseable as that shape. This reuses
contracts each agent's prompt already committed to, rather than inventing a second, separate
notion of "did this agent respond well enough."

This also fixes the second, more subtle failure mode the ticket names: a lost `debate-angle`
report reaching `synthesizer` as `orchestrator`'s own paraphrase, rather than being flagged
as lost. `orchestrator` is now required to pass angle outputs to `synthesizer` **verbatim**,
and `synthesizer` independently checks the same legibility contract on what it receives —
so a paraphrase that doesn't preserve `ANGLE:`/`VERDICT:`/`POSITION:` is caught at the
synthesis step even if `orchestrator`'s own check somehow passed it through.

**Alternative considered and rejected: a single confidence/quality score reported by each
sub-agent about its own hand-off.** Rejected because a sub-agent cannot meaningfully assess
whether *its own* hand-back reached the caller — the loss (per the Context section) happens
in the relay, after the sub-agent has already returned successfully from its own point of
view. The check has to happen on the receiving side, against a structural contract, not be
self-reported by the agent whose output may not have survived the trip.

## Decision 3: one retry, angle-scoped only, never for `classifier`/`panel-selector`/`synthesizer`

When exactly one `debate-angle` invocation comes back illegible, `orchestrator` retries that
single angle once before giving up on it. This is scoped narrowly:

- Only `debate-angle` gets a retry. `classifier` and `panel-selector` are single,
  early, cheap calls — a degraded response from either is far more likely to reflect a
  systemic relay problem for this run than one flaky angle among several, so retrying them
  doesn't change the odds of success and just delays surfacing the same problem.
  `synthesizer` is deliberately not retried either: by the time `synthesizer` runs, its
  inputs (the angle outputs) are already fixed, and a `synthesizer` retry given the same
  inputs is unlikely to produce a different legibility outcome — the failure mode observed
  for `synthesizer` in the ticket was receiving already-corrupted input, not degrading a
  valid one.
- Only a single retry per angle, and only when exactly one angle is missing per debate round
  (not "retry every missing angle blindly"), to keep the check itself cheap and to avoid
  quietly turning a real, recurring degradation into an invisible non-event through
  unbounded retries — a second miss on the same angle is treated as a real loss, reported as
  `degraded`, not retried again.

**Alternative considered and rejected: no retry at all, treat any single miss as immediately
degraded.** Rejected because a lone miss among several angles, unlike a `classifier`/
`panel-selector` miss, is plausibly transient relay noise rather than a systemic problem —
one bounded retry costs little and can recover a plan that would otherwise be blocked for a
timing fluke. The ticket itself names this as a piste to evaluate ("envisager une nouvelle
tentative sur l'angle perdu … quand c'est un angle et non le classifier qui manque"), which
this decision follows directly.

## Decision 4: symmetric treatment for `reviewer`'s `code-review` sub-pass

> **Superseded (2026-09-23) by ADR 0013.** The `code-review` sub-pass never returned when
> invoked from inside `reviewer`, so this cap fired on every PR. The correctness pass is now
> a dedicated `bug-hunter` agent invoked by `implementer`, and `reviewer` no longer caps its
> verdict. The text below is kept as the historical record.

The ticket explicitly asks to check the symmetric case already observed on PR #11:
`reviewer` invoking the `code-review` skill and that sub-pass not returning within the
turn's budget. The same principle applies — a sub-pass that started and never returned is
not equivalent to one that ran clean, and must not be silently treated as such. `reviewer`
now reports explicitly in `FINDINGS` when `code-review` didn't return, and its `VERDICT` is
capped at `changes-requested` in that case (never `approve`/`approve-with-notes`) — a review
that never completed its correctness pass cannot certify the diff as done.

This is kept in `reviewer.md` itself rather than introducing a second `PANEL:`-shaped
sentinel, since `reviewer` already has its own `VERDICT`/`FINDINGS` contract that a human
reads directly on every PR; a `changes-requested` verdict with an explicit "code-review did
not return" finding is exactly as blocking, and exactly as visible, as `orchestrator`'s
`PANEL: degraded` is for a plan.

## Consequences

- `orchestrator` can no longer render `PLAN:` as a normal-looking plan when any panel member
  didn't answer legibly. `PANEL: degraded (<detail>)` is always paired with
  `PLAN: none — panel degraded …` — there is no state where a human sees a plausible plan and
  has to separately notice it rests on an incomplete panel.
- A human can still choose to proceed on a degraded panel, but that choice now happens
  strictly outside `orchestrator` (it has no mechanism to act on an override even if told to)
  — the calling session must relay `PANEL` unchanged and get an explicit human decision
  before anything downstream (a ticket, an ADR) gets created from a degraded run.
  `orchestrator`'s own hard rule is unchanged in spirit but restated to cover this
  explicitly: it never stands in for a sub-agent's missing answer.
- This does not fix the underlying relay loss — a genuinely systemic relay failure will now
  surface as `PANEL: degraded` on every run rather than being silently absorbed, which is the
  intended outcome (visible failure over silent, confident-looking corruption), not a
  regression to be engineered away separately by this ticket.
- If a future sub-agent is added to the panel (or an existing one's output contract
  changes), the same legibility check — validate against that agent's own declared sentinel
  fields — extends the same way; there is no separate registry of "which agents count" to
  keep in sync by hand.
