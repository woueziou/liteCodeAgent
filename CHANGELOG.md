## [0.8.1](https://github.com/woueziou/liteCodeAgent/compare/v0.8.0...v0.8.1) (2026-09-17)


### Bug Fixes

* **ci:** keep the plugin manifest in lockstep with the released version ([fa4e20a](https://github.com/woueziou/liteCodeAgent/commit/fa4e20a0a01d865d8b564afa4b45b1270a58b298))
* **ci:** publish to npm via OIDC trusted publishing ([8a3aa48](https://github.com/woueziou/liteCodeAgent/commit/8a3aa48e75bf878290cd052acd45179546916a3b))

# [0.8.0](https://github.com/woueziou/liteCodeAgent/compare/v0.7.2...v0.8.0) (2026-09-17)


### Features

* add config CLI for targets, packs, and project settings ([eb1e422](https://github.com/woueziou/liteCodeAgent/commit/eb1e4227409bd7fbe8417d91acd469da7ac4fbb9))

## [0.7.2](https://github.com/woueziou/liteCodeAgent/compare/v0.7.1...v0.7.2) (2026-09-15)


### Bug Fixes

* repair semantic-release pipeline and decouple CI from npm token ([6757fe5](https://github.com/woueziou/liteCodeAgent/commit/6757fe5d1966caf3ada22435e7182b428e42c281))

## [0.7.1](https://github.com/woueziou/liteCodeAgent/compare/v0.7.0...v0.7.1) (2026-09-15)


### Bug Fixes

* gate CI on npm token preflight ([86283bc](https://github.com/woueziou/liteCodeAgent/commit/86283bce8c968a982fd4023b660c24d5ec600555))
* skip release when npm publishing is not configured ([66e20de](https://github.com/woueziou/liteCodeAgent/commit/66e20de99f3b6c01b109918d83980f29f60df852))

# Changelog

## 0.1.0 — unreleased

First extraction of the pipeline out of a single repo into installable packs.

- `core` pack: 11 pipeline agents + 6 shared skills, fully decoupled from any one project.
- `web` pack: 7 expert skills for TypeScript/React work.
- Template engine with `{{ }}` interpolation, `#if`/`#each` blocks, and `join`/`codelist`
  filters. An unresolved placeholder is a hard error, never a silent blank.
- `install` renders packs into a target repo, tracked by `.claude/.litecode-lock.json`.
  Dry run by default; hand-edited files are reported as drift and need `--force`.
- `board init` / `board doctor` provision and verify the GitHub Project board, resolving
  every field/option id into a generated `board.json` instead of hand-written ids.
  Adding an option to an existing single-select field is refused by design — the API
  cannot do it without regenerating every option id and nulling every item's Status.
- Agents declare a capability `tier` rather than a model id, so the same pack can be
  rendered for a different provider later.

## 0.2.0 — unreleased

- `litecode init` is now a wizard. It detects the repo (git remote, scripts and lockfile,
  dependencies across `apps/*`/`packages/*`, ADR directory, skills you already own, the
  convention bullets in your `CLAUDE.md`, your GitHub Projects) and proposes real answers.
  `domains` and `agentSkills` are derived rather than asked. `--yes` skips the questions.
- `install.sh`: one-command bootstrap, clones via `gh` so it works on a private repo.
  Re-running it updates.
- `litecode upgrade`: self-update the kit, refusing to pull over local edits.
- `install` now fails on a skill reference that resolves to neither an installed pack nor
  a local overlay, naming where each dangling reference came from.
- Fixed: directory detection used `Bun.file().exists()`, which is false for directories,
  so ADR/skill/workspace discovery silently found nothing.

## 0.3.0 — unreleased

- Native Claude Code plugin and marketplace manifests. Add the repository as a marketplace,
  install `litecode-agent@litecode`, then run `/litecode-agent:setup` in a target project.
- The plugin exposes the existing CLI to Claude Code while keeping packs behind the config-aware
  renderer; raw `{{ project.* }}` templates are never loaded as plugin components.
- Fixed the interactive init wizard losing stdin after its first answer and looping forever on
  the next required prompt.
- Fixed core rendering for projects that explicitly opt out of ADRs.

## 0.4.0 — unreleased

- Provider-neutral agent runtime with adapters for OpenAI Responses, Anthropic Messages, and
  DeepSeek Chat Completions. Provider model ids live only in `runner.models` in project config.
- `litecode run <agent> --prompt <text>` executes pack agents outside Claude Code.
- Local tool layer implements `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, and `Skill`, with
  frontmatter tool restrictions enforced by the runtime and file access constrained to the project
  and configured worktree roots.
- `Agent` runs child agents synchronously, executes sibling `Agent` calls in parallel, selects each
  child's model from its capability tier, and enforces depth, turn, and total-agent budgets.
- DeepSeek thinking continuations preserve `reasoning_content` across tool turns.

## 0.5.0 — unreleased

- Every run can return a structured report containing request and token totals, elapsed time,
  agent-call count, and a per-agent/model usage breakdown.
- Optional model pricing in project config calculates cost without baking volatile provider prices
  into LiteCodeAgent. `maxCostUsd` acts as a circuit breaker and fails closed when usage is missing.
- `litecode run --usage` prints a concise stderr summary, `--json` emits the full report, and
  `--record <path>` persists the same report without storing the input prompt.

## 0.6.0 — unreleased

- Provider requests retry bounded transient HTTP responses with exponential backoff and honor
  `Retry-After`; permanent client errors, transport failures, and ambiguous timed-out POSTs are not
  replayed.
- Global run and per-request timeouts are configurable. `SIGINT`/`SIGTERM` cancellation propagates
  across provider calls, retry waits, child agents, searches, and active Bash subprocesses.
- Failed runs expose structured partial reports with status, completed usage, retry count, provider
  request ids, and typed error diagnostics. `--json` and `--record` preserve this report on exit 1.

## 0.7.0 — unreleased

- The npm package is now named `litecodeagent` and exposes matching `litecodeagent` plus compatible
  `litecode` executables, enabling `bunx litecodeagent <command>` without a global installation.
- `bunx litecodeagent setup` initializes a missing config and renders the packs in one flow. It
  preserves the existing dry-run default; `--apply` is still explicit and all drift guards remain.
- Interactive init now asks for the web-pack values that previously remained as `TODO`, so a fully
  answered wizard can proceed directly to rendering.
- The published file set is explicit and tested from the generated package archive; source tests and
  development dependencies are excluded. Package-cache installs explain that `@latest` replaces the
  legacy git-only `upgrade` operation.
