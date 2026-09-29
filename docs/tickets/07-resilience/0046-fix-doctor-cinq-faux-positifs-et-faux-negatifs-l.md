---
schemaVersion: 2
id: 0046-fix-doctor-cinq-faux-positifs-et-faux-negatifs-l
title: "fix(doctor): cinq faux positifs et faux négatifs laissés par bug-hunter sur la PR #82"
label: bug
status: readyToMerge
priority: low
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Findings non bloquants de bug-hunter sur la PR #82 (ticket 0038, `litecode doctor`), laissés hors de la PR. Détail et reproduction dans les commentaires de la PR #82.

## Critères d'acceptation
- `checkStalePrStatus` (src/doctor.ts) : un ticket avec deux branches (une première tentative dont la PR est fermée, une seconde dont la PR est ouverte) ne produit pas d'alerte.
- Même check : une branche distante supprimée après fusion (`gh pr merge --delete-branch`) ne masque plus une PR fusionnée ou fermée (faux négatif).
- `doctor` lancé depuis un worktree de ticket résout `project.worktreeRoot` par rapport au checkout principal, pas au worktree.
- Un worktree « prunable » (dossier supprimé, encore enregistré) n'est pas compté comme présent ; il est signalé comme à nettoyer (`git worktree prune`).
- Un seul `gh pr list` par branche entre les deux checks de PR (mise en cache dans l'exécution).
- Un test par cas.

## Plan
1. src/doctor.ts : les cinq corrections.
2. tests/doctor.test.ts : un test par cas, dépôts git temporaires.

## Hors périmètre
Nouveaux checks.

### 2026-09-29 — implementer: PR opened, reviewed, ready to merge

PR: https://github.com/woueziou/liteCodeAgent/pull/98 (branch `fix-doctor-five-findings/0046`, base `main`).

Implemented the five fixes in src/doctor.ts with one test per case in tests/doctor.test.ts (temporary git repos), test-first per this ticket's `bug` label (commit b240eec adds the five regression tests, confirmed failing against the pre-fix code; commit 155c32a is the fix).

`reviewer`'s first pass (commit 18b5a15, before the test-first restructuring) returned `changes-requested`: blocking finding that the fix and its tests were squashed into a single commit, violating `project.testFirst: bugs`. Fixed by splitting into b240eec (failing tests) + 155c32a (fix).

`bug-hunter`'s first pass (commit 18b5a15) returned `HUNT: partial`, with two blocking findings: (1) `doctor()` still read ticket status / ran the primary-checkout-leak check against whichever `root` it was invoked with, not the primary checkout, so a ticket worktree's stale copy of `docs/tickets` could falsely flag a live worktree as orphaned; (2) `checkStalePrStatus` could raise a false closed/merged error when `gh` failed for one of a ticket's *other* branches, since an "unknown" lookup wasn't excluded from the "not open" set. Also one non-blocking finding: prefer a MERGED lookup over CLOSED when a ticket has both. Fixed in commit aff73dd (`primaryCheckoutRoot()` threaded through `ticketDoctor`/`listTickets`/`checkPrimaryCheckoutLeak`; `checkStalePrStatus` now degrades to the unverified warn when any branch's gh lookup is unknown; MERGED preferred over CLOSED), with new regression tests for each, confirmed failing against the pre-fixup code.

Both were re-invoked against commit aff73dd (final branch head):
- `reviewer` re-review: **VERDICT: approve**. All five acceptance criteria satisfied, `TEST_FIRST` confirmed (checked out b240eec into a throwaway worktree, reran tests, 5 of the 6 new tests fail there for exactly the reasons described), no findings, plan fidelity matches, attribution verified on all three commits.
- `bug-hunter` re-hunt: **HUNT: complete**. All prior findings confirmed fixed by direct probing (mixed gh-state combinations, primary-root threading from an actual ticket worktree, MERGED-over-CLOSED). One new non-blocking finding: `primaryCheckoutRoot()` picks the bare repo dir as the primary root in a bare-clone-as-main-worktree layout, silently losing ticket-status-driven findings there — narrow (this project's primary checkout is always a normal non-bare repo per ADR 0015's flow), out of this ticket's scope ("Hors périmètre: Nouveaux checks" also covers this as hardening rather than one of the five findings), deferred rather than fixed here; recommended as a future ticket via triage if ever needed.

Both full verdicts (both passes) posted verbatim on the PR as comments, verified landed (4 comments total). CI (`test`, `GitGuardian Security Checks`) green. No merge conflicts. Moving to `readyToMerge`.
