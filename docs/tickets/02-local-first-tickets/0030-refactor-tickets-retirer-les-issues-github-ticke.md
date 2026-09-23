---
schemaVersion: 2
id: 0030-refactor-tickets-retirer-les-issues-github-ticke
title: refactor(tickets)!: retirer les issues GitHub, tickets purement locaux
label: chore
status: review
priority: high
size: large
assignedAgent: human
dueDate: 
---

Décision humaine (2026-09-23) : plus d'issues GitHub. Les tickets vivent uniquement dans le buffer local ; les pull requests GitHub restent (`gh pr create`, verdicts postés sur la PR).

À retirer ou adapter :
- l'agent `sync`, `litecode ticket sync` (et `--auto`, `src/tickets/auto-sync.ts`, `src/tickets/sync.ts`) ;
- l'appel `gh issue list` du contrôle anti-doublon de `ticket new` (`fetchOpenIssueDedupeCandidates`) — ne garder que la comparaison locale ;
- le champ `issue`, `synced`/`syncedAt` et les blocs `<!-- litecode:comment -->` (les commentaires deviennent du texte dans le ticket) — attention à la migration des fichiers existants et à `schemaVersion` ;
- les prompts qui lisent ou ferment des issues (`gh issue view`, `gh issue close`, « Closes #n », « Staging a comment instead of calling `gh issue comment` ») : l'implementer, triage, tracker, dispatcher et les skills ;
- `verify-report` : le ticket est désigné par son id local, plus par `#issue` ;
- `tests/agents-sync-only-gh.test.ts`, la doc (README, `docs/tickets/README.md`), et un ADR qui remplace les ADR 0001, 0009 et 0012 sur ce point.

Changement cassant pour les utilisateurs de la CLI (`ticket sync` disparaît).

### 2026-09-23 — claude: implémenté (ADR 0015)

- Schéma v2 : `issue`/`synced`/`syncedAt` supprimés, les notes sont du texte daté dans le ticket. `litecode ticket migrate [--apply]` convertit les fichiers v1 (commentaires en attente conservés en texte) ; `ticket doctor` signale les fichiers v1. Les 30 tickets du dépôt sont migrés.
- Supprimés : `ticket sync` (et `--auto`), l'agent `sync`, `src/tickets/sync.ts`, `src/tickets/auto-sync.ts`, les clés de config d'auto-sync, la recherche `gh issue list` du contrôle anti-doublon.
- `verify-report` lit `TICKET:` (accepte encore `ISSUE:`) et trouve le ticket par son id.
- Prompts : l'implementer lit le fichier ticket, laisse des notes datées, cite le ticket dans la PR au lieu de « Closes #n » ; triage, tracker, dispatcher, reviewer, orchestrator et les skills n'utilisent plus `gh issue`. Un test de pack interdit ce vocabulaire.
- Docs : README, `docs/tickets/README.md`, HANDOFF ; ADR 0015, notes de remplacement dans les ADR 0009 et 0012.

### 2026-09-23 — claude: relectures

`reviewer` : approve, sans constat. `bug-hunter` : HUNT complete, 6 constats non bloquants, tous corrigés — test « `ticket sync` n'existe plus » qui ne pouvait pas échouer, anciens `ISSUE: #n` confondus avec des tickets et numéros non complétés, migration qui fusionnait des commentaires et modifiait des exemples dans les blocs de code, clés de frontmatter inconnues supprimées sans prévenir, schéma futur non signalé, et notes de ticket jamais commitées (l'implementer écrit désormais statut et notes dans son worktree et les commite sur la branche).

### 2026-09-23 — claude: seconde passe de bug-hunter

La correction précédente (statut et notes commités sur la branche du ticket) introduisait 3 problèmes bloquants : `verify-report` acceptait un `blocked` jamais écrit, le `done` d'un ticket de vérification seule restait sur une branche jamais mergée, et triage ne voyait pas le blocage. Décision humaine : retour au checkout principal — les agents y écrivent statut et notes, visibles tout de suite, et l'humain commite les tickets. Également corrigé : un commentaire contenant un bloc de code n'était plus migré (détection des blocs réécrite selon CommonMark), et toute valeur `ISSUE:` est désormais traitée comme un ancien numéro GitHub.
