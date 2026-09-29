---
schemaVersion: 2
id: 0060-fix-tests-tickets-ports-fixes-des-tests-du-dashb
title: "fix(tests,tickets): ports fixes des tests du dashboard, réécriture du frontmatter, bunx dans un worktree isolé"
label: bug
status: planned
priority: high
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Trois points laissés par bug-hunter sur la PR #101 (ticket 0057, ADR 0020).
- tests/dashboard/serve.test.ts utilise des ports fixes (`freshPort()` commence à 41730) : deux `bun test` simultanés, ce qu'on fait dès que plusieurs implémenteurs tournent en parallèle, se heurtent à EADDRINUSE. C'est l'échec « 1 fail + 1 error » non reproductible vu pendant le 0057.
- `appendTicketNote` (ticket note) et `ticket move` relisent puis re-sérialisent tout le fichier : la mise en forme du frontmatter peut changer (guillemets, ordre) alors que seule une note ou le statut devait bouger.
- Dans un worktree isolé neuf, `bunx litecodeagent` peut résoudre une version publiée plus ancienne qui n'a pas encore `ticket note` ni `--project` sur `ticket move` ; non vérifié.

## Critères d'acceptation
- Les tests du dashboard écoutent sur le port 0 (attribué par l'OS) et lisent le port réel ; deux exécutions simultanées de la suite passent.
- `ticket note` n'écrit que la fin du corps, et `ticket move` ne change que la ligne `status:` : le reste du fichier est conservé octet pour octet (test de non-régression sur un frontmatter formaté à la main).
- implementer.md indique quelle commande utiliser pour la CLI quand la version installée n'a pas `ticket note` (détection par `--help` et message clair), ou épingle la version ; le comportement réel de `bunx` dans un worktree neuf est vérifié et documenté.
- Tests pour chaque point.

## Plan
1. tests/dashboard/serve.test.ts : port 0.
2. src/tickets/store.ts, src/cli.ts : écritures ciblées pour note et move.
3. packs/core/agents/implementer.md : résolution de la CLI ; régénérer les agents.
4. tests/.

## Hors périmètre
Changer le format des tickets.
