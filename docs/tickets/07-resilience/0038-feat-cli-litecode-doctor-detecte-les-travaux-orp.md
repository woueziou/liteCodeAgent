---
schemaVersion: 2
id: 0038-feat-cli-litecode-doctor-detecte-les-travaux-orp
title: "feat(cli): litecode doctor détecte les travaux orphelins"
label: feature
status: readyToMerge
priority: high
size: medium
assignedAgent: human
dueDate: 
---

Source : audit du 2026-09-27, point 6.

## Contexte
Rien ne détecte un travail abandonné en cours de route. GSD a health --repair et forensics.

## Critères d'acceptation
`litecode doctor` (sans écrire par défaut) signale :
- ticket inProgress sans worktree ni branche ;
- worktree sous `project.worktreeRoot` sans ticket actif correspondant ;
- branche de ticket poussée sans PR ;
- ticket review/readyToMerge dont la PR est fermée ou fusionnée ;
- dérive du lockfile d'installation ; plus les erreurs de `ticket doctor` et `config doctor`.
- Fonctionne hors ligne : les vérifications GitHub sont marquées « non vérifié » si gh est indisponible.
- Tests avec dépôt git temporaire.

### 2026-09-28 — implementer: PR opened, reviewed, ready to merge

PR: https://github.com/woueziou/liteCodeAgent/pull/82 (branch `feat/cli-doctor/0038`, base `main`)

Implementation: new `src/doctor.ts` aggregating `tickets/doctor.ts`, `config-doctor.ts`, and
`install.ts`'s `buildPlan` drift entries, plus new checks for an orphaned inProgress ticket
(no worktree, no branch), a stale worktree under `project.worktreeRoot` with no active
ticket, a pushed branch with no PR, and a review/readyToMerge ticket whose PR is closed or
merged. GitHub checks degrade to a `warn` "non vérifié" finding on any `gh` failure
(including `gh` not being installed at all), so the command stays usable offline. Wired up
as `bunx litecodeagent doctor`. Tests in `tests/doctor.test.ts` use a real temporary git
repo (10 tests).

Two same-PR fixups landed during review, both re-verified with `bun run check` + `bun test`
(full suite green after each):
- commit `db8d065`: `prForBranch` only caught `GhError`, so a missing `gh` binary (plain
  `Error`/ENOENT from `Bun.spawn`) crashed the whole `doctor` run instead of degrading to
  "non vérifié" — a `bug-hunter` blocking finding, fixed and confirmed resolved by a
  `bug-hunter` re-hunt.
- commit `42ba0dc`: `checkOrphanedWorktrees` only treated `inProgress` as "active", so a
  worktree mid a same-PR review fixup (`review`/`readyToMerge`) got a false "stale, remove
  it" warning — a `bug-hunter` non-blocking finding from the re-hunt, fixed anyway since it
  was cheap and confirmed live against this repo's own tickets.

**reviewer verdict:** `approve` (reviewed at commit `aa7130f`, before the two fixups above;
full `VERDICT`/`FINDINGS`/`REENTRY` posted verbatim on the PR).

**bug-hunter verdict:** `HUNT: complete` on the re-hunt (commit `db8d065`), the blocking
ENOENT finding confirmed resolved, no new blocking finding; full `HUNT`/`FINDINGS`/`REENTRY`
for both the first pass and the re-hunt posted verbatim on the PR. Five non-blocking findings
from the first pass were left as-is for follow-up tickets (not fixed in this PR): a
multi-branch false positive in `checkStalePrStatus`, a deleted-remote-branch false negative
in the same check, a wrong-root resolution when `doctor` runs from inside a worktree instead
of the main checkout, a prunable worktree counted as "present", and duplicate `gh pr list`
calls per branch across the two PR-status checks. These should be filed as new tickets via
`triage`/`dispatcher` when picked up next.

PR shows `MERGEABLE`, no merge conflicts. Moving `inProgress -> readyToMerge`.
