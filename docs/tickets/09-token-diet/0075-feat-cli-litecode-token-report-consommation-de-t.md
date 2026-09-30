---
schemaVersion: 2
id: 0075-feat-cli-litecode-token-report-consommation-de-t
title: "feat(cli): litecode token-report, consommation de tokens par agent"
label: feature
status: backlog
priority: high
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
On optimise sans mesure. Les transcripts Claude Code (`~/.claude/projects/<projet>/*.jsonl`, sous-agents inclus) contiennent l'usage de chaque requête ; il faut savoir quel agent coûte le plus.

## Critères d'acceptation
- `litecode token-report [--session <id>] [--project <path>]` lit les transcripts du projet et affiche, par agent (session principale et chaque type de sous-agent), les tokens input, output, cache read et cache creation, triés par total décroissant.
- Sans `--session`, la session la plus récente est utilisée.
- Tests avec des transcripts JSONL de fixture.
- `bun run check` et `bun test` passent.

## Plan
1. Déterminer le format des transcripts (champs `usage`, identification du sous-agent) à partir de la documentation et d'un fichier réel.
2. Écrire le parseur et l'agrégation dans `src/`.
3. Brancher la commande dans la CLI.
4. Tests sur fixtures.

## Hors périmètre
Les cibles autres que Claude Code ; le calcul en dollars.
