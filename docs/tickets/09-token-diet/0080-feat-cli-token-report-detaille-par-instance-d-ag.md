---
schemaVersion: 2
id: 0080-feat-cli-token-report-detaille-par-instance-d-ag
title: "feat(cli): token-report détaillé par instance d'agent"
label: feature
status: backlog
priority: medium
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
`litecode token-report` (ticket 0075) agrège par type d'agent. Pour comprendre un coût il faut le détail par instance : combien d'appels, taille du contexte au premier et au dernier appel, taille maximale. Cette analyse a dû être faite à la main sur les transcripts.

## Critères d'acceptation
- `litecode token-report --detail` ajoute, pour chaque instance de sous-agent, son type, son nombre d'appels, la taille de contexte du premier appel, la taille maximale et la somme des contextes lus.
- Sans `--detail`, la sortie actuelle est inchangée.
- Tests sur les transcripts de fixture existants.
- `bun run check` et `bun test` passent.

## Plan
1. Étendre l'agrégation dans `src/token-report/aggregate.ts` (par instance, en dédupliquant les messages assistant par identifiant).
2. Ajouter l'option et le rendu.
3. Tests.

## Hors périmètre
Le calcul en dollars ; les cibles autres que Claude Code.
