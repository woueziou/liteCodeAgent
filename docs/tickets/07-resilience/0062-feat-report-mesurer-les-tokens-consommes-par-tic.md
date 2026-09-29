---
schemaVersion: 2
id: 0062-feat-report-mesurer-les-tokens-consommes-par-tic
title: "feat(report): mesurer les tokens consommés par ticket"
label: feature
status: readyToMerge
priority: high
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
L'efficacité en tokens ne peut s'améliorer que si elle se mesure. Aujourd'hui les chiffres viennent de ce que l'outil Agent de Claude Code affiche en fin de sous-agent, relevés à la main ; rien n'est conservé par ticket. `litecode run --usage` mesure déjà tokens et coût pour le runner direct.

## Critères d'acceptation
- Le rapport d'implementer gagne un champ optionnel `TOKENS:` (tokens de l'implémenteur, et des sous-agents quand l'outil les rapporte ; `unknown` sinon), que `verify-report` accepte sans en faire une erreur.
- Chaque exécution d'implementer consigne ses tokens dans son journal de progression (ADR 0018) ; les reprises s'additionnent.
- `litecode ticket list` et le dashboard affichent le total par ticket quand il est connu, et un total par épic.
- Avec le runner direct, les tokens viennent de son rapport d'usage existant, sans saisie de l'agent.
- Tests : parsing de `TOKENS:`, somme sur plusieurs entrées de journal, affichage.

## Plan
1. src/report/verify.ts, src/report/journal.ts : champ TOKENS.
2. src/tickets (list), src/dashboard : totaux.
3. packs/core/agents/implementer.md : sortie TOKENS (une ligne).
4. tests/.

## Hors périmètre
Estimation du coût en devises pour les harnesses natifs.

### 2026-09-29 — implementer: PR opened, reviewed

PR: https://github.com/woueziou/liteCodeAgent/pull/108. reviewer: approve-with-notes. bug-hunter re-hunt: HUNT: complete, no blocking finding. CI: pass.
Deferred, non-blocking (see PR comment): double count if the agent also writes journal tokens under the direct runner; `--ticket` not wired into any flow; prefix-parse leniency; native harnesses cannot see the implementer's own total (design question, likely caller-recorded).

```progress-journal
step: step 10: ready to merge
worktree: ../worktrees/0062
branch: feat-report-tokens/0062
base: main
commit: see PR head
checks: bun run check: pass
pr: https://github.com/woueziou/liteCodeAgent/pull/108
```
