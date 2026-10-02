---
schemaVersion: 2
id: 0087-feat-packs-load-skills-on-demand-and-merge-web-s
title: "feat(packs): Load skills on demand and merge web skills from seven to four"
label: feature
status: backlog
priority: high
size: large
assignedAgent: human
dueDate: 
importedFrom: 
---

## Parent

`docs/specs/restructure-litecode.md`

## Contexte

Plus aucun agent ne précharge de skill : ils se chargent à la demande par les règles de routage. Les skills web passent de sept à quatre sans perdre de règle. Un ticket backend n'embarque plus les skills UI.

## Critères d'acceptation

- [ ] Aucun agent du pack n'a de skill préchargé dans son frontmatter rendu.
- [ ] Les skills web sont quatre : le design absorbe le petit viewport, l'UX absorbe le tactile avec le bloc de confirmation dédoublonné, le mobile reste seul avec le préambule commun, le frontend et TypeScript restent séparés.
- [ ] Chaque règle des sept skills d'origine se retrouve dans les quatre.
- [ ] `upgrade` réécrit les anciens noms de skills dans les règles de routage des projets existants.
- [ ] L'implementer écrit dans son rapport quand aucune règle de routage ne correspond au ticket.
- [ ] Le tableau de mesure de la base (0082) est comparé pour un ticket backend.
- [ ] Tests au seam 2 (rendu des packs) et seam 1 (migration par `upgrade`).

## Bloqué par

- 0082
- 0083
