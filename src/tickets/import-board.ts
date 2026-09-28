/**
 * `litecode ticket import-board` (ticket 0050, ADR 0019): a one-time exit for a project
 * still on the old GitHub Project v2 board (ADR 0015), not a sync. Every board item —
 * issue-backed or draft — becomes at most one local ticket file; running the command again
 * never re-imports or overwrites one it already created (idempotence, below).
 *
 * This module holds the pure planning/mapping logic, unit-testable without touching `gh`;
 * `runImportBoard` is the only function that also does I/O (reading the board, writing
 * ticket files), and it isolates one item's failure from the rest.
 */

import type { BoardItem } from "../gh.ts";
import { createTicket, listTickets, type NewTicket } from "./store.ts";
import { CLARIFICATION_MARKER, CONTRACT_SECTIONS, PRIORITIES, SIZES, STATUS_ROLES, ticketSection, type Priority, type Size, type StatusRole } from "./spec.ts";

/** The exact string `import-board` writes to a new ticket's `importedFrom` field. */
export function importedFromOf(item: BoardItem): string {
  return item.kind === "issue" ? `github:${item.repo}#${item.number}` : `github-project-item:${item.id}`;
}

/** How the source item is referred to in generated ticket prose. */
function itemRef(item: BoardItem): string {
  return item.kind === "issue" ? `#${item.number}` : `l'élément ${item.id}`;
}

type MappedField<T extends string> = { value: T; unmapped: string | null };

/**
 * Matches a board field's raw value against a local enum, case/space-insensitively, either
 * on the enum value itself (`"high"` -> `"high"`) or on a human label (`"High"` ->
 * `"high"` via `label`). No match, or no raw value at all, falls back to `fallback` and
 * reports the original raw string in `unmapped` so the caller can flag it — this is the one
 * behavior the ticket's acceptance criteria pins down: an out-of-enum value never blocks
 * the import, it just forces a clarification instead of silently guessing.
 */
function mapEnum<T extends string>(raw: string | undefined, values: readonly T[], fallback: T, label?: (v: T) => string): MappedField<T> {
  if (raw === undefined || raw.trim() === "") return { value: fallback, unmapped: null };
  const norm = raw.trim().toLowerCase();
  for (const v of values) {
    if (v.toLowerCase() === norm) return { value: v, unmapped: null };
    if (label && label(v).toLowerCase() === norm) return { value: v, unmapped: null };
  }
  return { value: fallback, unmapped: raw };
}

const STATUS_ROLE_VALUES = STATUS_ROLES.map((s) => s.role) as StatusRole[];
const statusLabel = (role: StatusRole) => STATUS_ROLES.find((s) => s.role === role)!.label;

export type MappedBoardItem = {
  importedFrom: string;
  title: string;
  status: StatusRole;
  priority: Priority;
  size: Size;
  body: string;
  /** Raw values that fell outside the local enums, cited in the body's clarification marker(s). */
  unmapped: { field: string; raw: string }[];
};

/**
 * Builds the four contract sections (0035) from an item's body. When the source body
 * already carries all four `## <heading>` sections with actual content, that structure is
 * kept as-is; otherwise the whole body goes under "Contexte" and the other three sections
 * get an explicit `[À CLARIFIER]` placeholder — the acceptance criteria only mandates the
 * "Critères d'acceptation" wording, but "Aucune section vide" rules out leaving Plan/Hors
 * périmètre blank too, so they get the same treatment.
 */
function buildBody(item: BoardItem, ref: string): string {
  const raw = item.body ?? "";
  const structured = CONTRACT_SECTIONS.every((h) => {
    const section = ticketSection(raw, h);
    return section !== null && section !== "";
  });
  if (structured) {
    return CONTRACT_SECTIONS.map((h) => `## ${h}\n\n${ticketSection(raw, h)}`).join("\n\n") + "\n";
  }
  const contexte = raw.trim() || `(pas de description sur ${ref})`;
  return [
    `## Contexte\n\n${contexte}`,
    `## Critères d'acceptation\n\n${CLARIFICATION_MARKER} critères à définir (importé de ${ref})`,
    `## Plan\n\n${CLARIFICATION_MARKER} plan à définir (importé de ${ref})`,
    `## Hors périmètre\n\n${CLARIFICATION_MARKER} périmètre à définir (importé de ${ref})`,
  ].join("\n\n") + "\n";
}

