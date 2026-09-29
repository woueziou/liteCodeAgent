---
schemaVersion: 2
id: 0057-feat-agents-lancer-chaque-implementeur-dans-un-w
title: "feat(agents): lancer chaque implémenteur dans un worktree isolé"
label: feature
status: backlog
priority: high
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Malgré les consignes (ticket 0048 : chemin absolu du worktree, vérification du checkout principal en fin de run), les implémenteurs écrivent encore d'abord dans le checkout principal : 0050 (deux fois), 0052, 0055, 0054 — les quatre agents de la vague du 2026-09-29. Chacun s'en est aperçu et a nettoyé avec `git restore`/`git checkout --`, ce qui effacerait aussi tout travail non commité du propriétaire dans ces fichiers. Cause probable : l'agent démarre dans le checkout principal et des Edit/Write partent de là. L'outil Agent de Claude Code sait lancer un agent dans son propre worktree git (`isolation: "worktree"`) ; les autres cibles ont peut-être un équivalent.

## Critères d'acceptation
- Pour les cibles qui le permettent (au moins claude-code), la délégation vers implementer demande l'isolation par worktree (texte de `src/delegation.ts` / skill chained-implementation / consignes de l'appelant) ; implementer utilise ce worktree comme son worktree de ticket au lieu d'en créer un second.
- Les écritures de ticket (statut, notes), qui doivent se faire dans le checkout principal sur la branche par défaut, passent par une commande qui prend le chemin du checkout principal explicitement (ex. `litecode ticket move --root <main-checkout>` et une commande de note), jamais par Edit/Write relatifs.
- implementer ne nettoie jamais le checkout principal avec `git restore`/`git checkout --` : s'il détecte une fuite, il compare avec son worktree, et seulement si c'est identique octet pour octet il retire sa copie ; sinon il s'arrête et le signale.
- Les cibles sans isolation gardent le fonctionnement actuel, avec la vérification de fin de run.
- Tests : rendu de la délégation par cible ; commande de note/move avec racine explicite ; test de contrat sur implementer.md.

## Plan
1. src/delegation.ts : consigne d'isolation par cible.
2. src/cli.ts / src/tickets : `--root` pour ticket move et une commande `ticket note`.
3. packs/core/agents/implementer.md, skills/chained-implementation : usage ; nettoyage sûr.
4. tests/ + `install --apply`.

## Hors périmètre
Sandbox des outils d'écriture (non disponible dans les harnesses).
