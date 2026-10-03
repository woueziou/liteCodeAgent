# liteCodeAgent

**A team of AI agents that takes an idea from "someone mentioned it in chat" all the way
to "a reviewed pull request on a tracked ticket" — and that you can drop into any project
with one command.**

New here? Start with the two sections below; they assume no prior knowledge of the tool.
Already know your way around? Jump to [Quick start](#quick-start).
Unsure what a term means (ticket, epic, pack, install target…)? See the [glossary](GLOSSARY.md).

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

**2. Run setup.** It asks one question, having already guessed everything else from your repo.

```bash
bunx litecodeagent setup
```

This is a **preview**: it shows you the files it would create, and writes nothing.

**3. Look at what it proposes,** then run it for real:

```bash
bunx litecodeagent setup --apply
```

That's it. Your coding tool now has the agents. From here on the command is `litecode`
(`/litecode` inside your coding tool). After each new release, `litecode upgrade` brings the
project up to date, and `litecode` tells you at launch when the project is behind. In CI,
`litecode setup --check` exits 1 if the installed files differ from the packs.

<details>
<summary>What's <code>bunx</code>, and where does the code go?</summary>

`bunx` downloads a command, runs it, and keeps it in a shared cache — nothing is added to
your project's dependencies and nothing is installed system-wide. Use
`litecode <command>` to force the newest release.

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
litecode config targets
```

Prefer to say it in one line? `litecode config targets set claude-code,pi` works
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

### 1. Answer one question

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

The only question is *when a ticket touches…, which guides should the agent read?* The rules
are proposed from your detected stack: Enter accepts them, or type `N: when => guide, guide` to
edit rule N, `when => guide, guide` to add one, `-N` to remove one, `skip` to keep none. When
nothing is detected, it asks for at least one rule; `skip` still lets the install finish. A
summary of the tools, check command and rules is printed before the file is written.

Prefer no question at all? `bunx litecodeagent init --yes` writes the deduced rules as they are.
A check command or GitHub repository it couldn't find is left out of the file: the install still
succeeds, and the agents that need it refuse with the exact `litecode config set project.checkCommand
"<command>"` or `litecode config set project.repo <owner/name>` to run.

The generated file holds only the tools, packs, project name, default branch, `checkCommand`,
`typecheckCommands` and the routing rules (`project.domains`). Everything else (`tiers`,
`worktreeRoot`, `adrDir`, `language`, `conventions`, `trustBoundaries`, angles) takes its default,
and `litecode config set` changes it. `litecode upgrade` removes the obsolete `target`,
`outDir`, `lessons` and `agentSkills` keys from an older config. `agentSkills` is ignored (no agent
preloads a skill; they load on demand through the routing rules), so a hand-written list is not
kept, and `doctor` warns while a config still carries it.

Setup installs into the coding tools it finds on your machine (their directory in the project, or
their binary on the PATH), and Claude Code when it finds none. To see what they are, and which
ones you have on:

```bash
bunx litecodeagent targets
```

To override the detection, name them directly: `bunx litecodeagent init --yes --targets codex,opencode`.
Configs written before this option existed keep their older single `target` setting.

### 2. Skim the result

Open `litecode.config.json`. `init` will have filled nearly all of it; what's worth a second
look:

| Field | Why |
| --- | --- |
| `project.conventions` | the rules `implementer`/`reviewer` are held to — the highest-leverage field in the file |
| `project.trustBoundaries` | what `security-expert` must assume; only you know these |
| `project.lessons` | incidents this project already lived through, injected into `implementer` so the lesson travels with the agent |
| `project.testFirst` | `bugs` (default), `all` or `off`: which tickets `implementer` must start with a failing-test commit, which `reviewer` then checks |
| `project.allowDefaultBranchCommits` | `false` by default. Set it to `true` only if this project really commits straight to its default branch (see step 4) |

`litecode setup` refuses to run while any `TODO` remains, because a `TODO` left in an
agent prompt reads to the model as an instruction rather than as something you forgot (a hand-written one;
`init` no longer writes any).
`examples/ts-employee-service.litecode.config.json` is a complete, real, filled-in config.

### 3. Render the packs

```bash
litecode setup          # dry run: shows exactly what would be written
litecode setup --apply
```

This writes each tool's native agent and skill files and a lockfile under its configuration
directory. For example: `.codex/agents/*.toml`, `.agents/skills/*/SKILL.md`,
`.opencode/agents/*.md`, `.kilo/agents/*.md`, and the Pi prompt/extension under `.pi/`.
Claude Code keeps `.claude/agents/*.md` and `.claude/skills/*/SKILL.md`.

`litecode setup --apply` also writes `.githooks/pre-commit`, a branch guard: it refuses a commit on your
default branch unless the commit holds only ticket files (see "Work with tickets"). It
points `core.hooksPath` at `.githooks` when that's safe. It never replaces a hook you
already have and never touches `core.hooksPath` if it's set, or if `.git/hooks` holds real
hooks. In those cases it prints the one line to add to your own hook instead.

### Updating preferences later

You never have to edit `litecode.config.json` by hand for common changes.

**To choose from a list** — run these with no arguments and they'll ask:

```bash
litecode config targets   # which coding tools to install into
litecode config packs     # which bundles of agents to install
litecode config edit      # both, in sequence
```

**To say it in one line** — when you already know what you want:

```bash
litecode config show                             # what is set right now
litecode config targets add pi,opencode          # extend an existing install
litecode config targets set claude-code,pi,codex # replace the tool list
litecode config packs add web
litecode config set project.defaultBranch develop
litecode config targets add pi --apply           # save, then write the files
```

`--apply` chains `setup --apply` after a change so new harness directories are written
immediately. Without it, the command updates the config only and reminds you to install.

Only files recorded in LiteCodeAgent's per-tool lockfiles are managed. Existing local skills
and other project files are never rewritten or deleted by the CLI.

### 4. Commit

```bash
git switch -c chore/add-litecodeagent
git add litecode.config.json .githooks
git commit -m "chore: add liteCodeAgent pipeline"
```

Also add the generated harness directories you enabled, including their `.litecode-lock.json`
files, then open a pull request as usual.

Do it on a branch: once the guard from step 3 is active, a commit of anything other than
ticket files on your default branch is refused. For a one-off exception, prefix the commit
with `LITECODE_ALLOW_DEFAULT_BRANCH_COMMIT=1`. If your project always commits straight to
its default branch, set `project.allowDefaultBranchCommits: true` instead.

---

## Using the pipeline

Once installed, you can use the agents through the selected coding tool. The flow is deliberately
gated: **nothing creates tracked work or writes code without you saying so.**

### Turn an idea into a recommendation

> "Run the orchestrator on: users should be able to cancel a request after approval"

Or, in Claude Code, Pi, OpenCode, or Kilo Code, invoke `/litecode users should be able to
cancel a request after approval`. Codex exposes custom skills as `$skill-name`, so use
`$litecode users should be able to cancel a request after approval` there (a literal
`/litecode ...` mention also describes the skill's activation intent, but Codex does not
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

Tickets are plain files you can read and edit like any other (ADR 0015). The rules:

- **Status changes go through `ticket move`,** which refuses a transition the pipeline
  doesn't allow (`planned` straight to `review`, say). Agents use it too.
- **Agents commit every ticket change themselves,** right away, on your default branch, in
  your main checkout: a status change, a note, a new ticket. They commit ticket files only,
  by path, and never push. Pushing is yours. That's the one kind of commit the branch guard
  lets through on the default branch (ADR 0015, amended).
- **A ticket body has four sections,** in this order: `## Contexte`,
  `## Critères d'acceptation`, `## Plan`, `## Hors périmètre`. `tracker` writes them, and
  `reviewer` checks the work against the acceptance criteria one by one.
- **`[À CLARIFIER]` marks an open question** only you can settle. While it's in a ticket,
  `ticket move … planned` refuses it. `planner` and `tracker` add it themselves when the
  debate left a question open. See `docs/tickets/README.md`.
- **Agents leave dated notes** at the end of the body, including a progress journal that
  `resume` reads.

```bash
litecode ticket new --title "Fix the flaky install test" --label bug \
  --priority medium --size small --body "Body goes here."
litecode ticket list
litecode ticket move 0042 planned
litecode doctor
litecode ticket migrate --apply   # once, if your tickets predate schema v2
litecode ticket import-board      # once, if you still used the old GitHub board
```

### Plan the queue

> "Run the dispatcher"

`dispatcher` ranks the local ticket buffer's `backlog`-status tickets by Priority / Size /
Due Date and moves the top items to `Planned`, flagging any priority-vs-deadline conflict
rather than silently resolving it.

### Implement one ticket

> "Run the implementer on 0042"

`implementer` moves the ticket to `In Progress`, then works on its own branch in a dedicated
git worktree. It never commits code on your default branch, and never lets its sub-agents
write outside that worktree. It follows your `conventions`, starts with a failing test when
`project.testFirst` says so, runs your `checkCommand` and opens a PR. Then it invokes
`reviewer` and `bug-hunter` for real verdicts, posts both on the PR, and moves the ticket to
`Ready to Merge` or `Review`. On a blocker it escalates to `triage` rather than guessing.

The flow is proportioned to the ticket's `size`: a `small` ticket runs `bug-hunter` at the
cheaper `balanced` tier (where the target lets a call pick its model), with no re-hunt unless
a finding blocks and no second review for non-blocking corrections; `medium` and `large` keep
the full flow. The rarely-needed procedures (ADR gate, resume, GitHub outage, sub-agent
steps, stacked PRs, leak cleanup) live in `implementer-*` skills loaded only when the case
arises, so the everyday prompt stays short. A launch prompt only needs the ticket and what
is specific to this launch.

If the change needs an ADR, `implementer` stops before committing it and waits for you. The
draft goes under an `## ADR à valider : NNNN` section in the ticket. `ticket list`,
`doctor` and the dashboard all point you at it. Once you approve, ask for the implementer
again on the same ticket: it picks up from its progress journal.

### Shortcuts

Two chaining skills collapse the gates — each still requires you to ask for it by name,
with the subject in hand:

- **`idea-to-planned`** — idea → orchestrator → tracker → dispatcher, no pauses.
  Stops at `Planned`; never writes code.
- **`chained-implementation`** — dispatcher → implementer on one named ticket, then
  checks the implementer's report with `verify-report` before relaying it.

### Keeping it healthy

```bash
litecode status          # installed packs, versions, files the kit owns
litecode doctor          # orphaned work: stranded worktrees and branches, PR-less
                                   # branches, stale review tickets, pending ADRs, leaked writes,
                                   # lockfile drift; plus ticket files, config and routing rules
litecode resume 0042     # where an interrupted implementer run left off, checked
                                   # against the worktree, branch and PR
litecode verify-report --file report.txt  # implementer report vs. git, gh, ticket status
litecode dashboard --serve   # live, read-only view of tickets and ADRs
litecode dashboard --build   # or a static snapshot, docs/dashboard.html
```

Claude Code creates each implementer's isolated worktree under `.claude/worktrees/agent-<id>/`
(git-ignored; `verify-report` skips it). Once an agent's PR is merged or abandoned, clean up:

```bash
git worktree list                        # spot the finished agent-<id> entries
git worktree remove .claude/worktrees/agent-<id>
git worktree prune                       # drop records of directories already deleted
```

`doctor` and `verify-report` only read. When GitHub is unreachable they mark its checks
"non vérifié" instead of failing.

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
litecode run orchestrator --prompt "users should be able to cancel a request after approval" --trace
litecode run reviewer --prompt-file /tmp/review-request.md
litecode run classifier --prompt "small copy fix" --usage
litecode run orchestrator --prompt-file request.md --json --record .litecode/runs/latest.json
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

The runner renders pack templates directly from the same config used by `setup`; unresolved
placeholders remain hard errors. It enforces each agent's declared tool list and supplies local
`Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, and `Skill` implementations. File tools resolve
symlinks and stay within the project and configured worktree roots. `Bash` is intentionally a real
local shell with the current user's permissions, so only agents declaring `Bash` receive it.

`Agent` is a synchronous tool: the parent resumes only when the child has returned its final text.
When a model emits several `Agent` calls in one turn, their children run in parallel. All children
share `maxDepth` and `maxAgentCalls` limits, and every individual loop is capped by `maxTurns`.

The Pi `/litecode` prompt uses a small trusted-project extension to call the direct API runner,
because Pi has prompt templates and extensions but no built-in subagent runtime. Add a `runner`
configuration and provider API key before using it; Pi's currently selected model is not used for
that nested run. Claude Code, OpenCode, and Kilo Code use their native agent delegation. Codex's
custom agent definitions use its native subagent support, and its workflow is exposed as the
`$litecode` skill.

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
  `frontend-expert`, `ui-ux-expert` (with touch), `design-expert` (with small viewport), and `mobile-expert`.
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
  no installed pack and has no local overlay, `setup` stops and tells you where each
  reference came from — rather than rendering an agent that asks the harness for something
  that isn't there.
- **The default branch is guarded in code, not just in prompts.** The pre-commit hook
  refuses code on it, and `ticket move` refuses invalid status transitions. A rule that
  only lives in a prompt gets broken eventually.
- **An agent's report is a claim, not a fact.** `verify-report` checks it against git, the
  PR and the ticket. `reviewer` has to prove each acceptance criterion rather than assert
  it.
- **Lockfile, not templating-by-copy.** `setup` can tell "you're behind this pack
  version" apart from "you edited this file by hand", and refuses to clobber the latter
  without `--force`.

---

## Upgrading and undoing

One command brings a project up to date with the latest release:

```bash
litecode upgrade
```

It shows everything it will do, then asks before touching anything:
- re-renders the installed agents and skills;
- deletes files an older release generated and this one no longer produces, but only the
  ones nobody has edited since;
- migrates ticket files to the current schema;
- removes settings and data files of features that no longer exist.

Anything it deliberately leaves alone is listed with the reason. Re-running it when
there's nothing left to do is harmless. `--yes` applies without asking, for scripts and
CI. A legacy git-clone install (`install.sh`) updates itself first, then carries on with
the new version.

Coming from a release that still used the GitHub board or GitHub-synced tickets? Follow
[Migrating from an earlier version](#migrating-from-an-earlier-version) below.

To re-render only, without the other steps: `litecode setup --apply`.

If you edited a managed file by hand, `setup` reports it as `DRIFT` and stops. Either
move your change upstream into the pack (the right answer, so every project gets it), or
re-run with `--force` to discard it.

To remove the kit from a project: delete the files listed in each enabled harness's
`.litecode-lock.json`, then those lockfiles and `litecode.config.json`. Other project files are
untouched.

---

## Migrating from an earlier version

This is for a project that hasn't upgraded in a while and still works the old way: tickets
mirrored as GitHub issues (schema v1), a GitHub Project board holding their status,
priority and size, or a `sync` agent pushing to GitHub. Today tickets are local files, the
board is gone, and nothing syncs. Getting there takes one command, one import, and a
review of what was imported.

### Which case are you in?

| What you have | What to run |
| --- | --- |
| Local ticket files with `issue`/`synced`/`syncedAt` in their frontmatter | `upgrade` migrates them (step 2) |
| Items that only exist on the GitHub Project board, with no local file | `ticket import-board` (step 3) |
| `project.board` in `litecode.config.json` | both: `upgrade` keeps it until you've imported, then you remove it (step 5) |
| Installed `sync` agent or `github-project-sync` skill | `upgrade` deletes them if you never edited them |

Not sure? Run the dry runs below: they write nothing and tell you.

### 1. Work on a branch

```bash
git switch -c chore/upgrade-litecodeagent
```

The upgrade re-renders your agents and installs the branch guard (see "Render the packs").
From then on, a commit on your default branch is refused unless it holds only ticket files.

### 2. Upgrade

```bash
litecode upgrade          # shows the plan, then asks
```

It does, in one go:
- **re-renders every agent and skill** for the current release;
- **deletes files an older release generated,** such as the `sync` agent and the
  `github-project-sync` skill, but only copies nobody edited. Edited ones are listed, and
  are yours to delete;
- **migrates v1 tickets to v2.** It drops `issue`, `synced` and `syncedAt`, and turns
  comments that were waiting to be posted into plain text in the ticket, so nothing is
  lost. A ticket with a frontmatter key it doesn't know stops the migration and is named;
  check it, then run `ticket migrate --apply --force`;
- **removes obsolete settings and the board's data files,** but keeps `project.board` while
  `project.board.number` is set, so the import in step 3 can still read it;
- **points you at `ticket import-board`** if a board is still configured.

Everything it leaves alone is listed with the reason. [`docs/upgrading-to-1.0.md`](docs/upgrading-to-1.0.md)
details each step, if you'd rather do them by hand.

### 3. Import what only lives on the board

```bash
litecode ticket import-board            # dry run: lists what it would import
litecode ticket import-board --apply    # writes the tickets
```

- **It only reads from GitHub.** No issue or board item is changed, closed or commented on.
- **Each item becomes at most one ticket,** recording its origin in `importedFrom`
  (`github:owner/repo#123`, or `github-project-item:<id>` for a draft). Running it again
  skips what's already imported, so an interrupted run just picks up where it stopped.
- **Board fields map to the local ones** when they match: status, priority, size. A value
  with no local equivalent puts the ticket in `backlog` with an `[À CLARIFIER]` note quoting
  the original value.
- **The issue body is kept.** If it doesn't already have the four ticket sections, it goes
  under `## Contexte`, and the other sections get an `[À CLARIFIER]` placeholder.
- **One failing item never stops the rest.** The run ends with a count of imported, skipped
  and failed items, with a reason for each failure.

If an earlier release's `upgrade` already removed `project.board` from your config, name the
board directly: `ticket import-board --apply --board my-org/12`. The import is described in
ADR 0019.

### 4. Review what came in

```bash
litecode ticket list
litecode doctor
```

Each imported ticket carrying `[À CLARIFIER]` needs a decision from you: fix the status, write
the acceptance criteria, then delete the marker. Until you do, `ticket move <id> planned` and
`dispatcher` refuse to plan it. Commit the imported tickets whenever you like. A commit made
only of ticket files is allowed on your default branch.

### 5. Finish

- Remove `project.board` from `litecode.config.json`.
- Delete any edited `sync`/`github-project-sync` copies `upgrade` listed.
- Commit the rest (config, re-rendered agents, `.githooks/`) on your branch and open a pull
  request.
- From now on, ticket status lives in the ticket files only. The old issues and board stay on
  GitHub untouched. A migrated ticket's old issue number is still in its git history.

---

## Status

Phases 1–5 and the npm/bunx distribution path are implemented: packs and install, local
tickets, native Claude Code/Codex/Pi/OpenCode/Kilo Code integrations, the direct API runner
with recursive `Agent`, usage/cost reporting, runner reliability, and ephemeral CLI
execution. The resilience work compared the pipeline with GSD, Superpowers and Spec Kit
(epic `docs/tickets/07-resilience`). It added the branch guard, validated status moves, the
ticket contract, per-criterion review, test-first, `doctor`, `resume` with its progress
journal, visible pending ADRs, leak detection and the board import. Provider adapters, orchestration semantics, retries,
cancellation, timeouts, budgets, partial failure reports, package contents, and structured CLI
calls are covered with deterministic tests; a live provider smoke run requires the corresponding
API key. The package is published on npm as `litecodeagent`.

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
