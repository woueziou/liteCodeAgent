---
schemaVersion: 2
id: 0079-perf-packs-regles-de-lecture-et-d-ecriture-sobre
title: "perf(packs): règles de lecture et d'écriture sobres pour les agents"
label: chore
status: backlog
priority: medium
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Mesuré : à chaque appel, un agent relit tout son contexte accumulé (coût ≈ nombre d'appels × taille du contexte). L'implementer du ticket 0069 a fait 66 appels, un contexte jusqu'à 174 000 tokens, 26 `Write` de fichiers entiers ; `implementer.md` (5 400 tokens) a été lu en entier avec `cat` par l'implementer et par `bug-hunter`.

## Critères d'acceptation
- Un court paragraphe commun (partial ou skill déjà chargé par les agents concernés) énonce : lire des sections (`sed -n`, `grep -n`) plutôt que des fichiers entiers ; ne pas relire un fichier déjà lu ; déplacer ou extraire du texte par script plutôt que réécrire le fichier avec `Write` ; borner les sorties de commande (`| tail`, `| head`).
- Il est référencé par `implementer`, `reviewer` et `bug-hunter`, sans dépasser les budgets de taille existants.
- Un test vérifie sa présence dans les trois agents.
- Fichiers installés régénérés ; `bun run check` et `bun test` passent.

## Plan
1. Rédiger le paragraphe en moins de 100 mots.
2. Le brancher dans les trois agents via le mécanisme de partials existant.
3. Test, régénération.

## Hors périmètre
Découper l'implementer (ticket suivant).
