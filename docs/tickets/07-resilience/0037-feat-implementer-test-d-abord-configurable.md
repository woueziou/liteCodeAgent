---
schemaVersion: 2
id: 0037-feat-implementer-test-d-abord-configurable
title: "feat(implementer): test d'abord, configurable"
label: feature
status: done
priority: medium
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

Source : audit du 2026-09-27, point 5.

## Contexte
Aucun prompt n'impose d'écrire le test avant le code. Superpowers impose RED-GREEN-REFACTOR ; Spec Kit en fait un article non négociable de sa constitution. On veut la discipline sans le dogme.

## Critères d'acceptation
- Nouvelle clé de config `testFirst: bugs | all | off` (défaut `bugs`), validée par le schéma et `config doctor`.
- Avec `bugs` : pour un ticket label bug, implementer commite un test qui échoue avant le correctif.
- reviewer vérifie dans l'historique git de la branche que ce commit existe et que le test échouait.
- Rendu conditionnel dans le template (pas de texte mort quand `off`).

### 2026-09-28 — implementer: progress journal, PR opened

`project.testFirst` (bugs|all|off, default bugs) added to `src/config.ts`, `implementer`/`reviewer` pack templates updated with conditional rendering (`{{^if project.testFirstOff}}`), template-only `testFirstOff`/`testFirstAll` booleans derived in `src/install.ts`. `bun run check` and `bun test` (379 pass) both green. PR opened.

```progress-journal
step: step 7: PR opened
worktree: ../worktrees/0037
branch: feat-implementer-test-first/0037
base: main
commit: 7f34e3d
checks: bun run check: pass; bun test: 379 pass, 0 fail
pr: https://github.com/woueziou/liteCodeAgent/pull/92
```

### 2026-09-28 — implementer: ready to merge

PR: https://github.com/woueziou/liteCodeAgent/pull/92 (base `main`, branch `feat-implementer-test-first/0037`, final commit `4f4b27f`).

First `reviewer`/`bug-hunter` pass (commit 7f34e3d): reviewer `VERDICT: approve`, all four acceptance criteria satisfied. `bug-hunter` found two **blocking** issues bug-hunter's own hunt missed on the first implementation: (1) `src/runner/catalog.ts`'s separate render call site bypassed the new `testFirstOff`/`testFirstAll` template flags, so the runner target always rendered `bugs`-mode wording regardless of the configured `testFirst` value; (2) `reviewer.md`'s new test-first check instructed `git stash`/`git checkout <sha>` in the shared worktree it's given, mutating the implementer's live checkout while `bug-hunter` might run concurrently in it.

Both fixed in commit `00c42f0`: `templateProject()` moved to `src/template.ts` as a shared export, wired into both render call sites, with a new regression test (`tests/runner.test.ts`); `reviewer.md` reworded to use a throwaway detached worktree/`git archive` copy instead of mutating the shared one.

Re-hunt on `00c42f0`: `HUNT: complete`, both prior blocking findings verified closed, one new **non-blocking** finding — the throwaway copy has no `node_modules` and the instruction ran the whole suite, so a missing-dependency error or an unrelated flaky test could get recorded as the failing-test proof. Fixed in commit `4f4b27f`: symlink/copy `node_modules` into the copy, run only the specific test.

Final `reviewer` pass on `4f4b27f`: `VERDICT: approve`, all four acceptance criteria re-verified against the final diff, `FINDINGS: none`, `REENTRY: none needed`. Both fixup commits carry the `Agent: implementer` trailer.

Both verdicts (reviewer's final pass and bug-hunter's re-hunt) posted verbatim on the PR:
- https://github.com/woueziou/liteCodeAgent/pull/92#issuecomment-5872664860 (reviewer, final)
- https://github.com/woueziou/liteCodeAgent/pull/92#issuecomment-5872665450 (bug-hunter, re-hunt)
