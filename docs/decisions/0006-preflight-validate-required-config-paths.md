---
generated_by: implementer
task: "#17"
---

# 0006. Pre-flight validate required config paths, scoped to `agentSkills`

Status: proposed
Date: 2026-09-18

## Context

`bunx litecodeagent install --apply` against a project config that predates a newer pack
fails mid-render:

```
agents/sync.md: {{ project.agentSkills.sync | join }} is not defined in the project config
```

`ProjectSchema.agentSkills` (`src/config.ts`) is `z.record(z.string(), z.array(z.string()))
.default({})`: omitting the `sync` key is schema-valid. `template.ts`'s renderer hard-throws
on any undefined lookup, by design — a rendered agent prompt with a silently-empty hole is
worse than a failed build (see `template.ts`'s own doc comment). The schema permits absence;
the renderer forbids it. That gap is real, but the fix has to live in pre-flight validation,
not in loosening the renderer: making `| join` treat `undefined` as `[]` would make
`packs/core/agents/sync.md`'s frontmatter `skills: {{ project.agentSkills.sync | join }}`
render as an empty list silently, shipping a `sync` agent stripped of skills the project
config never actually opted out of. `requiredPaths` (`install.ts`) already existed for
exactly this purpose, with the doc comment "so invalid project config can fail before
writes," but had zero call sites.

## Decision 1: scope the check to `project.agentSkills.*`, not every path a template references

`referencedPaths` can in principle report every `{{ ... }}` path any pack file uses,
including paths under `{{#if}}` guards and `{{#each}}` blocks. Generalizing pre-flight
validation to "every referenced path must be present" was rejected in favor of narrowing to
`agentSkills` leaves specifically:

- **False positives from `{{#if}}`-guarded paths.** A path only referenced inside an
  `{{#if project.web}}...{{/if}}` block is legitimately absent for a project that never
  installed the `web` pack (`project.web` is `.optional()` in the schema for exactly this
  reason). A path-presence check with no awareness of the guarding condition would demand a
  key the schema, and the human author of `ProjectSchema`, deliberately made optional.
  Building condition-aware validation (walking `{{#if}}` truthiness against the actual config
  before deciding whether a nested path is "required") is real static-analysis work — more
  than this ticket's evidence supports building correctly.
- **`{{#each}}` item-scoped paths are not root config paths at all.** Inside
  `{{#each project.xs}}{{ name }}{{/each}}`, `name` resolves against the loop item first,
  never against `project.name`. `referencedPaths` (now fixed, see Decision 3) already
  excludes these from its output; a generalized required-path check would otherwise need
  the same scope-awareness duplicated in a second place.
- **`agentSkills` is the case this ticket fixes, but it is not the only place with this
  mismatch — see the correction below.** All 8 agent keys (`debate-angle`, `planner`,
  `implementer`, `reviewer`, `triage`, `dispatcher`, `sync`, `tracker`) share the same shape:
  a `z.record` default of `{}` that makes per-key absence schema-valid while every pack file
  assumes presence via `| join`. `angles`/`domains` are `.min(1)`-enforced arrays consumed via
  `{{#each}}` (no per-key absence is possible), and most other fields are required scalars the
  schema itself would reject as missing.

**Correction (post-review):** an earlier draft of this ADR claimed `project.web` was
`.optional()` end-to-end "with schema agreeing with template guards via
`{{#if project.web}}`." That claim was checked against the actual codebase during review and
is false. `project.web` in `ProjectSchema` (`src/config.ts`) is
`z.object({ appDir, framework, apiClient, typeSourceOfTruth, typecheck, styling }).optional()`
— schema-valid when entirely absent — but every `SKILL.md` under `packs/web`
(`frontend-expert`, `design-expert`, `typescript-expert`, `mobile-expert`,
`mobile-design-expert`, `mobile-ui-ux-expert`, `ui-ux-expert`) references `project.web.appDir`
/ `.framework` / `.styling` / `.typeSourceOfTruth` / `.typecheck` / `.apiClient`
**unconditionally, with no `{{#if project.web}}` guard anywhere in the pack**. A config that
lists `"web"` in `packs` without a `project.web` block is schema-valid today and will fail
`install` mid-render with the same raw, confusing `TemplateError` issue #17 was filed to
eliminate — this is a live, reproducible instance of the same bug class today, not a future
hypothetical, and it is **not covered by this ticket's fix**. It is tracked as a separate
follow-up (see Consequences) rather than folded into this PR, since fixing it properly means
widening `missingAgentSkillPaths`'s scope (or a small generalization step), which is real code
change, not a documentation correction.

This scope is deliberately narrow given the evidence available: the planning panel that
produced this ticket was degraded (the classifier's verdict was unreadable, and 2 of 3
debate angles were lost), so this decision rests on direct code inspection during
implementation rather than a full debate. That inspection missed the `project.web` gap above
on the first pass; it was caught in review, not by the original analysis, which is itself
evidence for why this ADR asked for independent re-examination rather than being accepted on
authority.

**Alternative considered and rejected: generalize now, accept some false positives.**
Rejected because a pre-flight check that produces its own false-positive install failures
(on a legitimately optional path) is worse than the bug it fixes — it would replace one
confusing failure with a different one, on a green install that should have succeeded.

## Decision 2: an entirely-missing key is an error; a present-but-empty key is not

`missingAgentSkillPaths` (`install.ts`) treats `config.project.agentSkills.sync === undefined`
(key absent) as the failure, and `config.project.agentSkills.sync === []` (key present, empty
array) as valid. These are not the same thing and must not be conflated:

- An absent key is the exact bug this ticket fixes — the schema allows it, the renderer
  doesn't, and there's no way for the project to have expressed an actual choice, because
  the pack introducing the requirement didn't exist yet when the config was written.
- An empty array is a project explicitly saying "no skills preloaded for this agent," which
  `| join` renders as an empty string without error — a legitimate, already-supported
  configuration, not a gap. Treating it as equally broken would make the doctor demand
  "fixes" for configs that are already correct, on every run, forever.

## Decision 3: `schemaVersion` / auto-migration were rejected, `--fix` is the counter-argument

`src/tickets/spec.ts` already shipped a `schemaVersion` field that has never been read by
any migration code — a hand-maintained version marker with no consumer is dead weight, not a
safety net, and this ticket does not repeat that pattern.

Automatic migration triggered from `upgrade()` was also rejected: `upgrade()` only manages a
git-clone checkout of the kit itself and never runs for the more common `bunx litecodeagent`
invocation path, where there is no local checkout to run a migration step from at all. A
fix tied to `upgrade()` would silently not apply to most installs.

The real tension this ticket has to answer is `src/init.ts`'s own comment on
`deriveAgentSkills`: "Asking a human to maintain this list by hand is how it drifts into
naming skills that no installed pack provides." That argument cuts against *any* required
list a human is expected to keep current by hand — which describes the pre-flight check
itself, not just a rejected migration mechanism. The opt-in `config doctor --fix` is the
direct answer: it reuses `deriveAgentSkills` (the same pure function `init` already trusts)
to compute the missing keys' values mechanically, and writes them only when a human
explicitly runs `--fix` — nothing is silently rewritten, and nothing is hand-maintained. The
validation step never invents values itself; it only ever detects and reports.

## Consequences

- `litecode install`/`config doctor` both fail loudly and specifically the moment an
  installed pack references an `agentSkills` key the config doesn't have, instead of a
  generic mid-render `TemplateError` pointing at a template file that isn't the actual bug.
- The check does not protect against a top-level config section that is schema-`.optional()`
  but referenced unconditionally (no `{{#if}}` guard) by an installed pack's templates. This
  is not a hypothetical future gap: `project.web` is exactly this shape today (see the
  correction under Decision 1) and is currently unprotected — a config with `packs: ["web"]`
  and no `project.web` block will still fail `install` with a raw, confusing `TemplateError`.
  This PR does not fix that; it is filed as a separate follow-up ticket (same bug class as
  #17, tracked and prioritized independently) rather than folded into this diff, since closing
  it means widening `missingAgentSkillPaths`'s scope (or a small generalization step), not
  editing this ADR further.
- If a future pack needs pre-flight validation for a path shape outside `agentSkills`/`web`,
  extending `missingAgentSkillPaths`'s regex scope (or generalizing it) is the place to
  revisit this decision — not a reason to leave the new path unchecked.
