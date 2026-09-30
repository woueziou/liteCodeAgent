---
schemaVersion: 2
id: 0069-perf-implementer-alleger-implementer-md-en-depla
title: "perf(implementer): alléger implementer.md en déplaçant les cas rares en références"
label: feature
status: planned
priority: high
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
`packs/core/agents/implementer.md` fait ~21 Ko (~5 000 tokens), rechargés à chaque lancement d'implementer (un par ticket). C'est le plus gros poste fixe du pipeline ; les autres agents font 5-9 Ko.

## Critères d'acceptation
- `packs/core/agents/implementer.md` fait au plus 12 000 octets ; un test le vérifie.
- Les sections retirées vivent dans des fichiers `packs/core/reference/implementer-<nom>.md` avec frontmatter `name`/`description` comme les références existantes, et `implementer.md` les cite dans sa liste « Rare cases live in reference files ».
- Aucun comportement nominal supprimé : les tests existants passent sans modification de leurs assertions (sauf déplacement d'une assertion vers le fichier de référence qui porte désormais le texte).
- `bun run check` et `bun test` passent ; fichiers installés régénérés (`bun run src/cli.ts install --apply --force`).

## Plan
1. Mesurer chaque section de `implementer.md` ; identifier celles qui ne servent pas au flux nominal (ex. détails du flux de relecture par taille, délégation, conflits de merge, rapports sans résultat).
2. Les déplacer dans des références `implementer-*.md`, une ligne de renvoi par cas dans la liste des cas rares.
3. Condenser la prose restante sans changer les règles (phrases redondantes, rappels répétés).
4. Ajouter un test de taille ; adapter les tests dont le texte a déménagé.
5. Régénérer les fichiers installés.

## Hors périmètre
Changer le comportement d'implementer ; les autres agents.
