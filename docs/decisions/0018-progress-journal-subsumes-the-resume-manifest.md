---
generated_by: implementer
task: "0034-feat-resume-journal-de-progression-par-ticket-et"
---

# 0018. The per-ticket progress journal subsumes the ADR gate's resume-manifest

Status: proposed
Date: 2026-09-28

## Context

ADR 0008 gave the ADR draft approval gate a durable `resume-manifest` fenced block, posted
as a ticket note, so a freshly invoked `implementer` could reconstruct worktree, branch,
commit, ADR path and "already posted" state without relying on a session resume that
doesn't reliably work. That solved the gate's own resume problem, but only the gate's: any
other point in a ticket's run — mid-implementation, after a PR is opened, waiting on
`reviewer`/`bug-hunter` — has no equivalent artifact. A session that dies at step 4 or step
8 leaves a worktree half-done with nothing but the ticket's prose notes (if any were even
written) to reconstruct from, exactly the problem ADR 0008 solved for one specific step and
left open everywhere else (ticket 0034, filed from the 2026-09-27 audit).

Two established precedents in adjacent tools do this generally rather than for one gate: GSD
tracks pause/resume state in a `STATE.md`; Superpowers keeps a `progress.md` ledger that
survives context compaction, recording `BASE..HEAD` commit ranges as work proceeds. Both
treat "where did this run get to" as an ongoing journal, not a one-off checkpoint.

## Decision: `implementer` keeps a `progress-journal` note per ticket; `resume-manifest` becomes that same journal's ADR-gate case, not a second format

`implementer` now appends a fenced `progress-journal` block (fields: `step`, `worktree`,
`branch`, `base`, `commit`, `checks`, `pr`) to a ticket note after worktree/branch creation
and after each flow step that changes what a resume would need to know. `src/report/
journal.ts` parses these blocks (and the ADR gate's `resume-manifest` blocks) into one
`JournalEntry` shape — `resume-manifest`'s `worktree`/`branch`/`commit` map onto the same
journal fields, with `adr_path`/`board_status`/`adr_posted` carried as gate-specific extras
recognized by the same parser, not a rewritten one. `implementer.md`'s ADR gate step 2 keeps
posting `resume-manifest` verbatim (nothing already relying on that shape breaks), but now
describes it explicitly as this journal's own format, so a ticket's note history never mixes
two incompatible block languages for what is, mechanically, the same idea.

A new `litecode resume <ticket>` command (`src/resume.ts`) reads a ticket's latest journal
entry (of either shape) and verifies it against the repo, reusing `src/report/verify.ts`'s
`Probes` (`branchExists`, `prView`, `ticketStatus`) rather than reimplementing those lookups,
plus two resume-specific probes added to `src/report/probes.ts`: `worktreeExists` (is the
worktree directory still there) and `commitInBranch` (is the journal's last commit actually
reachable from the journal's branch, via `git merge-base --is-ancestor`). It reports either
the step to resume at or the specific field that diverges from git reality — the same
"verify, don't trust" posture `verify-report` and the ADR gate's own step 5 already use.

**Alternative considered and rejected: leave `resume-manifest` as its own format, add a
second `progress-journal` format alongside it.** This is what the ticket's acceptance
criteria explicitly rule out ("Le manifeste ADR devient un cas particulier de ce journal
(pas deux formats)") — two parsers for the same underlying question ("where did this run
get to") would drift the moment one is updated and the other isn't, the exact failure mode
ADR 0008 itself was written to avoid for the manifest's own reconstruction.

**Alternative considered and rejected: extend `litecode doctor` instead of adding a new
`resume` command.** `doctor` (ticket 0038) already detects orphaned `inProgress` tickets
with *no* worktree/branch at all — a coarse "something's wrong" scan across every ticket.
`resume` answers a different, narrower question for one already-identified ticket: given
that a journal exists, precisely which step to pick back up at, and which of its claims no
longer hold. Folding a single-ticket, field-by-field reconstruction into a whole-buffer
scanner would have made `doctor`'s output noisier for its existing job without making either
command better at its own.

**Alternative considered and rejected: require an exact `BASE..HEAD` commit range in the
journal, like Superpowers' ledger.** Rejected as more precision than `resume` needs: the
gate's own `commit` field (a single sha, "or none") already answers "how far did local work
get", and a range adds a second value (`BASE`) that would only ever equal the branch's
creation point already recoverable from `git merge-base` against the branch it was created
off — recorded here as the journal's own `base` field instead, populated once at branch
creation rather than carried through every subsequent entry.

## Consequence

A ticket's progress is legible from its own note history at any point in a run, not just at
the one gate ADR 0008 covered — a died-mid-step-4 session now leaves a journal entry a fresh
`implementer` (or a human, via `litecode resume <ticket>`) can act on the same way the ADR
gate's manifest already could. The cost is one more thing `implementer.md`'s flow asks the
agent to do (append a journal note per step) and a slightly larger `src/report/` surface
(`journal.ts`, plus two new probes); both are small next to a worktree nobody can safely pick
back up. `resume-manifest`'s wire format is unchanged, so no previously posted gate note
needs migrating — this is additive parsing, not a breaking rename.
