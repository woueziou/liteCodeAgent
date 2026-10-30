# Closer handoff: contract for pack authors

Plumbing for [ADR 0027](../decisions/0027-hand-the-tail-of-an-implementer-run-to-a-fresh-context-closer.md) (ticket 0081, part A). The `closer` agent and its text are part B.

## The flag

Pack files see a root-level boolean named `handoff`, resolved for the target being rendered
(Claude Code, Codex, Pi, OpenCode, Kilo Code, or the API `runner`). Use the existing block tags:

```
{{#if handoff}}
Hand the tail of the run to the closer: ...
{{/if}}
{{^if handoff}}
Run the tail steps yourself: ...
{{/if}}
```

There is no `{{> closerHandoff}}` helper: the SAME agent source carries both texts, and the
renderer keeps one of them per target. The flag is `handoff`, not `project.handoff` (that is
the raw config setting, `auto` or `off`, and is not the per-target decision).

## What each case renders

| `project.handoff` | target resolves to | `{{#if handoff}}` | `{{^if handoff}}` |
| --- | --- | --- | --- |
| `off` (default) | disabled | dropped | kept |
| `auto`, `handoffSupport[target]` is `true` | enabled | kept | dropped |
| `auto`, `handoffSupport[target]` is `false` | disabled | dropped | kept |
| `auto`, no override | `HANDOFF_SUPPORT[target]` (all `false` today) | dropped | kept |

So with the default config, and with today's table under `auto`, a pack renders exactly its
in-line text everywhere: adding the `{{#if handoff}}` branch must not change any rendered agent.
A render context built without the flag (an older call site) also reads as disabled.

## Where it lives

- `src/handoff.ts`: `resolveHandoff(project, target)` returns `{ enabled, reason }`; `templateContext` builds the render context with `handoff`.
- `src/config.ts`: `project.handoff`, `project.handoffSupport`, `HANDOFF_SUPPORT` (empty of supported targets until the measurement of ADR 0027 Decision 9).
- Wired in `src/install.ts` (both render sites) and `src/runner/catalog.ts` (target `runner`).

## Journal marker (single-writer guard)

The `progress-journal` block takes two optional fields, written by whoever hands off:

```
handoff: closer in flight   # or: returned
handoffAt: 2026-10-05T10:00:00Z   # ISO timestamp of that write
```

`implementer` writes `closer in flight` before spawning the closer and `returned` when the
closer has answered or failed (ADR 0027 Decision 7); the closer never writes the journal. While the latest entry says `closer in flight` and is under 2 hours old
(`HANDOFF_STALE_MS` in `src/report/journal.ts`), `litecode resume <NNNN>` refuses and exits 1.
Older, it is stale: `resume` warns and proceeds, and `litecode doctor` warns naming the ticket
and the age. Unknown `handoff` values and non-ISO `handoffAt` values are ignored.
`formatJournalBlock` accepts `handoff` and `handoffAt` to write them.
