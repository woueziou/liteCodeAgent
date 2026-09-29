---
schemaVersion: 2
id: 0054-feat-implementer-verifier-la-ci-de-la-pr-avant-r
title: "feat(implementer): vérifier la CI de la PR avant readyToMerge"
label: feature
status: inProgress
priority: medium
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Sur la PR #93 (ticket 0050), l'implémenteur a passé le ticket en `readyToMerge` avec « bun test: 399 pass, 0 fail » alors que la CI GitHub de la PR échouait : un test lançait `upgrade` sans `--no-self-update`, ce qui passait en local (branche présente) mais pas en CI (detached HEAD). Ni implementer ni `verify-report` ne regardent l'état des checks de la PR ; l'appelant l'a découvert après coup (`gh pr checks 93`) et a dû corriger lui-même (commit 87507a4).

## Critères d'acceptation
- implementer attend la fin des checks de la PR (`gh pr checks <pr> --watch` ou équivalent, avec une limite de temps) après chaque push et avant de passer en `readyToMerge`. Un check en échec : il lit le log, corrige sur la même PR (fixup), repousse ; sinon le ticket va en `review` avec le lien du run en échec.
- Le rapport `STATUS:` d'implementer inclut l'état des checks (`CI:` pass / fail / pending / none) ; `CHECK_OUTPUT` reste la sortie locale.
- `litecode verify-report` interroge les checks de la PR : un ticket `readyToMerge` avec un check en échec est une erreur ; des checks encore en cours sont un avertissement ; un dépôt sans CI n'est pas une erreur. `gh` indisponible : avertissement « non vérifié », comme les autres sondes.
- Tests : verify-report avec checks en échec / en cours / absents (sondes simulées) ; test de contrat sur implementer.md ; agents installés régénérés.

## Plan
1. src/report/probes.ts : sonde des checks de PR via gh.
2. src/report/verify.ts : règles ci-dessus, champ `CI:` optionnel dans le rapport.
3. packs/core/agents/implementer.md : attente des checks, format de sortie ; régénérer les agents.
4. tests/report-verify.test.ts, tests/agents-*.

## Hors périmètre
Configurer ou modifier les workflows de CI du projet.
