---
schemaVersion: 2
id: 0049-fix-resume-cinq-points-laisses-par-bug-hunter-su
title: "fix(resume): cinq points laissés par bug-hunter sur la PR #84"
label: bug
status: backlog
priority: medium
size: small
assignedAgent: human
dueDate: 
---

## Contexte
Findings non bloquants de bug-hunter sur la PR #84 (ticket 0034, journal de progression + `litecode resume`), laissés hors de la PR. Détail dans la note du ticket 0034 et les commentaires de la PR #84.

## Critères d'acceptation
- implementer écrit une entrée de journal après le commit de l'ADR et après l'ouverture de la PR, pour que `resume` ne s'appuie pas sur un journal périmé ; `resume` signale un journal en retard sur l'état du dépôt (commit plus récent sur la branche, PR ouverte non journalisée).
- `worktreeExists` résout un chemin de worktree relatif par rapport au checkout principal, pas au dossier courant : `resume` lancé depuis un worktree donne le même résultat.
- La lecture des blocs `progress-journal` et `resume-manifest` accepte les fins de ligne CRLF (comme `fenceRegions` dans src/tickets/spec.ts).
- Un bloc non refermé produit une erreur explicite au lieu d'avaler le bloc suivant.
- Les valeurs `commit` (sha hexadécimal) et `pr` (URL ou numéro) sont validées avant d'être passées à git et gh.
- Un test par point.

## Plan
1. packs/core/agents/implementer.md : déclencheurs du journal ; régénérer les agents.
2. src/report/journal.ts : CRLF, bloc non refermé, validation des valeurs.
3. src/resume.ts et src/report/probes.ts : résolution du chemin, détection du journal en retard.
4. tests/report-journal.test.ts, tests/resume.test.ts.

## Hors périmètre
Changer le format du journal (ADR 0018).
