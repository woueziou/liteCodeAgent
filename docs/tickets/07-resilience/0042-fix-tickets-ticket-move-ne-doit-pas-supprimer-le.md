---
schemaVersion: 2
id: 0042-fix-tickets-ticket-move-ne-doit-pas-supprimer-le
title: "fix(tickets): ticket move ne doit pas supprimer les clés de frontmatter inconnues"
label: bug
status: readyToMerge
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

### 2026-09-28 — implementer: PR ouverte, revue terminée, prête à merger

PR: https://github.com/woueziou/liteCodeAgent/pull/79 (branche `fix-ticket-move-frontmatter/0042`, commit final `4dc38c0`)

Implémentation : `Ticket` porte désormais `extraFrontmatter` (clés inconnues, valeur + ordre du fichier), rempli par `parseTicket` et réécrit par `serializeTicket` après les clés connues — `ticket move` les conserve donc sans condition. Un premier passage avait aussi supprimé le gate `--force` de `ticket migrate`/`litecode upgrade`, mais bug-hunter a montré que c'était dangereux : ce parseur frontmatter est un lecteur `clé: valeur` par ligne sans notion de listes/maps/commentaires YAML, donc une clé inconnue non scalaire (`tags: [a, b]`, une valeur avec `# commentaire`, une map imbriquée qui écrase un champ réel comme `priority`) est déjà mal lue à l'analyse — la réécrire sans avertir aurait figé cette mauvaise lecture dans le fichier. Le gate refuse-sauf-`--force` a donc été restauré pour `ticket migrate`/`upgrade` uniquement (construit à partir de `Ticket.extraFrontmatter` déjà parsé, plus besoin de relire le fichier) ; `ticket move` reste inconditionnel, ce qui est sûr pour son cas d'usage (pas de changement de schéma, pas de nouvelle analyse). Un deuxième bug non bloquant trouvé et corrigé au passage : `quote()` (`src/frontmatter.ts`) ne traitait pas les retours à la ligne intégrés comme dangereux, ce qui pouvait corrompre un fichier ou créer une clé fantôme au prochain parsing — corrigé.

**reviewer, verdict final (commit 4dc38c0) : `VERDICT: approve`, `FINDINGS: none`.** Confirme la fidélité au plan (la répartition préserver/refuser est une lecture légitime des critères d'acceptation, pas un abandon de la solution préférée), `bun run check`/`bun test` verts (275 tests), attribution correcte sur les 3 commits, aucune ADR nécessaire.

**bug-hunter : trois passages.**
1. Premier passage (commit `f28f206`) : `HUNT: partial` (outil Bash indisponible), findings *plausibles* seulement lues dans le code — newline non échappée dans `quote()`, et clés non scalaires perdant leur sens lors de `ticket migrate`/`upgrade`.
2. Deuxième passage, retry du premier sur le même commit, outils redevenus disponibles : `HUNT: complete`. A confirmé en exécutant réellement le code : (bloquant, confirmé) `ticket migrate --apply`/`litecode upgrade` réécrivaient silencieusement des tickets v1 avec des clés non scalaires (liste YAML, commentaire, map imbriquée écrasant `priority`) sans plus jamais refuser ; (non bloquant, confirmé) `quote()` ne gérait pas `\n`/`\r` ; (non bloquant) doc `--force` obsolète dans `cli.ts`/`docs/upgrading-to-1.0.md` ; (non bloquant) `unknownKeys` devenu mort avec un commentaire mensonger.
3. Troisième passage (re-hunt obligatoire après le fixup, commit `f67ac7a`) : `HUNT: complete`. A reproduit et confirmé que les deux corrections marchent (refus sans `--force` sur les cas non scalaires, migration `--force` conservant `epic: payments`, `upgrade` qui skip toujours le ticket à risque, round-trip newline correct). Un seul finding restant, non bloquant (confirmé) : les commentaires du code affirmaient que `ticket move` "never reparses anything", ce qui est faux (il reparse bien, et réémet une clé non scalaire sous une forme différente) — corrigé dans le commit `4dc38c0` (reformulation des commentaires uniquement, aucun changement de comportement), confirmé par le nouveau passage `reviewer` ci-dessus.

Verdicts complets (verbatim) postés sur la PR : https://github.com/woueziou/liteCodeAgent/pull/79#issuecomment-5865017838 (reviewer), #issuecomment-5865023512, #issuecomment-5865028837, #issuecomment-5865033517 (les trois passages bug-hunter).

Ticket déplacé `inProgress` → `readyToMerge`.
