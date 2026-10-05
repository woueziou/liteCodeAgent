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

## Handoff measurement with a real pull request (ticket 0081, ADR 0027)

Date 2026-10-05. Same ticket (`0001`, size S), same code (litecode at `f455b2c`), same prompt, run with the implementer's full flow: pull request, CI, the review passes. Two conditions that differ only by configuration:

- **A**: `project.handoff` off (the default). The implementer runs steps 8 to 10 itself.
- **B**: `project.handoff: "auto"` with `project.handoffSupport: {"claude-code": true}`. The implementer hands the tail to the `closer`.

Fixture: this directory plus a CI workflow (`bun run check`, `bun test`) in a throwaway private GitHub repository. `replay-pr.sh` resets the checkout **and** the remote `main` to the base, closes the previous run's pull request, and refuses to start unless the start state is exactly the base. `analyze-pr-runs.py` computes the figures below from the `claude -p` JSON and the session transcripts, with the context definition of `litecode token-report --detail`.

Five valid runs per condition, alternated. Every run had its own pull request (distinct head commit) and a CI run for it.

| Measure | A (off) | B (closer) | Change B vs A | 95 % interval |
|---|---|---|---|---|
| Cost (USD) | 0.52 ± 0.03 | 0.51 ± 0.04 | -0.9 % | -12 % to +10 % |
| All-instance tokens (context read + output) | 1,307,117 ± 108,358 | 1,219,426 ± 185,432 | -6.7 % | -25 % to +11 % |
| Implementer context read | 1,164,750 ± 112,266 | 772,782 ± 181,157 | -33.7 % | -53 % to -14 % |
| Implementer calls | 40.6 ± 4.0 | 27.2 ± 4.2 | -33.0 % | -48 % to -18 % |
| Implementer context read after the PR | 762,931 ± 114,537 | 468,076 ± 191,249 | -38.6 % | -70 % to -8 % |
| Duration (s) | 197 ± 60 | 262 ± 45 | +33 % | -7 % to +73 % |

Implementer share of its own context read after the PR: A 65 %, B 59 %.

**Verdict against ADR 0027, decision 9.** The gate asks for the share after the PR to fall by at least a quarter, with no new `verify-report` failure and no half-finished run. It is **not met**: the share moved from 65 % to 59 % (a 9 % relative fall), and four of the five B runs ended with the ticket in `review` and a partial bug hunt, against one of five for A (A also lost one run to a CI that had not reported yet). The handoff stays off.

**What the data does show.** The closer takes work off the implementer: its calls and its own context read fall by a third. But the closer, the reviewers and the extra turns add about the same back, so the total (tokens, dollars) does not move: -7 % and -1 %, both inside the noise. Duration rises by about a third (a second agent to start, CI waited by the closer).

**Why this fixture may understate the benefit.** The implementer's context here is small (about 29,000 tokens per call on average, against 130,000 to 180,000 in real runs). A fresh context saves roughly (implementer context - closer context) per call of the tail, so the saving grows with the size of the ticket. This is a hypothesis; it was not measured.

**Outcome quality, B.** The closer ran, started `reviewer` and `bug-hunter` in the foreground at depth 2, and posted both reports in most runs. But the bug-hunter at depth 2 had Bash commands refused (3 to 5 refusals per B run against 0 or 1 per A run, under `--permission-mode dontAsk` with an allowlist), so its hunt was partial and the ticket stayed in `review`. Whether that is a property of nesting under a permission allowlist or of this harness is not established; in an interactive session the user would approve those commands.

**Defects the measurement found and that tests and reviews had not** (all fixed on the branch of PR #147): the closer, started in the foreground by the implementer, handed its partial text back as a result (first run); the closer ended its turn to wait for background reviews that no longer had anyone to notify (second run); GitHub queues the checks about 90 seconds after the pull request opens, so agents declared CI missing (a flaw of the default flow too, not touched).

**Limits.** Five runs per condition, one tiny ticket, one model configuration, one machine; a gap under about 20 % is not proven (rule of ticket 0090). A first series of eight runs was discarded because a failed `git switch` left each run starting from the previous run's work; the script now forces and verifies the start state. The measurement cost about 9 USD in total, 1.14 USD of it for the discarded series.
