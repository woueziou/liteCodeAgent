---
name: implementer-progress-journal
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# The progress journal note (implementer)

Loaded by `implementer` before writing its first progress-journal note (after step 3, and after each step a resume needs to know about: implementing, PR opened, review passes invoked, an approved ADR committed). Post it as a ticket note (`bunx litecodeagent ticket note --project <primary-checkout> <NNNN> --file <path>`) ending in this fenced block:

  ````
  ```progress-journal
  step: <e.g. "step 4: implement" or "step 7: PR opened">
  worktree: ../worktrees/<NNNN>
  branch: <branch name>
  base: <branch this was created off — usually main>
  commit: <sha of last local commit, or "none">
  checks: <e.g. "bun run check: pass" or "not yet run">
  pr: <PR url, once one exists>
  ```
  ````

Include only fields that apply; `litecode resume` reads the latest. Never post this and the ADR gate's `resume-manifest` for one step.
