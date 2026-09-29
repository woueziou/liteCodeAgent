---
generated_by: implementer
task: "0061"
---

# 0021. Size-proportional implementation flow, rare cases loaded on demand

Status: accepted
Date: 2026-09-29

## Context

Tokens declared by each implementer on 2026-09-28/29 ran from 80k to 190k per ticket (median about 135k), before the reviewers, plus 70k to 150k on every resume after an ADR. Ticket 0044, a few-line regex fix, cost about as much as a medium feature. Two causes: `implementer.md` had grown to about 7,400 words (roughly 10k tokens, three times `reviewer` and eight times `bug-hunter`), reloaded on every run and resume, one rule per incident, most of them only useful in rare cases; and every ticket ran the same flow (worktree, PR, CI, `reviewer`, `bug-hunter` at the most expensive tier, often a re-hunt and a second review).

## Decisions

1. **`implementer.md` keeps the nominal flow only; rare cases become skills.** The body targets at most 3,000 words (tested). The ADR approval gate and its resume, resuming and review fixups, GitHub outage, sub-agent-driven steps, stacked PRs, disputing a reviewer finding, leak cleanup, verification-only tickets and CLI resolution move verbatim into `implementer-*` pack skills, which the agent loads with the `Skill` tool only when the case arises. They are not listed in the agent's `skills:` frontmatter (that would preload them and defeat the point). Hard rules stay in the body. A test checks that every skill is referenced by the body and installed, and that each moved rule is still findable in its skill.
2. **The flow is proportioned to the ticket's `size`.** `small` (and `trivial`): still a worktree, a PR and both passes, but `bug-hunter` runs at the `balanced` tier, there is no re-hunt unless a finding is blocking, and no second `reviewer` pass for non-blocking corrections (`reviewer` returns `approve-with-notes`, `implementer` applies the notes and re-runs `bun run check`). `medium`/`large`: today's flow. The bar for a blocking finding does not change with size.
3. **The tier is chosen at the call, without duplicating agents.** A new `{{> delegateTier <tier>}}` helper renders "pass `model: "<model>"` on that call" for Claude Code (model taken from the configured `tiers`), whose `Agent` tool accepts a per-call model. Every other target (opencode, kilo-code, codex, pi) and the API runner, which fixes a model per agent tier, cannot choose per call: the prompt says so and the agent keeps its default tier. No capability is invented for them.
4. **Callers pass only the ticket and launch specifics.** `chained-implementation` (and the docs) say what is already inside `implementer.md` need not be repeated per launch: worktree, ticket commits on the default branch, CI, no forced push, single final report.

## Consequences

- Every implementer run and resume loads a prompt roughly 60% smaller; the measurement of the effect is a separate ticket (0062).
- A rule that is only in a skill is followed only if the agent loads it: the body's "Rare cases" list names the trigger for each, and the tests pin the list, but compliance is prompt-level, like every other rule here.
- On targets without per-call model choice, small tickets keep `bug-hunter` at `reasoning`: they lose only the saving from the tier, not the review.
- Ticket sizes are set by planning; a mis-sized ticket gets the wrong flow. A `small` ticket with a blocking finding still gets the re-hunt and second pass, so the cost of a wrong size is money, not an escaped defect.
