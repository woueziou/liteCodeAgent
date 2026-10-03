---
schemaVersion: 2
id: 0091-chore-plugin-follow-the-litecode-command-rename
title: "chore(plugin): follow the /litecode command rename"
label: chore
status: done
priority: low
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Parent

`docs/specs/restructure-litecode.md`

## Contexte

Le ticket 0084 renomme la commande dans l'outil en `/litecode` sur chaque install target. Le plugin Claude Code (`bin/`, `.claude-plugin/`) a été restauré depuis (PR #138). Il restait à vérifier ce que « suivre le renommage » veut dire pour lui.

Constat : le plugin n'expose que `/litecode-agent:setup`, préfixé par son nom. La commande du pipeline, `/litecode`, est installée **dans le projet** par `litecode setup` (fichier de workflow du pack), pas par le plugin. Renommer le plugin en `litecode` casserait `litecode-agent@litecode` chez ceux qui l'ont déjà installé, et `tests/plugin.test.ts` fige le nom. On le garde.

Ce qui était réellement périmé : le skill `setup` décrivait un parcours qui n'existe plus (valeurs `TODO` à compléter, `litecode install`, `litecode ticket doctor`, `litecode init --yes` puis édition à la main).

## Critères d'acceptation

- [x] Décider où vit le plugin (ce dépôt ou un autre) et le versionner avec la CLI : ce dépôt, et `tests/plugin.test.ts` vérifie que sa version suit celle de `package.json`.
- [x] La commande du plugin est cohérente avec `/litecode` : le skill `setup` suit le parcours actuel (`setup`, `setup --apply`, `doctor`) et dit que `/litecode` apparaît dans le projet après l'installation. Le plugin garde son nom `litecode-agent`.
- [x] Le test des métadonnées du plugin passe, et un nouveau test (`tests/plugin-setup-skill.test.ts`) fige le skill `setup` sur les commandes qui existent.

## Bloqué par

- 0084
