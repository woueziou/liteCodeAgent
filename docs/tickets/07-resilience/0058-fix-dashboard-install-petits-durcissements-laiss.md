---
schemaVersion: 2
id: 0058-fix-dashboard-install-petits-durcissements-laiss
title: "fix(dashboard,install): petits durcissements laissés par bug-hunter sur #96, #97 et #98"
label: bug
status: done
priority: low
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Findings non bloquants laissés hors des PR #96 (0055), #97 (0052) et #98 (0046). Détails dans les commentaires de ces PR.

## Critères d'acceptation
- `--allow-host` sans valeur ne prend pas l'option suivante comme valeur (`repeatedArg` dans src/cli.ts) : erreur explicite.
- `dashboard --serve` affiche au démarrage la liste effective des hôtes autorisés.
- `isWildcardBindHost` reconnaît aussi `--host 0` et `::ffff:0.0.0.0`.
- Un échec d'écriture de `core.hooksPath` pendant `install` est signalé à l'utilisateur (aujourd'hui détecté mais silencieux).
- `primaryCheckoutRoot()` (src/doctor.ts) gère un dépôt bare utilisé comme worktree principal.
- Un test par point.

## Plan
1. src/cli.ts, src/dashboard/serve.ts : les trois points du dashboard.
2. src/install.ts : message d'échec de core.hooksPath.
3. src/doctor.ts : dépôt bare.
4. tests/.

## Hors périmètre
Nouvelles options.

### 2026-09-29 — implementer: PR #105 opened, landed on Review

PR: https://github.com/woueziou/liteCodeAgent/pull/105 (branch fix-small-hardenings/0058; d99d7d7 tests-only, 940ced1 fix). CI: pass.

reviewer: VERDICT approve-with-notes (all criteria satisfied, test-first verified; only non-blocking note: pre-existing report-probes.test.ts gh-stub timeouts, unrelated).

bug-hunter: HUNT: partial (could not build a real bare repo in its sandbox, so listWorktrees `bare` parsing was verified against documented porcelain format and the unit test only). Non-blocking findings:
- isWildcardBindHost still misses spellings such as `0.0`, `0x0`, `::ffff:0:0`, empty `--host ""` (warning only; the Host allow-list still protects). REENTRY: new ticket via triage.
- primaryCheckoutRoot silently falls back to `root` in bare layouts. REENTRY: new ticket via triage.
- hooksPath failure warning discards git's stderr. REENTRY: same-PR fixup or defer.

Landed on Review (not Ready to Merge) because the hunt was partial. Full reports are on the PR.

```progress-journal
step: step 10: landed on Review
worktree: ../worktrees/0058
branch: fix-small-hardenings/0058
base: origin/main
commit: 940ced1
checks: bun run check: pass; bun test (this run): pass
pr: https://github.com/woueziou/liteCodeAgent/pull/105
```
