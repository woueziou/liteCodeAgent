# Restructure litecode for a simpler install, unified CLI and leaner tokens

Status: tickets 0082 to 0090 (epic `11-restructure`) and 0081.

Spec de restructuration de litecode : installation plus simple, CLI et mise à jour unifiées, isolation de l'implementer selon l'outil, skills allégés et tokens maîtrisés. Issue d'une session de grilling ; les termes suivent `GLOSSARY.md`.

## Problem Statement

Pour une petite équipe qui utilise déjà Claude Code ou Codex, litecode est difficile à prendre en main. L'init pose treize groupes de questions, dont plusieurs en jargon (ADR directory, debate angles, trust boundaries) qu'un utilisateur ne sait pas remplir. Le nom de la commande varie (`bunx litecodeagent`, `litecode`, `/litecodeagent`). Trois « doctor » se chevauchent, `upgrade` n'est annoncé nulle part, et `--help` est une liste plate. L'implementer est forcé en worktree même quand l'outil n'en a pas besoin ou n'en offre pas. Chaque ticket coûte cher en tokens : l'implementer précharge dix skills quel que soit le ticket, des règles sont dupliquées entre agents, skills et références, et rien ne empêche leur retour.

## Solution

Un projet s'installe avec une seule question : valider les règles de routage vers les skills (Domain) déduites de la stack. Tout le reste est détecté ou prend une valeur par défaut, modifiable ensuite. La commande s'appelle `litecode` partout, avec un `--help` groupé par étape. `upgrade` est le seul point de mise à jour et `doctor` le seul de diagnostic. L'implementer choisit son Isolation mode selon les capacités de l'install target. Aucun skill n'est préchargé : ils se chargent à la demande par les Domain. Les règles dupliquées ont une source unique, et les tokens sont surveillés en couches.

## User Stories

1. As a team member, I want `litecode setup` to ask me a single question, so that I can start a first ticket without understanding the config.
2. As a team member, I want the install targets pre-selected from the tools found on disk, so that I don't pick them by hand.
3. As a team member, I want the project name, default branch, check command and type-check commands detected, so that I don't type what the repo already says.
4. As a team member, I want to see the Domain rules deduced from my stack and accept them with one keypress, so that agents read the right skills.
5. As a team member, I want to edit or add Domain rules in that same question, so that a wrong detection is fixed at install time.
6. As a team member, I want the question worded without jargon ("when a ticket touches…, which guides should the agent read?"), so that I understand it.
7. As a team member whose stack is not detected, I want to be asked to write at least one Domain rule, so that the model does not have to guess during work.
8. As a team member, I want to skip that question and still finish the install, so that nothing blocks me.
9. As a team member, I want `doctor` to warn "no routing rule" when I skipped it, so that I notice the gap.
10. As a team member, I want a summary of everything written before the install is applied, so that I confirm what changes.
11. As a team member, I want the generated config to contain only targets, packs, project name, default branch, check command, type-check commands and Domain rules, so that I can read it.
12. As a team member, I want every other setting available through `config set` with its default, so that I can change it later without editing JSON.
13. As a team member without a detected check command, I want the install to pass, so that I am not stuck.
14. As a team member without a detected check command, I want the implementer to refuse to work with a message naming the exact `config set` command, so that I know the fix.
15. As a team member without a detected GitHub repository, I want the same behaviour for the agents that open pull requests, so that failure is explicit.
16. As a user, I want the command to be called `litecode` in every message, prompt and README example, so that I learn one name.
17. As a user, I want `bunx litecodeagent` mentioned only for the first install, so that the rest is consistent.
18. As a user of any install target, I want the in-tool command to be `/litecode`, so that it matches the CLI.
19. As a user, I want `--help` grouped by workflow stage (install, plan, implement, diagnose), so that I find a command quickly.
20. As a user, I want the CLI to announce `litecode upgrade` after `setup`, so that I know how to update.
21. As a user, I want the CLI to tell me when my project is behind the installed version, so that I upgrade at the right time.
22. As a user, I want a single `upgrade` command that self-updates, migrates config and tickets, re-renders packs and removes orphans, so that one command brings the project up to date.
23. As a user with an existing project, I want `upgrade` to remove obsolete config keys and rename old skill names in my Domain rules, so that nothing breaks after the restructure.
24. As a user, I want a single `doctor` command with `--fix` that also checks tickets and config, so that I don't choose among three doctors.
25. As a user, I want `doctor` to verify that every skill named in a Domain rule exists in the installed packs, so that routing does not silently point nowhere.
26. As a user, I want `doctor` to warn when the stack contains a technology with no Domain rule, so that a missed detection is visible.
27. As a user, I want `install` to stop being a user-facing command and `--check` to remain available for CI drift, so that the surface is small.
28. As a Claude Code user, I want the implementer to run in an isolated worktree by default, so that it cannot touch my main checkout.
29. As a user of opencode, kilo-code, codex or pi, I want the implementer to run inline by default, so that it works without an isolation feature my tool lacks.
30. As a user, I want to force `worktree` or `inline` per project or per call, so that I override the default.
31. As a user, I want inline mode refused when the working tree is dirty, so that unrelated changes never mix into a ticket.
32. As a user, I want inline mode refused when another implementer is already running, so that two runs never collide.
33. As a user whose tool gains worktree support, I want to override the built-in capability table in config, so that I don't wait for a release.
34. As an agent, I want ticket writes to still reach the primary checkout in both modes, so that the dispatcher and dashboard see them.
35. As a user, I want the web skills reduced from seven to five with every rule kept, so that less is loaded without losing guidance.
36. As a user, I want no skill preloaded by any agent, so that a backend ticket never pays for UI skills.
37. As an agent, I want skills loaded on demand through the Domain rules, so that I read only what the ticket touches.
38. As an agent, I want to say in my report when no Domain rule matched the ticket, so that missing guidance is visible.
39. As a maintainer, I want each rule written once, with a single source per topic (test-first, batch, trailer, human-instruction gate), so that edits don't drift.
40. As a maintainer, I want a rule removed from an agent text only when a test or guard still enforces it, so that refactoring never loses a rule.
41. As a maintainer, I want the agent-trailer rule kept as one line in each agent body, so that it is applied without loading a skill.
42. As a maintainer, I want a drift report of each agent's and skill's size against the previous version, so that growth is visible.
43. As a maintainer, I want a word budget per agent and skill enforced by `bun test`, so that CI catches obvious bloat.
44. As a maintainer, I want a reference ticket measured with `token-report` at each release, so that real cost per ticket is tracked.
45. As a maintainer, I want an optional tokenizer estimate, added only if word counts prove too coarse, so that I do not add a dependency early.
46. As a maintainer, I want the implementer to hand off to a fresh-context agent after the pull request opens, so that CI waits and reviews don't carry 170k tokens of context.
47. As a maintainer, I want the ready `09-token-diet` tickets merged and a baseline measured before this work starts, so that gains are attributable.
48. As a maintainer, I want separate ADRs for isolation, extended word budgets and context handoff, so that each reversal of an accepted decision is recorded.

