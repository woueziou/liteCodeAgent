---
schemaVersion: 1
id: 0024-chore-tickets-migrer-les-20-tickets-a-plat-vers
title: chore(tickets): migrer les 20 tickets à plat vers les répertoires d'epic
label: chore
status: done
priority: medium
size: medium
assignedAgent: human
dueDate: 
issue: 
synced: false
syncedAt: 
---

One-time data migration, not source code. Move the 20 existing `docs/tickets/NNNN-xxx.md` files to `docs/tickets/<epic>/NNNN-xxx.md`.

**Blocked** until the epic grouping scheme is settled — several of the 20 existing tickets do not obviously belong to any single epic. Options to be decided by the repo owner (see ADR 0012):
- Arbitrary bucket
- "Miscellaneous" epic
- Manual per-file decision

**Depends on** lot 3 (the recursive reader must exist before files are moved).

**After migration**: verify via `litecode ticket list` that all 20 still parse.

**⚠️ Breaking reference links**: flat paths `docs/tickets/NNNN-xxx.md` are cited in ADRs 0008–0011 and in PR comments — these become dead links. Plan an explicit migration note or an acknowledged cutoff date.

Epic: local-first-tickets
Lot: 4/9

<!-- litecode:comment -->
PR #54 opened, `reviewer` invoked. VERDICT: changes-requested (procedural cap only — no code defect found).

FINDINGS:
- (non-blocking, procedural) The `code-review` skill sub-pass was launched as a background fork and did not return within the reviewer's turn budget; the reviewer's toolset had no way to await it, so it explicitly declined to report on that sub-pass rather than fabricate a clean result.
- (informational, all clean via manual verification) Epic distribution matches exactly (1+5+9+7+7=29, no dup/drop); git history preserved via rename detection for 0001-0020; 0021-0029 correctly new adds; no src/ files touched (verified against true merge-base origin/main@e98958c, no overlap with parallel lot 6); frontmatter edits for 0015/0025 are valid single-line YAML changes consistent with stated rationale; 0012's internal path reference correctly updated; commit carries `Agent: implementer` trailer; README migration note matches the actual diff.

PLAN_FIDELITY: matches — diff does exactly what the PR description and this ticket describe.

REENTRY: no code defect to fix. Either (a) re-run review with a Monitor-capable session so the code-review skill sub-pass can complete, or (b) a human explicitly accepts the manual verification as sufficient for this low-risk, docs-only migration and waives the automated sub-pass, upgrading the verdict to approve with no further diff changes needed.

Full verdict posted verbatim on the PR: https://github.com/woueziou/liteCodeAgent/pull/54#issuecomment-5764802147
<!-- /litecode:comment -->

