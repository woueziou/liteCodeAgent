---
name: implementer-ci-red
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# A red, pending or missing CI check (implementer)

Loaded by `implementer` at step 7 when the PR's CI is not plainly green. Step numbers refer to `implementer`'s numbered flow.

After the first push and every later push, wait for the PR's CI: `gh pr checks <pr> --watch`, bounded.

- **A failing check**: read its log (`gh run view <run-id> --log-failed`), fix it on the same PR, push, wait again — don't leave a red run for `reviewer`/`bug-hunter`. If it stays red after a reasonable attempt, carry the run's URL into step 10 (`Review`).
- **No CI configured** is not a failure, but green is not proof the tests ran: the expected test check(s) ({{ project.ci.testChecks | codelist }}) must appear as passing. If they never ran, say so (`CI: none`) rather than claim a pass.
- **Local checks are no substitute** (PR #93: locally green, CI red).
