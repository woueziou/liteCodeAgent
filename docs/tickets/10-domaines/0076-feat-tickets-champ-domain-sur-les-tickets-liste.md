---
schemaVersion: 2
id: 0076-feat-tickets-champ-domain-sur-les-tickets-liste
title: "feat(tickets): champ domain sur les tickets, liste déclarée dans la config"
label: feature
status: backlog
priority: high
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Plusieurs personnes peuvent travailler sur un même projet, chacune sur un domaine (ex. une personne prend tout ce qui touche à l'UI/UX). Un ticket a un `label` (bug/feature/doc/chore) et un `epic`, mais aucun moyen de dire quel domaine il touche. Le domaine est un simple filtre : il ne réserve pas le ticket à une personne et ne change rien au comportement de `dispatcher` ou `implementer`.

## Critères d'acceptation
- Un ticket accepte un champ frontmatter `domain` : une liste de zéro, un ou plusieurs domaines (un ticket peut toucher `backend` et `security`). Les anciens tickets sans `domain` restent valides.
- La config litecode accepte `tickets.domains` : la liste des domaines connus du projet, avec pour défaut `backend`, `frontend`, `ui`, `ux`, `security`, `infra`, `data`, `docs`, `testing`.
- `litecode ticket new --domain <a[,b]>` renseigne le champ ; `litecode ticket list --domain <x>` filtre ; `--domain` et `--epic` se combinent.
- Un domaine absent de `tickets.domains` est accepté mais `litecode ticket doctor` émet un avertissement (jamais une erreur), qui cite la liste connue.
- Les valeurs sont normalisées en minuscules ; `UI` et `ui` sont le même domaine.
- Le champ `domain` survit à un aller-retour lecture/écriture du ticket, y compris par `ticket move` et `ticket note`.
- Tests couvrant : schéma, config, `ticket new`, `ticket list --domain`, doctor, aller-retour.
- `bun run check` et `bun test` passent.

## Plan
1. Ajouter `domain` à `TicketSchema` dans `src/tickets/spec.ts` (liste de chaînes, défaut vide) et à la sérialisation.
2. Ajouter `tickets.domains` à `TicketsSchema` dans `src/config.ts`, avec la liste par défaut.
3. Ajouter `--domain` à `ticket new` et `ticket list` dans `src/cli.ts`, et à l'aide de la CLI.
4. Ajouter la vérification dans `src/tickets/doctor.ts`.
5. Tests.

## Hors périmètre
Attribuer un domaine à une personne ; empêcher `dispatcher` ou `implementer` de prendre un ticket ; le dashboard (voir le ticket suivant).
