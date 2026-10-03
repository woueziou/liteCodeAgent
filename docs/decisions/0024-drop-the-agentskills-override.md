---
generated_by: implementer
task: "0092"
---

# 0024. Drop the `agentSkills` override, nothing is preloaded

Status: accepted
Date: 2026-10-03

## Context

ADR 0006 pre-validated the `project.agentSkills.*` paths that pack agents referenced through `skills: {{ project.agentSkills.X | join }}`, and `doctor --fix` filled missing keys from `deriveAgentSkills`. Since ticket 0087 no agent preloads a skill by default: skills load on demand through the routing rules (Domain) and the skill tool. The override was left as the only thing still preloading, and it kept alive a required-path check, a repair command and a derivation at init, all for a list nobody needs to maintain.

## Decision

This ADR supersedes ADR 0006, which was entirely about `agentSkills` required paths.

1. **Preloading no longer exists.** No rendered agent has a `skills:` line, whatever the config. Pack agent sources do not reference `project.agentSkills`.
2. **Skills install only from Domain rules and angles.** `agentSkills` no longer counts as a wanted skill.
3. **The agentSkills-specific checks are removed**: the install error on a missing key, `doctor --fix` filling keys, and the derivation at init.
4. **The schema stays tolerant.** A config that still carries `project.agentSkills` loads without error and the key is ignored. `doctor` warns that it is ignored.
5. **`upgrade` removes the key** (an obsolete key since ticket 0083) and its plan says custom lists are not preserved.

## What changes for users

Agents no longer start with any skill loaded; they pull skills on demand according to the Domain rules. A project's `agentSkills` list stops having any effect, `litecode upgrade` removes it, `doctor` warns while it is still present, and `config set project.agentSkills...` warns that the key is ignored (and still writes it). `litecode doctor --fix` no longer repairs anything: the flag prints one line saying it was removed and the command carries on as a plain `doctor`.

## Consequences

- A hand-written `agentSkills` list is lost on upgrade; this is accepted. A skill a project wants available is named by a Domain rule.
- A project that relied on preloading a skill that no Domain rule names loses that skill from every agent, silently: nothing fails at install or at run time. Mitigation: add a Domain rule that names the skill.
- `doctor --fix` is removed. An old script that passes it sees the one-line removal notice, and the exit code is the one `doctor` gives without the flag, so such a script keeps working but no longer repairs anything.
- `doctor` is silent when `agentSkills` is missing or empty, and it warns (never errors) when the key is present. The old error severity for a missing key is gone, so a missing key can no longer fail `doctor` or the install.
- The generic `requiredPaths` machinery stays; only the `agentSkills` scope goes. The unguarded `project.web` gap noted in ADR 0006 stays open: this ADR does not close it.
- Rendered agents are smaller (the `skills:` line is gone).
