#!/bin/bash
# Replays the baseline measurement. Usage: replay.sh <fixture-dir> <base-commit> <runs> <output-prefix>
# The fixture dir must already be installed (see README.md) and committed at <base-commit> on main.
set -u
DIR=${1:?fixture dir}; BASE=${2:?base commit}; N=${3:-5}; OUT=${4:-/tmp/baseline}
cd "$DIR" || exit 1
PROMPT="Implement ticket 0001 (docs/tickets/0001-fix-price-applydiscount-truncates-cents-instead.md). There is no GitHub repository for this project: do your normal work up to the point of opening a pull request, then stop after committing on your ticket branch and pushing it to origin. Do not call gh and do not open a pull request. Report what you did. Shell rule for this run: issue each shell command as one simple command, with no variable assignments and no heredocs; write files with the Write tool."
TOOLS=(Read Edit Write Glob Grep Skill Agent "Bash(git:*)" "Bash(bun:*)" "Bash(bunx:*)" "Bash(ls:*)" "Bash(cat:*)" "Bash(mkdir:*)" "Bash(mv:*)" "Bash(cp:*)" "Bash(rm:*)" "Bash(touch:*)" "Bash(grep:*)" "Bash(rg:*)" "Bash(sed:*)" "Bash(awk:*)" "Bash(head:*)" "Bash(tail:*)" "Bash(wc:*)" "Bash(sort:*)" "Bash(diff:*)" "Bash(find:*)" "Bash(echo:*)" "Bash(printf:*)" "Bash(cd:*)" "Bash(pwd:*)" "Bash(test:*)" "Bash(date:*)" "Bash(sleep:*)" "Bash(xargs:*)")
for i in $(seq 1 "$N"); do
  # Reset to the pinned state: a leftover branch or worktree from a previous run contaminates the next one.
  git switch -q main && git reset -q --hard "$BASE" && git clean -qfd
  for w in $(git worktree list --porcelain | grep '^worktree ' | cut -d' ' -f2 | grep -v "$(basename "$DIR")\$"); do git worktree remove --force "$w"; done
  rm -rf "$(dirname "$DIR")/worktrees"; git worktree prune
  for b in $(git branch --format='%(refname:short)' | grep -v '^main$'); do git branch -q -D "$b"; done
  for b in $(git branch -r --format='%(refname:short)' | grep -v 'origin/main$' | grep -v HEAD | grep -v '^origin$'); do git push -q origin --delete "${b#origin/}"; done
  git fetch -q --prune
  claude -p --agent implementer --output-format json --max-budget-usd 10 --permission-mode dontAsk \
    --allowedTools "${TOOLS[@]}" -- "$PROMPT" > "$OUT$i.json" 2> "$OUT$i.err"
done
