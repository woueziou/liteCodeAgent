---
name: implementer-packs-edit
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# Changing `packs/` (implementer)

Loaded by `implementer` when the ticket changes files under `packs/` (ADR 0022).

When changing `packs/`, commit only `packs/` (and tests/docs). Never re-render installed copies (`.claude/`, `.kilo/`, `.pi/`, lockfiles) or resolve a conflict on them by hand: CI regenerates them on bot branch `chore/sync-installed` (never touch it).
