# Hiding internal agents from the session (ticket 0073)

`classifier`, `panel-selector`, `debate-angle`, `synthesizer` and `planner` are only called
by `orchestrator`. Announcing their descriptions in every session costs tokens. This page
records, per install target, whether an agent can stay invocable by another agent without
being announced to the main session. The list lives in `src/internal-agents.ts`.

| Target | Can hide? | Mechanism / source | Applied |
| --- | --- | --- | --- |
| opencode | Yes | Agent option `hidden: true` (subagents only): hides the agent from the `@` autocomplete menu; it stays invocable through the Task tool. Source: opencode docs, "Agents > Options > Hidden" (https://opencode.ai/docs/agents/). | Yes, `.opencode/agents/*.md` |
| claude-code | No | Subagent frontmatter has no visibility field. Restricting via `Agent(name)` permission rules would also block `orchestrator`'s own calls. Source: Claude Code docs, "Subagents" (https://code.claude.com/docs/en/sub-agents). | No change |
| codex | No | Custom agent TOML files have no hide/visibility key. Source: Codex docs, "Subagents" (https://developers.openai.com/codex/subagents). | No change |
| kilo-code | Not verified | Kilo's agent format is close to opencode's, but a `hidden` option is not confirmed in its documentation (https://kilo.ai/docs). Left unchanged until confirmed. | No change |
| pi | n/a | Pi has no native agent definitions; the extension calls the shared runner. | No change |

Caveats: the links were not re-fetched during implementation; they record the sources the
mechanisms come from. On opencode, `hidden` is documented as an autocomplete filter, so
whether the Task tool description still lists these agents depends on the opencode version.
Re-check a target's docs before extending `HIDING_TARGETS`.
