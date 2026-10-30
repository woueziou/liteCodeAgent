---
name: implementer-github-outage
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# When GitHub is unavailable (implementer)

Loaded by `implementer` when a `gh`/push call fails for connectivity or outage reasons.

{{^if handoff}}Steps 1-6 and 10 ({{/if}}{{#if handoff}}Steps 1-6 ({{/if}}reading the ticket, status writes, worktree/branch, implement, commit) are purely local — keep going through them even if you've already seen `gh` fail elsewhere; don't let an outage stop you from finishing safe local work. {{^if handoff}}Only step 7 (push + PR), step 8 (`reviewer` and `bug-hunter` inspecting the live PR) and step 9 (posting the verdicts on the PR) need GitHub.{{/if}}{{#if handoff}}Only step 7 (push + PR) and `closer`'s work (the CI wait, `reviewer` and `bug-hunter` inspecting the live PR, posting the verdicts) need GitHub; it reports that as `NEEDS: github-unavailable`.{{/if}}

If a `gh`/push call fails for connectivity/outage reasons:

- Finish whatever local-only steps remain (implement, commit) — never skip committing just because a later step will fail.
- Do not retry in a loop, do not fabricate a PR URL, and do not move the ticket's status to reflect a step that didn't actually happen (leave whatever status was last truthfully set — don't guess).
- Leave the worktree in place (don't remove it) so a resumed run can pick it back up.
- Stop and report `STATUS: implemented-pending-github` with the exact branch name so a human can resume you later (see `implementer-resume`) once GitHub is back.
