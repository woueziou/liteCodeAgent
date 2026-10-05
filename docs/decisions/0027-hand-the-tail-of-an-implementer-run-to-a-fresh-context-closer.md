---
generated_by: claude
task: "0081"
---

# 0027. The tail of an implementer run is handed to a fresh-context `closer`

Status: accepted
Date: 2026-10-05

> **Accepted (2026-10-05):** validated by merging PR #146 with the five proposals of "Questions for the validation" as written (name `closer`, default `off`, two relaunches, two hours, 25 %). Implementation: ticket 0081.

## Context

After it opens its pull request, `implementer` still has to wait for CI, start `reviewer` and `bug-hunter`, post their reports, move the ticket and write a note (steps 8 to 10 of `implementer.md`). None of that needs the code it wrote, yet every call of that tail re-reads the whole context the run has accumulated, up to about 170,000 tokens. Ticket 0081 measured it on one run (ticket 0069) and asked for a handoff.

One run is an anecdote, so the premise was measured before this ADR. `docs/specs/restructure-baseline/tail-share.py` reads the Claude Code transcripts of this project (read-only) and, for every `implementer` run of at least 10 calls that opened a PR, computes the share of the run's context read (input plus cache read plus cache creation, summed over calls, the figure `litecode token-report --detail` reports) that falls after `gh pr create`:

- 42 runs with a PR: **mean 55.8 %, median 55.0 %, pooled 56.5 %**, from 22.6 % to 95.4 %.

More than half of what an implementer reads is read after its PR is open. This is the best-supported lever left, and the one the closing measurement of the restructure (ticket 0090) could not see, because its protocol stops before the PR.

What is not measured: the share is of context read, not of cost (cache reads are cheaper than fresh tokens); the runs are older versions of the agents; and part of the tail needs the code (see below), so the achievable saving is lower than the share. A rough bound, with a fresh context of 15,000 to 25,000 tokens against 130,000 to 180,000 and part of the tail staying with the implementer, is 20 to 45 % of an implementer run's context read. That is an estimate; Decision 9 turns it into a gate.

Constraints found in the repository:

- **Nesting.** The `closer` would itself start `reviewer` and `bug-hunter`: one delegation level more than today. ADR 0014 cites limits on nested spawning in Codex, nothing documents opencode or kilo-code, and ADR 0013 records a past failure of nested invocation. Only the API runner has a hard limit (`runner.maxDepth`, default 4).
- **Per-call tier.** A model can be chosen per call only on Claude Code (`delegateTier`). Everywhere else an agent runs at the tier written in its own frontmatter.
- **One writer.** Nothing stops `litecode resume` from starting a second writer on a worktree while another agent works there.
- **Budgets.** `implementer.md` has about 90 bytes of room under its 12,000-byte cap; a new pack file needs a row in `tests/pack-word-caps.test.ts`; agent descriptions are capped at 20 words.
- **`litecode verify-report`** checks repository and GitHub state, not who wrote the report, so a report assembled from a handoff passes unchanged if it is true.

What needs the implementer's code context: fixing a red CI, applying review fixes, deciding whether a finding is a false positive. What does not: waiting for CI, building the two review briefs, posting and verifying the comments, choosing the ticket status from the verdicts, the ticket note.

## Decision

