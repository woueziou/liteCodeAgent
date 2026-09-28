---
schemaVersion: 2
id: 0047-feat-adr-rendre-visibles-sur-main-les-adr-en-att
title: "feat(adr): rendre visibles sur main les ADR en attente d'approbation"
label: feature
status: backlog
priority: high
size: medium
assignedAgent: human
dueDate: 
---

## Contexte
La porte d'approbation ADR (implementer, ADR 0008) interdit de commiter un ADR avant l'accord humain : le fichier reste dans le worktree du ticket, et seule une copie du texte arrive sur `main`, noyée dans une note du ticket. L'écran ADR du dashboard (0032) ne lit que `docs/decisions/`. Rien ne signale qu'un ADR attend une validation ni où le lire. Constaté le 2026-09-28 avec l'ADR 0018 (ticket 0034) : le propriétaire ne le trouvait pas pour le valider.

## Critères d'acceptation
- Le dashboard liste les ADR en attente d'approbation (statut « à valider »), avec leur texte complet et le ticket concerné. Ils sont détectés depuis les notes de ticket portant un `resume-manifest` avec `adr_path` dont le fichier n'existe pas encore dans `docs/decisions/`.
- `litecode doctor` et `litecode ticket list` signalent un ticket bloqué sur un ADR en attente, avec le chemin du ticket où le lire.
- implementer, à la porte ADR, écrit le brouillon dans une section dédiée du ticket (`## ADR à valider : NNNN`) plutôt qu'au milieu d'une note, et donne ce chemin dans son rapport.
- Une fois l'ADR commité (après approbation), il n'apparaît plus comme « à valider ».
- Tests : détection d'un brouillon en attente, disparition après commit, affichage dashboard.

## Plan
1. src/decisions/ : lecture des brouillons depuis les tickets (réutiliser src/report/journal.ts du ticket 0034 s'il est fusionné).
2. Dashboard : section « ADR à valider ».
3. src/doctor.ts et `ticket list` : signalement.
4. packs/core/agents/implementer.md : section dédiée dans le ticket ; régénérer les agents.

## Hors périmètre
Commiter les brouillons d'ADR sur main (écarté : l'ADR précéderait son code et devrait être supprimé en cas de refus).
