---
schemaVersion: 2
id: 0050-feat-migrate-importer-une-seule-fois-les-tickets
title: "feat(migrate): importer une seule fois les tickets du board GitHub dans le dépôt"
label: feature
status: planned
priority: medium
size: medium
assignedAgent: human
dueDate: 
---

## Contexte
Migration pour les utilisateurs restés sur l'ancien mode board GitHub (GitHub Project v2 configuré dans `project.board`, issues miroirs des tickets v1) sans avoir migré depuis longtemps. `litecode upgrade` et `ticket migrate` ne convertissent que les fichiers v1 déjà locaux : aucun chemin n'importe les éléments du Project ni les issues sans fichier local, ni leurs champs statut / priorité / taille. C'est une porte de sortie ponctuelle du couplage GitHub (ADR 0015), pas une synchronisation. Recommandation de l'orchestrateur du 2026-09-28 (panel complet, synthèse blocked-compatible), décisions validées par le propriétaire le 2026-09-28.

## Critères d'acceptation
- Nouvelle sous-commande `litecode ticket import-board [--apply]`, distincte de `ticket migrate` (dont le contrat ne change pas). Simulation par défaut ; `--apply` écrit. Lecture seule côté GitHub : aucune écriture, fermeture ou modification d'issue ou d'élément.
- Source : le Project v2 de `project.board.number` (éléments + champs statut / priorité / taille) et les issues liées. Lecture via une fonction en lecture seule de src/gh.ts réutilisant la gestion des limites de débit.
- Nouveau champ optionnel `importedFrom` dans TicketSchema (KEY_ORDER, après `dueDate`) : `github:owner/repo#123` pour une issue, `github-project-item:<id>` pour un brouillon du Project sans issue. Jamais stocké dans `extraFrontmatter` ; jamais retiré une fois écrit.
- Idempotence : comparaison exacte sur `importedFrom` avant écriture. Un élément déjà importé est ignoré, même si l'issue a changé ; aucun écrasement. Relancer la commande reprend là où une exécution interrompue s'est arrêtée.
- Valeur de champ inconnue (statut, priorité ou taille hors des enums locaux) : ticket importé en `backlog` avec un `[À CLARIFIER]` citant la valeur d'origine, ce qui bloque sa planification (ticket 0035).
- Corps : les quatre sections du contrat (0035). Une issue qui ne s'y découpe pas proprement : texte complet sous « Contexte », et « Critères d'acceptation » contient `[À CLARIFIER] critères à définir (importé de #N)`. Aucune section vide.
- Isolation par élément : un échec n'arrête pas l'import. Bilan final importés / ignorés / en échec, avec la raison de chaque échec.
- Écriture via createTicket/writeTicketExclusive (src/tickets/store.ts) ; les tickets importés sont commités sur la branche par défaut comme tout changement de ticket.
- `litecode upgrade` signale la commande quand `project.board` est encore configuré, sans jamais la lancer.
- docs/upgrading-to-1.0.md : nouvelle étape d'import, et section 4 corrigée (les agents commitent désormais les tickets, PR #77). docs/tickets/README.md documente `importedFrom`.
- ADR 0019 rédigé et approuvé avant l'implémentation, reprenant ces décisions.
- Tests dans tests/ : correspondance des champs, valeur inconnue, corps non structuré, idempotence, isolation des échecs, bilan, simulation et `--apply` de la CLI, fonction gh avec stub.

## Plan
ADR : docs/decisions/0019-github-board-import-migration.md
1. src/tickets/spec.ts : champ `importedFrom`, KEY_ORDER, commentaires.
2. src/gh.ts : lecture des éléments du Project et des issues.
3. src/tickets/import-board.ts (nouveau) : mapBoardItem, construction du corps, idempotence, isolation, bilan.
4. src/cli.ts : sous-commande `ticket import-board` et aide.
5. src/project-upgrade.ts : avis quand `project.board` est configuré.
6. docs/upgrading-to-1.0.md, docs/tickets/README.md.
7. tests/import-board.test.ts, tests/ticket-cli.test.ts, test gh.

## Hors périmètre
Synchronisation continue ou bidirectionnelle avec GitHub ; import des commentaires d'issue ; création d'épics depuis les jalons ou itérations (ticket 0040).
