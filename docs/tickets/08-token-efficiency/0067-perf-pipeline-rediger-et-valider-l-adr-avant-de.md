---
schemaVersion: 2
id: 0067-perf-pipeline-rediger-et-valider-l-adr-avant-de
title: "perf(pipeline): rédiger et valider l'ADR avant de lancer l'implémentation"
label: feature
status: done
priority: medium
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Un arrêt pour ADR en cours d'implémentation suivi d'une reprise a rendu 0034, 0050 et 0057 parmi les tickets les plus chers : l'implémenteur recharge tout à la reprise.

## Critères d'acceptation
- Quand planner signale un ADR, il le rédige ; tracker l'écrit dans le ticket sous `## ADR à valider : NNNN` ; dispatcher ne planifie pas un ticket dont l'ADR attend validation.
- Une fois l'ADR approuvé, implementer le commite dans sa PR sans s'arrêter.
- La porte d'ADR en cours d'implémentation reste pour les ADR découverts pendant le travail.
- Tests de contrat ; agents régénérés.

## Plan
1. packs/core/agents/planner.md, tracker.md, dispatcher.md, implementer.md / skill implementer-adr-gate.
2. src/ si `ticket move … planned` doit refuser un ADR en attente.
3. tests/ + install --apply.

## Hors périmètre
Changer le format des ADR.

### 2026-09-29 — implementer: PR opened, moved to Review

PR: https://github.com/woueziou/liteCodeAgent/pull/114 (CI: test pass).
reviewer: approve-with-notes. bug-hunter: hunt 1 complete with a blocking finding, fixed; re-hunt complete with a new blocking finding (section cut at the first `## `), fixed in the last commit and verified by probe on real 0066/0061 tickets, but not re-hunted (one re-hunt per run) — hence Review. Open non-blocking follow-ups: ADR number reservation now spans the ticket's backlog life (planner should also check pending `## ADR à valider/approuvé` numbers in tickets); tracker pastes the ADR verbatim so its `## ` headings split the ticket sections; approval is a manual heading rename.

```progress-journal
step: step 10: review
worktree: ../worktrees/0067
branch: adr-before-implementation/0067
base: origin/main
commit: see PR head
checks: bun run check pass; bun test 592 pass
pr: https://github.com/woueziou/liteCodeAgent/pull/114
```
