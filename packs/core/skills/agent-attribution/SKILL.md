---
name: agent-attribution
description: Mandatory traceability rule for any agent that mutates files, commits, or GitHub state. Use whenever an agent's tools include Write, Edit, or Bash(git commit)/Bash(gh *). Ensures every mutation is attributable after the fact, independent of which agent or plugin actually performed it — because tool restrictions declared in an agent's frontmatter are not a reliable enforcement boundary in this environment (verified: an agent without Edit/Write/Bash declared was still able to modify a file, so intent-only restrictions cannot be trusted).
---

# Agent attribution

Any agent that can mutate state (files, git, GitHub issues/board) MUST leave a trace that survives independently of that agent's own self-report. The point is detection, not prevention: if something edited a file without leaving the expected trace, that is itself the signal something unexpected happened (a different plugin, a fallback agent, a hook) — investigate before trusting the diff.

## Rule 1 — Git commits carry an `Agent:` trailer

Every commit created by an agent (not by the human directly) must end with:

```
Agent: <agent-name>
Task: <issue number or one-line description of what triggered this>
```

on its own trailer lines, same convention as `Co-Authored-By`. Never put this information as an inline code comment — it belongs in git history, not in the source file.

Example:

```
fix: remove trailing whitespace in traveller error log

Agent: implementer
Task: #42
```

## Rule 2 — Generated documents carry frontmatter attribution

Any document an agent generates (an ADR{{#if project.adrDir}} under `{{ project.adrDir }}/`{{/if}}, a flow doc, a generated report) must have:

```yaml
generated_by: <agent-name>
task: <issue number or description>
```

in its frontmatter (in addition to whatever other frontmatter that document type requires). Updates to an existing doc append/update this field, they don't just silently rewrite it.

## Rule 3 — Every mutation ends in a self-report, no exceptions

An agent that edits/writes/commits must, in its final output to whoever invoked it, explicitly list: every file touched, every command run that had a side effect (`git commit`, `gh issue create`, `gh project item-edit`), and what was deliberately NOT done. Silence about a touched file is treated as a violation, not an oversight.

## Rule 4 — Mismatch is a stop condition, not a detail to note in passing

If a diff or `git log` shows a change that doesn't have a matching `Agent:` trailer, or a file is modified with no corresponding self-report from the agent that was supposed to have acted — stop and flag it explicitly to the human before proceeding, rather than assuming the intended agent quietly did it. Do not assume the tools/description in an agent's frontmatter reflect what that invocation actually had access to; verify against the actual diff and commit trailer.
