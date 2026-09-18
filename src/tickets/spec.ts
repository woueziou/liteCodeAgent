/**
 * A ticket file is a *buffer*, not a second source of truth.
 *
 * GitHub stays authoritative for everything the board shows. What lives under the
 * tickets directory is a local staging area: a ticket is drafted there (no API call),
 * edited there, and accumulates pending comments there — then one `litecode ticket sync`
 * pushes the whole batch in a single burst of `gh` calls. That is what turns N agents
 * each doing their own scattered `gh issue create`/`item-edit` into one bounded, retryable
 * run, which is the only durable answer to GitHub's secondary rate limit.
 *
 * `synced` is therefore a dirty flag, not a piece of state anyone should reason from:
 * `false` means "this file holds changes GitHub has not seen yet".
 *
 * Status/priority/size are pushed to the board **once, at creation** — the board does
 * not know about the item before that, so there is nothing to conflict with yet. After
 * creation those three fields are pull-only: GitHub, not the file, is authoritative for
 * pipeline state, so a ticket file re-asserting a stale status on every sync would fight
 * a human who moved the card on the board. See ADR 0001.
 */

import { z } from "zod";
import { parseFrontmatter, serializeFrontmatter, type Frontmatter } from "../frontmatter.ts";
import { STATUS_ROLES, PRIORITY_OPTIONS, SIZE_OPTIONS, type StatusRole } from "../board/spec.ts";

export const TICKET_STATUSES = STATUS_ROLES.map((s) => s.role) as [StatusRole, ...StatusRole[]];

/** File-side vocabulary is lower-case; the board's option labels are capitalised. */
export const PRIORITIES = ["low", "medium", "high"] as const;
export const SIZES = ["trivial", "small", "medium", "large"] as const;

export type Priority = (typeof PRIORITIES)[number];
export type Size = (typeof SIZES)[number];

/**
 * Explicit maps rather than a naive `charAt(0).toUpperCase()` capitalisation: if the
 * board's option labels (`PRIORITY_OPTIONS`/`SIZE_OPTIONS` in `board/spec.ts`) are ever
 * renamed to something that doesn't round-trip through simple capitalisation, this map
 * fails at the type-check instead of silently sending the board an option string it
 * doesn't recognise.
 */
const PRIORITY_OPTION_BY_VALUE: Record<Priority, (typeof PRIORITY_OPTIONS)[number]> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const SIZE_OPTION_BY_VALUE: Record<Size, (typeof SIZE_OPTIONS)[number]> = {
  trivial: "Trivial",
  small: "Small",
  medium: "Medium",
  large: "Large",
};

export function priorityOption(p: Priority): (typeof PRIORITY_OPTIONS)[number] {
  return PRIORITY_OPTION_BY_VALUE[p];
}

export function sizeOption(s: Size): (typeof SIZE_OPTIONS)[number] {
  return SIZE_OPTION_BY_VALUE[s];
}

/**
 * Bumped whenever the on-disk shape of a ticket file changes in a way an existing
 * committed file wouldn't already satisfy. `1` is the shape shipped with the initial
 * local ticket buffer (see ADR 0001); no migration exists yet because no ticket file has
 * ever been committed under an earlier shape.
 */
export const CURRENT_SCHEMA_VERSION = 1;

const optional = (schema: z.ZodString) =>
  z.preprocess((v) => (v === "" || v === undefined ? undefined : v), schema.optional());

export const TicketSchema = z.object({
  /** On-disk shape version. Missing on a hand-written file is treated as `1`. */
  schemaVersion: z.preprocess(
    (v) => (v === "" || v === undefined ? CURRENT_SCHEMA_VERSION : Number(v)),
    z.number().int().positive().default(CURRENT_SCHEMA_VERSION),
  ),
  /** Stable file identity, e.g. `0007-ticket-buffer`. Never changes, even after sync. */
  id: z.string().regex(/^\d{4}-[a-z0-9-]+$/, "expected NNNN-kebab-slug"),
  title: z.string().min(1),
  label: z.enum(["bug", "feature", "doc", "chore"]),
  /**
   * The pipeline status this ticket asserts. Only meaningful before the first sync
   * (create) — once `issue`/`synced` show the ticket has a board item, this field is
   * overwritten by `ticket sync`'s pull step, never read for a push.
   */
  status: z.enum(TICKET_STATUSES).default("backlog"),
  priority: z.enum(PRIORITIES).default("medium"),
  size: z.enum(SIZES).default("medium"),
  assignedAgent: z.string().default("human"),
  dueDate: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")),
  /** Set by the first successful sync; the link between this file and the GitHub issue. */
  issue: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : Number(v)),
    z.number().int().positive().optional(),
  ),
  /** false = this file holds changes GitHub has not seen yet. */
  synced: z.preprocess((v) => (typeof v === "string" ? v === "true" : v), z.boolean().default(false)),
  syncedAt: optional(z.string()),
});

export type TicketMeta = z.infer<typeof TicketSchema>;

export type Ticket = TicketMeta & {
  /** Path of the file this was read from, relative to the repo root. */
  path: string;
  /** The issue body, pending-comment blocks already stripped out. */
  body: string;
  /** Comments staged locally, in file order, not yet posted to the issue. */
  pendingComments: string[];
};

const COMMENT_OPEN = "<!-- litecode:comment -->";
const COMMENT_CLOSE = "<!-- /litecode:comment -->";
const COMMENT_BLOCK = /<!-- litecode:comment -->\n?([\s\S]*?)\n?<!-- \/litecode:comment -->\n*/g;

/** Renders a comment block, which is how an agent stages a comment without touching gh. */
export function commentBlock(text: string): string {
  return `${COMMENT_OPEN}\n${text.trim()}\n${COMMENT_CLOSE}\n`;
}

export function splitComments(body: string): { body: string; comments: string[] } {
  const comments: string[] = [];
  const stripped = body.replace(COMMENT_BLOCK, (_, text: string) => {
    const trimmed = text.trim();
    if (trimmed) comments.push(trimmed);
    return "";
  });
  return { body: stripped.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n", comments };
}

export function parseTicket(source: string, path: string): Ticket {
  const { data, body } = parseFrontmatter(source, path);
  const parsed = TicketSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`${path} is not a valid ticket:\n${issues}`);
  }
  const split = splitComments(body);
  return { ...parsed.data, path, body: split.body, pendingComments: split.comments };
}

/**
 * Keys are written in a fixed order so a synced ticket produces a minimal diff: a file
 * whose key order drifted on every write would make `git log` on a ticket unreadable.
 * `schemaVersion` is first, matching `TicketSchema`'s key order.
 */
const KEY_ORDER: (keyof TicketMeta)[] = [
  "schemaVersion",
  "id",
  "title",
  "label",
  "status",
  "priority",
  "size",
  "assignedAgent",
  "dueDate",
  "issue",
  "synced",
  "syncedAt",
];

export function serializeTicket(ticket: Ticket): string {
  const data: Frontmatter = {};
  for (const key of KEY_ORDER) {
    const value = ticket[key];
    data[key] = value === undefined || value === null ? "" : String(value);
  }
  const comments = ticket.pendingComments.map(commentBlock).join("\n");
  const body = comments ? `${ticket.body.trimEnd()}\n\n${comments}` : `${ticket.body.trimEnd()}\n`;
  return serializeFrontmatter(data, body);
}

/** `Fix the flaky board test!` -> `fix-the-flaky-board-test` */
export function slugify(title: string): string {
  return (
    title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "ticket"
  );
}
