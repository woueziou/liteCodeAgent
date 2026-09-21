---
schemaVersion: 1
id: 0015-fix-agents-le-verdict-du-reviewer-n-atteint-jama
title: fix(agents): le verdict du reviewer n'atteint jamais la PR sur le chemin Ready to Merge
label: bug
status: done
priority: high
size: small
assignedAgent: implementer
dueDate: 
issue: 43
synced: false
syncedAt: 2026-09-21T16:26:02.752Z
---

Constat reproduit **cinq fois sur cinq** dans la session du 19-21/09/2026, sur les PR #34, #36, #39, #41 et #42 : chacune a été approuvée par `reviewer`, et **aucune ne porte le moindre commentaire sur GitHub**. `gh pr view <n> --json comments` renvoie 0 pour les cinq.

Deux causes distinctes, toutes deux dans les prompts :

1. **Chemin `Review`** : `implementer.md` étape 9 demande de stager le verdict comme commentaire sur le ticket local. Il n'atteint donc GitHub qu'au prochain `sync` — le propriétaire qui ouvre la PR pour merger ne voit rien.
2. **Chemin `Ready to Merge`** : le prompt ne prévoit **aucune** trace. L'étape 9 ne demande de stager le verdict que lorsqu'on atterrit sur `Review`. Une PR approuvée proprement ne garde donc aucune preuve qu'une review a eu lieu, ni de ce qu'elle a trouvé.

Le cas #42 est explicite : l'implementer a justifié l'absence de commentaire en disant qu'un `approve-with-notes` sans finding ouvert va directement en `Ready to Merge` « sans étape Review, donc sans commentaire requis ». Il suivait correctement le prompt.

Conséquence : les huit passes de review de la PR #41, qui ont trouvé cinq bugs bloquants réels (race à l'écriture concurrente, ticket marqué « synced » avec un push de Status non résolu, `statusEdit()` avalant silencieusement une erreur…), n'ont laissé aucune trace consultable sur la PR.

Piste : le verdict doit être posté sur la PR (`gh pr comment`) sur les DEUX chemins, ou à défaut le staging local doit être suivi d'un `sync` avant que l'implementer rende la main. À trancher : est-ce compatible avec l'invariant « seul `sync` parle à GitHub » (ADR 0010) ? Un `gh pr comment` n'est pas une mutation du GitHub Project — la frontière mérite d'être explicitée.

generated_by: tracker

<!-- litecode:comment -->
Reviewer re-review of PR #47 (commit 47d41a5, fixing the two blocking findings from the prior code-review sub-pass):

VERDICT: changes-requested

CHECK_OUTPUT:
- `tsc --noEmit`: clean, no output/errors.
- `bun test`: 165 pass, 0 fail, 878 expect() calls, 21 files — matches the claimed numbers exactly.

FINDINGS:
- (informational, non-blocking) The `code-review` skill sub-pass (effort medium) was invoked against 47d41a5 in a fresh worktree but did not return within this review's turn budget (~4+ minutes across two background polls, no notification). Reviewer did a manual read-through of the diff instead but explicitly did not treat that as a substitute for the code-review skill's bug-hunting/simplification pass — this is why the verdict is capped at `changes-requested` rather than `approve`/`approve-with-notes`, on process grounds, not because a concrete defect was found.
- (verified, no issue found) Manually diffed `packs/core/agents/implementer.md`, `.claude/agents/implementer.md`, `.kilo/agents/implementer.md` against main — new step 9 fixes both prior findings: requires `--body-file` (never inline `--body`) for posting the verdict, explaining the backtick/`$(...)` injection risk, and adds a verification clause mirroring step 2's pattern, treating a failed/unverified post as a blocker. Step renumbering is consistent across all three rendered files, no unrelated drift in `.kilo`.
- (verified, no issue found) Rebuilt from origin/fix/reviewer-verdict-to-pr/issue-43 in a clean worktree and ran `bun run src/cli.ts install --apply`: `implementer.md` reports `ok` (unchanged) for `.claude`/`.kilo`/`.pi`, confirming the PR's lock hash/version entries for implementer.md genuinely match current file content. The other 26 files reported as needing `update` are pre-existing pack-vs-lock drift already on main, untouched by this PR. Diff touches exactly the expected files — no unrelated files touched.
- Commit trailer check on 47d41a5/e351b1e was not done by reviewer in this pass; implementer has since verified both carry the required `Agent: implementer` trailer.

PLAN_FIDELITY: matches — diff does exactly what the PR describes.

REENTRY:
- code-review sub-pass didn't return: same-PR — re-invoke it (effort medium) before merge; if it surfaces nothing new, verdict can be upgraded to approve/approve-with-notes without further diff changes.
- Commit trailer check: confirmed by implementer (47d41a5, e351b1e both carry `Agent: implementer` / `Task: #43`); no action needed.
<!-- /litecode:comment -->
