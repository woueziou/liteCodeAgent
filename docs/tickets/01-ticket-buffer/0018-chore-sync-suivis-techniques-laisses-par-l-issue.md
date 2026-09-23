---
schemaVersion: 2
id: 0018-chore-sync-suivis-techniques-laisses-par-l-issue
title: chore(sync): suivis techniques laissés par l'issue #27
label: chore
status: done
priority: low
size: small
assignedAgent: human
dueDate: 
---

Deux suivis non bloquants identifiés par `reviewer` pendant les huit passes de review de la PR #41 (issue #27), délibérément laissés hors périmètre :

1. Le fichier d'état de `ticket sync --auto` (`.claude/data/ticket-sync-auto-state.json`, introduit par l'ADR 0009) **n'enregistre pas le nouveau statut `blocked`** ajouté par la PR #41. Un ticket bloqué par un push de `Status` non résolu n'apparaît donc pas dans la trace que le mode non surveillé est censé laisser.
2. `statusEdit` et `statusUnresolved` (`src/tickets/sync.ts`) **dupliquent une chaîne de gardes** qui gagnerait à être extraite dans un helper partagé.

Aucun des deux n'est un défaut de correction — ce sont des finitions.

generated_by: tracker

Fermé comme obsolète (vérifié sur `main` @ b160f38) : les deux suivis visaient du code supprimé par la PR #55 (suppression de `src/board/`). Il n'existe plus de résultat `blocked` côté sync (`SyncOutcome` = `synced | skipped`, `src/tickets/sync.ts:59-65`), et `statusEdit`/`statusUnresolved` ont disparu avec le push de `Status`. Rien à implémenter.
