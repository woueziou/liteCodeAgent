---
generated_by: implementer
task: "#16"
---

# 0011. Optional `project.language` for agent prose

Status: proposed
Date: 2026-09-21

## Context

Issue #16 asks for a `project.language` config key (free text, e.g. `"French"`,
`"Brazilian Portuguese"`) that is interpolated into pack prompts so agent prose,
GitHub content agents write, and generated ADRs follow the project's chosen working
language.

Two earlier debate angles rendered `blocking`, each correct about a different failure
mode of the obvious designs:

- `language: z.string().optional()` with a **bare** `{{ project.language }}`
  interpolation at each injection site: `renderLeaf` (`src/template.ts:124-126`) throws
  `TemplateError` on any undefined path, and `referencedPaths()` (used by
  `requiredPaths()`-style pre-flight validation in `src/install.ts`) walks the raw pack
  sources to determine which config paths must be present — so `litecode install` would
  break for **every existing config** the moment any pack file referenced
  `project.language` at all, since none of them declare it.
- `language: z.string().default("English")` with the same bare interpolation: this
  parses fine for every existing config, but it silently injects a brand-new
  instruction into the rendered prompts of **every existing project** on the next
  `litecode install`, purely as a side effect of upgrading the pack — a behavior change
  disguised as a schema default, with no config diff a human would notice to explain it.

Both angles agreed the field should exist; they disagreed on how to make it safe to
introduce into a config-driven templating system where the absence of a key must not be
distinguishable, in the rendered output, from a key that was never invented.

## Decision

`language: z.string().optional()` **with no `.default()`**, and **every** pack
injection site is wrapped in `{{#if project.language}}…{{/if}}` rather than
interpolating the bare path. `{{#if}}` evaluates truthiness (`src/template.ts:101-103`)
instead of throwing on `undefined`, and the render context is literally
`{ project: config.project }` (`src/install.ts`) — so an absent key skips the whole
block, and `stripStandaloneTags` (`src/template.ts:143-145`) removes the block tags'
own lines, leaving the rendered file byte-identical to today whenever `language` is
absent. That byte-identical property, exercised directly in
`tests/template.test.ts` and across the full example-config render in
`tests/install.test.ts`, is the only part of this feature a machine can actually
verify — nothing can assert on the language an LLM's prose comes out in.

No BCP-47 validation, no enum, no auto-detection: the value is opaque free text passed
straight through to prompts, consistent with the issue's explicit scope decision.
`src/detect.ts`'s `Detected` type has no `language` field and none was added — `init`
asks a plain optional question with no inferred default.

### Injection sites (framed) vs. exclusions (never framed)

Framed with `{{#if project.language}}…{{/if}}`, one short "Working language" section
placed near the top of each file's prose, immediately after its opening paragraph(s):

- `packs/core/agents/implementer.md`, `orchestrator.md`, `reviewer.md`,
  `debate-angle.md`, `triage.md`, `classifier.md`, `synthesizer.md`
- `packs/core/skills/github-project-sync/SKILL.md`

Each framed block states in its own reserve clause exactly which parts of that
specific agent's output format stay in English, rather than a single generic
"translate everything" instruction — the issue's own analysis showed a blanket
instruction would contradict three concrete existing prompts:

- `triage.md`'s `NEXT_STATUS: <Planned | Blocked>` encodes board labels as enum
  values, not prose.
- `reviewer.md`'s `CHECK_OUTPUT:` carries verbatim tool output.
- `sync.md`'s existing instruction to report "verbatim from the command's own output."

Excluded from framing, everywhere, because they are sentinel keys, enum values, or
verbatim passthrough rather than free prose:

- Every sentinel key across all seven agents (`STATUS:`, `ISSUE:`, `BRANCH:`, `PR:`,
  `BLOCKER:`, `CHECK_OUTPUT:`, `SIZE:`, `ROUTE:`, `ANGLE:`, `VERDICT:`,
  `NEXT_STATUS:`, `RESOLUTION:`, `PLAN:`'s own label) and their enum values
  (`approve|approve-with-notes|changes-requested`,
  `trivial|small|medium|large`, `blocking|non-blocking|no-concern`,
  `Planned|Blocked`, and every `STATUS:` value the pipeline agents emit).
- Conventional Commit prefixes and `src/board/spec.ts`'s label/status constants —
  `implementer.md`'s block names these explicitly (plus `litecode ticket new`'s
  `--label`/`--priority`/`--size` flag values), since it is the one agent that writes
  both commits and ticket-CLI invocations directly.
- `reviewer.md`'s `CHECK_OUTPUT:`, `github-project-sync/SKILL.md`'s `gh` flags/arguments
  and status-role names, and any comment text that quotes tool output verbatim — all
  called out explicitly in their respective blocks as never translated.
- `src/board/spec.ts` itself (`PRIORITY_OPTIONS`, `SIZE_OPTIONS`, `REQUIRED_LABELS`,
  `STATUS_ROLES[].label`) is plain TypeScript the template engine never touches, so it
  needed no framing at all — it was already safe by construction.

