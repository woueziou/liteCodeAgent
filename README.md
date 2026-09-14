# liteCodeAgent

A portable, versioned multi-agent software pipeline. The agents that take an idea from
"someone said it in chat" to "a reviewed PR on a tracked board" live here as **packs**,
so a new project gets the whole pipeline with one command instead of a copy-paste that
starts drifting the same afternoon.

```
idea → classifier → panel-selector → debate-angle ×N → synthesizer → planner
                                                                        ↓
                                              tracker → dispatcher → implementer → reviewer
                                                                        ↑           ↓
                                                                      triage ←──────┘
```

---

## Requirements

| Tool | Why |
| --- | --- |
| [Bun](https://bun.sh) ≥ 1.1 | runs the CLI |
| [GitHub CLI](https://cli.github.com) (`gh`), authenticated | board provisioning and everything the agents do on GitHub |
| Claude Code | optional: native plugin and rendered-agent harness |
| Provider API key | required only for `bunx litecodeagent run` outside Claude Code |

```bash
gh auth status   # must show you logged in before `bunx litecodeagent board ...`
```

---

## Install through Claude Code

Add this repository as a marketplace, then install the plugin:

```text
/plugin marketplace add woueziou/liteCodeAgent
/plugin install litecode-agent@litecode
/reload-plugins
```

This works with the private repository when your existing git credentials can access it. In the
target project, start the guided setup with:

```text
/litecode-agent:setup
```

The plugin makes `litecode` available to Claude Code's Bash tool and installs its Bun dependencies
from the committed lockfile. The setup skill still renders the parameterized packs through the
same config validation and lockfile rules described below; it never loads pack templates directly.
Update it later with `/plugin update litecode-agent@litecode`.

## Quick start with Bun

Nothing is installed globally. From the target project's root, Bun downloads the CLI into its
shared cache, runs the guided setup, and previews the files it would render:

```bash
cd /path/to/your/project
bunx litecodeagent setup
```

Review `litecode.config.json`, then apply through the same command:

```bash
bunx litecodeagent setup --apply
```

If you want the shortest interactive path and are comfortable applying immediately after the
questions, use one command:

```bash
bunx litecodeagent setup --apply
```

`setup` creates the config only when it is absent, so rerunning it previews or applies pack
updates without replacing your answers. Use `bunx litecodeagent@latest <command>` to explicitly
request the newest release. The shorter `litecode` executable remains available for global,
plugin, and linked development installs.

## Set up a project

Run these from the root of the repo you want the pipeline in.

### 1. Answer a few questions

```bash
cd /path/to/your/project
bunx litecodeagent init
```

`init` reads your repo first and proposes real answers rather than blank fields. It picks
up, across a monorepo (not just the root manifest):

| Detected | From |
| --- | --- |
| repo, owner, default branch | your git remote |
| check and type-check commands | your `package.json` scripts and lockfile |
| framework, styling, ORM, API layer, auth | dependencies across `apps/*` and `packages/*` |
| ADR directory | whether `docs/decisions/` exists |
| skills you already own | `.claude/skills`, `.agents/skills`, `.pi/skills`, `.opencode/skills`, `.kilo/skills` |
| house rules | the bullet list under a "Conventions" heading in your `CLAUDE.md`/`AGENTS.md` |
| board | `gh project list` for your org — pick from the real list |

You confirm or correct each one. Two things are derived rather than asked, because they're
mechanical and drift the moment a human maintains them by hand:

- **`domains`** — which expert skill loads for which kind of change, from your detected stack.
- **`agentSkills`** — what each agent preloads, from the angles and domains you just chose.
  A stack-specific skill you already own locally (say `orpc-expert`) gets wired in wherever
  it applies.

Prefer no questions at all? `bunx litecodeagent init --yes` writes a config from detection alone and
marks anything it couldn't determine as `TODO`.

Setup selects Claude Code, Codex, Pi, OpenCode, and Kilo Code by default. To choose a subset,
pass a comma-separated list, for example `bunx litecodeagent init --yes --targets codex,opencode`.
Existing configs without `targets` keep their legacy `target` setting.

### 2. Skim the result

Open `litecode.config.json`. `init` will have filled nearly all of it; what's worth a second
look:

| Field | Why |
| --- | --- |
| `project.conventions` | the rules `implementer`/`reviewer` are held to — the highest-leverage field in the file |
| `project.trustBoundaries` | what `security-expert` must assume; only you know these |
| `project.lessons` | incidents this project already lived through, injected into `implementer` so the lesson travels with the agent |

`bunx litecodeagent install` refuses to run while any `TODO` remains, because a `TODO` left in an
agent prompt reads to the model as an instruction rather than as something you forgot.
`examples/ts-employee-service.litecode.config.json` is a complete, real, filled-in config.

### 3. Render the packs

```bash
bunx litecodeagent install          # dry run: shows exactly what would be written
bunx litecodeagent install --apply
```

This writes each tool's native agent and skill files and a lockfile under its configuration
directory. For example: `.codex/agents/*.toml`, `.agents/skills/*/SKILL.md`,
`.opencode/agents/*.md`, `.kilo/agents/*.md`, and the Pi prompt/extension under `.pi/`.
Claude Code keeps `.claude/agents/*.md` and `.claude/skills/*/SKILL.md`.

Only files recorded in LiteCodeAgent's per-tool lockfiles are managed. Existing local skills
and other project files are never rewritten or deleted by the CLI.

### 4. Provision the board

The pipeline is board-backed: state lives in a GitHub Project, not in issue comments.

```bash
bunx litecodeagent board init          # dry run; uses the board you picked during init
bunx litecodeagent board init --apply
```

If you skipped the board question, pass it explicitly:
`bunx litecodeagent board init --owner my-org --number 1`.

This creates any missing fields (`Status`, `Priority`, `Size`, `Assigned Agent`,
`Due Date`) and labels (`bug`, `feature`, `doc`, `chore`), then writes every resolved id
into `.claude/data/board.json`. Put `owner` and `number` into your config afterwards so
you can just run `bunx litecodeagent board init` next time.

Don't have a board yet? Create an empty GitHub Project first (org → Projects → New
project → Table), note its number from the URL, then run the command above — it will
provision every field into it.

### 5. Commit

```bash
git add litecode.config.json
git commit -m "chore: add liteCodeAgent pipeline"
```

Also add the generated harness directories you enabled, including their `.litecode-lock.json`
files. Commit `board.json` too — these files are shared state, not local scratch. `board.json`
is generated; never hand-edit it.

---

## Using the pipeline

Once installed, you can use the agents through the selected coding tool. The flow is deliberately
gated: **nothing creates tracked work or writes code without you saying so.**

### Turn an idea into a recommendation

> "Run the orchestrator on: users should be able to cancel a request after approval"

Or, in Claude Code, Pi, OpenCode, or Kilo Code, invoke `/litecodeagent users should be able to
cancel a request after approval`. Codex exposes custom skills as `$skill-name`, so use
`$litecodeagent users should be able to cancel a request after approval` there (a literal
`/litecodeagent ...` mention also describes the skill's activation intent, but Codex does not
register arbitrary slash commands).

`orchestrator` classifies the change, picks the relevant debate angles, argues each one in
parallel, synthesizes them, and returns a plan — touching nothing. If the angles reach a
genuine conflict, it hands you the tension instead of picking a winner.

### Create the ticket

> "Ok, track it"

`tracker` creates the issue and puts it on the board in `Backlog`. It only ever runs after
you've explicitly approved.

### Plan the queue

> "Run the dispatcher"

`dispatcher` ranks `Backlog` by Priority / Size / Due Date and moves the top items to
`Planned`, flagging any priority-vs-deadline conflict rather than silently resolving it.

### Implement one ticket

> "Run the implementer on #42"

`implementer` moves the item to `In Progress`, works in a dedicated git worktree, follows
your `conventions`, runs your `checkCommand`, opens a PR, then invokes `reviewer` for a
real verdict before moving the item to `Ready to Merge` or `Review`. On a blocker it
escalates to `triage` rather than guessing.

### Shortcuts

Two chaining skills collapse the gates — each still requires you to ask for it by name,
with the subject in hand:

- **`idea-to-planned`** — idea → orchestrator → tracker → dispatcher, no pauses.
  Stops at `Planned`; never writes code.
- **`chained-implementation`** — dispatcher → implementer on one named issue.

### Keeping it healthy

```bash
bunx litecodeagent status          # installed packs, versions, files the kit owns
bunx litecodeagent board doctor    # board.json vs. the live board, and Status integrity
```

Run `board doctor` after anyone edits the project's fields in the GitHub UI.

---

## Direct API runner (also used by Pi)

Add a `runner` block to `litecode.config.json`. Model ids stay in project config; packs continue to
declare only `fast`, `balanced`, or `reasoning` tiers.

```json
{
  "runner": {
    "provider": "openai",
    "models": {
      "fast": "fast-model-id",
      "balanced": "balanced-model-id",
      "reasoning": "reasoning-model-id"
    },
    "pricing": {
      "fast-model-id": { "inputPerMillion": 0.1, "outputPerMillion": 0.4 },
      "balanced-model-id": { "inputPerMillion": 1, "outputPerMillion": 4 },
      "reasoning-model-id": { "inputPerMillion": 2, "outputPerMillion": 8 }
    },
    "maxCostUsd": 2,
    "maxTurns": 30,
    "maxDepth": 4,
    "maxAgentCalls": 32,
    "runTimeoutMs": 1800000,
    "requestTimeoutMs": 300000,
    "maxRetries": 2,
    "retryBaseDelayMs": 500,
    "retryMaxDelayMs": 10000
  }
}
```

Replace the model ids and example prices with current values from the provider. LiteCodeAgent does
not ship a price table because provider prices change independently from the packs. `pricing` is
optional, but every configured model must have an entry when `maxCostUsd` is set. API keys are read from
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `DEEPSEEK_API_KEY`; set `apiKeyEnv` to use another
environment variable. `baseUrl` can point the matching adapter at a gateway or proxy.

Run any pack agent:

```bash
bunx litecodeagent run orchestrator --prompt "users should be able to cancel a request after approval" --trace
bunx litecodeagent run reviewer --prompt-file /tmp/review-request.md
bunx litecodeagent run classifier --prompt "small copy fix" --usage
bunx litecodeagent run orchestrator --prompt-file request.md --json --record .litecode/runs/latest.json
```

The default stdout remains the agent's final text so shell pipelines keep working. `--usage` adds a
token and cost summary on stderr. `--json` returns a structured run report with totals and a
per-agent/model breakdown; `--record` writes that same report to a chosen file without storing the
input prompt. Cost is `null` when pricing is absent or the provider omits usage.

`maxCostUsd` stops the run after a provider response reports usage beyond the configured limit and
prevents another request once the limit is reached. The response that crosses the limit is already
billed, and sibling requests already in flight may also finish, so this is a circuit breaker rather
than a prepaid spending guarantee. If a provider omits usage while a limit is configured, the run
fails instead of pretending the limit was enforced.

The complete agent tree is bounded by `runTimeoutMs`; each HTTP attempt is bounded separately by
`requestTimeoutMs`. `Ctrl-C` and `SIGTERM` propagate through provider requests, retry waits, child
agents, `Grep`, and `Bash`, terminating active subprocesses. Successful and failed JSON reports use
`completed`, `failed`, `cancelled`, or `timed_out` status values. A failed `--record` run still writes
its partial token totals, retry count, request ids, and structured error before exiting with code 1.

Transient HTTP responses (`408`, `409`, `429`, and `5xx`) are retried up to `maxRetries` with bounded
exponential backoff, respecting `Retry-After` when present. Authentication, permission, balance, and
validation errors are not retried. Transport failures and request timeouts are also not replayed:
the runner cannot prove whether a raw POST reached the provider, so an automatic retry could charge
for the same model turn twice. `--trace` shows every retry and any provider request id returned.

The runner renders pack templates directly from the same config used by `install`; unresolved
placeholders remain hard errors. It enforces each agent's declared tool list and supplies local
`Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, and `Skill` implementations. File tools resolve
symlinks and stay within the project and configured worktree roots. `Bash` is intentionally a real
local shell with the current user's permissions, so only agents declaring `Bash` receive it.

`Agent` is a synchronous tool: the parent resumes only when the child has returned its final text.
When a model emits several `Agent` calls in one turn, their children run in parallel. All children
share `maxDepth` and `maxAgentCalls` limits, and every individual loop is capped by `maxTurns`.

The Pi `/litecodeagent` prompt uses a small trusted-project extension to call the direct API runner,
because Pi has prompt templates and extensions but no built-in subagent runtime. Add a `runner`
configuration and provider API key before using it; Pi's currently selected model is not used for
that nested run. Claude Code, OpenCode, and Kilo Code use their native agent delegation. Codex's
custom agent definitions use its native subagent support, and its workflow is exposed as the
`$litecodeagent` skill.

Project-local skills remain outside the runner unless explicitly configured. To make a local expert
available to direct API agents, place it under a separate `<skill-dir>/<name>/SKILL.md` tree and add
that parent directory to `runner.skillDirs`. The configured runner output directory is excluded.

---

## Packs

- **`core`** — the 11 pipeline agents (`classifier`, `panel-selector`, `debate-angle`,
  `synthesizer`, `planner`, `orchestrator`, `tracker`, `dispatcher`, `implementer`,
  `reviewer`, `triage`) plus `github-project-sync`, `agent-attribution`,
  `critique-expert`, `security-expert`, and the two chaining skills.
- **`web`** — expert skills for TypeScript/React work: `typescript-expert`,
  `frontend-expert`, `ui-ux-expert`, `design-expert`, and the three `mobile-*` experts.
  Requires `core`, and requires `project.web` in your config.

A skill that only makes sense on one repo (a framework-specific expert, a house style
guide) belongs in that repo's native skill directory as a local overlay — not in a pack.

---

## How it stays portable

- **No project literals in packs.** Agents and skills are Markdown with `{{ }}`
  placeholders; a test fails the build if a repo name, path, or board id leaks into one.
- **An unresolved placeholder is a hard error.** A prompt with a hole in it is worse than
  a build that fails.
- **Capability tiers, not model ids.** Packs declare `tier: fast | balanced | reasoning`;
  Claude resolves those through `tiers`; other native harnesses inherit the model selected
  in that tool. The direct API runner maps tiers through the configured OpenAI, Anthropic,
  or DeepSeek adapter.
- **Dangling skill references fail the install.** If your config names a skill that is in
  no installed pack and has no local overlay, `install` stops and tells you where each
  reference came from — rather than rendering an agent that asks the harness for something
  that isn't there.
- **Lockfile, not templating-by-copy.** `install` can tell "you're behind this pack
  version" apart from "you edited this file by hand", and refuses to clobber the latter
  without `--force`.

---

## Upgrading and undoing

```bash
bunx litecodeagent@latest install          # latest release, dry run shows the delta
bunx litecodeagent@latest install --apply
```

There is no separate CLI upgrade step in the Bun path: `bunx` resolves the npm package and stores
it in Bun's shared cache. `litecode upgrade` remains available only for the legacy git-clone
installation made by `install.sh`.

If you edited a managed file by hand, `install` reports it as `DRIFT` and stops. Either
move your change upstream into the pack (the right answer, so every project gets it), or
re-run with `--force` to discard it.

To remove the kit from a project: delete the files listed in each enabled harness's
`.litecode-lock.json`, then those lockfiles and `litecode.config.json`. Other project files are
untouched.

---

## Status

Phases 1–5 and the npm/bunx distribution path are implemented: packs/install/board, native
Claude Code/Codex/Pi/OpenCode/Kilo Code integrations, the direct API runner with recursive `Agent`, usage/cost reporting, runner
reliability, and ephemeral CLI execution. Provider adapters, orchestration semantics, retries,
cancellation, timeouts, budgets, partial failure reports, package contents, and structured CLI
calls are covered with deterministic tests; a live provider smoke run requires the corresponding
API key. The npm package is ready for publication as `litecodeagent`.

---

## Development

```bash
bun install
bun test
bun x tsc --noEmit
```

Merging Conventional Commits into `main` runs CI and publishes releases to npm. `feat:` commits
create a minor release, `fix:` and `perf:` commits create a patch release, and a `BREAKING CHANGE:`
footer creates a major release. Commits such as `docs:` and `chore:` do not publish. Each release
updates `package.json` and `CHANGELOG.md`, publishes `litecodeagent`, and creates a GitHub release.
Configure an npm publish token as the repository Actions secret `NPM_TOKEN`.

Working on the kit itself? `git clone` it anywhere and `bun link` — that takes over the
`litecode` and `litecodeagent` commands. The legacy `install.sh` path is also retained for private
source-only distributions that cannot publish the npm package.

Pack changes are content changes: edit the Markdown under `packs/`, bump the pack's
`version` in `pack.json`, and run `bun test` — the suite checks that no project literal
leaked in, that every agent declares a tier rather than a model, and that a full render
leaves no unresolved `{{ }}`.
