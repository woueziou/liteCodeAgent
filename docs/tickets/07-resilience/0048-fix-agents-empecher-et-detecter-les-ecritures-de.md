---
schemaVersion: 2
id: 0048-fix-agents-empecher-et-detecter-les-ecritures-de
title: "fix(agents): empêcher et détecter les écritures de source dans le checkout principal"
label: bug
status: done
priority: high
size: medium
assignedAgent: human
dueDate: 
---

## Contexte
Deux fois déjà, le travail d'une branche de ticket est apparu en copie non commitée dans le checkout principal : ticket 0032 (autre session, fichiers src/dashboard/*) et ticket 0045 (packs/core/agents/{implementer,reviewer,bug-hunter}.md et un test, identiques à la PR #83). La seconde a fait échouer `verify-report` pour le ticket 0034, qui travaillait en parallèle sur implementer.md. Cause probable : un sous-agent (étape déléguée, reviewer ou bug-hunter) démarre dans le checkout principal et y écrit, faute de chemin absolu vers le worktree.

## Critères d'acceptation
- implementer passe systématiquement le chemin absolu de son worktree à chaque sous-agent qui peut écrire, avec l'interdiction explicite d'écrire ailleurs ; reviewer et bug-hunter n'écrivent jamais de fichier suivi par git.
- Avant de rendre son rapport, implementer vérifie `git status` du checkout principal : toute modification d'un fichier que sa branche touche est signalée, et nettoyée si elle est identique octet pour octet à sa branche.
- `litecode doctor` signale une modification non commitée du checkout principal identique au contenu d'une branche de ticket ouverte (fuite probable), en nommant la branche.
- Tests : doctor détecte une fuite simulée ; test de contrat sur le prompt implementer.

## Plan
1. packs/core/agents/implementer.md : consignes de délégation et vérification de fin de run ; régénérer les agents.
2. src/doctor.ts : nouveau check « fuite dans le checkout principal ».
3. tests/doctor.test.ts, tests/agents-*.

## Hors périmètre
Sandbox des outils d'écriture par agent (non disponible dans les harnesses cibles).

### 2026-09-28 — implementer: PR ouverte, reviewer + bug-hunter passés, ready to merge

PR: https://github.com/woueziou/liteCodeAgent/pull/86 (branche `fix-agents-write-leaks/0048`, base `main`)

- `reviewer`: `VERDICT: approve` (aucune remarque), critères d'acceptation vérifiés un par un contre `packs/core/agents/implementer.md`, `src/doctor.ts`, `tests/doctor.test.ts`, `tests/agents-no-leak.test.ts`.
- `bug-hunter` pass 1 (commit ac22e2f): `HUNT: complete`, 2 findings bloquants confirmés — (1) la commande de comparaison de la recette « avant de rendre son rapport » comparait `HEAD` du checkout principal (donc `main`) à la branche au lieu de comparer le fichier du working tree à la branche, ce qui ne détectait jamais une vraie fuite ; (2) `checkPrimaryCheckoutLeak` utilisait `git status --porcelain` sans `--untracked-files=all`, donc une fuite dans un nouveau dossier non suivi était masquée par la ligne `?? dir/` collapsée. Les deux corrigées sur le commit 45037db (recette remplacée par `cmp <primary-checkout>/<path> <(git -C <worktree> show HEAD:<path>)` ; doctor passe à `git status --porcelain -z --untracked-files=all` avec parsing NUL, gère aussi renames/quoting).
- `bug-hunter` pass 2 / re-hunt (commit 45037db): `HUNT: complete`, plus aucun finding bloquant. 2 findings non bloquants (fail-safe) — commande de discard qui ne gérait pas une fuite déjà stagée, et l'étape 3 (re-vérification) qui n'utilisait pas `--untracked-files=all` comme l'étape 1. Corrigés dans la foulée sur le commit 7b0ca56.
- `bun run check` et `bun test` (328 tests, 0 échec) verts sur le commit final.
- Les deux findings non bloquants restants de la passe 1 de `bug-hunter` (résolution d'une branche remote-only via `branchesForTicket`/`git show <short>:<path>` ; portée de `branchFileContent` en cas de revert vers le contenu de branche après avance de `main`) sont volontairement reportés — à traiter via `triage`/un nouveau ticket si jugé utile, pas bloquants pour ce ticket.
- Les 4 rapports complets (`reviewer` + les 3 passes de `bug-hunter`) sont postés verbatim sur la PR.
- `git status --short` du checkout principal vérifié propre (aucune fuite) avant ce rapport.
