---
schemaVersion: 1
id: 0016-fix-agents-l-invariant-sync-only-gh-n-est-verifi
title: fix(agents): l'invariant sync-only-gh n'est vérifié que sur les prompts, jamais à l'exécution
label: bug
status: backlog
priority: medium
size: medium
assignedAgent: human
dueDate: 
issue: 44
synced: false
syncedAt: 2026-09-21T15:36:13.172Z
---

> **Recadré le 2026-09-23** après la suppression du board (PR #55, 0026) et le rétrécissement de l'invariant (PR #56, 0029). `gh project` n'est plus une capacité : il n'y a plus de board. Le texte d'origine est conservé plus bas pour l'historique.

## Invariant restant

La surface `gh` qui mute GitHub se limite désormais à `gh issue create` (autorisé : `sync`, `tracker`) et `gh issue comment` (autorisé : `sync`, `implementer`, `reviewer`, `triage`), cf. `tests/agents-sync-only-gh.test.ts`. `gh pr create`/`gh pr comment` restent hors périmètre (légitimes pour `implementer`).

Ce test ne scanne que les **fichiers de prompt**. Il ne dit rien de ce qu'un agent fait réellement à l'exécution. La preuve historique ci-dessous (un implementer qui appelle une commande `gh` interdite, avec succès) vaut toujours pour la surface restante.

À trancher : peut-on vérifier l'invariant ailleurs que dans les prompts ? Pistes non pré-décidées — un hook `PreToolUse` sur `Bash` refusant `gh issue create`/`gh issue comment` hors allowlist ; un wrapper `gh` dans le PATH des agents ; une détection a posteriori dans le rapport d'agent. Le hook vivrait dans le `.claude/settings.json` du projet appelant, que ce CLI ne contrôle pas (même raisonnement que l'ADR 0009, décision 1).

## Contexte d'origine (avant suppression du board)

La PR #41 (issue #27, ADR 0010) a établi que **seul l'agent `sync` mute le GitHub Project**, et l'a rendu vérifiable par `tests/agents-sync-only-gh.test.ts`, dont l'allowlist est réduite à `sync.md` seul.

Ce test scanne les **fichiers de prompt**. Il ne peut rien dire de ce qu'un agent fait réellement à l'exécution.

Preuve immédiate : lors de l'implémentation de l'issue #16, **après** le merge de #41, l'implementer a déplacé le board avec `gh project item-edit` — alors que son propre prompt le lui interdit et que l'invocation le lui interdisait explicitement. L'appel a réussi. Aucun test ne l'a détecté ; c'est une relecture humaine du rapport de l'agent qui l'a repéré.

L'issue #27 avait anticipé exactement ça, en citant la skill `agent-attribution` : « les restrictions d'outils déclarées dans le frontmatter d'un agent ne sont pas une frontière d'application fiable — vérifié : un agent sans Edit/Write déclaré a quand même modifié un fichier ».

À trancher (d'origine) : peut-on vérifier l'invariant ailleurs que dans les prompts ? Pistes non pré-décidées — un hook `PreToolUse` sur `Bash` refusant `gh project` sauf pour `sync` ; un wrapper `gh` dans le PATH des agents ; une détection a posteriori dans le rapport d'agent. Noter que le hook vit dans le `.claude/settings.json` du projet appelant, que ce CLI ne contrôle pas (même raisonnement que l'ADR 0009, décision 1).

generated_by: tracker
