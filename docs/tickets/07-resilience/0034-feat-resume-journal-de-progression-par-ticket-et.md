---
schemaVersion: 2
id: 0034-feat-resume-journal-de-progression-par-ticket-et
title: "feat(resume): journal de progression par ticket et litecode resume"
label: feature
status: planned
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
