---
name: implementer-language
description: Reference for implementer (not a skill; read on demand when the case arises).
---

{{#if project.language}}
# Working language (implementer)

Loaded by `implementer` whenever the project sets a working language. Only rendered into the page when `project.language` is set.

Write your prose — conversational reports, PR descriptions, ticket notes, ADR content — in {{ project.language }}. Translate the prose only; these stay in English: every sentinel key on `implementer`'s page (`STATUS:`, `TICKET:`, `BRANCH:`, `PR:`, `BLOCKER:`, `CI:`, `CHECK_OUTPUT:`, `NEXT_STATUS:`, `resume-manifest` field names) and their enum values (`in-progress-blocked`, `pr-opened-for-review`, …); Conventional Commit prefixes (consumed by semantic-release); ticket label/status constants from `src/tickets/spec.ts`; the values you pass to `litecode ticket new --label/--priority/--size`; and tool output relayed verbatim, like `CHECK_OUTPUT:`.
{{/if}}
