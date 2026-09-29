---
schemaVersion: 2
id: 0055-fix-setup-prevenir-que-le-premier-commit-se-fait
title: "fix(setup): prévenir que le premier commit se fait sur une branche une fois le garde actif"
label: bug
status: backlog
priority: medium
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Depuis le ticket 0033, `install --apply` (et donc `setup --apply` et `upgrade`) écrit `.githooks/pre-commit` et active `core.hooksPath` quand c'est sans risque. Ce garde refuse tout commit sur la branche par défaut qui ne contient pas uniquement des fichiers de ticket. Un nouvel utilisateur qui suit le démarrage rapide fait ensuite `git commit` de la mise en place sur `main` : le commit est refusé, sans qu'aucune sortie de `setup`/`install` ne l'ait prévenu. Le README l'explique depuis la PR #94, mais la CLI ne dit rien.

## Critères d'acceptation
- Quand `install --apply` (y compris via `setup` et `upgrade`) vient d'activer le garde et que la branche courante est la branche par défaut, la sortie se termine par un avertissement clair : committer la mise en place sur une branche (commande `git switch -c …` suggérée), ou exception ponctuelle `LITECODE_ALLOW_DEFAULT_BRANCH_COMMIT=1`, ou `project.allowDefaultBranchCommits: true`.
- Aucun avertissement quand la branche courante n'est pas la branche par défaut, ni quand `allowDefaultBranchCommits` vaut `true`, ni quand le garde n'a pas été activé (hook préexistant, `core.hooksPath` déjà défini).
- Le message d'erreur de `guard-branch` lui-même rappelle ces trois options (il en cite déjà deux ; vérifier qu'il suggère aussi `git switch -c`).
- Tests : présence et absence de l'avertissement selon chaque cas.

## Plan
1. src/install.ts : après `activateGitHooksPath`, avertissement conditionnel.
2. src/guard-branch.ts : message de refus.
3. tests/install.test.ts, tests/guard-branch*.test.ts.

## Hors périmètre
Changer la politique du garde.
