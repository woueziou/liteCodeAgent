---
schemaVersion: 1
id: 0027-docs-purger-les-references-au-board-dans-les-adr
title: docs: purger les références au board dans les ADR, prompts et skills
label: doc
status: review
priority: medium
size: medium
assignedAgent: human
dueDate: 
issue: 
synced: false
syncedAt: 
---

Documentation pass once code stabilizes. Update `docs/decisions/0008` through `0011` (board references), PR comment conventions, and prompt bodies under `packs/` that mention Status/Priority/Size push or `board.json`.

Delete `packs/core/skills/github-project-sync/`.

Update `CLAUDE.md` and the README if they cite `board init`/`board doctor`.

**Coordination**: issue #49 ("prompt bodies assume Claude Code mechanisms on five targets") touches the same prompt files — run this lot in parallel, coordinating to avoid conflicts.

Epic: local-first-tickets
Lot: 7/9

<!-- litecode:comment -->
Two follow-up commits added on PR #58 (https://github.com/woueziou/liteCodeAgent/pull/58, branch `docs/purge-board-refs/issue-0027`):

1. `9b73c96` — removed a leftover dead reference to the deleted `github-project-sync` skill from README.md's pack list.
2. `f3d8743` — pre-empted a merge conflict with sibling PR #56 (both independently touched the same lines of `tests/agents-sync-only-gh.test.ts`): merged both PRs' intents onto this branch (empty `ITEM_ADD_ALLOWED`/`ITEM_EDIT_ALLOWED`, purged `SKILL_ITEM_MUTATION_ALLOWED`/comments of stale board/skill references), then reverted #56's own edit to that file so it no longer conflicts regardless of merge order. Confirmed conflict-free via `git merge-tree` in both directions.

`reviewer` verdict on both commits: **approve**, no findings. `bun run check` clean, `bun test` 145 pass / 0 fail. Full verdict text posted verbatim on the PR: https://github.com/woueziou/liteCodeAgent/pull/58#issuecomment-5767042909

Status already at Ready to Merge; PR shows no merge conflicts.
<!-- /litecode:comment -->

## Réouverture — 2026-09-23

Rouvert après vérification sur `main` (b160f38) : la PR #58 a purgé les ADR, la skill `github-project-sync` et le test d'invariant, mais **pas les corps de prompts**. Ceux-ci décrivent encore une mécanique qui n'existe plus depuis #55 (0026) — `sync` ne pousse que titre/corps/commentaires, jamais `status` (`src/tickets/sync.ts:1-21`, `packs/core/agents/sync.md:22`).

Reste à corriger :

- `packs/core/agents/implementer.md:14` — cite `src/board/spec.ts`, supprimé (le vocabulaire vit dans `src/tickets/spec.ts`).
- `packs/core/agents/implementer.md:57`, `:67`, `:170` — « `sync` pousse le changement de Status vers le board », « l'hydratation de `sync` » : faux, le statut est purement local.
- `packs/core/agents/implementer.md` (autres occurrences de « board item ») — le ticket se déplace dans son fichier local, pas sur un board.
- `packs/core/agents/reviewer.md:53`, `packs/core/agents/orchestrator.md`, `packs/core/workflows/litecodeagent.md`, `packs/core/skills/idea-to-planned/SKILL.md`, `packs/core/skills/chained-implementation/SKILL.md`, `packs/core/agents/dispatcher.md` — vocabulaire « board » / « GitHub Project » à ramener au buffer local.
- `src/tickets/store.ts:77` — commentaire citant `applyTicketHydration`, supprimé.
- `docs/tickets/README.md` — décrit encore GitHub comme source de vérité et `status` comme pull-only (corrigé dans le même lot que cette réouverture).

## Complément livré — 2026-09-23

Branche `docs/purge-board-refs-followup/issue-0027` (basée sur `chore/tickets-status-refresh`) :

- Prompts `implementer`/`triage`/`dispatcher` : un déplacement de statut est une simple écriture locale ; plus de `synced: false` pour un changement de statut seul (cela ne faisait que renvoyer un titre/corps inchangé), plus de push de Status ni d'hydratation. Glob des tickets rendu récursif (`**/*.md`) pour les répertoires d'epic.
- `implementer.md` cite `src/tickets/spec.ts` au lieu de `src/board/spec.ts` ; ADR 0010 remplacé par ADR 0012 partout où il fondait une consigne.
- `reviewer`, `orchestrator`, workflow `litecodeagent`, skills `idea-to-planned`/`chained-implementation`, description de `pack.json` : vocabulaire « board » ramené au buffer local.
- `skills/setup/SKILL.md` : l'étape `litecode board init` (commande supprimée) devient `litecode ticket doctor`.
- `litecode.config.json` : deux leçons propres au code GraphQL du board supprimées ; la leçon générale sur l'encodage des variables `gh api graphql` conservée, reformulée.
- `.claude/data/board.json` et `.claude/data/github-project-item-ids.json` supprimés (listés comme nettoyage restant par l'ADR 0012) ; `project.board` reste dans le schéma pour la compatibilité, conformément à l'ADR.
- `HANDOFF.md` : invariant 4 (board init) remplacé par l'invariant du buffer local.
- Commentaires morts : `src/tickets/store.ts` (`applyTicketHydration`), `src/config-doctor.ts` (`board doctor`) ; titre du test de skills dans `tests/agents-sync-only-gh.test.ts`.
- Copies installées (`.claude/`, `.kilo/`, `.pi/`) régénérées par `litecode install --apply`.

Volontairement non fait : la clé `board_status` du resume-manifest (ADR 0008) est gardée telle quelle pour ne pas casser la reprise de manifests existants.

`bun run check` propre, `bun test` 156 pass / 0 fail. Non passé par `reviewer`.
