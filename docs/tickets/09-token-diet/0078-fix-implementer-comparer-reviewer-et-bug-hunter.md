---
schemaVersion: 2
id: 0078-fix-implementer-comparer-reviewer-et-bug-hunter
title: "fix(implementer): comparer reviewer et bug-hunter à la base réelle de la PR"
label: bug
status: backlog
priority: high
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Mesuré sur le run du lot 0070-0072 : `reviewer` a exécuté `git diff main...<branche>` alors que le `main` local était en retard sur `origin/main`. Le diff de 70 Ko (~16 000 tokens) contenait des PR déjà mergées, et il est ensuite relu à chaque appel suivant du sous-agent. `bug-hunter` fait de même sur son propre contexte.

## Critères d'acceptation
- `implementer.md` demande de passer à `reviewer` et `bug-hunter` la base sous la forme `origin/<base>` (après un `git fetch`), jamais le nom de branche local.
- `reviewer` et `bug-hunter` reçoivent la consigne de commencer par `git diff --stat <base>...HEAD` puis de lire les diffs fichier par fichier, ou par `gh pr diff <n> --name-only`, au lieu d'un diff complet en une fois.
- Un test vérifie ces consignes dans les textes de pack.
- Le budget de taille de `implementer.md` (12 000 octets) reste respecté : si besoin, déplacer du texte vers une référence.
- Fichiers installés régénérés ; `bun run check` et `bun test` passent.

## Plan
1. Repérer où `implementer.md` décrit ce qui est passé aux relecteurs (étape 8).
2. Corriger la base et ajouter la consigne de lecture progressive dans `reviewer.md` et `bug-hunter.md`.
3. Test, régénération.

## Hors périmètre
Le contenu des rapports de relecture.
