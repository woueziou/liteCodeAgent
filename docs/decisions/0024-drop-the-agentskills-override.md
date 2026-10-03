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

## Consequences

- A hand-written `agentSkills` list is lost on upgrade; this is accepted. A skill a project wants available is named by a Domain rule.
- The generic `requiredPaths` machinery stays; only the `agentSkills` scope goes. The unguarded `project.web` gap noted in ADR 0006 is unchanged by this ADR.
- Rendered agents are smaller (the `skills:` line is gone).
