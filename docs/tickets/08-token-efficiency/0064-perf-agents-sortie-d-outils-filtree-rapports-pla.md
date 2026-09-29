---
schemaVersion: 2
id: 0064-perf-agents-sortie-d-outils-filtree-rapports-pla
title: "perf(agents): sortie d'outils filtrée, rapports plafonnés, relecture unique pour les petits tickets"
label: feature
status: readyToMerge
priority: high
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Mesure du 0063 (small, .gitignore + filtre) : implementer 46 k, reviewer 26 k, bug-hunter 19 k. Les agents lancent la suite complète (~570 tests) plusieurs fois, collent des `gh pr view --json` et des diffs entiers ; les rapports finaux font 1 à 2 k tokens que l'appelant relit ; reviewer.md fait ~2 200 mots.

## Critères d'acceptation
- implementer : tests ciblés pendant le travail, suite complète une fois avant le push ; sorties filtrées (résumé + échecs, `--json` avec `--jq`, `git diff --stat` avant tout diff complet).
- Rapport final d'implementer : bloc STATUS + 10 lignes au plus ; le détail va dans la note du ticket. `verify-report` inchangé.
- Tickets `chore`/`doc` sans changement sous `src/`, et `small` sans logique : une seule passe (reviewer en tier `fast` qui couvre aussi la chasse aux bugs), pas de bug-hunter.
- reviewer.md allégé comme implementer.md (ADR 0021) : cas rares en skills, budget de mots testé.
- Tests de contrat ; agents installés régénérés.

## Plan
1. packs/core/agents/implementer.md, reviewer.md, bug-hunter.md ; skills reviewer-*.
2. tests/ (budget de mots, flux par label/taille).
3. install --apply.

## Hors périmètre
Lots de tickets (ticket séparé).

### 2026-09-29 — implementer: PR #112 opened, landed on Review

PR: https://github.com/woueziou/liteCodeAgent/pull/112 (CI test: pass). reviewer: approve-with-notes. bug-hunter first pass: 1 blocking (single-pass contradiction) fixed; re-hunt: HUNT complete, 1 NEW blocking finding, so Review (no looping).

Open blocking finding (re-hunt): the agents say "Read `reference/<name>.md`" as a bare relative path, but the files install at `<root>/reference/` per target (.claude, .codex, .opencode, .kilo, .pi); sub-agents start in the primary checkout and Pi/runner have no agents dir. implementer-ticket-commits.md is used on every ticket move, so its rules (commit by path, never push, no signing bypass) should be back inline. Fix: template helper rendering the per-target reference dir, expose references to the runner, inline commit rules, per-target install test that the named path exists. Priority High, same-PR fixup.

Non-blocking left: `small` bullet still says "both passes" (one clause); `src/` hard-coded in the single-pass rule (new ticket, deferrable).
Deliberate notes: bug-hunter.md left unchanged (single pass just skips it); the 5 rare-case docs are reference files (not registered skills) per the human's adjustment, including two extra implementer ones (implementer-test-first, implementer-ticket-commits) to fit implementer.md's word budget. Full reports are on the PR.

```progress-journal
step: step 10: Review
worktree: ../worktrees/0064
branch: perf-lean-agents/0064
base: main
commit: see branch tip
checks: bun run check pass; bun test 576 pass
pr: https://github.com/woueziou/liteCodeAgent/pull/112
```

### 2026-09-29 — implementer: same-PR fixup done, Ready to Merge

Fixup 780ddc9 on PR #112: `{{> reference <name>}}` helper renders the real per-target path (Pi/runner served via the first installed target's root); ticket-commit rules inline again (reference file deleted, budget raised to 3150 with justification in the test); "small" bullet fixed; per-target test that each named path exists after install. CI test: pass. bug-hunter re-hunt: HUNT complete, no blocking finding. reviewer earlier: approve-with-notes. Reports on the PR.
Deferred (new tickets, non-blocking): normalize outDir in reference paths; derive REFERENCE_ROOTS from install ROOTS; `src/` hard-coded in the single-pass rule.

```progress-journal
step: step 10: Ready to Merge
worktree: ../worktrees/0064
branch: perf-lean-agents/0064
base: main
commit: 780ddc9
checks: bun run check pass; bun test 579 pass
pr: https://github.com/woueziou/liteCodeAgent/pull/112
```
