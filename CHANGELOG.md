# Changelog

## 0.1.0 — unreleased

First extraction of the pipeline out of a single repo into installable packs.

- `core` pack: 11 pipeline agents + 6 shared skills, fully decoupled from any one project.
- `web` pack: 7 expert skills for TypeScript/React work.
- Template engine with `{{ }}` interpolation, `#if`/`#each` blocks, and `join`/`codelist`
  filters. An unresolved placeholder is a hard error, never a silent blank.
- `install` renders packs into a target repo, tracked by `.claude/.litecode-lock.json`.
  Dry run by default; hand-edited files are reported as drift and need `--force`.
- `board init` / `board doctor` provision and verify the GitHub Project board, resolving
  every field/option id into a generated `board.json` instead of hand-written ids.
  Adding an option to an existing single-select field is refused by design — the API
  cannot do it without regenerating every option id and nulling every item's Status.
- Agents declare a capability `tier` rather than a model id, so the same pack can be
  rendered for a different provider later.

## 0.2.0 — unreleased

- `litecode init` is now a wizard. It detects the repo (git remote, scripts and lockfile,
  dependencies across `apps/*`/`packages/*`, ADR directory, skills you already own, the
  convention bullets in your `CLAUDE.md`, your GitHub Projects) and proposes real answers.
  `domains` and `agentSkills` are derived rather than asked. `--yes` skips the questions.
- `install.sh`: one-command bootstrap, clones via `gh` so it works on a private repo.
  Re-running it updates.
- `litecode upgrade`: self-update the kit, refusing to pull over local edits.
- `install` now fails on a skill reference that resolves to neither an installed pack nor
  a local overlay, naming where each dangling reference came from.
- Fixed: directory detection used `Bun.file().exists()`, which is false for directories,
  so ADR/skill/workspace discovery silently found nothing.
