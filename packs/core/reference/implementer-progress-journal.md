---
name: implementer-progress-journal
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# The progress journal note (implementer)

Loaded by `implementer` before writing its first progress-journal note (after step 3, and after each step a resume needs to know about: implementing, PR opened, review passes invoked, an approved ADR committed). Post it as a ticket note (`bunx litecodeagent ticket note --project <primary-checkout> <NNNN> --file <path>`) ending in this fenced block:

  ````
  ```progress-journal
  step: <e.g. "step 4: implement" or "step 7: PR opened">
  worktree: {{ project.worktreeRoot }}/<NNNN>
  branch: <branch name>
  base: <branch this was created off — usually {{ project.defaultBranch }}>
  commit: <sha of last local commit, or "none">
  checks: <e.g. "{{ project.checkCommand }}: pass" or "not yet run">
  pr: <PR url, once one exists>
  ```
  ````

Include only fields that apply; `litecode resume` reads the latest. Never post this and the ADR gate's `resume-manifest` for one step.
{{#if handoff}}

`litecode resume` reads only the LATEST entry, so a handoff entry copies every field forward (`step`, `worktree`, `branch`, `pr`, and `base`, `commit`, `checks`) and adds `handoff` (`closer in flight` before you start `closer`; `returned` once it has answered or failed, written by you, never by `closer`) and `handoffAt` (ISO 8601 UTC time of that write). Example, written before the launch:

  ````
  ```progress-journal
  step: step 8: closer in flight
  worktree: {{ project.worktreeRoot }}/0042
  branch: fix/rate-limit/0042
  base: {{ project.defaultBranch }}
  commit: a1b2c3d
  checks: {{ project.checkCommand }}: pass
  pr: https://github.com/{{ project.repo }}/pull/12
  handoff: closer in flight
  handoffAt: 2026-10-05T10:00:00Z
  ```
  ````
{{/if}}
