---
generated_by: claude
task: "0031"
---

# 0016. `litecode upgrade` brings a project up to date in one command

Status: proposed
Date: 2026-09-23

## Context

Upgrading a project to 1.0 took four manual steps from `docs/upgrading-to-1.0.md`:
1. `install --apply`;
2. deleting the orphaned `sync` agent and `github-project-sync` skill copies, which
   `install` reports but never deletes;
3. `ticket migrate --apply`;
4. removing obsolete config keys and data files by hand.

Testing against a real 0.14.0 install also turned up a trap the manual steps didn't
cover. 0.14.0 named `github-project-sync` in the `agentSkills` of five agents. `install`
accepted the reference only because the old installed copy of the skill passed for a
local overlay. Once that orphan is deleted, the reference dangles.

`litecode upgrade` existed, but only pulled a legacy git-clone install of the CLI itself.
The project owner asked for the migration to happen through the tool, without the user
typing any other command (ticket 0031).

## Decision

1. **`litecode upgrade` upgrades the project** it runs in (`src/project-upgrade.ts`).
   A legacy git-clone install still pulls itself first, then re-runs the command with
   the new code, so the project is migrated by the release it just fetched.
2. **Upgrading is a list of migrations, each detecting what it needs.** There is no
   version stamp:
   - `config` removes obsolete settings (`project.board`, the auto-sync keys,
     `agentSkills.sync`) and names of removed skills from every skill list;
   - `packs` re-renders;
   - `orphans` deletes files older releases generated;
   - `tickets` migrates v1 tickets;
   - `legacy-data` deletes the board and sync data files.

   A current project gets an empty plan, so re-running is harmless. A future breaking
   release adds a migration instead of a manual step.
3. **Every later migration is planned against the config as `config` will leave it**,
   so agents are re-rendered without references to removed skills.
4. **The plan is shown, then confirmed** (owner's choice). Nothing is written before the
   user answers yes. `--yes` skips the question for scripts. Outside a terminal and
   without `--yes`, the command shows the plan and applies nothing.
5. **Orphans are deleted only when intact** (owner's choice): their content must still
   match the hash their lockfile recorded. An edited orphan is kept and listed.
   Likewise, a hand-edited managed file stops the re-render, and a ticket with an
   unknown frontmatter key isn't migrated. Everything left alone is reported with the
   reason.
6. **Config cleanup edits the file as written**, removing only obsolete keys. It never
   re-serializes the parsed config, which would add every default the user never set.
7. **Changes apply in order and stop at the first failure**, reporting what was already
   applied.

## Consequences

- One command replaces the four manual steps. The 1.0 guide leads with it and keeps the
  manual steps as a reference.
- After a successful upgrade, the lockfile no longer lists the orphans. An edited orphan
  that was kept is therefore reported once, not on every later run.
- Migrated tickets and the cleaned config are left uncommitted, like any other change
  (ADR 0015).
