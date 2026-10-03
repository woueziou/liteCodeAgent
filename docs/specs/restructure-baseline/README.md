# Baseline measurement (ticket 0082)

Fixture and protocol to measure the cost of one small backend ticket, before and after the restructure. Ticket 0090 replays it with the same protocol.

The fixture is a tiny pricing module with one bug and one ticket (`0001`, size S, already `planned` and assigned to `implementer`). `litecode.config.json` is the config used at the baseline, with `project.isolation` pinned to `inline`; the agents were installed from it.

## Protocol

1. Copy this directory to a fresh path (here: `/tmp/litecode-baseline`), `git init -b main`, add a bare local `origin`, commit.
2. `bun add -d typescript @types/bun`, then confirm `bun run check` and `bun test` pass (3 tests).
3. Install litecode into it with the repo CLI, claude-code target only: `litecode config targets set claude-code`, `litecode setup --apply`, then `litecode upgrade --yes --no-self-update` to drop the other targets' files. Set `litecode config set project.isolation inline`, `litecode setup --apply` again, and commit. That commit is the base.
4. `bunx litecodeagent` must run the repo under test. `bin/` does not exist in the repo, so put a script named `litecodeagent` (and `litecode`) in `node_modules/.bin` that runs `bun run <repo>/src/cli.ts "$@"`.
5. Run `replay.sh <fixture-dir> <base-commit> 5 <output-prefix>`. It resets the fixture to the base (branches, remote branches and worktrees from earlier runs are removed) before each of the five runs, then runs `claude -p --agent implementer` with a capped budget, a fixed prompt and a fixed list of allowed tools.
6. Read `total_cost_usd`, `num_turns` and `usage` from each JSON output. `litecode token-report` in the fixture gives the same totals per agent.

## Baseline result (isolation pinned to `inline`, five runs)

Date 2026-10-03. litecode 1.4.1 (repo `main` at `09730c5`), Claude Code 2.1.288, model `claude-sonnet-5-5`. Base commit of the fixture: `3c15b53`.

| Run | Total tokens | Cost (USD) | Turns |
|---|---|---|---|
| 1 | 257,945 | 0.094 | 20 |
| 2 | 319,167 | 0.111 | 23 |
| 3 | 333,138 | 0.114 | 21 |
| 4 | 388,299 | 0.123 | 23 |
| 5 | 262,611 | 0.091 | 19 |
| **Mean ± sd** | **312,232 ± 54,039 (17 %)** | **0.106 ± 0.014 (13 %)** | **21.2 ± 1.8 (8 %)** |

Output tokens: 2,592 ± 214 (8 %). Wall clock about 30 to 40 s per run. No subagent, no permission denial, no error in any run. Total tokens are about 95 % cache reads, so cost and turns track the work more closely than the raw token count.

Rendered agent prompts in the fixture (`.claude/agents/*.md`), in words: implementer 2,056, orchestrator 1,373, tracker 1,172, reviewer 1,166, triage 1,024, dispatcher 925, bug-hunter 904, planner 705, synthesizer 360, classifier 271, debate-angle 211, panel-selector 167. Total 10,334 words for 12 agents.

## What the variance allows

With five runs per condition, a 95 % interval on the difference of two means is about ±25 % on total tokens, ±19 % on cost and ±12 % on turns. A change smaller than that cannot be told from noise. Read cost and turns first, tokens second. Resolving a 10 % change would take about six times more runs per condition (roughly thirty), which is not worth it here; ticket 0090 should treat any gap under about 20 % as unproven.

## Isolation was the main source of noise

Before pinning, the agent chose a worktree in some runs and the primary checkout in others (four runs, isolation `auto`):

| Run | Total tokens | Cost (USD) | Turns | Isolation |
|---|---|---|---|---|
| 1 | 342,837 | 0.156 | 23 | primary checkout |
| 2 | 465,166 | 0.227 | 27 | worktree |
| 3 | 317,271 | 0.115 | 23 | worktree |
| 4 | 171,461 | 0.104 | 13 | primary checkout |

