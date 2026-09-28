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

/**
 * The pipeline's status machine (ticket 0033): which `status` transitions `litecode
 * ticket move` accepts, so the rule "inProgress before review/readyToMerge" lives in code
 * instead of only in agent prose. Encodes the pipeline as it's actually driven today:
 *
 * - `dispatcher` moves `backlog -> planned`.
 * - `implementer` moves `planned -> inProgress`, then `inProgress -> review | readyToMerge`
 *   (or straight to `done` for a verification-only ticket with no code change), and can
 *   escalate any active status to `blocked`.
 * - `triage` un-blocks back to `planned` (re-scoped) or `inProgress` (resumed in place).
 * - A human moves `review -> readyToMerge | done` and `readyToMerge -> done` once merged.
 * - `implementer` can also move `review -> inProgress` (and `readyToMerge -> inProgress`) to
 *   apply a same-PR fixup requested by a reviewer/bug-hunter finding, per the resume flow.
 *
 * `done` is terminal: nothing reopens a done ticket by moving its status (a regression
 * gets its own new ticket).
 */
export const ALLOWED_TRANSITIONS: Record<StatusRole, StatusRole[]> = {
  backlog: ["planned", "blocked"],
  planned: ["inProgress", "blocked"],
  inProgress: ["review", "readyToMerge", "done", "blocked"],
  blocked: ["planned", "inProgress"],
  review: ["readyToMerge", "done", "blocked", "inProgress"],
  readyToMerge: ["done", "blocked", "inProgress"],
  done: [],
};

/** Whether `litecode ticket move` would accept `from -> to`. `from === to` is always a no-op allowed. */
export function isTransitionAllowed(from: StatusRole, to: StatusRole): boolean {
  return from === to || (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

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
  /**
   * Frontmatter keys `TicketSchema` doesn't know about (a hand-added `epic:`,
   * `generated_by:`/`task:` from the agent-attribution skill, ...), in file order, values
   * as written. `parseTicket` captures these so any path that round-trips a ticket through
   * `serializeTicket` — `ticket move` included — keeps them instead of silently dropping
   * them on the next status write. Empty for a ticket with no such keys.
   */
  extraFrontmatter: Frontmatter;
};

const LEGACY_COMMENT_BLOCK = /<!-- litecode:comment -->\n?([\s\S]*?)\n?<!-- \/litecode:comment -->/g;

/** Keys a v1 ticket carried that v2 drops on purpose. */
const LEGACY_KEYS = new Set(["issue", "synced", "syncedAt"]);

/**
 * Frontmatter keys a migration would drop without them being legacy keys — a hand-added
 * `epic:`, say. `serializeTicket` only writes known keys, so these would vanish silently.
 */
export function unknownKeys(source: string, path: string): string[] {
  return Object.keys(extraFrontmatter(source, path));
}

/**
 * The subset of a ticket file's frontmatter `TicketSchema` doesn't know about, in file
 * order — everything `unknownKeys` reports, but with values kept too so `parseTicket` can
 * carry them forward on `Ticket.extraFrontmatter`.
 */
function extraFrontmatter(source: string, path: string): Frontmatter {
  const { data } = parseFrontmatter(source, path);
  const known = new Set<string>(KEY_ORDER);
  const extra: Frontmatter = {};
  for (const [key, value] of Object.entries(data)) {
    if (!known.has(key) && !LEGACY_KEYS.has(key)) extra[key] = value;
  }
  return extra;
}

/**
 * Fenced code blocks, as `[start, end)` offsets, following CommonMark's rules closely
 * enough for ticket bodies: a fence opens with 3+ backticks or tildes (any indentation,
 * so fences inside list items count), closes on a line of the same character at least as
 * long with nothing after it, and an unclosed fence runs to the end of the text.
 */
function fenceRegions(text: string): [number, number][] {
  const regions: [number, number][] = [];
  let open: { char: string; length: number; start: number } | null = null;
  let offset = 0;
  for (const raw of text.split("\n")) {
    const lineEnd = offset + raw.length + 1;
    const line = raw.replace(/\r$/, "");
    if (!open) {
      const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
      if (m && !(m[1]![0] === "`" && m[2]!.includes("`"))) open = { char: m[1]![0]!, length: m[1]!.length, start: offset };
    } else {
      const m = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (m && m[1]![0] === open.char && m[1]!.length >= open.length) {
        regions.push([open.start, Math.min(lineEnd, text.length)]);
        open = null;
      }
    }
    offset = lineEnd;
  }
  if (open) regions.push([open.start, text.length]);
  return regions;
}

const insideAny = (regions: [number, number][], at: number) => regions.some(([start, end]) => at >= start && at < end);

/** Applies `fn` to the text outside fenced code blocks only. */
function outsideFences(text: string, fn: (prose: string) => string): string {
  let out = "";
  let last = 0;
  for (const [start, end] of fenceRegions(text)) {
    out += fn(text.slice(last, start)) + text.slice(start, end);
    last = end;
  }
  return out + fn(text.slice(last));
}

/**
 * Rewrites a v1 ticket as v2: bumps `schemaVersion` (the legacy keys drop out on their
 * own, since `TicketSchema` doesn't know them) and unwraps each staged-comment block into
 * its own paragraph, so a comment `sync` never posted is kept rather than lost or fused
 * into the text around it.
 *
 * A block is matched on the whole body first — a comment may itself contain a fenced
 * block, such as an ADR draft's `resume-manifest` — and is left exactly as written only
 * when it *starts* inside a fence, where it's an example of the old format, not a comment.
 */
export function migrateTicket(ticket: Ticket): Ticket {
  const fences = fenceRegions(ticket.body);
  const unwrapped = ticket.body.replace(LEGACY_COMMENT_BLOCK, (block: string, text: string, at: number) =>
    insideAny(fences, at) ? block : `\n\n${text.replace(/^\n+|\s+$/g, "")}\n\n`,
  );
  const body = outsideFences(unwrapped, (prose) => prose.replace(/\n{3,}/g, "\n\n"));
  return { ...ticket, schemaVersion: CURRENT_SCHEMA_VERSION, body: body.replace(/^\n+/, "").trimEnd() + "\n" };
}

export function parseTicket(source: string, path: string): Ticket {
  const { data, body } = parseFrontmatter(source, path);
  const parsed = TicketSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`${path} is not a valid ticket:\n${issues}`);
  }
  return { ...parsed.data, path, body: body.trimEnd() + "\n", extraFrontmatter: extraFrontmatter(source, path) };
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
  // Unknown frontmatter keys (`epic:`, `generated_by:`, ...) are written back after the
  // known ones, in the order they were read — a status/field write must not silently drop
  // information some other tool or a human added by hand.
  for (const [key, value] of Object.entries(ticket.extraFrontmatter ?? {})) {
    data[key] = value;
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
