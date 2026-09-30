# Hiding internal agents from the session (ticket 0073)

`classifier`, `panel-selector`, `debate-angle`, `synthesizer` and `planner` are only called
by `orchestrator`. Announcing their descriptions in every session costs tokens. This page
records, per install target, whether an agent can stay invocable by another agent without
being announced to the main session. Result: no target offers a frontmatter switch that
does this, so the install renders nothing differently.

| Target | Can hide? | Mechanism / source |
| --- | --- | --- |
| opencode | No, by agent frontmatter | `hidden: true` only removes the agent from the `@` autocomplete (UI, no token saving). Verified on opencode 1.14.39: `ToolRegistry.describeTask` builds the Task tool description from agents where `mode !== "primary"` and the calling agent's `permission.task` is not `deny`; it never reads `hidden`. Docs: https://opencode.ai/docs/agents/ |
| claude-code | No | Subagent frontmatter has no visibility field; `Agent(name)` deny rules would also block `orchestrator`. Docs: https://code.claude.com/docs/en/sub-agents |
| codex | No | Custom agent TOML files have no visibility key. Docs: https://developers.openai.com/codex/subagents |
| kilo-code | Not verified | Format close to opencode's, so `hidden` would likely be UI-only too. Docs: https://kilo.ai/docs |
| pi | n/a | No native agent definitions; the extension calls the shared runner. |

Possible follow-up (not done, needs verification): on opencode, set `permission.task.<name>: deny`
for the five agents on the session's primary agent(s) in `opencode.json`, while `orchestrator`
keeps them allowed. That is a config-level change, outside the agent-file rendering.
