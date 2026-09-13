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
| Claude Code | the harness the packs currently render for |

```bash
gh auth status   # must show you logged in before `litecode board ...`
```

---

## Install the CLI

One command. It clones into `~/.litecode`, installs dependencies, and puts `litecode` on
your PATH. Run it again later to update.

```bash
gh repo clone woueziou/liteCodeAgent /tmp/lca -- --depth=1 && bash /tmp/lca/install.sh
```

`gh` carries your GitHub auth, so this works on the private repo. Override the location
with `LITECODE_HOME=/somewhere`.

Check it:

```bash
litecode packs
```

Later:

```bash
litecode upgrade     # pull the latest packs into your install
```

`upgrade` refuses to pull over uncommitted changes in `~/.litecode` — if you edited a pack
there, that change belongs upstream, not in your local copy.

## Set up a project

Run these from the root of the repo you want the pipeline in.

### 1. Answer a few questions

```bash
cd /path/to/your/project
litecode init
```

`init` reads your repo first and proposes real answers rather than blank fields. It picks
up, across a monorepo (not just the root manifest):

| Detected | From |
| --- | --- |
| repo, owner, default branch | your git remote |
| check and type-check commands | your `package.json` scripts and lockfile |
| framework, styling, ORM, API layer, auth | dependencies across `apps/*` and `packages/*` |
| ADR directory | whether `docs/decisions/` exists |
| skills you already own | `.claude/skills/*/SKILL.md` |
| house rules | the bullet list under a "Conventions" heading in your `CLAUDE.md`/`AGENTS.md` |
| board | `gh project list` for your org — pick from the real list |

You confirm or correct each one. Two things are derived rather than asked, because they're
mechanical and drift the moment a human maintains them by hand:

- **`domains`** — which expert skill loads for which kind of change, from your detected stack.
- **`agentSkills`** — what each agent preloads, from the angles and domains you just chose.
  A stack-specific skill you already own locally (say `orpc-expert`) gets wired in wherever
  it applies.

Prefer no questions at all? `litecode init --yes` writes a config from detection alone and
marks anything it couldn't determine as `TODO`.

### 2. Skim the result

Open `litecode.config.json`. `init` will have filled nearly all of it; what's worth a second
look:

| Field | Why |
| --- | --- |
| `project.conventions` | the rules `implementer`/`reviewer` are held to — the highest-leverage field in the file |
| `project.trustBoundaries` | what `security-expert` must assume; only you know these |
| `project.lessons` | incidents this project already lived through, injected into `implementer` so the lesson travels with the agent |

`litecode install` refuses to run while any `TODO` remains, because a `TODO` left in an
agent prompt reads to the model as an instruction rather than as something you forgot.
`examples/ts-employee-service.litecode.config.json` is a complete, real, filled-in config.

### 3. Render the packs

```bash
litecode install          # dry run: shows exactly what would be written
litecode install --apply
```

This writes `.claude/agents/*.md` and `.claude/skills/*/SKILL.md` into your repo, plus
`.claude/.litecode-lock.json` recording what the kit owns.

**Everything else under `.claude/` is yours.** A skill you wrote by hand is never read,
rewritten, or deleted by the CLI.

### 4. Provision the board

The pipeline is board-backed: state lives in a GitHub Project, not in issue comments.

```bash
litecode board init          # dry run; uses the board you picked during init
litecode board init --apply
```

If you skipped the board question, pass it explicitly:
`litecode board init --owner my-org --number 1`.

This creates any missing fields (`Status`, `Priority`, `Size`, `Assigned Agent`,
`Due Date`) and labels (`bug`, `feature`, `doc`, `chore`), then writes every resolved id
into `.claude/data/board.json`. Put `owner` and `number` into your config afterwards so
you can just run `litecode board init` next time.

Don't have a board yet? Create an empty GitHub Project first (org → Projects → New
project → Table), note its number from the URL, then run the command above — it will
provision every field into it.

### 5. Commit

```bash
git add litecode.config.json .claude/
git commit -m "chore: add liteCodeAgent pipeline"
```

Commit `board.json` and `.litecode-lock.json` too — they're shared state, not local
scratch. `board.json` is generated; never hand-edit it.

---

## Using the pipeline

Once installed, you talk to the agents through Claude Code. The flow is deliberately
gated: **nothing creates tracked work or writes code without you saying so.**

### Turn an idea into a recommendation

> "Run the orchestrator on: users should be able to cancel a request after approval"

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
litecode status          # installed packs, versions, files the kit owns
litecode board doctor    # board.json vs. the live board, and Status integrity
```

Run `board doctor` after anyone edits the project's fields in the GitHub UI.

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
guide) belongs in that repo's `.claude/` as a local overlay — not in a pack.

---

## How it stays portable

- **No project literals in packs.** Agents and skills are Markdown with `{{ }}`
  placeholders; a test fails the build if a repo name, path, or board id leaks into one.
- **An unresolved placeholder is a hard error.** A prompt with a hole in it is worse than
  a build that fails.
- **Capability tiers, not model ids.** Packs declare `tier: fast | balanced | reasoning`;
  the tier→model mapping lives in your config. That's what will let the same packs drive
  an OpenAI- or DeepSeek-backed runner without touching a single agent file.
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
litecode upgrade                                    # updates ~/.litecode
cd /path/to/your/project && litecode install        # dry run shows the delta
litecode install --apply
```

If you edited a managed file by hand, `install` reports it as `DRIFT` and stops. Either
move your change upstream into the pack (the right answer, so every project gets it), or
re-run with `--force` to discard it.

To remove the kit from a project: delete the files listed in `.claude/.litecode-lock.json`,
then the lockfile and `litecode.config.json`. Your own `.claude/` files are untouched.

---

## Status

Phase 1 — packs, install, board provisioning — is done and driving a real repo.

Next: a plugin manifest for native `/plugin install`, then the provider-agnostic runner
(an agent loop with its own tool layer and `Agent` spawning) so the same packs run against
OpenAI-compatible providers instead of only inside Claude Code.

---

## Development

```bash
bun install
bun test
bun x tsc --noEmit
```

Working on the kit itself? `git clone` it anywhere and `bun link` — that takes over the
`litecode` command, and `litecode upgrade` will then refuse to touch your working tree.

Pack changes are content changes: edit the Markdown under `packs/`, bump the pack's
`version` in `pack.json`, and run `bun test` — the suite checks that no project literal
leaked in, that every agent declares a tier rather than a model, and that a full render
leaves no unresolved `{{ }}`.
