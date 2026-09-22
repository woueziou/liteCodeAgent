---
schemaVersion: 1
id: 0004-feat-regrouper-l-etat-litecodeagent-dans-litecod
title: feat: regrouper l'état LiteCodeAgent dans .litecodeagent/
label: feature
status: done
priority: medium
size: large
assignedAgent: implementer
dueDate: 
issue: 18
synced: true
syncedAt: 2026-09-18T17:28:00.262Z
---

## Objectif

Sortir l'état propre à LiteCodeAgent des dossiers de harness pour le regrouper dans `.litecodeagent/`. La solution ne doit plus se présenter comme un accessoire de Claude.

## Périmètre arrêté par le propriétaire (non rediscutable)

`.litecodeagent/` contient **uniquement l'état propre à litecode** : les lockfiles (aujourd'hui `.claude/.litecode-lock.json`, `.codex/…`, `.pi/…`, `.opencode/…`, `.kilo/…`, voir `src/cli.ts:197-204`) et les données de board (`project.board.dataFile`, défaut `.claude/data/board.json`, et `project.board.itemIdCache`, défaut `.claude/data/github-project-item-ids.json`).

Les agents et skills rendus **restent dans le dossier natif de chaque harness** : Claude Code ne découvre ses agents qu'à `.claude/agents/` et ses skills qu'à `.claude/skills/`, c'est sa convention et elle n'est pas négociable. On ne renomme donc pas le défaut de `outDir`, et on n'introduit ni miroir ni lien symbolique.

## Le risque principal : perte de données silencieuse, pas simple gêne de migration

`readLockfile` qui ne trouve plus son fichier ne lève pas — il renvoie `null`. La détection de dérive en conclut alors qu'aucun fichier n'appartient à LiteCodeAgent, et un `install` suivant peut **écraser des fichiers édités à la main sans aucun avertissement de dérive**. Le repli sur les anciens chemins dans `readLockfile` est donc une exigence d'acceptation, pas une commodité.

Écueil concret et non théorique : `.claude/data/github-project-item-ids.json` est suivi par git et actuellement modifié dans ce repo. Si `board init` repart d'un fichier vide au nouveau chemin, l'état des item-ids se dédouble au lieu de migrer.

## Plan d'implémentation (10 étapes)

1. `src/lockfile.ts` — passer `LOCKFILE_NAME` à un schéma `.litecodeagent/<target>.lock.json` (le nom de cible doit désormais être dans le fichier, puisqu'il n'est plus désambiguïsé par le dossier du harness) ; adapter `readLockfile`/`writeLockfile` aux nouveaux chemins, et ajouter un repli legacy (paramètre supplémentaire ou helper `readLockfileWithLegacyFallback`) qui vérifie aussi l'ancien chemin par cible avant de conclure « pas de lockfile ».
2. `src/cli.ts:197-204` — mettre `lockPaths` de `cmdStatus` de `cmdStatus` aux nouveaux chemins, garder les anciens comme `legacyLockPaths`, et fusionner les deux pour que `litecode status` voie encore les installs d'avant migration.
3. `src/install.ts` — écrire le lockfile au nouveau chemin ; trancher explicitement l'asymétrie de `outDir` (lignes 259-262), soit en la gardant propre à claude-code avec un commentaire qui l'assume et la marque hors périmètre, soit en l'étendant aux autres cibles (lignes 265-277). À décider dans l'ADR, pas à laisser implicite.
4. `src/config.ts:40-41` — nouveaux défauts de `BoardSchema` : `.litecodeagent/board.json` et `.litecodeagent/github-project-item-ids.json` ; ajouter une étape de validation/migration qui détecte une `litecode.config.json` épinglant explicitement les anciens chemins (par opposition à une config qui se contente des défauts) et qui avertit ou réécrit.
5. `src/board/init.ts` — au `board init`, si le nouveau chemin est vide mais que l'ancien `.claude/data/*.json` contient des données, **déplacer** plutôt que repartir de zéro, en journalisant ce qui a bougé.
6. Nouveau `src/migrate.ts` (ou extension d'install) — commande `litecode migrate` : déplace lockfiles et données de board vers `.litecodeagent/`, réécrit les chemins épinglés en config, idempotente et sans effet si déjà migré. Câblée comme sous-commande dans `src/cli.ts`.
7. `.gitignore` — il n'a aujourd'hui aucune règle pour les données de board (seulement node_modules, bun.lockb, *.log, .DS_Store). Ajouter une règle ignorant `.litecodeagent/board.json` tout en gardant `.litecodeagent/github-project-item-ids.json` suivi — et se garder d'une règle large sur `.litecodeagent/` qui emporterait silencieusement le cache d'item-ids.
8. `packs/core/skills/github-project-sync/SKILL.md` — aucun chemin littéral à changer (la skill interpole `{{ project.board.itemIdCache }}`) ; ne mettre à jour que la prose et les exemples qui mentionnent `.claude/data/…`.
9. `CHANGELOG.md` et version — changement cassant par rapport à 0.13.1, avec un texte de guide de migration.
10. Tests — `tests/install.test.ts` (nouveau chemin de lockfile et détection legacy), tests de config (nouveaux défauts, avertissement/migration sur chemin épinglé), `tests/board.test.ts` et `tests/board-apply.test.ts` (`board init` migre les données legacy), `tests/distribution.test.ts` et `tests/packs.test.ts` (les agents et skills rendus atterrissent toujours dans le dossier natif de chaque harness, inchangé), nouveau `tests/migrate.test.ts` (legacy présent → déplacé ; déjà peuplé → sans effet ; config épinglée → réécrite). `bun run check` et `bun test` doivent passer.

## ADR — livrable gated

`docs/decisions/0004-litecodeagent-neutral-state-directory.md`

**Important : utiliser le numéro 0004, pas 0003.** Deux autres plans élaborés en parallèle ont chacun calculé « prochain numéro libre » sans se voir ; 0003 est réservé au ticket « langue de travail » (`docs/tickets/install-config/0002-feat-packs-langue-configurable.md`).

L'implémenteur écrit l'ADR, le poste en commentaire sur l'issue, puis s'arrête sur `STATUS: adr-pending-approval` sans commiter.

Décisions à trancher dans l'ADR :
- Le chemin littéral du nouveau lockfile par cible (`.litecodeagent/<target>.lock.json`, ou une autre convention).
- Le déclencheur de migration : automatique au prochain `install`/`board init`/`status`, `litecode migrate` explicite uniquement, ou les deux.
- Le comportement en conflit, quand `.litecodeagent/` et l'ancien chemin contiennent tous deux des données : qui gagne, ou erreur franche.
- Réécriture automatique ou simple avertissement pour les configs épinglant les anciens chemins, et l'ergonomie de ce choix.
- L'asymétrie de `outDir` : hors périmètre, ou généralisée aux cinq cibles.
- Le partage `.gitignore` (cache suivi, `board.json` ignoré), consigné explicitement.
- L'ampleur du bump semver à partir de 0.13.1 (minor ou major).

## Réserve sur l'origine de ce plan

L'orchestrateur signale lui-même que les retours de `classifier` et `panel-selector` ne lui sont pas parvenus lisiblement : le calibrage « large » et le choix des angles (correctness, contract) sont les siens, et le rapport de l'angle `contract` n'a atteint le synthétiseur que sous forme de paraphrase. À traiter comme un plan solide mais non comme un résultat de panel complet.

---

generated_by: tracker
task: github-project-sync
