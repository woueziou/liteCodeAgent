---
schemaVersion: 2
id: 0068-perf-packs-descriptions-d-agents-et-de-skills-co
title: "perf(packs): descriptions d'agents et de skills courtes, cas rares hors des skills"
label: feature
status: readyToMerge
priority: high
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Au démarrage de chaque session et de chaque sous-agent, le harness charge la description de chaque agent et de chaque skill installé (pas leur corps) : ~1 200 mots (~1,6 k tokens) dans ce dépôt, payés dans chaque contexte. Les plus longues font 70-80 mots (idea-to-planned, agent-attribution, orchestrator, tracker, implementer). Les 9 skills implementer-* (ADR 0021) ajoutent ~300 mots annoncés partout alors que seul implementer s'en sert.

## Critères d'acceptation
- Chaque description d'agent et de skill du pack core tient en 20 mots au plus ; les agents internes (classifier, panel-selector, debate-angle, synthesizer, planner) disent en une ligne qu'ils sont appelés par orchestrator. Un test borne chaque description et le total.
- Les implementer-* ne sont plus des skills enregistrés : fichiers de référence installés à côté des agents, qu'implementer lit avec Read quand le cas se présente (mêmes règles, même test de conservation qu'ADR 0021). Même mécanisme pour d'éventuels reviewer-* (ticket 0064).
- install n'installe un skill d'expertise que s'il est référencé par un agent installé ou demandé par la config.
- Agents installés régénérés ; install/upgrade suppriment les anciennes copies non modifiées des implementer-* skills.

## Plan
1. packs/core : descriptions, déplacement implementer-* vers packs/core/reference/.
2. src/install.ts, src/packs.ts : rendu des fichiers de référence, filtre des skills non référencés, nettoyage.
3. tests/ + install --apply.

## Hors périmètre
Changer le comportement des agents.

### 2026-09-29 — implementer: PR opened, ready to merge

PR: https://github.com/woueziou/liteCodeAgent/pull/113. reviewer: approve. bug-hunter: HUNT complete, one non-blocking finding (agent-attribution filtered) fixed in 0511c41. CI: test pass. Note: the installed `bunx litecodeagent` (1.1.1) lacks `ticket note`/`--project`; used `bun run src/cli.ts` from the primary checkout.
