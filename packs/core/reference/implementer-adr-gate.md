---
name: implementer-adr-gate
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# ADR draft approval gate (implementer)

Loaded by `implementer` when its step 5 applies (the ticket names an ADR, or you judge one warranted), or when you are resumed to continue past the gate. Step numbers refer to `implementer`'s numbered flow.

{{#if project.adrDir}}
**Already approved (ticket 0067).** When the ticket carries a `## ADR approuvé : <NNNN>` section (`planner` drafted the ADR, `tracker` wrote it into the ticket, a human approved it before the ticket was planned), there is no gate: write the ADR to the path named by the ticket's `ADR:` line (or `docs/decisions/<NNNN>-<kebab-title>.md`) from that section's text, with `generated_by`/`task` frontmatter, commit it in your PR with the rest of the work, and do not stop, post a `resume-manifest` or report `adr-pending-approval`. If the ticket instead carries a `## ADR à valider : <NNNN>` section with no `resume-manifest` block in it (a planning-time draft nobody approved; it should have been refused at planning), stop and escalate to `triage`. A section that does hold a `resume-manifest` is the mid-implementation gate's own draft: follow the gate below. The gate below applies only to an ADR you discover is needed mid-implementation.

An ADR records decisions a human should actually get to weigh in on, not a formality to auto-generate. When step 5 applies:

1. Write the ADR file to its proposed path (or `{{ project.adrDir }}/<NNNN>-<kebab-title>.md`, next free number, if `planner` only flagged "ADR warranted" without a path) — but do **not** `git add`/commit it, and do not push or open a PR yet. Everything else from step 4 may already be committed locally; the ADR is the one thing held back. If the ticket carries `planner`'s `ADR_DECISIONS:` list, rule only on those decisions. If no list exists, state plainly in the draft which decision(s) you're recording and why.
2. Leave the full drafted ADR in a dedicated ticket section, not buried in the middle of a dated note (ticket 0047 — without this, nothing else can find or list a pending draft): using the same `bunx litecodeagent ticket note --project <primary-checkout> <NNNN> --file <path>` mechanism as any other note (never `Edit`/`Write` on the ticket file — same reasoning as "Writing on the ticket" above), append a `## ADR à valider : <NNNN>` heading to the end of the ticket body, `<NNNN>` being the ADR's own number (from its filename, e.g. `0018` for `{{ project.adrDir }}/0018-x.md`), then under it one line saying it is a draft awaiting approval and is not committed, then the full ADR content. Append a fenced `resume-manifest` block right after that content, still inside the same section (not a separate note — see below for why it has to be the same durable artifact). `resume-manifest` is the progress journal's own shape, not a different mechanism (ADR 0008 amended by ticket 0034): same fields the journal already carries (`worktree`, `branch`, `commit`), plus three that only make sense mid-gate (`adr_path`, `board_status`, `adr_posted`) — so `litecode resume` reads this block exactly like any other journal note, no special-casing needed on its side, and `litecode doctor`/`ticket list`/the dashboard's ADR screen can find the draft's full text by reading everything between the section heading and this fence:

   ````
   ```resume-manifest
   worktree: {{ project.worktreeRoot }}/<NNNN>
   branch: <branch name>
   commit: <sha of last local commit, or "none" if nothing committed yet>
   adr_path: <ADR's path, repo-relative>
   board_status: In Progress
   checks_passed: <e.g. "{{ project.checkCommand }}: pass" or "not yet run">
   adr_posted: true
   ```
   ````

   This manifest, not the calling session's memory of this run, is what makes the gate resumable: the file itself lives only in your worktree, which nobody but you can read mid-run, and the invoking session's context is not guaranteed to survive to the point of approval (see step 5). The ticket note is the one artifact that's human-visible and reachable by whoever resumes this from the main checkout — so it has to carry the state, not just the ADR text.
3. Stop and report `STATUS: adr-pending-approval` with the full drafted ADR content (including the manifest block) inline in your report — verbatim, not summarized — plus the ADR's absolute path in your worktree, the path of the ticket file holding the `## ADR à valider : <NNNN>` section, the branch name, and confirmation that code changes (if any) are already committed locally.

   **Whoever invoked you must relay that ADR to the human verbatim, not as a summary.** Your report is not shown to the human directly; a caller who paraphrases it turns "approve this ADR" into "approve my description of it", which is not the same question and not a decision the human actually got to make.
4. Do not proceed to step 6 in the same run. A human reviews the draft and either approves it as-is, asks for edits, or tells you a decision inside it is wrong — only on their explicit go-ahead (in a follow-up message to you) do you commit the ADR (edited if requested) and continue from step 6.
5. If you're resumed specifically to continue past this gate — whether by the same agent process or, more commonly, by a **freshly invoked `implementer`** with no memory of this run (the normal case: the underlying agent/transcript is ephemeral and a same-process resume is not reliable — do not assume it will work, and do not treat a `could not be resumed` error as a blocker to escalate, it's the expected path here) — do not have the calling session reconstruct worktree/branch/commit/ADR-path/actions-done from memory or from re-reading the whole thread. Instead, reconstruct mechanically from the durable artifact:

   - Read the ADR draft in its `## ADR à valider : <NNNN>` section on the ticket file and its `resume-manifest` block. Treat the human's approval message as authorization to act on exactly what that manifest says — not on whatever the caller happens to paraphrase alongside it.
   - Reuse the manifest's `worktree`/`branch` as-is: if the worktree still exists, use it; if it was cleaned up, recreate it with `git worktree add <worktree> <branch>` (checking out the existing branch, never `-b` a new one — the branch already exists).
   - Verify, don't just trust, each manifest field against actual repo state before acting on it: confirm `commit` is present in `git log` on that branch, confirm the ADR file at `adr_path` exists and matches what's in the comment, confirm `checks_passed` by re-running `{{ project.checkCommand }}` rather than assuming it's still true.
   - Treat `adr_posted: true` as an idempotency guard: never add the ADR draft note again on resume, only commit the already-written file.
   - If the manifest note is missing (deleted), unparseable (malformed fenced block), or if multiple ADR-draft notes exist on the same ticket with no single one you can identify as authoritative (prefer the most recent one whose `resume-manifest` block is well-formed and has `adr_posted: true`, but stop if that still leaves genuine ambiguity), do not guess which state to act on — stop and escalate to `triage` with what you found, the same as any other unresolvable blocker. Likewise, if the manifest's `commit` field isn't found in `git log` on the branch, don't assume it's stale-but-harmless — stop and escalate rather than committing on top of state you can't verify. The one exception: `commit: none` is a valid, expected value (it means nothing was committed before the gate — a legitimate ADR-only ticket), so treat that literal value as confirmed with nothing to look up, not as an unverifiable sha.
   - Commit the ADR file (with any requested edits applied) with its own commit, then resume at step 6. Do not re-run step 2's status edit (it's still `In Progress` per the manifest) and do not re-create the branch.

This gate applies per-ADR: a ticket with no ADR skips straight from step 4 to step 6.
{{/if}}
