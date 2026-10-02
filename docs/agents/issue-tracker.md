# Issue tracker: Local Markdown

Tickets live as markdown files in `docs/tickets/`. The local buffer is the sole source of truth (ADR 0012); GitHub is only a sync target.

## Conventions

- One file per ticket: `docs/tickets/<NNNN>-<type>-<scope>-<slug>.md`, with a four-digit number. Match the existing files.
- Metadata is YAML frontmatter (`schemaVersion`, `id`, `title`, `label`, `status`, `priority`, `size`, `assignedAgent`, `dueDate`). Triage state goes in `status`/`label`; see `triage-labels.md` for the role strings.
- Grouped or legacy tickets sit in subfolders (`01-ticket-buffer/`, …). Look for the number there too.
- Staged comments use `<!-- litecode:comment -->` blocks. Don't append a free-form `## Comments` section.
- Specs and larger designs go in `docs/design/`.

## When a skill says "publish to the issue tracker"

Create a new numbered file in `docs/tickets/` with the frontmatter above. Take the next unused number. Don't call `gh`; `litecode sync` pushes to the board.

## When a skill says "fetch the relevant ticket"

Read the file by number or path (`docs/tickets/0081-*.md`).

## Wayfinding operations

Used by `/wayfinder`. Keep a map at `docs/tickets/<effort>/map.md`, with child tickets as numbered files in the same folder. Record `Type:` and `Blocked by:` in the frontmatter or the first lines of the body. Frontier is the set of open, unblocked, unclaimed tickets, lowest number first. Claim by setting `status`, and resolve by appending an `## Answer` section.