## Implementation Decisions

- **Install**: the interactive init is reduced to one question (Domain rules, proposed from detection, accepted with one keypress). Install targets are pre-selected from tools found on disk. A summary precedes writing. Non-interactive runs write the deduced rules without asking.
- **Undetected required values** (check command, GitHub repository): the install passes with the value absent. The agent that needs it refuses with a message naming the `config set` fix. This replaces the TODO placeholders that currently block install.
- **Generated config**: contains targets, packs, project name, default branch, check command, type-check commands and Domain rules. The legacy single `target`, the output directory, lessons and per-agent skill lists are removed. Model tiers, worktree root, ADR directory, project language, conventions, trust boundaries and review angles take defaults, and each stays settable through `config set`.
- **Domain**: kept, because routing and skill installation filtering both depend on it. Derived from the detected stack, shown at init, validated by `doctor`. The init prompt does not use the word "domain".
- **Skill loading**: no agent preloads a skill. Skills load on demand through Domain rules and the skill tool. The per-agent `agentSkills` override is dropped (ticket 0092): the key is ignored, and `upgrade` removes it and says custom lists are not kept.
- **Web skills**: seven merged into five (the spec first said four: seven minus two merges is five). The small-viewport design rules join the design skill, the touch interaction rules join the UX skill with the duplicated confirmation block merged, the mobile platform skill stays alone and carries the shared preamble, and the frontend and TypeScript skills stay separate. Existing Domain rules and configs are rewritten by `upgrade`.
- **Rule deduplication**: the test-first verification protocol lives in one reference and the implementer-side file shrinks to a checkpoint and a pointer. The batch protocol lives in one reference and the reviewer side keeps only its own rules. The human-instruction gate shared by the two workflow skills moves to a shared partial. The agent-trailer rule is one line per agent body.
- **Command naming**: `litecode` in CLI messages, help and docs, `/litecode` as the in-tool command. Any command run through `bunx` stays `bunx litecodeagent` (agent prompts, README examples, the `Next:` hint), because `litecode` is not on the PATH under `bunx`. The npm package name is unchanged.
- **CLI surface**: help grouped by workflow stage. `upgrade` is the single update entry and `doctor` the single diagnostic entry, with a fix option. The ticket and config doctors are folded into `doctor`. `install` becomes internal, keeping its drift check for CI. After setup the CLI announces `upgrade`, and it flags a project behind the installed version.
- **Isolation mode**: a setting with `auto`, `worktree` and `inline`. `auto` reads a built-in capability table per install target (worktree natively supported on Claude Code, not on the others or on the runner), overridable by config. Inline is refused on a dirty working tree or when another implementer is running. Ticket size does not influence `auto`. Ticket writes still go to the primary checkout through the existing explicit project flag in both modes.
- **Token control, in layers**: (1) a drift report of agent and skill sizes against the previous version, non-blocking; (2) a word budget per agent and skill enforced in `bun test`; (3) a reference ticket measured with `token-report` at each release; (4) a tokenizer estimate only if words prove too coarse. `token-report` reads only Claude Code transcripts, so other targets rely on the tokens declared in the progress journal.
- **Context handoff**: after the pull request opens, the implementer hands off to a fresh-context agent. This is the existing ticket 0081, with its own ADR first.
- **Order**: merge the ready `09-token-diet` tickets, measure a reference ticket as baseline, then restructure.
- **ADRs**: three new ADRs, each written before its slice. Isolation modes (partly supersedes ADR 0020, decision 1), generalised word budgets (extends ADR 0021), context handoff (ticket 0081). Written in the repo ADR format.
- **Slices** (each shippable alone, tool usable after every merge): installation and config; CLI naming, help, `upgrade` and `doctor`; isolation; skills and deduplication; token control.

