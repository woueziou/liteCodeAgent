---
schemaVersion: 1
id: 0003-fix-install-preflight-validate-config-paths-packs-require
title: fix(install): pre-flight validate config paths packs require, plus opt-in `config doctor --fix`
label: bug
status: backlog
priority: high
size: medium
assignedAgent: 
dueDate: 
issue: 17
synced: true
syncedAt: 2026-09-18T16:39:21.901Z
---

## Problem

`bunx litecodeagent install --apply` in a project whose config predates a newer pack fails with a cryptic mid-render error:

```
agents/sync.md: {{ project.agentSkills.sync | join }} is not defined in the project config
```

`src/config.ts:87` declares `agentSkills: z.record(z.string(), z.array(z.string())).default({})`, so omitting the `sync` key is schema-valid and `project.agentSkills.sync` is legitimately `undefined`. But `src/template.ts:124` hard-throws on any undefined lookup. The schema permits absence; the template forbids it. This affects all 8 agent keys (`debate-angle`, `planner`, `implementer`, `reviewer`, `triage`, `dispatcher`, `sync`, `tracker`), and the failure happens mid-render, after the pack-loading loop, so the diagnosis points at a template rather than at the config.

## Why the one-line fix is wrong

Making `| join` treat undefined as `[]` would be actively harmful. `packs/core/agents/sync.md:5` is `skills: {{ project.agentSkills.sync | join }}` **in YAML frontmatter**, and `parseList` (`src/frontmatter.ts:48-49`) turns an empty value into `[]` without error. The install would succeed while silently shipping a `sync` agent stripped of its `github-project-sync` and `agent-attribution` skills. That contradicts the renderer's documented invariant (`src/template.ts:11-12`): "Anything unresolved is a hard error, never a silently empty string: a prompt with a hole in it is worse than a build that fails." Keep the strict template; move the fix to pre-flight validation.

## Key discovery: finishing abandoned work

`requiredPaths` (`src/install.ts:243-247`) already exists with **zero call sites**. Its own doc comment states the intent: "Config paths a set of packs requires, so invalid project config can fail before writes." The expected-key set is derivable from the installed packs, so no hardcoded 8-key list and no `PackManifestSchema` change is needed.

## Plan

1. `src/template.ts` — fix `referencedPaths` (lines 152-158) to strip the `| filter` suffix, mirroring the `split("|")` in `renderLeaf` (line 122). It currently returns `"project.agentSkills.sync | join"`, not a usable path; without this every comparison spuriously fails. Add `tests/template.test.ts` coverage for filter-stripping and for `{{#each}}` item-scoped paths (which must NOT be reported as root-config paths).

2. `src/install.ts` — wire `requiredPaths` into a new `validateRequiredConfigPaths(config, packs)`, mirroring the error shape of `validateSkillReferences` (`src/install.ts:333-338`): name the config file, list each missing path with the pack file(s) referencing it, end with concrete remediation pointing at `config doctor --fix`. Scope to `project.agentSkills.*` leaves only (see ADR open question).

3. **Placement is critical.** Insert the check after the pack-loading loop ends at `src/install.ts:364` and BEFORE the render loop begins at line 366. A placement at ~line 405 (after the render loop) does NOT work: `outputFiles` -> `render` at line 369 throws the raw `TemplateError` first, and the regression test in step 4 would fail. This correction was verified against the code.

4. `tests/install.test.ts` — TDD regression test following the existing pattern at lines 73-77: parse `examples/ts-employee-service.litecode.config.json`, `delete config.project.agentSkills.sync`, assert `buildPlan` rejects with the new actionable error rather than a raw `TemplateError`, and that nothing was written. Add a typo case (`agentSkils`) proving typo detection is preserved. Note: this repo's own config carries all 8 keys, which is why the gap is currently untested.

5. **Opt-in repair** (explicitly requested by the human): add `litecode config doctor` reporting missing required config paths, with a `--fix` flag that fills in missing `agentSkills` keys by reusing `deriveAgentSkills` (`src/init.ts:108-130`, already a pure function returning the full 8-key map). Write through the existing `applyConfigMutation` machinery (`src/config-edit.ts`). Nothing is written without the explicit `--fix` flag — no silent mutation of a user-owned file. Follow the `board doctor` precedent (`src/board/doctor.ts`, wired at `src/cli.ts:413`) for command shape and output.

## Explicitly out of scope

Config `schemaVersion` (the tickets one at `src/tickets/spec.ts:62-68` shipped unused — do not repeat that), automatic migration triggered from `upgrade()` (it only manages the kit clone and never runs for `bunx` users, who have no checkout at all), any silent rewriting of the user's config, and `PackManifestSchema` changes.

## Human's scope decisions

The human chose pre-flight validation **plus** the opt-in `--fix` repair (not validation alone), and a single ticket (the pre-flight already resolves the blocking symptom by turning the error actionable).

## ADR

`docs/decisions/0003-preflight-validate-required-config-paths.md`. Open questions the ADR must settle rather than leave to default:
- Narrow `agentSkills.*`-only scope vs. generalizing to every path `referencedPaths` yields. Generalizing is `requiredPaths`' documented intent but risks false positives on `{{#if}}`-guarded or item-scoped paths. The plan defaults to narrow on reduced-panel confidence; the ADR must justify this actively. **This is the single most important thing for a reviewer to re-examine.**
- Whether missing-entirely and present-but-empty should fail identically.
- Why `schemaVersion`/auto-migration were rejected, and the counter-argument from inside the codebase: `src/init.ts:105-107` warns that hand-maintaining this list "is how it drifts" — which is the argument the opt-in `--fix` is meant to answer.

## Confidence caveat

The planning panel was degraded: the classifier's verdict was unreadable (sizing is the orchestrator's own judgement), and only 1 of 3 debate angles was recoverable — and that one recommended the template fallback the evidence rejects. The narrow scope rests on a thinner base than usual; the reviewer should weigh scope independently.

## Adjacent bug, NOT in this ticket

`src/cli.ts:397-398`: `if (apply && changed) return cmdInstall(...)` means `--apply` silently does nothing when a config edit changed nothing, even if output directories are missing. Observed live in this session ("Nothing to install." while `.kilo/` did not exist). File separately.

---

generated_by: tracker
