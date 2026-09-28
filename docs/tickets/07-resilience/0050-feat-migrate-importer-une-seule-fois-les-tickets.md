---
schemaVersion: 2
id: 0050-feat-migrate-importer-une-seule-fois-les-tickets
title: "feat(migrate): importer une seule fois les tickets du board GitHub dans le dépôt"
label: feature
status: inProgress
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

## ADR à valider : 0019

Brouillon, non commité — en attente d'approbation humaine avant de continuer l'implémentation (le code de la ticket est déjà implémenté et commité sur la branche, seul cet ADR est en attente).

---
generated_by: implementer
task: "0050"
---

# 0019. `ticket import-board`: a one-time exit from the GitHub Project board

Status: proposed
Date: 2026-09-28

## Context

ADR 0015 made tickets purely local. ADR 0012 removed `board init`/`board doctor`.
`litecode upgrade` and `ticket migrate` cover the file-format side of that migration
(schema v1 → v2), but neither ever reads the GitHub Project (v2) board itself: a project
that configured `project.board.number` and kept using the board past that cutoff has
items — some backed by an issue, some drafts with none — that exist only there, with no
local ticket file at all. There has been no path to bring them into the local buffer.

This is a one-time migration for users who stayed on the old board mode for a long time
without migrating (orchestrator's 2026-09-28 panel synthesis, blocked-compatible), not a
sync: once run, the board and the local buffer are not kept in agreement with each other
going forward. Decisions below were validated by the owner on 2026-09-28.

## Decision

1. **A new, standalone subcommand: `litecode ticket import-board [--apply]`.** It is not
   folded into `ticket migrate`, whose contract (schema-version rewrite of files already
   local) does not change. Simulation by default; `--apply` writes. Read-only on GitHub in
   both modes — nothing about an issue or project item is ever written, closed, or
   otherwise modified. Source: the Project v2 named by `project.board.number`, its items'
   custom fields (status/priority/size), and the linked issues, read via a read-only
   function in `src/gh.ts` (`readBoardItems`) that reuses the existing `gh()` wrapper's
   rate-limit handling rather than shelling out on its own.

2. **A new optional `TicketSchema` field, `importedFrom`** (`KEY_ORDER`, immediately after
   `dueDate`): `github:owner/repo#123` for a ticket imported from an issue-backed item,
   `github-project-item:<id>` for one imported from a draft item with no issue. It is never
   written by anything other than `import-board`, never placed in `extraFrontmatter`, and
   never removed once set — it is the ticket's permanent record of where it came from, and
   the key idempotence (next point) compares against.

3. **Idempotence is an exact string match on `importedFrom`.** Before creating a ticket for
   a board item, `import-board` checks whether any local ticket already carries that exact
   `importedFrom` string; if so, the item is skipped, unconditionally — even if the source
   issue's title/body/fields changed since. Nothing is ever overwritten. This also makes an
   interrupted run resumable for free: re-running only ever acts on items not yet imported,
   with no separate checkpoint state to maintain.

4. **An out-of-enum field value never blocks the import; it forces a clarification
   instead.** When a board item's status, priority, or size value doesn't match a local
   enum (case/label-insensitive), the ticket is still created — in `backlog`, regardless of
   which field(s) were unmapped — with an `[À CLARIFIER]` note in the body citing the
   original value(s) (ticket 0035's marker, which already blocks `ticket move ... planned`
   until a human resolves it). A recognized value on every field maps the ticket's
   `status`/`priority`/`size` directly.

5. **The body contract (0035) is honored even when the source doesn't cooperate.** If an
   issue's body already carries all four `## <heading>` sections with content, that
   structure is kept as-is. Otherwise: the whole body goes under `## Contexte` (or a
   placeholder line if it's empty), `## Critères d'acceptation` gets
   `[À CLARIFIER] critères à définir (importé de #N)`, and — since "no section is ever
   empty" rules out leaving them blank — `## Plan` and `## Hors périmètre` get an
   equivalent `[À CLARIFIER]` placeholder each.

6. **Per-item isolation, with a final tally.** One item failing (a write error, a
   malformed field) does not stop the run; the loop continues and that item is reported as
   failed, with its reason. The command ends with a count of imported/skipped/failed items,
   listing each item's outcome — not just a pass/fail exit code.

7. **Writes go through `createTicket`/`writeTicketExclusive`** (`src/tickets/store.ts`),
   same as every other ticket-creating path, so the same collision-safe numbering and
   exclusive-write guarantees apply. Imported tickets are committed on the default branch
   like any other ticket change (not a special case).

8. **`litecode upgrade` only points at the command; it never runs it.** When
   `project.board.number` is still configured, `upgrade`'s plan lists a skip entry naming
   `ticket import-board` and what it's for. Importing is a one-time, human-approved action
   with judgment calls baked into it (what to do with an unmapped field, what a malformed
   body becomes) — not something an unattended `upgrade --apply` should decide on someone's
   behalf. Since `project.board` is itself one of `cleanConfig`'s obsolete keys, this check
   reads the config file directly rather than the config `upgrade`'s later migrations plan
   against (which has already had `board` stripped) — the same reason `removeLegacyData`
   already reads raw config for `board.dataFile`.

## Consequences

- A project that imports late still gets every board item's issue/draft content, at the
  cost of losing the original board's live status if it wasn't already reflected in a
  recognized field value (falls back to `backlog` + a clarification note instead).
- `importedFrom` is a one-way marker, not a link that's kept live: nothing revisits an
  imported ticket if the source issue changes afterward (out of scope — no continuous or
  bidirectional sync, per the ticket).
- A human still has to review every `backlog`-with-`[À CLARIFIER]` ticket before it can be
  planned; import-board deliberately does not guess a pipeline status or acceptance
  criteria it can't derive safely from the source data.
- `project.board` remains referenced by one code path (`import-board`) after this ticket,
  which is why `upgrade`'s `cleanConfig` migration does not also remove the config schema's
  `board` key — only the individual project's config value, and only once the user has run
  `import-board` and removed it themselves.

```resume-manifest
worktree: ../worktrees/0050
branch: feat-import-board/0050
commit: a3f05d59f58968ccfb5b9c10a338ed5214d9738e
adr_path: docs/decisions/0019-github-board-import-migration.md
board_status: In Progress
checks_passed: bun run check: pass; bun test: 386 pass, 0 fail
adr_posted: true
```

### 2026-09-28 — implementer: ADR draft posted, awaiting approval

Code for ticket 0050 is implemented and committed on `feat-import-board/0050`
(commit `a3f05d5`). `bun run check` and `bun test` pass (386/386). Stopping here per the
ADR draft approval gate: the full ADR 0019 draft is above, in the `## ADR à valider : 0019`
section, with its `resume-manifest`. Not committed, not pushed, no PR opened. Waiting on a
human go-ahead before continuing at step 6 (commit ADR) → step 7 (push + PR) → step 8
(reviewer/bug-hunter).
