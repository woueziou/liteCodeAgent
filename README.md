# liteCodeAgent

**A team of AI agents that takes an idea from "someone mentioned it in chat" all the way
to "a reviewed pull request on a tracked ticket" — and that you can drop into any project
with one command.**

New here? Start with the two sections below; they assume no prior knowledge of the tool.
Already know your way around? Jump to [Quick start](#quick-start).

---

## What this actually is

AI coding assistants like Claude Code, Codex or Pi let you define **agents**: specialised
assistants with their own instructions and their own narrow job. One reviews code. One
writes it. One decides what to work on next.

Writing those agents well takes time, and once you have a set you like, you usually end up
copy-pasting them from project to project — where they slowly drift apart until no two
repos behave the same way.

liteCodeAgent is that set of agents, written once and kept in one place. You answer a few
questions about your project, and it generates the agent files in the format your coding
tool expects. When the agents improve, you pull the update instead of re-copying.

**Three things you'll see mentioned throughout:**

| Term | What it means |
| --- | --- |
| **agent** | One AI assistant with one job, defined in a Markdown file your coding tool reads |
| **pack** | A bundle of agents you install together — `core` is the pipeline, `web` adds front-end experts |
| **ticket** | A markdown file under `docs/tickets/` tracking one piece of work through the pipeline — the file is the ticket, there is no GitHub issue |

The agents are written as templates with blanks in them — your repo name, your test
command, your coding conventions. Setup fills the blanks from your answers. That's what
makes the same agents work in any project.

## How the agents work together

Each arrow is one agent handing off to the next:

```
idea → classifier → panel-selector → debate-angle ×N → synthesizer → planner
                                                                        ↓
                                              tracker → dispatcher → implementer → reviewer + bug-hunter
                                                                        ↑           ↓
                                                                      triage ←──────┘
```

Read it as a story. You describe something you want. `classifier` works out what kind of
change it is. `panel-selector` decides which angles are worth arguing — security?
performance? — and `debate-angle` argues each one separately, in parallel. `synthesizer`
reconciles them and `planner` turns the result into a plan.

Nothing has been created or written yet. **You approve first.** Then `tracker` drafts the
ticket, `dispatcher` decides what to do next, `implementer` writes the code and opens a
pull request, `reviewer` gives a real verdict on it, and `bug-hunter` independently hunts
for the inputs that break it. If something goes wrong,
`triage` picks it up rather than letting an agent guess.

That gating is deliberate: **no agent creates tracked work or writes code until you ask.**

---

## What you need before starting

| You need | Why | Check it |
| --- | --- | --- |
| [Bun](https://bun.sh) ≥ 1.1 | Runs the setup command. It's a JavaScript runtime, like Node. | `bun --version` |
| A git repository | The tool reads your remote to learn your project's name | `git remote -v` |
| [GitHub CLI](https://cli.github.com), signed in | For the agents' pull requests (`implementer` opens one per ticket) | `gh auth status` |
| A coding tool | Claude Code, Codex, Pi, OpenCode or Kilo Code — whichever you already use | — |
| A provider API key | **Only** if you want to run agents outside a coding tool | — |

If `gh auth status` says you're not logged in, run `gh auth login` before asking
`implementer` to open a pull request. Everything else works without it.

---

## Quick start

Nothing gets installed globally, and nothing is written until you say so.

**1. Go to the project you want the agents in.**

```bash
cd /path/to/your/project
```

**2. Run setup.** It asks a handful of questions, having already guessed most of the
answers from your repo.

```bash
bunx litecodeagent setup
```

This is a **preview**: it shows you the files it would create, and writes nothing.

**3. Look at what it proposes,** then run it for real:

```bash
bunx litecodeagent setup --apply
```

That's it. Your coding tool now has the agents.

<details>
<summary>What's <code>bunx</code>, and where does the code go?</summary>

`bunx` downloads a command, runs it, and keeps it in a shared cache — nothing is added to
your project's dependencies and nothing is installed system-wide. Use
`bunx litecodeagent@latest <command>` to force the newest release.

The generated agent files go into your coding tool's own directory (`.claude/`, `.codex/`,
`.pi/`, and so on), alongside a small lockfile so the tool knows what it owns.

</details>

Re-running `setup` later previews or applies updates to the agents without touching the
answers you gave. The shorter `litecode` command does the same thing and is available once
you install globally or through a plugin.

## Which coding tools are supported?

Five, and you can install into as many as you like at once:

```bash
bunx litecodeagent targets
```

That lists every tool, what it is, where its files land, and which ones you currently have
switched on. To change the selection, let it ask you:

```bash
bunx litecodeagent config targets
```

Prefer to say it in one line? `bunx litecodeagent config targets set claude-code,pi` works
too. Add `--apply` to write the files immediately after choosing.

## If you use Claude Code

You can skip the command line entirely. Add this repository as a marketplace, install the
plugin, then run the guided setup from inside Claude Code:

```text
/plugin marketplace add woueziou/liteCodeAgent
/plugin install litecode-agent@litecode
/reload-plugins
```

Then, in the project you want set up:

```text
/litecode-agent:setup
```

This works with the private repository as long as your git credentials can already reach
it. The plugin makes `litecode` available to Claude Code's Bash tool and installs its Bun
dependencies from the committed lockfile. Behind the scenes it follows exactly the same
config validation and lockfile rules described below — it never loads the agent templates
directly. Update it later with `/plugin update litecode-agent@litecode`.

---

## Setting up, step by step

The quick start above runs these steps for you. Here they are individually, in case you
want more control — or want to understand what just happened. Run them from the root of
the repo you want the agents in.

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

You confirm or correct each one. Two things are derived rather than asked, because they're
mechanical and drift the moment a human maintains them by hand:

- **`domains`** — which expert skill loads for which kind of change, from your detected stack.
- **`agentSkills`** — what each agent preloads, from the angles and domains you just chose.
  A stack-specific skill you already own locally (say `orpc-expert`) gets wired in wherever
  it applies.

Prefer no questions at all? `bunx litecodeagent init --yes` writes a config from detection alone and
marks anything it couldn't determine as `TODO`.

Setup installs into all five supported coding tools by default. To see what they are, and
which ones you have on:

```bash
bunx litecodeagent targets
```

To pick a subset during setup, the questions let you choose from that same list. Skipping
the questions? Name them directly: `bunx litecodeagent init --yes --targets codex,opencode`.
Configs written before this option existed keep their older single `target` setting.

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

### Updating preferences later

You never have to edit `litecode.config.json` by hand for common changes.

**To choose from a list** — run these with no arguments and they'll ask:

```bash
bunx litecodeagent config targets   # which coding tools to install into
bunx litecodeagent config packs     # which bundles of agents to install
bunx litecodeagent config edit      # both, in sequence
```

**To say it in one line** — when you already know what you want:

```bash
bunx litecodeagent config show                             # what is set right now
bunx litecodeagent config targets add pi,opencode          # extend an existing install
bunx litecodeagent config targets set claude-code,pi,codex # replace the tool list
bunx litecodeagent config packs add web
bunx litecodeagent config set project.defaultBranch develop
bunx litecodeagent config targets add pi --apply           # save, then write the files
```

`--apply` chains `install --apply` after a change so new harness directories are written
immediately. Without it, the command updates the config only and reminds you to install.

Only files recorded in LiteCodeAgent's per-tool lockfiles are managed. Existing local skills
and other project files are never rewritten or deleted by the CLI.

### 4. Commit

```bash
git add litecode.config.json
git commit -m "chore: add liteCodeAgent pipeline"
```

Also add the generated harness directories you enabled, including their `.litecode-lock.json`
files.

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

`tracker` drafts the ticket as a markdown file under `docs/tickets/` (configurable via
`project.tickets.dir`). That file is the ticket — nothing is created on GitHub. It only
ever runs after you've explicitly approved.

### Work with tickets

Tickets are plain files you can read, edit and commit like any other (ADR 0015). Agents
move them through `Planned`/`In Progress`/`Review`/`Ready to Merge`/`Blocked` by editing
their `status`, and leave dated notes at the end of their body.

```bash
bunx litecodeagent ticket new --title "Fix the flaky install test" --label bug \
  --priority medium --size small --body "Body goes here."
bunx litecodeagent ticket list
bunx litecodeagent ticket doctor
bunx litecodeagent ticket migrate --apply   # once, if your tickets predate schema v2
```

### Plan the queue

> "Run the dispatcher"

`dispatcher` ranks the local ticket buffer's `backlog`-status tickets by Priority / Size /
Due Date and moves the top items to `Planned`, flagging any priority-vs-deadline conflict
rather than silently resolving it.

### Implement one ticket

> "Run the implementer on #42"

`implementer` moves the item to `In Progress`, works in a dedicated git worktree, follows
your `conventions`, runs your `checkCommand`, opens a PR, then invokes `reviewer` and
`bug-hunter` for real verdicts before moving the item to `Ready to Merge` or `Review`. On a blocker it
escalates to `triage` rather than guessing.

### Shortcuts

Two chaining skills collapse the gates — each still requires you to ask for it by name,
with the subject in hand:

- **`idea-to-planned`** — idea → orchestrator → tracker → dispatcher, no pauses.
  Stops at `Planned`; never writes code.
- **`chained-implementation`** — dispatcher → implementer on one named ticket, then
  checks the implementer's report with `verify-report` before relaying it.

### Keeping it healthy

```bash
bunx litecodeagent status          # installed packs, versions, files the kit owns
bunx litecodeagent ticket doctor   # local ticket buffer: malformed/misplaced/duplicate files
bunx litecodeagent verify-report --file report.txt  # implementer report vs. git, gh, ticket status
```

---

## Running agents without a coding tool

Everything above runs the agents *inside* Claude Code, Codex, Pi and friends. You can also
run them directly against a provider's API — useful for scripts, CI, or when you just want
one agent's answer in your terminal. This is also how Pi runs them, since Pi has no
built-in sub-agent runtime of its own.

This section is the most technical part of the README; skip it unless you need it.

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

A pack is a bundle of agents and skills installed together. There are two:

- **`core`** — the 12 pipeline agents (`classifier`, `panel-selector`, `debate-angle`,
  `synthesizer`, `planner`, `orchestrator`, `tracker`, `dispatcher`, `implementer`,
  `reviewer`, `bug-hunter`, `triage`) plus `agent-attribution`, `critique-expert`,
  `security-expert`, and the two chaining skills.
- **`web`** — expert skills for TypeScript/React work: `typescript-expert`,
  `frontend-expert`, `ui-ux-expert`, `design-expert`, and the three `mobile-*` experts.
  Requires `core`, and requires `project.web` in your config.

A skill that only makes sense on one repo (a framework-specific expert, a house style
guide) belongs in that repo's native skill directory as a local overlay — not in a pack.

---

## Design decisions worth knowing

A few rules the tool holds itself to. They explain why it sometimes refuses to do
something rather than guessing.

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

**Coming from 0.x?** 1.0 removes the GitHub board and GitHub issue sync, and migrates
ticket files to a new schema. Follow [`docs/upgrading-to-1.0.md`](docs/upgrading-to-1.0.md).

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

`bun install` points `core.hooksPath` at `.githooks`, which rejects commits from an unexpected
author and any `Co-Authored-By` trailer.

Merging Conventional Commits into `main` runs CI and publishes releases to npm. `feat:` commits
create a minor release, `fix:` and `perf:` commits create a patch release, and a `BREAKING CHANGE:`
footer creates a major release. Commits such as `docs:` and `chore:` do not publish. Each release
updates `package.json` and `CHANGELOG.md`, publishes `litecodeagent`, and creates a GitHub release.
Publishing uses npm trusted publishing (OIDC): the `release` job exchanges the workflow's
`id-token` for a short-lived credential, so no npm token is stored in the repository. The package
must list this repository and `ci.yml` as a trusted publisher on npmjs.com.

When bootstrapping semantic-release on a repo that already has a version on npm, tag the commit
that matches the published release (`git tag vX.Y.Z <sha> && git push origin vX.Y.Z`) before the
first automated release. Do not auto-seed a baseline tag from the push parent — that hides prior
commits from the release analyzer.

Working on the kit itself? `git clone` it anywhere and `bun link` — that takes over the
`litecode` and `litecodeagent` commands. The legacy `install.sh` path is also retained for private
source-only distributions that cannot publish the npm package.

Pack changes are content changes: edit the Markdown under `packs/`, bump the pack's
`version` in `pack.json`, and run `bun test` — the suite checks that no project literal
leaked in, that every agent declares a tier rather than a model, and that a full render
leaves no unresolved `{{ }}`.
