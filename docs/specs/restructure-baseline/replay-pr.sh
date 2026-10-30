#!/bin/bash
# One measured run with a real pull request. Usage: replay-pr.sh <fixture-dir> <base-commit> <out-prefix> [budget-usd]
# Resets the local checkout AND the remote main to <base-commit>, deletes remote branches of earlier runs
# (which closes their pull requests), then runs the implementer with its full flow.
set -u
DIR=${1:?fixture dir}; BASE=${2:?base commit}; OUT=${3:?out prefix}; BUDGET=${4:-6}
cd "$DIR" || exit 1
# Discard whatever the previous run left (inline mode leaves uncommitted ticket changes on its feature
# branch: a plain `git switch main` then fails and the reset is silently skipped, which contaminated a
# whole series). Force everything, then verify the starting state instead of trusting it.
git reset -q --hard; git clean -qfd; git switch -q -f main || { echo "cannot switch to main, aborting" > "$OUT.err"; exit 1; }
git reset -q --hard "$BASE" && git clean -qfd
for w in $(git worktree list --porcelain | grep '^worktree ' | cut -d' ' -f2 | grep -v "$(basename "$DIR")\$"); do git worktree remove --force "$w"; done
rm -rf "$(dirname "$DIR")/worktrees"; git worktree prune
for b in $(git branch --format='%(refname:short)' | grep -v '^main$'); do git branch -q -D "$b"; done
for b in $(git ls-remote --heads origin | awk '{print $2}' | sed 's#refs/heads/##' | grep -v '^main$'); do git push -q origin --delete "$b"; done
git push -q -f origin main
START_SHA=$(git rev-parse HEAD)
if [ "$(git branch --show-current)" != "main" ] || [ "$START_SHA" != "$(git rev-parse "$BASE^{commit}")" ] || [ -n "$(git status --porcelain)" ] || [ "$(git branch --format='%(refname:short)' | grep -vc '^main$')" != "0" ]; then
  echo "starting state is not the clean base ($START_SHA on $(git branch --show-current)), aborting" > "$OUT.err"; exit 1
fi
echo "start ${START_SHA:0:7} on main, base $BASE" > "$OUT.startstate"
# Branch deletion closes pull requests asynchronously: wait until none is open, or a new run would
# attach itself to the previous run's pull request (found by the third pilot).
for i in $(seq 1 60); do n=$(gh pr list --state open --json number --jq 'length'); [ "$n" = "0" ] && break; sleep 3; done
[ "$(gh pr list --state open --json number --jq 'length')" = "0" ] || { echo "open PRs remain, aborting" > "$OUT.err"; exit 1; }
git fetch -q --prune
PROMPT="Implement ticket 0001 (docs/tickets/0001-fix-price-applydiscount-truncates-cents-instead.md). Follow your full normal flow, including opening the pull request, waiting for CI, and the review passes. After opening the pull request, GitHub queues the checks and the `test` check typically appears 90 to 150 seconds later: poll `gh pr checks` every 20 seconds until the `test` check has a result, for up to five minutes, and only then judge CI. Never report CI as missing before those five minutes have passed. Shell rule for this run: issue each shell command as one simple command, with no variable assignments and no heredocs; write files with the Write tool. Report what you did."
TOOLS=(Read Edit Write Glob Grep Skill Agent "Bash(git:*)" "Bash(gh:*)" "Bash(bun:*)" "Bash(bunx:*)" "Bash(ls:*)" "Bash(cat:*)" "Bash(mkdir:*)" "Bash(mv:*)" "Bash(cp:*)" "Bash(rm:*)" "Bash(touch:*)" "Bash(grep:*)" "Bash(rg:*)" "Bash(sed:*)" "Bash(awk:*)" "Bash(head:*)" "Bash(tail:*)" "Bash(wc:*)" "Bash(sort:*)" "Bash(diff:*)" "Bash(find:*)" "Bash(echo:*)" "Bash(printf:*)" "Bash(cd:*)" "Bash(pwd:*)" "Bash(test:*)" "Bash(date:*)" "Bash(sleep:*)" "Bash(xargs:*)" "Bash(tar:*)" "Bash(mktemp:*)" "Bash(python3:*)" "Bash(jq:*)" "Bash(tee:*)" "Bash(true:*)" "Bash(basename:*)" "Bash(dirname:*)" "Bash(cmp:*)")
date -u +%FT%TZ > "$OUT.start"
claude -p --agent implementer --output-format json --max-budget-usd "$BUDGET" --permission-mode dontAsk --allowedTools "${TOOLS[@]}" -- "$PROMPT" > "$OUT.json" 2> "$OUT.err"
echo "exit $?" >> "$OUT.err"
date -u +%FT%TZ > "$OUT.end"
gh pr list --state all --json number,state,headRefName,mergedAt,comments --jq '.[] | {number,state,headRefName,comments:(.comments|length)}' > "$OUT.pr.json" 2>&1
git log --oneline --all -8 > "$OUT.git" 2>&1
grep -h "^status:" docs/tickets/0001-*.md > "$OUT.ticket" 2>&1

# Integrity: the pull request must carry this run's head commit, and a CI run must exist for it.
HEAD_SHA=$(git rev-parse HEAD); BRANCH=$(git branch --show-current)
{
  echo "local branch $BRANCH head ${HEAD_SHA:0:7}"
  gh pr list --state all --json number,state,headRefOid,createdAt --jq '.[] | "pr #\(.number) \(.state) head \(.headRefOid[0:7]) created \(.createdAt[11:19])"'
  gh run list --limit 6 --json event,headSha,conclusion,createdAt --jq '.[] | "run \(.createdAt[11:19]) \(.event) \(.headSha[0:7]) \(.conclusion)"'
} > "$OUT.integrity" 2>&1
