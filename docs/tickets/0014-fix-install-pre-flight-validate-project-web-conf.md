---
schemaVersion: 1
id: 0014-fix-install-pre-flight-validate-project-web-conf
title: fix(install): pre-flight validate project.web config paths required by packs/web templates
label: bug
status: backlog
priority: high
size: small
assignedAgent: human
dueDate: 
issue: 32
synced: true
syncedAt: 2026-09-18T17:35:09.854Z
---

## Bug

`project.web` in `ProjectSchema` (`src/config.ts`) is `.optional()` — a config is schema-valid with it entirely absent. However, every `SKILL.md` under `packs/web` (`frontend-expert`, `design-expert`, `typescript-expert`, `mobile-expert`, `mobile-design-expert`, `mobile-ui-ux-expert`, `ui-ux-expert`) references `project.web.appDir` / `.framework` / `.styling` / `.typeSourceOfTruth` / `.typecheck` / `.apiClient` unconditionally — there is no `{{#if project.web}}` guard anywhere in the pack.

A config that lists `"web"` in `packs` without a `project.web` block is schema-valid today, and will fail `bunx litecodeagent install --apply` mid-render with a raw, confusing `TemplateError` instead of a clear pre-flight message.

This is the exact same bug class that issue #17 was filed to fix for `agentSkills` (see PR #23), but PR #23 deliberately scopes its fix narrowly to `agentSkills` only, per ADR 0006 referenced in that PR — it does not cover `project.web`.

## Repro

1. Create a config listing `"web"` in `packs`, with no `project.web` block.
2. Run `bunx litecodeagent install --apply`.
3. Observe a raw `TemplateError` mid-render instead of a clear pre-flight validation error.

## Possible fixes

1. Widen `missingAgentSkillPaths` (in `install.ts`) to also validate `project.web.*` paths referenced by installed pack templates against the config.
2. A small generalization to cover any top-level `.optional()` `ProjectSchema` section that is referenced unconditionally (no `{{#if}}` guard) by an installed pack's templates — of which `project.web` is one instance, but a more general mechanism would catch future cases too.

Follow-up to #17 / PR #23.
