---
generated_by: implementer
task: "0066"
---

# 0022. Installed agents are regenerated on main after merge, not in each PR

Status: accepted
Date: 2026-09-29

## Context

This repository dogfoods itself: `packs/` is the source, and `install --apply --force` renders it into `.claude/`, `.kilo/` and `.pi/`, each with a lockfile (`.litecode-lock.json`) listing every file's hash and an `installedAt` timestamp. Nearly every PR that touches `packs/` also regenerated those files, so two open PRs always conflicted on the three lockfiles (and on the rendered agents), forcing a merge of main, another `install --apply --force` and a new CI run each time.

## Decisions

1. **Option (a) is retained: PRs change `packs/` only; installed files are regenerated once, after merge, by CI, through a pull request.** A new workflow `.github/workflows/sync-installed.yml` runs on `push` to `main` and executes `install --apply --force`. If nothing changed it does nothing. Otherwise it force-updates the fixed branch `chore/sync-installed` (owned by the bot: never touched by humans or agents), and opens a PR from it titled `chore(install): regenerate installed agents from packs/`, or reuses the one already open. A human merges it, so nothing reaches `main` without a PR and `main` keeps owner-only attribution. `implementer.md` says: commit only `packs/`, never re-render or hand-resolve installed files, never touch `chore/sync-installed`.
2. **Option (b), a `.gitattributes` merge driver, is rejected.** A merge driver needs a `merge.<name>.driver` entry in each clone's git config (`.gitattributes` alone only names it), and GitHub's server-side merge never runs custom drivers, so it would not remove the conflicts that show up on the PR page.
3. **A gap is detected, not silently tolerated.** `litecode install --check` exits 1 when any installed file differs from what `packs/` renders (out of date or hand-edited) and writes nothing. `litecode doctor` reports it as a warning (`N installed file(s) are out of date with packs/`), except on a repository with nothing installed yet.
4. **Lockfiles stop churning.** `installedAt` is kept when a regeneration changes nothing else, so an unchanged re-run leaves the lockfile byte-identical.

## Consequences

- PR diffs shrink to `packs/`, tests and docs; the three-lockfile conflict disappears for ordinary PRs.
- Between a merge and the merge of the regeneration PR (as long as a human takes), main's installed files lag `packs/`; `doctor` shows the gap.
- The workflow needs `contents: write` (to push the bot branch) and `pull-requests: write` (to open or find the PR), and the repository setting allowing Actions to create pull requests. Without that setting the job fails visibly.
- The regeneration PR and its commit are authored by `github-actions[bot]` until a human merges it. Its checks do not start automatically (a `GITHUB_TOKEN` push triggers no workflow): the merger runs or reviews them by hand.
- The bot commit bypasses the repository's owner-only pre-commit hook (`git -c core.hooksPath=/dev/null commit`), which `bun install` activates in CI; otherwise the job could never commit. Merge the regeneration PR with squash so `main` keeps owner-only attribution.
- If a later run finds nothing to regenerate, it closes a still-open regeneration PR as obsolete.
- `--check` and `doctor` also count orphans (files a pack no longer produces) as out of date.
- Tests read the packs' sources, not the installed copies, so a PR that changes only `packs/` is judged on what it changed.
- The lockfile format is unchanged.
