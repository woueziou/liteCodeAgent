---
schemaVersion: 1
id: 0030-refactor-tickets-retirer-les-issues-github-ticke
title: refactor(tickets)!: retirer les issues GitHub, tickets purement locaux
label: chore
status: backlog
priority: high
size: large
assignedAgent: human
dueDate: 
issue: 
synced: false
syncedAt: 
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
