---
schemaVersion: 2
id: 0059-fix-ci-check-une-ci-verte-doit-prouver-que-les-t
title: "fix(ci-check): une CI verte doit prouver que les tests ont tourné"
label: bug
status: backlog
priority: medium
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Findings non bloquants de bug-hunter sur la PR #99 (ticket 0054, vérification de la CI avant readyToMerge). Le plus important : une PR empilée (`--base <branche-de-PR>`, flux « follow-on » d'implementer) ne déclenche pas le job `test` du workflow, qui ne cible que `main` ; `prChecks` peut alors lire « pass » (seul GitGuardian a tourné) sans que la suite ait tourné — exactement l'échec qui a motivé 0054 (PR #93).

## Critères d'acceptation
- `prChecks` distingue « tous les checks passent » de « les checks attendus ont tourné » : si aucun check de test n'a tourné sur la tête de la PR (ex. PR empilée), le résultat est `none`/avertissement, jamais `pass`. Le nom du ou des checks de test attendus est configurable (défaut : `test`).
- Juste après un push, des checks pas encore enregistrés (`no checks reported`) sont attendus pendant une durée bornée avant de conclure `none`.
- `prChecks` réutilise la gestion des limites de débit de src/gh.ts.
- La forme exacte de `gh pr checks --json` et ses codes de sortie sont vérifiés contre la version de gh utilisée, et documentés dans le code.
- Tests avec sondes simulées pour chaque cas.

## Plan
1. src/report/probes.ts : prChecks.
2. src/config.ts : nom des checks de test attendus.
3. packs/core/agents/implementer.md : PR empilée → ne pas conclure sur la CI.
4. tests/report-probes.test.ts, tests/report-verify.test.ts.

## Hors périmètre
Modifier les workflows de CI du projet.
