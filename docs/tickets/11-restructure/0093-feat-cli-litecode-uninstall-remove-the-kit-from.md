---
schemaVersion: 2
id: 0093-feat-cli-litecode-uninstall-remove-the-kit-from
title: "feat(cli): litecode uninstall removes the kit from a project"
label: feature
status: done
priority: medium
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

## Parent

`docs/specs/restructure-litecode.md`

## Contexte

Il n'existe aucune commande pour désinstaller litecode d'un projet. Le README demande de supprimer à la main les fichiers listés dans chaque `.litecode-lock.json`, puis les lockfiles et la config. Décisions du 2026-10-03 (grilling) :

- **Forme** : `litecode uninstall`, aperçu par défaut, `--apply` écrit (déjà non interactif, donc pas de `--yes` : une option inconnue est rejetée).
- **Supprimé par défaut** : les fichiers générés listés dans les lockfiles s'ils ne sont pas modifiés, les lockfiles, les dossiers vides laissés, le hook `pre-commit` de litecode et `core.hooksPath` s'il vaut `.githooks` et que litecode l'a posé.
- **Jamais supprimé** : `docs/tickets/`, `docs/decisions/`, les fichiers de l'utilisateur dans `.claude/` (ses propres skills), les branches et worktrees des agents.
- **Config** : `litecode.config.json` est gardé par défaut ; `--config` le supprime aussi.
- **Fichiers modifiés à la main** (drift) : jamais supprimés par défaut, listés avec la raison ; `--force` les supprime.
- **Hors du projet** (outil lui-même, clone de `install.sh`, plugin Claude Code) : non touchés ; la commande affiche les commandes exactes à lancer.
- **Traces des agents** (branches `…/NNNN`, worktrees) : non touchées ; la commande les signale et dit comment les retirer.

Un ADR est écrit avant le code (suppression de fichiers, difficile à défaire).

## Critères d'acceptation

- [x] Un ADR (format du dépôt) est écrit avant le code : forme de la commande, ce qui est supprimé, jamais supprimé, et la règle sur les fichiers modifiés.
- [x] `litecode uninstall` sans option n'écrit rien : il liste ce qu'il supprimerait, ce qu'il garde et pourquoi, et sort avec le code 0.
- [x] `litecode uninstall --apply` supprime les fichiers générés non modifiés de chaque lockfile présent, puis les lockfiles et les dossiers vides qu'ils laissent, sans toucher à un dossier qui contient encore des fichiers de l'utilisateur.
- [x] Un fichier modifié à la main (empreinte différente de celle du lockfile) n'est pas supprimé par défaut, il est listé avec la raison ; `--force` le supprime.
- [x] Le hook `pre-commit` de litecode est supprimé seulement s'il correspond à son lockfile (non modifié), et `core.hooksPath` est remis à son état d'origine seulement s'il vaut `.githooks` et que litecode l'a posé ; un `core.hooksPath` réglé par l'utilisateur sur autre chose n'est jamais modifié.
- [x] `litecode.config.json` est conservé par défaut ; `--config` le supprime.
- [x] `docs/tickets/`, `docs/decisions/`, et les fichiers hors lockfile de `.claude/` (et des dossiers des autres outils) ne sont jamais supprimés, quelles que soient les options.
- [x] La sortie finale affiche les commandes pour ce qui est hors du projet (`/plugin uninstall litecode-agent@litecode`, `rm -rf ~/.litecode` pour un clone d'`install.sh`) et signale les branches et worktrees d'agents restants avec la façon de les retirer.
- [x] Sans lockfile (projet jamais installé), la commande le dit clairement et sort avec le code 0 sans rien supprimer.
- [x] `litecode --help` liste la commande, `README.md` remplace la procédure manuelle de la section « Upgrading and undoing » par cette commande, et le glossaire gagne le terme si besoin.
- [x] Tests au seam 1 (CLI dans un projet temporaire) : aperçu sans effet, `--apply`, fichier modifié, `--force`, `--config`, hook et `core.hooksPath`, projet jamais installé, données de l'utilisateur intactes ; et une réinstallation (`setup --apply`) après `uninstall --apply` retrouve un projet cohérent.

## Bloqué par

- Aucun (peut démarrer tout de suite).
