# Baseline measurement (ticket 0082)

Fixture and protocol to measure the cost of one small backend ticket, before and after the restructure. Ticket 0090 replays it.

The fixture is a tiny pricing module with one bug and one ticket (`0001`, size S, already `planned` and assigned to `implementer`). `litecode.config.json` is the config used at the baseline; the agents were installed from it.

## Protocol

1. Copy this directory to a fresh path (here: `/tmp/litecode-baseline`), `git init -b main`, add a bare local `origin`, commit.
2. `bun add -d typescript @types/bun`, then confirm `bun run check` and `bun test` pass (3 tests).
3. Install litecode into it with the repo CLI, claude-code target only: `litecode config targets set claude-code`, `litecode setup --apply`, then `litecode upgrade --yes --no-self-update` to drop the other targets' files. Commit.
4. `bunx litecodeagent` must run the repo under test. `bin/` does not exist in the repo, so put a script named `litecodeagent` (and `litecode`) in `node_modules/.bin` that runs `bun run <repo>/src/cli.ts "$@"`.
5. Run, from the fixture root on `main`, with a clean tree:

```text
claude -p --agent implementer --output-format json --max-budget-usd 10 \
  --permission-mode dontAsk \
  --allowedTools Read Edit Write Glob Grep Skill Agent \
    "Bash(git:*)" "Bash(bun:*)" "Bash(bunx:*)" "Bash(ls:*)" "Bash(cat:*)" \
    "Bash(mkdir:*)" "Bash(mv:*)" "Bash(cp:*)" "Bash(rm:*)" "Bash(touch:*)" \
    "Bash(grep:*)" "Bash(rg:*)" "Bash(sed:*)" "Bash(awk:*)" "Bash(head:*)" \
    "Bash(tail:*)" "Bash(wc:*)" "Bash(sort:*)" "Bash(diff:*)" "Bash(find:*)" \
    "Bash(echo:*)" "Bash(printf:*)" "Bash(cd:*)" "Bash(pwd:*)" "Bash(test:*)" \
    "Bash(date:*)" "Bash(sleep:*)" "Bash(xargs:*)" \
  -- "<prompt below>"
```

Prompt: `Implement ticket 0001 (docs/tickets/0001-fix-price-applydiscount-truncates-cents-instead.md). There is no GitHub repository for this project: do your normal work up to the point of opening a pull request, then stop after committing on your ticket branch and pushing it to origin. Do not call gh and do not open a pull request. Report what you did. Shell rule for this run: issue each shell command as one simple command, with no variable assignments and no heredocs; write files with the Write tool.`

6. Read `total_cost_usd`, `num_turns` and `usage` from the JSON, then run `litecode token-report` in the fixture for the per-agent totals.

## Baseline result

| | |
|---|---|
| Date | 2026-10-02 |
| litecode | 1.4.1, repo commit `4b47fde` (code identical to `main` at `09730c5`) |
| Claude Code | 2.1.288, model `claude-sonnet-5-5` |
| Cost | 0.156 USD |
| Turns | 23, 39 s wall clock |
| Tokens | input 30, output 3,214, cache read 324,806, cache creation 14,787, total 342,837 |
| Subagents | 0 (no bug-hunter, no reviewer) |
| Permission denials | 0 |
| Outcome | test committed first and failing (`Expected 501, Received 500`), then fix, then 4 tests and `tsc` passing, branch pushed |

Rendered agent prompts in the fixture (`.claude/agents/*.md`), in words: implementer 2,056, orchestrator 1,373, tracker 1,172, reviewer 1,166, triage 1,024, dispatcher 925, bug-hunter 904, planner 705, synthesizer 360, classifier 271, debate-angle 211, panel-selector 167. Total 10,334 words for 12 agents.

## Caveats

- One run only: variance is unknown. Repeat three times before reading a small gap as a gain.
- No pull request, no CI wait, no reviewer and no bug-hunter. The costly parts named in ticket 0081 (context kept through CI and review) are outside this measurement.
- The fixture is tiny, so the absolute figure is far below a run on this repo (80k to 190k tokens per implementer run, ADR 0021). Use it to compare, not to forecast.
- Two earlier attempts stopped before writing code and are not counted: a Bash permission denial (0.10 USD), then a ticket still in `backlog` with a refused heredoc (0.08 USD). The ticket must be `planned` first.
- The agent added `Co-Authored-By` trailers to the fixture's commits. This repo's own rule (`CLAUDE.md`) forbids them in its own commits only.
