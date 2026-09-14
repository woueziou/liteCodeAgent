---
name: setup
description: Configure or refresh the liteCodeAgent pipeline in the current project. Use when the user asks to set up liteCodeAgent after installing this plugin.
disable-model-invocation: true
---

# Set up liteCodeAgent

Configure the repository in the current working directory. The `litecode` executable is provided
by this plugin and is available to Bash while the plugin is enabled.

1. Check that the current directory is the intended project root.
2. If `litecode.config.json` does not exist, run `litecode init --yes`. A plugin skill does not have
   an interactive terminal, so this uses repository detection and leaves every value it cannot
   determine as an explicit `TODO`.
3. Read `litecode.config.json`. Ask the user for the unresolved `TODO` values and for any missing
   project conventions, trust boundaries, or lessons that would materially affect the agents.
   Update only the config file with their answers.
4. Run `litecode install` and present the dry-run result. Treat unresolved placeholders, dangling
   skill references, and drift as blockers; do not weaken or bypass those checks.
5. Apply with `litecode install --apply` only after the user approves the concrete dry-run. Never
   add `--force` unless the user explicitly chooses to discard the drifted generated files.
6. If the config names a board, run `litecode board init` as a dry run. Do not apply a board plan
   with blockers, and never attempt to add an option to an existing single-select field.

If the user wants to run agents outside Claude Code, help them add a `runner` block containing the
provider and concrete model id for each capability tier. Store only the API key's environment
variable name in `apiKeyEnv`, never the key itself. When they want cost reporting, have them copy
current prices from their provider into `runner.pricing`; do not guess or hard-code volatile prices.
A live `litecode run` call can incur provider charges, so run it only when the user has asked to
execute an agent, not merely while configuring.

Files under `.claude/` that are absent from `.claude/.litecode-lock.json` belong to the project.
Do not read, rewrite, or remove them as part of setup.
