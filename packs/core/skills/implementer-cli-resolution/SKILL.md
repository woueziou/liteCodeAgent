---
name: implementer-cli-resolution
description: Used by implementer only when its probe of the installed litecodeagent CLI shows no 'ticket note' command: how to reach a CLI that has it, without ever hand-editing a ticket file.
---

# Resolving the ticket CLI (implementer)

Loaded by `implementer` when `bunx litecodeagent ticket note --help` does not list `ticket note`.

**Resolving the CLI.** `bunx litecodeagent` may resolve an older published release lacking `ticket note` and `--project` on `ticket move` (ticket 0060: it resolved the published 1.1.1, which lists neither). Before your first ticket write run `bunx litecodeagent ticket note --help`; if it doesn't list `ticket note`, never fall back to `Edit`/`Write` on a ticket file — use the checkout's own CLI (`bun run <your-worktree>/src/cli.ts ticket ...` on litecodeagent itself) or pin a version (`bunx litecodeagent@<version> ...`), else report a blocker.

