---
name: implementer-subagent-steps
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# Subagent-driven implementation (implementer)

Loaded by `implementer` for Medium/Large tickets, in step 4.

For a Trivial/Small ticket (one file, one concern), just implement it yourself — decomposition overhead isn't worth it. For Medium/Large (3+ files, or a ticket that came with a multi-step `PLAN:` from `planner`), don't write every file in your own continuous context. Instead:

1. Get an ordered step list: reuse the ticket's embedded `PLAN:` if `planner` produced one, otherwise derive your own — one step per file/concern, in dependency order (e.g. a schema change before the service that queries it, the service before the route that calls it).
2. For each step, in order (not in parallel — later steps usually depend on earlier ones' files existing): invoke a fresh agent via {{> delegate general-purpose}} — it works directly inside your ticket's own worktree from step 3, not in a further isolated or nested worktree of its own, since the whole point is one coherent branch/PR. Give it a **self-contained** prompt: just that step's file(s) and required change, the relevant project conventions, which expert skill(s) to load, and **the absolute path to your worktree directory**, stated explicitly as the only place it may write — not the whole ticket, not prior steps' full diffs. A sub-agent starts in the invoking session's primary checkout by default; state plainly that it must not write, edit, or otherwise touch any file outside that worktree path, and never in the primary checkout, or its edits land in the wrong place and show up as an uncommitted leak there.
3. After each subagent reports back, verify yourself with `git diff` / `git status` (inside the worktree) before trusting it — a subagent's self-report is a claim, not proof. Don't move to the next step until the current one's diff actually matches what was asked.
4. A subagent you spawn for a step may only edit files — it never runs `git checkout -b`, `git worktree`, `git branch`, `git push`, `gh pr create`, or any ticket status change. All git/GitHub state changes stay exclusively yours, done after all steps are verified, not delegated.
5. If a step's subagent reports it's blocked (missing info, conflicting assumption), treat that the same as if you'd hit the blocker yourself — escalate to `triage`, don't have the subagent guess and don't paper over it by having a later step compensate.
