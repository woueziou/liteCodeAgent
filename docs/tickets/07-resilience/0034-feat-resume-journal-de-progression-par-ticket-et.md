---
schemaVersion: 2
id: 0034-feat-resume-journal-de-progression-par-ticket-et
title: "feat(resume): journal de progression par ticket et litecode resume"
label: feature
status: done
priority: high
size: large
assignedAgent: human
dueDate: 
---

Source : audit du 2026-09-27, point 2.

## Contexte
Le resume-manifest n'existe que pour la porte d'approbation ADR (ADR 0008). Une session qui meurt au milieu d'un ticket laisse un worktree à moitié fait sans moyen fiable de reconstruire l'état. GSD a pause/resume + STATE.md ; Superpowers un ledger progress.md qui survit à la compaction, avec les plages BASE..HEAD.

## Critères d'acceptation
- implementer tient un journal de progression dans le ticket (note structurée, mise à jour à chaque étape : étape courante, worktree, branche, base, dernier commit, checks OK/KO, PR).
- `litecode resume <ticket>` reconstruit l'état depuis le journal + worktree + branche + PR, vérifie chaque champ (en réutilisant les sondes de `src/report/verify.ts`) et imprime l'étape où reprendre, ou un écart explicite.
- Le manifeste ADR devient un cas particulier de ce journal (pas deux formats).
- Tests : journal absent, journal incohérent avec git, reprise nominale.

### 2026-09-28 — implementer: code committed, ADR draft awaiting approval

Code is implemented and committed locally on `feat-resume-journal/0034` (not pushed yet):
`src/report/journal.ts` (parses both `progress-journal` and `resume-manifest` fenced blocks
into one `JournalEntry`), `src/resume.ts` (`resumeState`, reusing `src/report/verify.ts`'s
`Probes` plus two new resume-specific probes), `src/report/probes.ts` (`realResumeProbes`
adding `worktreeExists`/`commitInBranch`), `src/cli.ts` (`litecode resume <ticket>`), tests
in `tests/report-journal.test.ts` and `tests/resume.test.ts` (journal absent, journal
inconsistent with git — branch gone, commit unreachable, PR head mismatch — and nominal
resume, matching the acceptance criteria), plus `packs/core/agents/implementer.md` updated
(the "Writing on the ticket" progress-journal instructions, the resume section pointing at
`litecode resume`, and the ADR gate's `resume-manifest` paragraph reframed as this journal's
own shape). `bun run check` and `bun test` both pass (318 tests, 0 fail).

This changes the mechanism ADR 0008 describes (the resume-manifest becomes a case of the new
journal format, not a second format, per the ticket's acceptance criteria), so per the ADR
draft approval gate this stops here **without committing the ADR or opening a PR** until a
human approves. The full drafted ADR follows, verbatim, not committed:

---
**DRAFT — awaiting approval, not committed.** Path: `docs/decisions/0018-progress-journal-subsumes-the-resume-manifest.md` (next free ADR number; the ticket carried no `ADR:` path from `planner`, so this implementer judged one warranted mid-implementation, per the ticket's own "changes ADR 0008's mechanism" framing).

```markdown
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
```

```resume-manifest
worktree: ../worktrees/0034
branch: feat-resume-journal/0034
commit: d95fa2014a39993e1408f2eb6cec2d4577e470ad
adr_path: docs/decisions/0018-progress-journal-subsumes-the-resume-manifest.md
board_status: In Progress
checks_passed: bun run check: pass; bun test: 318 pass / 0 fail
adr_posted: true
```

### 2026-09-28 — implementer: ADR approved, PR opened, ready to merge

Human approved ADR 0018 verbatim, no edits. Committed it (`78b8c85`) on
`feat-resume-journal/0034` in `/Users/woueziou/works/personal_projects/worktrees/0034`,
merged `origin/main` (`fe4900a`, no conflicts) to pick up PR #83's step 10 false-positive
re-review rule and the three-dot diff-scope guidance in `reviewer.md`/`bug-hunter.md`,
re-rendered installed agents (`5c61472`), reran `bun run check` (pass) and `bun test`
(322 pass / 0 fail), then pushed and opened
https://github.com/woueziou/liteCodeAgent/pull/84 (base `main`).

`reviewer` verdict: `approve-with-notes`. One non-blocking finding: commit `d95fa20` is
missing the `Task:` attribution trailer (has `Agent:` only) — deferred as a traceability
hygiene item, not a functional defect. Plan fidelity: matches; all four acceptance criteria
verified with concrete proof.

`bug-hunter` report: `HUNT: complete`, no blocking findings. Five non-blocking findings, all
confirmed or plausible via direct probing: (1) `resume` doesn't detect a stale journal
relative to repo state when a gate step (ADR commit, PR open) happens without a fresh
journal note — the journal-trigger list in `implementer.md` doesn't cover "after the ADR
commit"; (2) `worktreeExists` resolves the journal's relative `worktree:` path against cwd,
so running `resume` from inside a worktree (rather than the main checkout) misreports the
worktree as gone; (3) the journal block regex isn't CRLF-aware, unlike
`src/tickets/spec.ts`'s existing `fenceRegions`; (4) an unclosed fenced block silently
swallows a later valid one instead of erroring; (5) the journal's `commit`/`pr` values are
passed to git/gh without format validation (argv-only, not exploitable, hardening only).
`bug-hunter` recommended same-PR fixups for (1) and (2), and triage-filed follow-up tickets
for (3)-(5); given both verdicts are non-blocking and MERGEABLE/CLEAN, these were deferred
rather than fixed in this run — flagging here for whoever files the follow-up tickets rather
than letting them go untracked.

Both full verdicts posted verbatim on the PR:
https://github.com/woueziou/liteCodeAgent/pull/84#issuecomment-5868034821 (reviewer),
https://github.com/woueziou/liteCodeAgent/pull/84#issuecomment-5868035328 (bug-hunter).

Ticket moved `In Progress` → `Ready to Merge`.
