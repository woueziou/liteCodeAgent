---
schemaVersion: 2
id: 0052-feat-dashboard-autoriser-des-hotes-supplementair
title: "feat(dashboard): autoriser des hôtes supplémentaires pour dashboard --serve"
label: feature
status: backlog
priority: low
size: small
assignedAgent: human
dueDate: 
---

## Contexte
Depuis la PR #85 (ticket 0041), `dashboard --serve` refuse (403) toute requête dont l'en-tête Host n'est pas 127.0.0.1, localhost, [::1] ou la valeur de `--host`, avec le port. Lancé avec `--host 0.0.0.0` (ou `::`) pour être consulté depuis une autre machine, il répond donc 403 : le navigateur envoie l'IP ou le nom réel de la machine. Finding non bloquant de bug-hunter sur la PR #85. Deux autres points non bloquants de la même passe : Host sans port sur le port 80, et casse de `--host` (corrigé dans la PR).

## Critères d'acceptation
- Option `--allow-host <nom[:port]>` répétable (et/ou clé de config `project.dashboard.allowedHosts`) ajoutée à la liste des hôtes acceptés.
- Avec `--host 0.0.0.0` ou `::` sans `--allow-host`, le serveur affiche au démarrage un avertissement expliquant que seules les requêtes locales passeront et comment autoriser un hôte.
- Un Host sans port est accepté quand le serveur écoute sur le port par défaut du schéma (80).
- La protection contre le DNS rebinding reste : aucun joker, aucune acceptation implicite de toutes les IP.
- Tests pour chaque cas ; ADR 0017 complété si la politique de confiance change.

## Plan
1. src/dashboard/serve.ts : liste d'hôtes additionnels, port par défaut, avertissement.
2. src/cli.ts : option `--allow-host` et aide.
3. tests/dashboard/serve.test.ts.

## Hors périmètre
Authentification du dashboard.
