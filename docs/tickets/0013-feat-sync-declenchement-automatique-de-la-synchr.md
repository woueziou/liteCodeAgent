---
schemaVersion: 1
id: 0013-feat-sync-declenchement-automatique-de-la-synchr
title: feat(sync): déclenchement automatique de la synchronisation, sans sollicitation humaine
label: feature
status: backlog
priority: medium
size: medium
assignedAgent: human
dueDate: 
issue: 31
synced: true
syncedAt: 2026-09-18T17:34:50.593Z
---

## Demande

Le humain ne veut plus avoir à demander la synchronisation à chaque fois: elle doit se faire « de façon intelligente », d'elle-même.

## Contraintes vérifiées (ne pas re-dériver)

- ~~Décision déjà prise: `synced: false` vaut VERROU (voir ticket 0008)~~ — CORRIGÉ par triage: ticket 0008 (issue #26) a été closed "not planned", jamais implémenté; `synced` reste aujourd'hui un simple flag dirty/pushed-or-not (vérifié dans `src/tickets/spec.ts`/`store.ts`/`sync.ts`). Ne pas supposer de sémantique de verrou. Ce ticket ne doit pas re-dériver le verrou unilatéralement.
- Décision déjà prise: `applyTicketSync` doit retourner un résultat TYPÉ par ticket (`{ticket, outcome: "synced"|"blocked"|"hydrated"|"skipped", detail}`) au lieu de l'actuel `Promise<string[]>` (voir ticket 0007). Un déclenchement automatique a besoin de ce résultat structuré pour décider quoi faire d'un échec sans intervention humaine.
- Décision déjà prise: politique de conflit = detect-and-block. Un sync automatique ne doit JAMAIS résoudre un conflit tout seul; il doit s'arrêter et le signaler.
- `src/tickets/sync.ts:246-252` persiste le fichier après CHAQUE mutation pour qu'un crash en milieu de lot reste reprenable et ne reposte pas les commentaires déjà postés. Tout déclenchement automatique doit préserver cet invariant.
- ADR 0001 (`docs/decisions/0001-local-ticket-buffer-and-github-sync.md`), section « 2. Throttling between `gh` calls », a déjà statué sur le rythme des appels `gh`. Un déclenchement automatique augmente mécaniquement la fréquence des appels et doit respecter ce throttling — et l'ADR doit être relu, pas contourné.

## Questions à trancher dans le ticket (ne pas décider unilatéralement)

- Quel est le déclencheur: à la fin de chaque action d'agent, sur un débounce temporel, à la fin d'une session, sur un hook Claude Code, ou une combinaison ?
- Que fait le déclenchement automatique quand il rencontre un conflit detect-and-block, sachant que personne ne regarde ? (file d'attente, notification, abandon avec trace)
- Comment éviter l'emballement: un sync automatique qui échoue et se relance en boucle consomme le quota `gh`.

## Dependencies

Dépend du ticket 0007 (résultat typé) — issue #25, MERGÉ (PR #36), satisfait.

~~devrait suivre 0008 (verrou)~~ — ticket 0008 (issue #26) a été CLOSED "not planned" par le owner, jamais implémenté. Ce ticket est donc RE-SCOPÉ pour ne plus dépendre de la sémantique de verrou (voir triage: https://github.com/woueziou/liteCodeAgent/issues/31#issuecomment-5745408296). Scope actuel: déclencheur + gestion de conflit detect-and-block sans surveillance + anti-emballement (throttling `gh`). La sémantique "en vol vs verrou libéré" est retirée des critères d'acceptation; un suivi lock-aware nécessitera une décision humaine sur la replanification de 0008 avant d'être scopé.

generated_by: tracker

<!-- litecode:comment -->
`implementer` opened PR #40 (branch `feat/auto-ticket-sync/issue-31`) implementing this ticket: `litecode ticket sync --auto` with a persisted cooldown (`tickets.autoMinIntervalMs`, overridable via `LITECODE_TICKET_AUTO_SYNC_MIN_INTERVAL_MS`) and a durable blocker trace file (`tickets.autoStateFile`) for detect-and-block conflicts on unattended runs.

The PR went through 4 review rounds with real fixes each time (all verified independently by `reviewer` against the actual diff at each head commit, with `bun run check`/`bun test` passing clean throughout):
1. `LITECODE_TICKET_AUTO_SYNC_MIN_INTERVAL_MS` was documented but not implemented — fixed (`resolveAutoMinIntervalMs`, mirroring ADR 0001's `throttleMs` pattern).
2. `loadAutoSyncState` threw on a corrupted/truncated state file instead of degrading gracefully — fixed (falls back to `EMPTY_AUTO_SYNC_STATE`), plus 3 smaller non-blocking fixes (empty-string env var, stale `fix` text on recurring blockers, missing `.gitignore` entry for the state file).
3. Round-2 fixes independently re-verified clean — no new findings.
4. A genuine `code-review` skill pass then found the round-2 fallback (`EMPTY_AUTO_SYNC_STATE`, no `lastAttemptAt`) itself fails *open*: a corrupted file reads as "never attempted," silently bypassing the cooldown in exactly the failure mode (process killed mid-write) most likely to recur — fixed (`loadAutoSyncState` now falls back to the corrupted file's own mtime as `lastAttemptAt`, so the cooldown still applies once; verified end-to-end via `shouldSkipForCooldown` in a new test).

**Round 5 (current) verdict: `changes-requested`, but for a process reason, not a code defect.** `reviewer` explicitly reports: the round-4 fix is genuinely correct (independently re-verified against `loadAutoSyncState`, the `cli.ts` call site, and the rewritten test, which exercises the fail-closed path end-to-end via `shouldSkipForCooldown`, not just "doesn't throw"); `bun run check` and `bun test` (138 pass) are clean on the exact head commit (`1b401ce`); the `.gitignore` doc-only fix matches what was asked. The only open item is that `reviewer`'s own invocation of the `code-review` skill did not return synchronously in its environment (no `Monitor` tool available to await it), and it declined to substitute its own manual read (which found nothing wrong) for that required pass — so it capped the verdict rather than approving on incomplete tooling. `reviewer`'s own words: "no code fixup needed — the only open item is process, not a code defect... If that pass returns clean (which is the likely outcome given my own read of the diff found nothing), this can move straight to approve without another implementer round-trip."

This ticket is being left in `Review` rather than `Ready to Merge` because the letter of the verdict is `changes-requested`, even though there is no known code defect. A human (or a re-run of `reviewer` with working `code-review` tooling) should confirm PR #40 at head `1b401ce` and move it to `Ready to Merge` if the `code-review` pass comes back clean, without requiring further implementer changes.
<!-- /litecode:comment -->
