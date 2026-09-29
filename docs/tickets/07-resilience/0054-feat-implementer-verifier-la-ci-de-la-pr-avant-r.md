---
schemaVersion: 2
id: 0054-feat-implementer-verifier-la-ci-de-la-pr-avant-r
title: "feat(implementer): vérifier la CI de la PR avant readyToMerge"
label: feature
status: readyToMerge
priority: medium
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Sur la PR #93 (ticket 0050), l'implémenteur a passé le ticket en `readyToMerge` avec « bun test: 399 pass, 0 fail » alors que la CI GitHub de la PR échouait : un test lançait `upgrade` sans `--no-self-update`, ce qui passait en local (branche présente) mais pas en CI (detached HEAD). Ni implementer ni `verify-report` ne regardent l'état des checks de la PR ; l'appelant l'a découvert après coup (`gh pr checks 93`) et a dû corriger lui-même (commit 87507a4).

## Critères d'acceptation
- implementer attend la fin des checks de la PR (`gh pr checks <pr> --watch` ou équivalent, avec une limite de temps) après chaque push et avant de passer en `readyToMerge`. Un check en échec : il lit le log, corrige sur la même PR (fixup), repousse ; sinon le ticket va en `review` avec le lien du run en échec.
- Le rapport `STATUS:` d'implementer inclut l'état des checks (`CI:` pass / fail / pending / none) ; `CHECK_OUTPUT` reste la sortie locale.
- `litecode verify-report` interroge les checks de la PR : un ticket `readyToMerge` avec un check en échec est une erreur ; des checks encore en cours sont un avertissement ; un dépôt sans CI n'est pas une erreur. `gh` indisponible : avertissement « non vérifié », comme les autres sondes.
- Tests : verify-report avec checks en échec / en cours / absents (sondes simulées) ; test de contrat sur implementer.md ; agents installés régénérés.

## Plan
1. src/report/probes.ts : sonde des checks de PR via gh.
2. src/report/verify.ts : règles ci-dessus, champ `CI:` optionnel dans le rapport.
3. packs/core/agents/implementer.md : attente des checks, format de sortie ; régénérer les agents.
4. tests/report-verify.test.ts, tests/agents-*.

## Hors périmètre
Configurer ou modifier les workflows de CI du projet.

### 2026-09-29 — implementer: PR opened, CI green

PR: https://github.com/woueziou/liteCodeAgent/pull/99
CI on the PR: pass (`gh pr checks 99 --watch` → `test` pass, `GitGuardian Security Checks` pass).

```progress-journal
step: step 8: reviewer + bug-hunter invoked
worktree: ../worktrees/0054
branch: feat-implementer-ci-check/0054
base: main
commit: b25a13d
checks: bun run check: pass; bun test: 407 pass, 0 fail
pr: https://github.com/woueziou/liteCodeAgent/pull/99
```

### 2026-09-29 — implementer: ready to merge

PR: https://github.com/woueziou/liteCodeAgent/pull/99
CI on the PR (after the fixup commit): pass.

VERDICT (reviewer): approve — no findings, plan fidelity matches, all four acceptance criteria satisfied. Full verdict posted on the PR.

HUNT (bug-hunter, first pass): complete — no blocking findings; one confirmed non-blocking defect (a missing `gh` binary could crash `prChecks` with an uncaught ENOENT instead of returning `unknown`) and three plausible non-blocking gaps (a race right after a push collapsing "no CI" and "CI not registered yet" into `none`; a stacked PR based on `--base <pr-branch>` never running the `test` GitHub Actions job so `prChecks` could read `pass` without the suite ever running in CI; an unverified claim about `gh pr checks --json`'s exit-8 behaviour, plus no secondary-rate-limit retry since `prChecks` bypasses the shared `gh()` wrapper). Full report posted on the PR.

Fixup: commit 6341c81 moved the `Bun.spawn` call inside `prChecks`'s try/catch so a missing `gh` binary now returns `{ kind: "unknown" }` like every other probe failure, with a new test (`tests/report-probes.test.ts`: "prChecks reports unknown, not an uncaught throw, when the gh binary itself doesn't exist"). `bun run check` and `bun test` (408 pass) re-run clean; the PR's own CI re-checked green after the push.

HUNT (bug-hunter, re-hunt after the fixup): complete — finding #1 confirmed fixed (verified against a reverted copy of `probes.ts`, the new test fails there and passes at 6341c81); no new defects in the fixup; the other three findings left open as non-blocking, deferred to a new ticket via triage. Full report posted on the PR.

The three remaining bug-hunter findings (the "no checks reported" race, stacked PRs skipping the `test` job, and the exit-8/rate-limit doc-comment note) are not fixed here — they were judged non-blocking and narrower than this ticket's scope, and are left for a follow-up ticket via `triage`; the stacked-PR gap (#3) is the one worth prioritizing there, since it's closest to this ticket's own motivating failure (PR #93/ticket 0050).

Moving `In Progress` → `Ready to Merge`.
