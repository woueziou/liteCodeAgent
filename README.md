# liteCodeAgent

A portable, versioned multi-agent software pipeline. The agents that take an idea from
"someone said it in chat" to "a reviewed PR on a tracked board" live here as **packs**,
not inside one repo's `.claude/` directory — so a second project gets the whole pipeline
with one command instead of a copy-paste.

```
idea → classifier → panel-selector → debate-angle ×N → synthesizer → planner
                                                                        ↓
                                              tracker → dispatcher → implementer → reviewer
                                                                        ↑           ↓
                                                                      triage ←──────┘
```

## Why packs instead of a template repo

A template gives you a copy that immediately starts drifting. A pack is installed, tracked
in a lockfile, and upgraded — and it renders from one source for whatever harness you run.

- **One source of truth.** Agents and skills are Markdown with `{{ }}` placeholders. They
  contain no repo names, no paths, no board ids.
- **Capability tiers, not model ids.** A pack declares `tier: fast | balanced | reasoning`.
  The tier→model mapping lives in the project's config, which is what will let the same
  pack drive an OpenAI- or DeepSeek-backed runner without touching a single agent file.
- **Local overlay is sacred.** The lockfile records exactly which files the kit owns.
  Anything else under `.claude/` is yours — never read, rewritten, or removed.

## Quick start

```bash
cd /path/to/your/repo
bun /path/to/liteCodeAgent/src/cli.ts init --packs core,web   # writes litecode.config.json
$EDITOR litecode.config.json                                  # fill in every TODO
bun /path/to/liteCodeAgent/src/cli.ts install                 # dry run
bun /path/to/liteCodeAgent/src/cli.ts install --apply
bun /path/to/liteCodeAgent/src/cli.ts board init              # dry run against GitHub
bun /path/to/liteCodeAgent/src/cli.ts board init --apply
```

Every mutating command is a dry run by default. `--apply` is always explicit.

## Commands

| Command | What it does |
| --- | --- |
| `litecode init` | Write a starter `litecode.config.json` with TODO placeholders |
| `litecode packs` | List available packs and what they contain |
| `litecode install` | Render packs into the target repo's `.claude/` |
| `litecode status` | Show installed packs, versions, and how many files the kit owns |
| `litecode board init` | Provision missing board fields/labels and resolve every id into `board.json` |
| `litecode board doctor` | Check `board.json` against the live board, and that no item lost its Status |

## Packs

- **`core`** — the 11 pipeline agents (`classifier`, `panel-selector`, `debate-angle`,
  `synthesizer`, `planner`, `orchestrator`, `tracker`, `dispatcher`, `implementer`,
  `reviewer`, `triage`) plus `github-project-sync`, `agent-attribution`,
  `critique-expert`, `security-expert`, and the `idea-to-planned` /
  `chained-implementation` chaining skills.
- **`web`** — expert skills for TypeScript/React work: `typescript-expert`,
  `frontend-expert`, `ui-ux-expert`, `design-expert`, and the three `mobile-*` experts.

A skill that only makes sense on one repo (a framework-specific expert, a house style
guide) stays in that repo's `.claude/` as a local overlay. Don't add it to a pack.

## The board is provisioned, not transcribed

The pipeline is board-backed: status lives in a GitHub Project, not in issue comments.
`litecode board init` discovers the project, creates whatever fields are missing, and
writes every resolved id into `.claude/data/board.json`. Agents read roles
(`inProgress`, `readyToMerge`, …) from that file — no id is ever written by hand, because
a hand-copied id silently diverges from the real one.

**One thing is deliberately not automated.** Adding an option to an *existing*
single-select field is reported as a blocker for a human to do in the web UI.
`updateProjectV2Field`'s `singleSelectOptions` input carries no option `id`, so the API
physically cannot preserve the existing ones: every option gets a fresh id and every board
item referencing an old one has its Status silently set to null. `board doctor` checks for
exactly that signature.

## Versioning

Each pack carries its own semver in `pack.json`; the repo is tagged as a whole. Installing
writes `.claude/.litecode-lock.json` recording pack versions and a content hash per file,
so `install` can tell apart "you're behind" from "you edited this by hand" — and refuses
to overwrite the latter without `--force`.

## Status

Phase 1 (packs, install, board provisioning) is done and driving a real repo. Next:
a plugin manifest for native `/plugin install`, then the provider-agnostic runner —
an agent loop with its own tool layer and `Agent` spawning, so the same packs run against
OpenAI-compatible providers instead of only inside Claude Code.

## Development

```bash
bun install
bun test
bun x tsc --noEmit
```