## Testing Decisions

- A good test checks external behaviour (output, files written, exit codes, rendered text), not internal modules.
- **Seam 1, CLI end to end in a temporary project** (prior art: init, install, project-upgrade, doctor and ticket CLI tests). Covers the single init question and its non-interactive form, the minimal generated config, absent check command or repository, `upgrade` migrating an old config and skill names, the unified `doctor` and its Domain checks, grouped help, the `upgrade` announcement and the behind-version notice, and the token drift report.
- **Seam 2, pack rendering** (prior art: packs, targets-render, agent text tests, lean description and lean output tests). Covers no preloaded skill, five web skills, the one-line trailer rule, single sources for deduplicated rules, word budgets per file, and a test proving a rule removed from an agent text is still enforced elsewhere.
- **Seam 3, isolation** (prior art: implementer worktree isolation and size flow tests). Covers the capability table per target, the config override, refusal of inline on a dirty tree or concurrent run, and primary-checkout ticket writes in both modes.
- No new seam. The per-release reference-ticket measurement needs a real Claude Code run and stays manual, outside `bun test`.

## Out of Scope

- Renaming the npm package.
- Replacing the 0081 handoff design beyond the ADR it needs (the implementation is its own ticket).
- Tokenizer-based estimation unless word budgets prove insufficient.
- Reducing the cost of the `run` provider path.
- Changing the ticket format or the ADR format.
- New agents or new packs.
- Cleaning the legacy `resume-manifest` code (separate cleanup ticket).

## Further Notes

- Choice rules settled in grilling: break compatibility and migrate through `upgrade` (small user base); keep `domains` and make the user validate it because an empty or wrong routing makes the model guess silently.
- Open risk: dropping preloading relies on Domain routing, so the "no rule matched" report and the `doctor` checks are part of the slice, not optional.
- This ticket is the spec; it is published as a ready-for-agent item. The status vocabulary has no `ready-for-agent` role, so it is recorded as `backlog` assigned to `human`, so the dispatcher does not pick the whole spec up; it is to be split into slice tickets with `to-tickets`.

## Baseline (ticket 0082)

Reference ticket: `0001` of a fictional pricing project, size S, backend, planned for the `implementer`, with `project.isolation` pinned to `inline`. Fixture, protocol, replay script and results are in `docs/specs/restructure-baseline/`. Baseline over five runs: 312,232 tokens (sd 17 %), 0.106 USD (sd 13 %), 21.2 turns (sd 8 %) per implementer run, and 10,334 words across the 12 rendered agent prompts. With five runs per condition, a gap under about 20 to 25 % is not distinguishable from noise. Ticket 0090 replays the same protocol.
