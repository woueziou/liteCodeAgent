---
schemaVersion: 2
id: 0071-perf-dispatcher-passer-dispatcher-au-tier-fast
title: "perf(dispatcher): passer dispatcher au tier fast"
label: chore
status: done
priority: medium
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
`dispatcher` est en `tier: balanced` (sonnet) alors que son travail (lire des tickets, trier par priorité/taille/échéance, `ticket move`) est mécanique, comme `tracker` qui est déjà en `fast`.

## Critères d'acceptation
- `packs/core/agents/dispatcher.md` a `tier: fast`.
- Un test vérifie le tier de dispatcher.
- `bun run check` et `bun test` passent ; fichiers installés régénérés.

## Plan
1. Changer le frontmatter.
2. Ajouter l'assertion de tier.
3. Régénérer.

## Hors périmètre
Les autres agents.

### 2026-09-30 — implementer: PR opened and reviewed

PR: https://github.com/woueziou/liteCodeAgent/pull/129 (batch 0071, 0071, 0072). CI: test pass. Reviewer: VERDICT approve; ACCEPTANCE 0070 all satisfied. Installed copies not re-rendered per ADR 0022 (CI regenerates).
