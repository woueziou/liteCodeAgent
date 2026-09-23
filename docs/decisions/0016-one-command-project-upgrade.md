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
5. **Orphans are deleted only when intact** (owner's choice). Their content must match
   the hash their lockfile recorded, both when the plan is made and again just before
   deleting. An empty folder left behind is removed too.

   Orphans are found in two places:
   - the lockfile;
   - the known install locations of removed agents and skills, because a project that
     already ran `install --apply` on 1.0 no longer has them in its lockfile.

   A file only the known locations turn up has no recorded hash, so it is kept and
   listed. So is an edited orphan. While a hand-edited managed file blocks the
   re-render, no orphan is deleted, because agents that weren't re-rendered may still
   reference them. A ticket with an unknown frontmatter key isn't migrated, and an
   invalid ticket is listed. Everything left alone is reported with the reason.
6. **Nothing is deleted outside the project.** Every path read from the config or a
   lockfile must resolve inside the project root. A path that doesn't is listed and
   never deleted.
7. **Config cleanup edits the file as written**, removing only obsolete keys and keeping
   the file's indentation. It never re-serializes the parsed config, which would add
   every default the user never set. A domain that loses its last skill to a removed one
   is dropped, because the schema forbids a domain with no skill. Angles are never
   dropped, since an empty skill list is normal for them, and neither is any entry that
   didn't name a removed skill.
8. **Changes apply in order and stop at the first failure**, reporting what was already
   applied.
9. **Exit code 0 means the project ended up fully current.** Anything still pending
   gives 1: a plan that wasn't applied (declined, or no terminal and no `--yes`) or
   items left for a human. CI can tell "done" from "needs attention".

## Consequences

- One command replaces the four manual steps. The 1.0 guide leads with it and keeps the
  manual steps as a reference.
- An orphan kept because it was edited, or because no lockfile vouches for it, keeps
  being listed on every run, with exit code 1, until the user deletes it. That is on
  purpose: the command never treats it as done.
- Migrated tickets and the cleaned config are left uncommitted, like any other change
  (ADR 0015).
