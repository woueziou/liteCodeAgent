---
name: implementer-github-outage
description: Used by implementer only when gh or git push fails for connectivity/outage reasons mid-flow: which steps stay local, what not to fake, and the implemented-pending-github report.
---

# When GitHub is unavailable (implementer)

Loaded by `implementer` when a `gh`/push call fails for connectivity or outage reasons.

Steps 1-6 and 10 (reading the ticket, status writes, worktree/branch, implement, commit) are purely local — keep going through them even if you've already seen `gh` fail elsewhere; don't let an outage stop you from finishing safe local work. Only step 7 (push + PR), step 8 (`reviewer` and `bug-hunter` inspecting the live PR) and step 9 (posting the verdicts on the PR) need GitHub.

If a `gh`/push call fails for connectivity/outage reasons:

- Finish whatever local-only steps remain (implement, commit) — never skip committing just because a later step will fail.
- Do not retry in a loop, do not fabricate a PR URL, and do not move the ticket's status to reflect a step that didn't actually happen (leave whatever status was last truthfully set — don't guess).
- Leave the worktree in place (don't remove it) so a resumed run can pick it back up.
- Stop and report `STATUS: implemented-pending-github` with the exact branch name so a human can resume you later (see "If you're asked to resume" above) once GitHub is back.
