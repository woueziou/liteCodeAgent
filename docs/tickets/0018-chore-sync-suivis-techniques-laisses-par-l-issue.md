---
schemaVersion: 1
id: 0018-chore-sync-suivis-techniques-laisses-par-l-issue
title: chore(sync): suivis techniques laissés par l'issue #27
label: chore
status: backlog
priority: low
size: small
assignedAgent: human
dueDate: 
issue: 46
synced: true
syncedAt: 2026-09-21T15:36:36.090Z
---

Deux suivis non bloquants identifiés par `reviewer` pendant les huit passes de review de la PR #41 (issue #27), délibérément laissés hors périmètre :

1. Le fichier d'état de `ticket sync --auto` (`.claude/data/ticket-sync-auto-state.json`, introduit par l'ADR 0009) **n'enregistre pas le nouveau statut `blocked`** ajouté par la PR #41. Un ticket bloqué par un push de `Status` non résolu n'apparaît donc pas dans la trace que le mode non surveillé est censé laisser.
2. `statusEdit` et `statusUnresolved` (`src/tickets/sync.ts`) **dupliquent une chaîne de gardes** qui gagnerait à être extraite dans un helper partagé.

Aucun des deux n'est un défaut de correction — ce sont des finitions.

generated_by: tracker
