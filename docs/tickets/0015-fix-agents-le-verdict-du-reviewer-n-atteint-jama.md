---
schemaVersion: 1
id: 0015-fix-agents-le-verdict-du-reviewer-n-atteint-jama
title: fix(agents): le verdict du reviewer n'atteint jamais la PR sur le chemin Ready to Merge
label: bug
status: review
priority: high
size: small
assignedAgent: implementer
dueDate: 
issue: 43
synced: false
syncedAt: 2026-09-21T15:36:02.564Z
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
PR #47: https://github.com/woueziou/liteCodeAgent/pull/47

Note : un commentaire précédent sur ce fichier ("## Reviewer verdict: changes-requested") était fabriqué par l'implementer précédent et n'a jamais été un vrai verdict de reviewer. Le VRAI verdict, posté sur la PR (https://github.com/woueziou/liteCodeAgent/pull/47#issuecomment-5763383054), est le suivant :

## Verdict de review (réel — remplace le commentaire fabriqué plus haut)

**VERDICT: changes-requested**

**CHECK_OUTPUT:**
```
$ tsc --noEmit
(no errors)
```

**FINDINGS:**
- (blocking) `.claude/.litecode-lock.json` and `.kilo/.litecode-lock.json` are not updated in this diff even though `.claude/agents/implementer.md` and `.kilo/agents/implementer.md` content changed. `src/install.ts` (`~L460-467`) compares on-disk file hash against the *stored* lock hash to decide `drift` vs `update`; since the lock still holds the pre-diff hash, the very next `litecode install --apply` run will see these two files as hand-edited ("Refusing to overwrite files edited by hand since the last install") even though the change came from a legitimate template update. Fix: regenerate/update the `implementer.md` entries in both lock files (or re-run `litecode install --apply` and include the resulting lockfile diff) so the stored hash matches the new rendered content.
- (non-blocking) A stray blank line was added right before `## Worktree isolation` in both `.claude/agents/implementer.md` and `.kilo/agents/implementer.md` (not present in `packs/core/agents/implementer.md`'s corresponding spot in the same way — worth a quick look, likely harmless render artifact, but flagging since it wasn't called out in the PR description).
- (informational, not a finding against this diff) The `code-review` skill sub-pass invoked during this review was launched as a background task and did not return a result within this review's turn. Per policy this caps the verdict at `changes-requested` regardless of what the manual read above found — a completed correctness pass has not actually run yet.

**PLAN_FIDELITY:** matches. Step 9 now posts `reviewer`'s verbatim verdict via `gh pr comment` on *both* the `Review` and `Ready to Merge` paths (old step 9 renumbered to step 10), closing the gap described in #43. The ADR 0010 boundary is made explicit in the new step 9 text: it states a PR comment is not a GitHub Project mutation and is out of `sync`'s exclusive scope, consistent with `tests/agents-sync-only-gh.test.ts`'s existing allowlist (`gh pr comment`/`gh pr create` are out of scope for that test's forbidden-substring scan; no forbidden substring was introduced). The three files (`packs/core`, `.claude`, `.kilo`) are consistent renders of the same template change. Commit carries the required `Agent: implementer` / `Task: #43` trailer, no `Co-Authored-By:`, and the PR description has no generated-with footer.

**REENTRY:**
- Lock-file staleness → same-PR fixup (small, same ticket): update both `.litecode-lock.json` files' `implementer.md` hash entries before merge.
- Stray blank line → same-PR fixup, optional cleanup, can be folded into the lock-file fixup commit.
- `code-review` non-return → re-run the `code-review` sub-pass (foreground or awaited) on the next revision of this PR before it can be approved; do not merge on this review's verdict alone.

## Suite (fixup appliqué par implementer)

- Les deux `.litecode-lock.json` (`.claude`, `.kilo`) ont été régénérés via un vrai run de `bun run src/cli.ts install --apply --force` dans le worktree ; seules les entrées `agents/implementer.md` ont été retenues (les 24 autres fichiers marqués `update` sont un drift pack-vs-lock préexistant sur `main`, hors scope de ce ticket, non touchés). `litecode install` (dry run) confirme `ok` sur les deux fichiers, plus de DRIFT.
- La ligne vide parasite avant `## Worktree isolation` est bien un artefact du moteur de rendu (`{{#if project.language}}...{{/if}}` avec `project.language` absent ne collabse pas complètement le bloc), reproductible sur un vrai `install --apply` — elle ne vient pas d'une édition manuelle et ne disparaît PAS d'elle-même. Corriger le moteur de rendu serait une décision de conception hors du périmètre mécanique de ce ticket ; la ligne vide est donc laissée telle quelle (non bloquant, déjà qualifié non-bloquant par le vrai verdict).
- `bun run check` (tsc --noEmit) repasse sans erreur après régénération des lockfiles.
<!-- /litecode:comment -->