/** Pure mapping from one board item to what would become a local ticket. No I/O. */
export function mapBoardItem(item: BoardItem): MappedBoardItem {
  const ref = itemRef(item);
  const status = mapEnum(item.fields.status, STATUS_ROLE_VALUES, "backlog", statusLabel);
  const priority = mapEnum(item.fields.priority, PRIORITIES, "medium");
  const size = mapEnum(item.fields.size, SIZES, "medium");
  const unmapped = [
    status.unmapped !== null ? { field: "status", raw: status.unmapped } : null,
    priority.unmapped !== null ? { field: "priority", raw: priority.unmapped } : null,
    size.unmapped !== null ? { field: "size", raw: size.unmapped } : null,
  ].filter((v): v is { field: string; raw: string } => v !== null);

  const title = item.title.trim() || `Importé de ${ref}`;
  let body = buildBody(item, ref);
  // An unknown field value always lands the ticket in `backlog`, blocked from `planned`
  // by the marker it carries — even if the field itself (say `priority`) was recognized,
  // an unrecognized `status` still overrides to `backlog` since starting anywhere else
  // without a human's say-so would be guessing at pipeline state, not just a ranking input.
  const effectiveStatus: StatusRole = unmapped.length > 0 ? "backlog" : status.value;
  if (unmapped.length > 0) {
    const note = unmapped.map((u) => `${CLARIFICATION_MARKER} valeur d'origine « ${u.raw} » pour ${u.field} hors des enums locaux.`).join("\n");
    body = `${body.trimEnd()}\n\n${note}\n`;
  }

  return {
    importedFrom: importedFromOf(item),
    title,
    status: effectiveStatus,
    priority: priority.value,
    size: size.value,
    body,
    unmapped,
  };
}

export type ImportEntry =
  | { outcome: "imported"; importedFrom: string; path: string }
  | { outcome: "skipped"; importedFrom: string; reason: string }
  | { outcome: "failed"; importedFrom: string; reason: string };

export type ImportSummary = { entries: ImportEntry[]; applied: boolean };

/**
 * Imports every board item that hasn't been imported yet. `apply: false` (the default)
 * only reports what *would* happen — no ticket file is written. `apply: true` writes via
 * `createTicket` (which itself uses `writeTicketExclusive`, per the ticket's contract).
 *
 * Idempotence: an item whose exact `importedFrom` string already exists on a local ticket
 * is skipped, unconditionally — even if the source issue changed since. This also makes an
 * interrupted run resumable: re-running only ever acts on items not yet imported.
 *
 * Isolation: one item's failure (a malformed field, a write error) does not stop the rest —
 * it's recorded as `failed` with its reason and the loop continues.
 */
export async function runImportBoard(root: string, dir: string, items: BoardItem[], apply: boolean): Promise<ImportSummary> {
  const existing = await listTickets(root, dir);
  const alreadyImported = new Set(existing.map((t) => t.importedFrom).filter((v): v is string => v !== undefined));
  const entries: ImportEntry[] = [];

  for (const item of items) {
    const importedFrom = importedFromOf(item);
    if (alreadyImported.has(importedFrom)) {
      entries.push({ outcome: "skipped", importedFrom, reason: "déjà importé (importedFrom identique)" });
      continue;
    }
    try {
      const mapped = mapBoardItem(item);
      if (!apply) {
        entries.push({ outcome: "imported", importedFrom, path: "(simulation)" });
        continue;
      }
      const input: NewTicket = {
        title: mapped.title,
        label: "feature",
        body: mapped.body,
        status: mapped.status,
        priority: mapped.priority,
        size: mapped.size,
        importedFrom: mapped.importedFrom,
      };
      const ticket = await createTicket(root, dir, input);
      alreadyImported.add(importedFrom); // guards a duplicate item id within the same board read
      entries.push({ outcome: "imported", importedFrom, path: ticket.path });
    } catch (e) {
      entries.push({ outcome: "failed", importedFrom, reason: (e as Error).message });
    }
  }

  return { entries, applied: apply };
}