Mean 324,184, sd 120,549 (37 %). In the worktree runs `tsc` was not found (no `node_modules` there), so the type check went unverified. Pinning `inline` halved the relative spread. A fifth run that reused a leftover branch and worktree was discarded (contamination).

## Caveats

- No pull request, no CI wait, no reviewer and no bug-hunter. The costly parts named in ticket 0081 (context kept through CI and review) are outside this measurement.
- The fixture is tiny, so the absolute figure is far below a run on this repo (80k to 190k tokens per implementer run, ADR 0021). Use it to compare, not to forecast.
- Quality varies at the same cost. In the pinned runs, two confirmed that the new test failed before the fix, two said they had not run it against the old code, and one was unclear. A lower token count can mean a skipped check.
- Two earlier attempts stopped before writing code and are not counted: a Bash permission denial (0.10 USD), then a ticket still in `backlog` with a refused heredoc (0.08 USD). The ticket must be `planned` first.
- The agent added `Co-Authored-By` trailers to the fixture's commits. This repo's own rule (`CLAUDE.md`) forbids them in its own commits only.

## Closing measurement (ticket 0090)

Date 2026-10-03. Same protocol and the same `replay.sh`. Two conditions, ten runs each, isolation pinned to `inline`, one implementer run per ticket replay, no pull request, no reviewer.

- **Before:** the base `3c15b53` of the first measurement (the packs as they were before tickets 0087, 0088 and 0092). Runs 1 to 5 are the baseline above, runs 6 to 10 were added on the same base.
- **After:** a fixture rebuilt from this directory and installed with the packs of `main` at `b1157a6` (tickets 0087, 0088, 0092 merged, 0089 changes no prompt). Base commit `141069e`.

| Measure | Before (10 runs) | After (10 runs) | Change | 95 % interval on the change |
|---|---|---|---|---|
| Total tokens | 304,151 ± 54,708 (18 %) | 279,573 ± 39,710 (14 %) | -8.1 % | -23.0 % to +6.8 % |
| Cost (USD) | 0.112 ± 0.017 (15 %) | 0.109 ± 0.025 (23 %) | -2.6 % | -20.7 % to +15.5 % |
| Turns | 21.1 ± 2.0 (9 %) | 19.9 ± 1.4 (7 %) | -5.7 % | -13.3 % to +1.9 % |
| Output tokens | 2,682 ± 339 (13 %) | 2,475 ± 239 (10 %) | -7.7 % | -18.1 % to +2.7 % |
| Cache-creation tokens | 6,437 ± 4,005 | 7,505 ± 6,131 | +16.6 % | -60 % to +93 % |

Every interval contains zero. No run had an error, a permission denial or a subagent.

**Verdict: not proven.** The points are favourable (tokens -8 %, turns -6 %, output -8 %), but none exceeds the noise and all are below the 20 % bar set by ticket 0090. The first five runs of each condition suggested -17 % on tokens; ten runs shrank it to -8 %, which is what a lucky first sample looks like. Cost did not fall (-2.6 %, interval -21 % to +16 %).

**Prompt size per agent (Q4b): unchanged.** The 12 agents render to 10,331 words after, against 10,334 at the first baseline. The restructure cut the sources by about 3 %, not what the model reads. The measurable change is elsewhere: no agent preloads a skill, and for a project with no routing rule only three skills are installed (`agent-attribution`, `chained-implementation`, `idea-to-planned`) instead of five.

**Quality, a weak signal.** A pattern match over the final reports (so indicative, not a measurement) finds that the agent said it had not run the new test against the old code in 5 of 10 runs before and 1 of 10 after. That would mean the leaner packs did not make the agent skip checks. Ten runs cannot confirm it.

**What would settle the cost question.** With a spread of about 15 %, resolving a 10 % change takes about 20 runs per condition (roughly 2 USD each side).

**Limits.** No pull request, no CI wait, no reviewer: the part ticket 0081 targets (context kept through CI and review) is outside this protocol, so 0081 cannot show up here. The fixture's `litecodeagent` script runs the current repo checkout, so the CLI the agents call during a run is newer than the packs for the "before" condition; it does not change any prompt. The fixture is tiny, so absolute numbers are far below a run on this repo.
