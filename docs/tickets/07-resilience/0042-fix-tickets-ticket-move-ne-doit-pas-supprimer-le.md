---
schemaVersion: 2
id: 0042-fix-tickets-ticket-move-ne-doit-pas-supprimer-le
title: "fix(tickets): ticket move ne doit pas supprimer les clés de frontmatter inconnues"
label: bug
status: backlog
priority: medium
size: small
assignedAgent: human
dueDate: 
---

Source : finding non bloquant de bug-hunter sur la PR #76 (ticket 0033), reporté dans un ticket à part.

## Contexte
`litecode ticket move` (ajouté par la PR #76) relit le ticket avec `parseTicket` puis le réécrit avec `serializeTicket`. Or `serializeTicket` n'écrit que les clés connues (`KEY_ORDER`, `src/tickets/spec.ts`) : toute clé ajoutée à la main ou par un autre outil (`epic:`, `generated_by:`, `task:`…) disparaît sans avertissement au premier changement de statut. `ticket migrate` a déjà la politique inverse : il détecte ces clés via `unknownKeys()` (`src/tickets/spec.ts`) et refuse sans `--force`. Une autre session a déjà constaté la disparition de `generated_by`/`task` sur le ticket 0032.

## Critères d'acceptation
- `ticket move` conserve les clés de frontmatter inconnues, avec leur valeur et leur ordre, après les clés connues. Solution préférée, puisque changer un statut ne doit rien perdre ; à défaut, refuser comme `ticket migrate`, sauf `--force`.
- Même garantie pour tout autre chemin qui réécrit un ticket existant via `serializeTicket`.
- Tests : un ticket avec `generated_by` et `epic` garde ces clés après `ticket move`.

## Dépendances
Nécessite la PR #76 (ticket 0033), qui introduit `ticket move`.