`orchestrator.md`'s block is a partial exception worth naming: its output structure's
`PLAN:` and `RECOMMENDATION:` fields carry free prose by design (a synthesized
recommendation, not a machine-parsed enum), so those two are named as translatable,
while `SIZE:`/`PANEL:`/`ADR:` and any verbatim `BLOCKING_TENSION` text stay English —
this is the same distinction applied per-field rather than per-agent.

### Wording of the reserve clause

Each block follows the same shape: state which field(s) in that agent's own output
carry translatable prose, then state which stay in English and *why* (sentinel key,
enum value, commit-prefix convention, or verbatim tool-output passthrough) — naming the
reason, not just asserting the rule, so a future editor of these prompts understands
why a given field can't move to the framed set later without breaking something
downstream. `implementer.md` additionally names Conventional Commit prefixes, the
board label constants, and the ticket CLI flag values, since it is the only agent that
produces all three of those directly.

### `stripStandaloneTags` and byte-identical rendering

Every `{{#if project.language}}`/`{{/if}}` pair inserted in this PR is placed on its
own line, with no other content sharing that line — i.e. every one is a "standalone
tag" in `stripStandaloneTags`'s sense (`src/template.ts:143-145`), so its own line is
removed entirely rather than left as a blank line when the block is skipped. This was
verified directly, not assumed: `tests/template.test.ts` exercises this exact pattern
(`{{#if project.language}}` on its own line, body, `{{/if}}` on its own line) and
asserts the absent-key render matches the surrounding text exactly, with no leftover
blank line; `tests/install.test.ts`'s full-render assertions over the example config
(which does not set `language`) additionally confirm no touched pack file regressed
against the pre-existing "no unresolved template syntax" check. No inline (non-standalone)
placement was introduced by this change — every framed block is a standalone section,
never a mid-sentence conditional — so the residual-artifact risk the issue flagged as a
thing to check does not arise here.

### `init`'s question wording

`init` asks: *"Working language for agent prose, e.g. French (blank to keep agents in
English)"*, with no fallback value passed to `ask()`. Pressing Enter without typing
anything returns `""`, which the conditional spread (`...(language ? { language } : {})`)
omits from the written config entirely — the same pattern already used for `web`. The
parenthetical explicitly states what skipping does ("keep agents in English") so a
blank answer is unambiguous relative to typing a language, rather than leaving a user
to guess whether blank means "no preference, detect for me" (out of scope) or "English."

### Example config and its own drift guard

`examples/ts-employee-service.litecode.config.json` deliberately omits `language`, so
it continues to exercise the absent-key path through `tests/install.test.ts`'s existing
"full render produces no unresolved template syntax" test. This PR adds a second copy
of that same test with `project.language` set on the parsed example config
(`tests/install.test.ts`), so both paths — present and absent — run through the actual
shipped example rather than only through synthetic fixtures in `tests/template.test.ts`.
`tests/packs.test.ts` gained two more checks specific to this feature: every
`project.language` reference in any pack file must fall inside a
`{{#if project.language}}…{{/if}}` range, and no line matching a sentinel-key shape
(`^[A-Z][A-Z_]*:`) may contain a `{{ project.language }}` interpolation. Together these
three tests mean a future edit that reintroduces a bare interpolation, an unframed
reference, or an accidental sentinel-line interpolation fails CI rather than only
being caught by manual review.

### Pack version bump and its consequence

`packs/core/pack.json` moves `0.3.0` → `0.4.0`. Every pack file touched by this PR
(eight agent/skill files) has a different rendered hash after this change, even for a
project that never sets `language` — the added `{{#if}}`/`{{/if}}` lines themselves
change the source template even though they render to nothing when the key is absent.
Any existing install will see drift reported (or a silent rewrite, if the project runs
`litecode install --force` unattended) the next time it runs `litecode install`. This
is inherent to how templated packs are versioned and distributed here — a source change
without a corresponding config option always changes the rendered artifact for
downstream installs, regardless of whether the new option is used — not incidental
noise specific to this PR, and the PR description says so explicitly for anyone
running `litecode install` against an existing project immediately after upgrading to
pack `0.4.0`.

## Consequences

- A project that sets `project.language` gets translated agent prose, GitHub content,
  and ADRs, without any change to sentinel-key-driven pipeline mechanics — dispatcher
  routing, board Status moves, and semantic-release commit parsing all continue to key
  off English values regardless of `project.language`.
- A project that never sets it is provably unaffected at the byte level, verified by
  test, not by inspection.
- Adding a ninth pack file with prose in the future must repeat this same
  framing/exclusion split by hand — there is no structural mechanism forcing a new file
  to get a working-language block, only the two `tests/packs.test.ts` guards that catch
  a *misused* reference, not a *missing* one. A future ticket that finds a prose-heavy
  pack file with no working-language section at all would not be caught by this PR's
  tests.
