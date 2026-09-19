---
schemaVersion: 1
id: 0013-feat-sync-declenchement-automatique-de-la-synchr
title: feat(sync): déclenchement automatique de la synchronisation, sans sollicitation humaine
label: feature
status: backlog
priority: medium
size: medium
assignedAgent: human
dueDate: 
issue: 31
synced: true
syncedAt: 2026-09-18T17:34:50.593Z
---

## Demande

Le humain ne veut plus avoir à demander la synchronisation à chaque fois: elle doit se faire « de façon intelligente », d'elle-même.

## Contraintes vérifiées (ne pas re-dériver)

- Décision déjà prise par le humain dans ce projet: `synced: false` vaut VERROU — un ticket qui porte des modifications locales non synchronisées est considéré « en vol » et aucun autre agent ne doit le prendre (voir ticket 0008). Un sync qui se déclenche tout seul doit donc savoir s'il est en train de publier l'état d'un agent encore au travail, ou de libérer un verrou.
- Décision déjà prise: `applyTicketSync` doit retourner un résultat TYPÉ par ticket (`{ticket, outcome: "synced"|"blocked"|"hydrated"|"skipped", detail}`) au lieu de l'actuel `Promise<string[]>` (voir ticket 0007). Un déclenchement automatique a besoin de ce résultat structuré pour décider quoi faire d'un échec sans intervention humaine.
- Décision déjà prise: politique de conflit = detect-and-block. Un sync automatique ne doit JAMAIS résoudre un conflit tout seul; il doit s'arrêter et le signaler.
- `src/tickets/sync.ts:246-252` persiste le fichier après CHAQUE mutation pour qu'un crash en milieu de lot reste reprenable et ne reposte pas les commentaires déjà postés. Tout déclenchement automatique doit préserver cet invariant.
- ADR 0001 (`docs/decisions/0001-local-ticket-buffer-and-github-sync.md`), section « 2. Throttling between `gh` calls », a déjà statué sur le rythme des appels `gh`. Un déclenchement automatique augmente mécaniquement la fréquence des appels et doit respecter ce throttling — et l'ADR doit être relu, pas contourné.

## Questions à trancher dans le ticket (ne pas décider unilatéralement)

- Quel est le déclencheur: à la fin de chaque action d'agent, sur un débounce temporel, à la fin d'une session, sur un hook Claude Code, ou une combinaison ?
- Que fait le déclenchement automatique quand il rencontre un conflit detect-and-block, sachant que personne ne regarde ? (file d'attente, notification, abandon avec trace)
- Comment éviter l'emballement: un sync automatique qui échoue et se relance en boucle consomme le quota `gh`.

## Dependencies

Dépend du ticket 0007 (résultat typé) et devrait suivre 0008 (verrou), puisque le sens du déclenchement dépend de la sémantique du verrou.

generated_by: tracker
