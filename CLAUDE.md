# Working in this repository

## Commit attribution

Commits in this repository are attributed to the repository owner alone.

- **Never** add a `Co-Authored-By:` trailer to a commit message, for any tool or model.
- **Never** add generated-with / attribution footers to pull request descriptions.
- Commit as the configured git user; do not override `--author`.

Git hooks enforce this locally, so a violation fails at commit time rather than
landing silently:

- `.githooks/pre-commit` rejects an author or committer outside the allow-list.
- `.githooks/commit-msg` rejects co-author trailers.

They are wired up by the `prepare` script (`git config core.hooksPath .githooks`),
which `bun install` runs. To enable them by hand in a fresh clone:

```sh
git config core.hooksPath .githooks
```

## Checks

Run `bun run check` (tsc) and `bun test` before proposing a change.
