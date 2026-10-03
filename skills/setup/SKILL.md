---
name: setup
description: Configure or refresh the liteCodeAgent pipeline in the current project. Use when the user asks to set up liteCodeAgent after installing this plugin.
disable-model-invocation: true
---

# Set up liteCodeAgent

Configure the repository in the current working directory. The `litecode` executable is provided
by this plugin and is available to Bash while the plugin is enabled.

1. Check that the current directory is the intended project root.
2. Run `litecode setup`. It creates `litecode.config.json` if it is missing, guessing everything it
   can from the repository (a plugin skill has no interactive terminal, so the routing rules it
   deduces are written without asking), then prints a dry run. Nothing is installed yet.
3. Read `litecode.config.json` and settle what detection could not:
   - If `project.checkCommand` or `project.repo` is absent, ask the user for it and set it with
     `litecode config set project.checkCommand "<command>"` or
     `litecode config set project.repo <owner/name>`. Without them the agents that need them refuse
     to work, with a message naming this exact command.
   - Show the routing rules (`project.domains`) that were deduced, in plain words: "when a ticket
     touches X, the agent reads these guides". Ask the user to keep, edit or add rules, and write
     the full list with `litecode config set project.domains '<json array>'`, each entry shaped
     `{"match": "...", "skills": ["..."]}` (`litecode config edit` needs a terminal, which a plugin
     skill does not have). If there is none, ask for at least one; the user may decline, and the
     install still works.
   - Ask for any project conventions, trust boundaries or lessons that would materially affect the
     agents. Update only the config file with the answers.
4. Run `litecode setup` again and present the dry-run. Treat dangling skill references and drift as
   blockers; do not weaken or bypass those checks.
5. Apply with `litecode setup --apply` only after the user approves the concrete dry-run. Never add
   `--force` unless the user explicitly chooses to discard the drifted generated files.
6. Run `litecode doctor` to check the project: config, routing rules, ticket files and orphaned
   work. It only reports. There is no board to initialize: ticket status lives only in the local
   files (ADR 0012, ADR 0015).

Once set up, the pipeline command inside Claude Code is `/litecode` (it is installed into the
project, so it does not carry this plugin's `litecode-agent:` prefix). After each new release,
`litecode upgrade` brings the project up to date.

If the user wants to run agents outside Claude Code, help them add a `runner` block containing the
provider and concrete model id for each capability tier. Store only the API key's environment
variable name in `apiKeyEnv`, never the key itself. When they want cost reporting, have them copy
current prices from their provider into `runner.pricing`; do not guess or hard-code volatile prices.
A project can tune `runTimeoutMs`, `requestTimeoutMs`, and the bounded retry settings when the
defaults do not fit its workloads. Do not recommend retrying authentication, billing, or validation
errors, and do not weaken the global timeout merely to hide a recurring failure.
A live `litecode run` call can incur provider charges, so run it only when the user has asked to
execute an agent, not merely while configuring.

Files under `.claude/` that are absent from `.claude/.litecode-lock.json` belong to the project.
Do not read, rewrite, or remove them as part of setup.