1. **A new pack agent, `closer`, at the `fast` tier.** The tier is written in its frontmatter, so it holds on every target. Tools: Bash, Read, Write, Agent. It owns the metadata-only tail: wait for CI, start `reviewer` (and `bug-hunter` according to the size flow of ADR 0021), post both reports verbatim and verify the posts, decide the ticket status from the verdicts, write the ticket note.
2. **The handoff is a brief of pointers, not pasted code.** After the PR is open and the journal says `step 7: PR opened`, `implementer` passes: ticket id and file path, size and label, branch, base, PR number and URL, the worktree path (or the primary checkout when the isolation mode is `inline`) and the primary checkout's absolute path, the head commit, the `CHECK_OUTPUT` of its last local run, the expected CI test checks, the attempt number, and the verdicts and counters of earlier attempts (including how many re-hunts were used).
3. **`closer` never writes to the worktree.** Its only writes are PR comments and ticket moves and notes through the CLI with `--project <primary checkout>` (ADR 0020). One writer on the code at any time.
4. **`closer` returns one block**: `VERDICTS`, `CI`, `POSTED` (verified or not), `TICKET_STATUS` (what it set), `NEEDS` (`none`, `code-fix:ci-red`, `code-fix:review`, `conflict`, `github-unavailable`, `nesting-unavailable`), `EVIDENCE` (run URL, finding ids) and `TOKENS` (its own estimate).
5. **`implementer` still sends the single final report.** It builds it from the returned block; the report format and `litecode verify-report` do not change. `TOKENS` adds the closer's.
6. **Fixes loop through the implementer.** On `NEEDS: code-fix:*`, `implementer` moves the ticket from `review` to `inProgress` before touching code (the rule of `implementer-resume`), fixes, pushes and starts a new `closer` with `attempt + 1`. After two relaunches it stops as it does today: ticket in `review`, report. Disputes about a finding stay with the implementer (ADR 0013).
7. **Single-writer guard.** Before starting a `closer`, `implementer` writes `handoff: closer in flight` in its progress journal, and `handoff: returned` when it comes back. While an in-flight marker younger than two hours exists, `litecode resume` does not propose resuming code work, says why and exits 1; an older marker is reported as stale.
8. **Activation: `project.handoff` is `auto` or `off`.** `auto` consults a capability table per install target, next to the one for isolation, listing the targets where the chain `implementer`, `closer`, `reviewer`/`bug-hunter` has been verified. It starts empty. A user can override an entry in config without a release, as for `project.worktreeSupport` (ADR 0023). **The first release ships with the default `off`.**
9. **Gate to turn it on.** `claude-code` is added to the table, and the default becomes `auto`, only after a before/after measurement on real PR runs (a throwaway GitHub repository, at least five runs per condition, `litecode token-report --detail`, the method of ticket 0090) shows the share of context read after the PR falling by at least a quarter, with no new `verify-report` failure and no run left in a half-finished state.
10. **Fallback.** If `Agent` is unavailable to `closer`, nesting is refused, or `closer` cannot start, it returns `NEEDS: nesting-unavailable` and `implementer` performs steps 8 to 10 itself, exactly as today. The text of those steps stays in a reference the implementer reads only then.
11. **Budgets.** The prose of steps 8 to 10 moves out of `implementer.md` into the `closer` agent and the references it reads, so `implementer.md` shrinks; the new files get caps in `tests/pack-word-caps.test.ts`; the description stays within 20 words.

## Consequences

- If the measurement confirms it, the tail of a run is read in a context of about 20,000 tokens instead of about 150,000. Part of the tail (CI red, review fixes) still happens in the implementer's context, so the gain is below the 56 % share.
- A new agent, a new config key, a capability table, a journal marker and a change to `litecode resume`: more moving parts, each tested at the CLI or pack-rendering seam of the spec.
- On targets not in the table nothing changes. That includes every target on day one, because the default is `off`.
- The fallback keeps today's behaviour reachable, so a refused nesting degrades to the current flow instead of failing a run.
- Two levels of delegation below the implementer, on a target that allows it, make failures harder to read. `closer` reports `NEEDS` instead of guessing, and the implementer keeps the final word.
- The `closer` runs at the `fast` tier but starts `reviewer` and `bug-hunter` at the tiers of ADR 0021; their cost does not change.
- A resumed or nested `closer` is not tracked separately by `token-report --detail` (known limit of ticket 0080).

## Alternatives considered

- **Do nothing.** The tail is more than half of what an implementer reads; ruled out by the measurement above.
- **A sibling stage launched by the caller** (the `chained-implementation` skill or the human), not a child of the implementer. No extra nesting, but the human sees two reports instead of one, and the caller drives the fix loop. Kept as the fallback design if nested delegation proves unusable everywhere.
- **Shrink the tail in place** (fewer calls, `--jq` everywhere, one bounded `gh pr checks --watch`). Cheap and complementary, but it does not change the size of the context each call re-reads.
- **A general-purpose agent with a per-call `fast` tier.** Works only on Claude Code (Context, per-call tier).

## Questions for the validation

1. The name `closer`.
2. Default `off` for the first release, as Decision 8 proposes, or `auto` on Claude Code straight away.
3. Two relaunches at most (Decision 6).
4. Two hours for a fresh in-flight marker (Decision 7).
5. The 25 % threshold of Decision 9.
