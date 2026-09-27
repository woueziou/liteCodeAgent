---
schemaVersion: 2
id: 0033-feat-guard-imposer-par-le-code-les-regles-de-bra
title: "feat(guard): imposer par le code les règles de branche et de statut"
label: feature
status: inProgress
priority: high
size: medium
assignedAgent: human
dueDate: 
---

Source : audit du 2026-09-27 (litecodeagent vs GSD / Superpowers / Spec Kit), point 1.

## Contexte
Les règles critiques ne vivent que dans la prose des prompts : ne jamais commiter sur la branche par défaut (règle ajoutée à implementer le 2026-09-27), transitions de statut, attribution. `agent-attribution` admet que les restrictions d'outils ne sont pas appliquées ; tout agent peut écrire n'importe quel `status` dans le frontmatter.

## Critères d'acceptation
- Un hook `pre-commit` (dans `.githooks/` et rendu pour les projets cibles) refuse un commit sur `project.defaultBranch`, sauf si la config l'autorise explicitement (ex. `allowDefaultBranchCommits: true`) ou si une variable d'env d'override est posée par l'humain.
- `litecode ticket move <id> <status>` valide la machine d'états (ex. `planned → review` refusé, `inProgress` requis avant `review`/`readyToMerge`) et écrit le statut.
- implementer, dispatcher et triage utilisent `ticket move` au lieu d'éditer le frontmatter à la main.
- Tests couvrant les transitions refusées et le hook.

## Hors périmètre
Hook `PreToolUse` Claude Code : optionnel, à évaluer séparément.
