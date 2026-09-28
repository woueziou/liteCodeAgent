---
schemaVersion: 2
id: 0037-feat-implementer-test-d-abord-configurable
title: "feat(implementer): test d'abord, configurable"
label: feature
status: inProgress
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
