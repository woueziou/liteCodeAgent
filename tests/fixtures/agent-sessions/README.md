# Agent session fixtures

Outputs of the agents, replayed by `tests/agent-session-replay.test.ts` against the
output contracts (`STATUS:`, `PANEL:`, `HUNT:`, `VERDICT:` ...). No network, no API key.

Each file is a `RunReport`, the JSON `litecode run --record <path>` writes.
`manifest.json` lists every fixture with its provenance and the values the replay must read.

## Provenance

`litecode run --record` needs a configured API runner and a paid key. Until one was
available, the fixtures were built from outputs already in this repo:

- `pr-comment` (reviewer, bug-hunter): the verdicts `implementer` posted verbatim on
  PRs #76-#101, minus the heading the implementer added above the first `VERDICT:` / `HUNT:` line.
  Real model output, but posted by the implementer, not captured from a runner. `usage`,
  `durationMs`, ... are zeroed.
- `synthetic` (implementer, orchestrator): no real output of these was kept anywhere, so they
  are written by hand from the prompt's `Output` block. They prove the parsers accept the
  documented shape (including bold-wrapped keys, the degraded panel), not that a model
  produces it. Replace them by real recordings first.
- `recorded`: reserved for fixtures produced by `--record`.

`legacy: true` marks a reviewer verdict that predates the `ACCEPTANCE:` / `TEST_FIRST:` fields.

## Re-recording when a prompt changes

The replay test fails when a prompt's `Output` block no longer lists the keys the readers
in `tests/helpers/agent-contracts.ts` expect. Then:

1. Update the readers (`*_KEYS`) to the new contract.
2. Record a fresh session per outcome with a configured runner:
   `bunx litecodeagent run reviewer --prompt-file <prompt> --record tests/fixtures/agent-sessions/reviewer/<name>.json`
   (same for `bug-hunter`, `orchestrator`, `implementer`). Use a prompt that produces each
   outcome (approve, approve-with-notes, changes-requested; hunt complete, partial; panel degraded).
3. Add or update the entry in `manifest.json` with `"provenance": "recorded"`, the `--record` date
   as `source`, and the expected values. Drop `legacy` once the fixture has every key.
4. Delete fixtures the change made obsolete; the test checks that manifest and disk agree.
5. `bun test tests/agent-session-replay.test.ts`.

Never hand-edit a `recorded` or `pr-comment` output to make a test pass: fix the reader or re-record.
