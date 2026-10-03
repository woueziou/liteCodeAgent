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

## Mesure

Rendered size in words of each agent file for the backend-only fixture config (`docs/specs/restructure-baseline/litecode.config.json`, `core` pack, no domain rule). Counted on the output of `buildPlan` (frontmatter included). "Before" matches the 0082 baseline (10,334 words). No agent was run.

| Agent | Avant | Après |
|---|---|---|
| implementer | 2,056 | 2,055 |
| orchestrator | 1,373 | 1,373 |
| tracker | 1,172 | 1,171 |
| reviewer | 1,166 | 1,165 |
| triage | 1,024 | 1,023 |
| dispatcher | 925 | 924 |
| bug-hunter | 904 | 901 |
| planner | 705 | 704 |
| synthesizer | 360 | 360 |
| classifier | 271 | 271 |
| debate-angle | 211 | 210 |
| panel-selector | 167 | 167 |
| **Total (12 agents)** | **10,334** | **10,324** |

The agent text barely changes (an empty `skills:` line is gone, bug-hunter no longer lists two skills, the implementer gains one sentence and loses a duplicated hard-rule line). The saving is in what is installed and announced: expert skill files installed for this backend config go from 2 (`critique-expert`, `security-expert`, preloaded by bug-hunter) to 0, and with the `web` pack added, from 9 to 5 (the 2 core experts plus 7 web skills, then the 5 web skills). A backend ticket no longer pulls any UI skill into an agent's frontmatter.
