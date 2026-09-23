---
generated_by: claude
task: "0019 (#48)"
---

# 0013. The correctness pass is a dedicated pack agent, invoked by `implementer`

Status: proposed
Date: 2026-09-23

## Context

ADR 0007, decision 4, had `reviewer` invoke the `code-review` skill for its correctness
pass, and cap its `VERDICT` at `changes-requested` whenever that sub-pass didn't return.
The rule was sound — a review whose correctness pass never ran can't certify a diff — but
the sub-pass never returned: zero times out of six on PRs #37, #39, #40, #41 and #47, and
again on #64. Invoked from inside a sub-agent, the skill runs as a forked background task
the sub-agent has no way to await. The cap therefore fired on every PR regardless of the
diff's quality, stopped meaning anything, and every merge went through over a
`changes-requested` verdict.

Two further problems (ticket 0019):

- `code-review` is a built-in Claude Code skill, not part of this repo's packs. On the
  other four install targets (`codex`, `pi`, `opencode`, `kilo-code`) the prompt pointed
  at something that doesn't exist, and nothing told `reviewer` whether it was in the
  "not invokable" case (no cap) or the "invoked, never returned" case (cap).
- When the same pass was run to completion from the main session on #64, it found ten
  real defects `reviewer`'s own read had missed. The correctness pass is worth keeping;
  only its delivery mechanism was broken.

## Decision

1. **A new pack agent, `bug-hunter`** (`packs/core/agents/bug-hunter.md`), owns the
   correctness pass: enumerate what the diff promises, turn every suspicion into a
   concrete failure scenario, and confirm it by running the code wherever possible,
   tagging each finding `confirmed` or `plausible`. It returns `HUNT: complete | partial`
   so an incomplete hunt is stated, never implied. Its skills are declared statically
   (`critique-expert`, `security-expert`) rather than through `project.agentSkills`, so
   adding it doesn't make every existing config fail install pre-flight.
2. **`implementer` invokes `bug-hunter` directly, via `Agent`, alongside `reviewer`** — the
   same synchronous mechanism already used for `reviewer`, which does return. Nothing is
   nested inside `reviewer` any more.
3. **`reviewer` no longer runs a correctness sub-pass and no longer caps its verdict.** It
   keeps plan fidelity, conventions, verification and attribution, and reports obvious
   defects it happens to see.
4. **`implementer` merges both reports.** `Ready to Merge` requires `reviewer` to approve
   *and* `bug-hunter` to return `HUNT: complete` with no unresolved blocking finding. A
   `HUNT: partial`, or a `plausible` blocking finding that hasn't been fixed or disproved,
   lands the ticket in `Review`. Both reports are posted verbatim on the PR.

This supersedes ADR 0007's decision 4. Decisions 1–3 of ADR 0007 (the degraded debate
panel) are unaffected.

## Consequences

- A `changes-requested` verdict means something again: it comes from a finding, not from
  a sub-pass that was never going to return.
- The independence the skill provided is kept: `bug-hunter` runs in its own context and
  doesn't see `reviewer`'s reasoning, so one agent's blind spots don't become both
  passes' blind spots.
- `bug-hunter` is invoked through `Agent`, like `reviewer`, so on install targets without
  a synchronous sub-agent mechanism it inherits the same portability gap as the rest of
  `implementer`'s flow. That gap is ticket 0020's subject, not this ADR's — but unlike
  before, there's no longer a Claude-only *skill* on top of it.
- One more agent per PR costs one more model call at the `reasoning` tier. That is the
  price of a correctness pass that actually runs.
