/**
 * A ticket file is the ticket — there is nothing else (ADR 0015). It's drafted in the
 * tickets directory, edited there, moved through the pipeline there, and keeps its own
 * history as plain text in its body. No GitHub issue mirrors it: the only GitHub artefact
 * of the pipeline is the pull request that implements a ticket.
 *
 * `priority`/`size`/`assignedAgent` are ranking and routing inputs for `dispatcher`, freely
 * editable by hand or by any agent. `status` is the field the pipeline drives
 * (`dispatcher`/`implementer`/`triage` handing a ticket between `Planned`/`In Progress`/
 * `Review`/`Ready to Merge`/`Blocked`) by writing it directly on the file.
 */

import { z } from "zod";
import { parseFrontmatter, serializeFrontmatter, type Frontmatter } from "../frontmatter.ts";

/**
 * Statuses referred to by *role* (`inProgress`, `readyToMerge`, ...), a naming convention
 * kept from the era when a GitHub Project board's status labels had to be mapped onto a
 * fixed set of pipeline roles. There is no board any more, but the roles themselves are
 * still the vocabulary `dispatcher`/`implementer`/`triage` drive a ticket's `status`
 * field through, so it stays here rather than being collapsed into a bare string enum.
 */
export type StatusRole =
  | "backlog"
  | "planned"
  | "inProgress"
  | "blocked"
  | "review"
  | "readyToMerge"
  | "done";

export const STATUS_ROLES: { role: StatusRole; label: string; description: string }[] = [
  { role: "backlog", label: "Backlog", description: "Tracked, not yet scheduled" },
  { role: "planned", label: "Planned", description: "Scheduled by dispatcher, ready for implementer" },
  { role: "inProgress", label: "In Progress", description: "Implementer is actively working it" },
  { role: "blocked", label: "Blocked", description: "Escalated to triage or waiting on a human" },
  { role: "review", label: "Review", description: "PR open, needs a human judgment call" },
  { role: "readyToMerge", label: "Ready to Merge", description: "Reviewer approved, nothing left but merge" },
  { role: "done", label: "Done", description: "Merged or closed as verified-no-change" },
];

export const TICKET_STATUSES = STATUS_ROLES.map((s) => s.role) as [StatusRole, ...StatusRole[]];

export const PRIORITIES = ["low", "medium", "high"] as const;
export const SIZES = ["trivial", "small", "medium", "large"] as const;

export type Priority = (typeof PRIORITIES)[number];
export type Size = (typeof SIZES)[number];

/**
 * Bumped whenever the on-disk shape of a ticket file changes in a way an existing
 * committed file wouldn't already satisfy.
 *
 * - `1` — the GitHub-synced buffer (ADR 0001): `issue`/`synced`/`syncedAt` in the
 *   frontmatter, comments staged in `<!-- litecode:comment -->` blocks until `sync` posted
 *   them.
 * - `2` — purely local tickets (ADR 0015): those three keys are gone and a comment is just
 *   text in the body. A v1 file still parses (the stale keys are ignored);
 *   `litecode ticket migrate` rewrites it as v2, and `ticket doctor` flags it until then.
 */
export const CURRENT_SCHEMA_VERSION = 2;

/** A file with no `schemaVersion` predates the field, i.e. it's v1. */
const LEGACY_SCHEMA_VERSION = 1;

const optional = (schema: z.ZodString) =>
  z.preprocess((v) => (v === "" || v === undefined ? undefined : v), schema.optional());

export const TicketSchema = z.object({
  /** On-disk shape version. Missing on a hand-written file is treated as `1`. */
  schemaVersion: z.preprocess(
    (v) => (v === "" || v === undefined ? LEGACY_SCHEMA_VERSION : Number(v)),
    z.number().int().positive(),
  ),
  /** Stable file identity, e.g. `0007-ticket-buffer`. Never changes. */
  id: z.string().regex(/^\d{4}-[a-z0-9-]+$/, "expected NNNN-kebab-slug"),
  title: z.string().min(1),
  label: z.enum(["bug", "feature", "doc", "chore"]),
  /**
   * The pipeline status this ticket asserts — purely local state.
   * `dispatcher`/`implementer`/`triage` move a ticket through the pipeline by writing this
   * field directly on the file.
   */
  status: z.enum(TICKET_STATUSES).default("backlog"),
  priority: z.enum(PRIORITIES).default("medium"),
  size: z.enum(SIZES).default("medium"),
  assignedAgent: z.string().default("human"),
  dueDate: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")),
});

export type TicketMeta = z.infer<typeof TicketSchema>;

export type Ticket = TicketMeta & {
  /** Path of the file this was read from, relative to the repo root. */
  path: string;
  /** Everything after the frontmatter, the ticket's own history included. */
  body: string;
};

const LEGACY_COMMENT_BLOCK = /<!-- litecode:comment -->\n?([\s\S]*?)\n?<!-- \/litecode:comment -->/g;

/** Keys a v1 ticket carried that v2 drops on purpose. */
const LEGACY_KEYS = new Set(["issue", "synced", "syncedAt"]);

/**
 * Frontmatter keys a migration would drop without them being legacy keys — a hand-added
 * `epic:`, say. `serializeTicket` only writes known keys, so these would vanish silently.
 */
export function unknownKeys(source: string, path: string): string[] {
  const { data } = parseFrontmatter(source, path);
  const known = new Set<string>(KEY_ORDER);
  return Object.keys(data).filter((key) => !known.has(key) && !LEGACY_KEYS.has(key));
}

/** A fenced code block, whose content is an example and must come through untouched. */
const FENCE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm;

/** Applies `fn` to the text outside fenced code blocks only. */
function outsideFences(text: string, fn: (prose: string) => string): string {
  let out = "";
  let last = 0;
  for (const fence of text.matchAll(FENCE)) {
    out += fn(text.slice(last, fence.index)) + fence[0];
    last = fence.index! + fence[0].length;
  }
  return out + fn(text.slice(last));
}

/**
 * Rewrites a v1 ticket as v2: bumps `schemaVersion` (the legacy keys drop out on their
 * own, since `TicketSchema` doesn't know them) and unwraps each staged-comment block into
 * its own paragraph, so a comment `sync` never posted is kept rather than lost or fused
 * into the text around it. Blocks inside a fenced code block are examples, not comments,
 * and are left exactly as written.
 */
export function migrateTicket(ticket: Ticket): Ticket {
  const body = outsideFences(ticket.body, (prose) =>
    prose
      .replace(LEGACY_COMMENT_BLOCK, (_, text: string) => `\n\n${text.replace(/^\n+|\s+$/g, "")}\n\n`)
      .replace(/\n{3,}/g, "\n\n"),
  );
  return { ...ticket, schemaVersion: CURRENT_SCHEMA_VERSION, body: body.replace(/^\n+/, "").trimEnd() + "\n" };
}

export function parseTicket(source: string, path: string): Ticket {
  const { data, body } = parseFrontmatter(source, path);
  const parsed = TicketSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`${path} is not a valid ticket:\n${issues}`);
  }
  return { ...parsed.data, path, body: body.trimEnd() + "\n" };
}

/**
 * Keys are written in a fixed order so an edited ticket produces a minimal diff: a file
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
];

export function serializeTicket(ticket: Ticket): string {
  const data: Frontmatter = {};
  for (const key of KEY_ORDER) {
    const value = ticket[key];
    data[key] = value === undefined || value === null ? "" : String(value);
  }
  return serializeFrontmatter(data, `${ticket.body.trimEnd()}\n`);
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
