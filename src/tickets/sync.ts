/**
 * Push the ticket buffer to GitHub, and pull the board back into it.
 *
 * Push writes Priority/Size/Assigned Agent to the board **once, at creation** — the board
 * does not know about the item yet, so there is nothing to conflict with. After creation
 * those three stay pull-only forever: they're human-curated, and GitHub, not a ticket
 * file, is the source of truth for them. See ADR 0001.
 *
 * `Status` is different, per ADR 0010: it's the one field the pipeline itself drives
 * (`dispatcher`/`implementer` handing a ticket between `Planned`/`In Progress`/`Review`/
 * `Ready to Merge`), so a dirty local file's `status` is allowed to push past creation too
 * — this is also the *only* way any agent moves a board item's Status now; no agent calls
 * `gh project item-edit` directly for it any more, they write the local file and `sync`
 * turns that into the board mutation. The project owner accepted, in writing (see ADR
 * 0010), the same overwrite risk this already carried for title/body: if a human moves the
 * card on the board and an agent independently dirties the same ticket with a different
 * Status inside one `sync` cycle, the agent's write wins.
 *
 * Pull runs first regardless: anything a human (or another agent) moved on the board is
 * read back before push decides what, if anything, still disagrees with it, and `ticket
 * sync` runs pull before push by default so a push never overwrites board state the file
 * hasn't seen yet this run.
 */

import { join } from "node:path";
import { gh } from "../board/gh.ts";
import type { BoardData } from "../board/spec.ts";
import { fetchTicketItems, type RemoteItem } from "./remote.ts";
import { priorityOption, sizeOption, slugify, type Ticket, type TicketMeta } from "./spec.ts";
import { PRIORITIES, SIZES } from "./spec.ts";
import { listTickets, nextNumber, writeTicket, writeTicketExclusive } from "./store.ts";

export type FieldEdit = {
  field: string;
  fieldId: string;
  from: string | null;
  to: string;
  /** Set for single-selects; `item-edit` needs the option id, not the label. */
  optionId?: string;
};

export type TicketAction =
  | { kind: "create"; ticket: Ticket; edits: FieldEdit[]; comments: string[] }
  | { kind: "update"; ticket: Ticket; issue: number; edits: FieldEdit[]; comments: string[] };

export type SyncPlan = {
  actions: TicketAction[];
  skipped: { ticket: Ticket; reason: string }[];
  blockers: { ticket: Ticket; problem: string; fix: string }[];
};

function field(board: BoardData, name: string): { id: string; options?: Record<string, string> } {
  const f = board.fields[name];
  if (!f) throw new Error(`${name} is missing from the generated board data — run \`litecode board init --apply\``);
  return f;
}

/**
 * The values a brand-new ticket asserts, as the board would spell them. Only ever called
 * for a `create` action: an already-created ticket never has Status/Priority/Size pushed
 * again (see module docs and ADR 0001).
 */
function creationEdits(board: BoardData, ticket: Ticket): FieldEdit[] {
  const status = board.statusRoles[ticket.status];
  if (!status) throw new Error(`No board status mapped to role '${ticket.status}'`);
  const priority = field(board, "Priority");
  const size = field(board, "Size");

  const edits: FieldEdit[] = [
    { field: "Status", fieldId: field(board, "Status").id, from: null, to: status.label, optionId: status.optionId },
    {
      field: "Priority",
      fieldId: priority.id,
      from: null,
      to: priorityOption(ticket.priority),
      optionId: priority.options?.[priorityOption(ticket.priority)],
    },
    {
      field: "Size",
      fieldId: size.id,
      from: null,
      to: sizeOption(ticket.size),
      optionId: size.options?.[sizeOption(ticket.size)],
    },
    { field: "Assigned Agent", fieldId: field(board, "Assigned Agent").id, from: null, to: ticket.assignedAgent },
  ];
  if (ticket.dueDate) {
    edits.push({ field: "Due Date", fieldId: field(board, "Due Date").id, from: null, to: ticket.dueDate });
  }
  return edits;
}

/**
 * Per ADR 0010: `Status` is the one field a dirty local file is allowed to push past
 * creation — it's the field the pipeline itself drives (`dispatcher`/`implementer`
 * handing a ticket between `Planned`/`In Progress`/`Review`/`Ready to Merge`), unlike
 * `Priority`/`Size`/`Assigned Agent`, which stay human-curated and pull-only forever. An
 * agent never calls `gh project item-edit` itself for any of these — it writes the local
 * file and dirties it; this is the one place that write turns into a board mutation, and
 * only `sync` (via `applyTicketSync`) ever executes it.
 *
 * Only produces an edit when `remote` actually has an entry for the ticket's issue and
 * that entry's Status disagrees with what the local file now says — no remote data means
 * nothing to diff against, so no edit is pushed blind. Throws, rather than silently
 * skipping, if `ticket.status` itself has no board mapping (a stale `board.json`) — see
 * the throw below for why.
 */
function statusEdit(board: BoardData, ticket: Ticket, remote: Map<number, RemoteItem>): FieldEdit[] {
  if (ticket.issue === undefined) return [];
  const remoteItem = remote.get(ticket.issue);
  if (!remoteItem) return [];
  const remoteStatus = remoteItem.fields.get("Status");
  if (remoteStatus === undefined) return [];
  // Unlike a missing `remoteItem`/`remoteStatus` (nothing to diff against yet, so no edit
  // is the right no-op), a `ticket.status` role with no board mapping means `board.json` is
  // stale — the same failure mode `creationEdits`/`planTicketPull` both already throw on
  // for this exact field, so silently skipping the edit here would leave `applyTicketSync`
  // reporting a ticket "synced" while its Status quietly never moved on the board.
  const desired = board.statusRoles[ticket.status];
  if (!desired) {
    throw new Error(
      `No board status mapped to role '${ticket.status}' for #${ticket.issue} — board.json may be stale, run \`litecode board init --apply\``,
    );
  }
  if (remoteStatus === desired.label) return [];
  return [{ field: "Status", fieldId: field(board, "Status").id, from: remoteStatus, to: desired.label, optionId: desired.optionId }];
}

export function planTicketSync(tickets: Ticket[], board: BoardData, remote: Map<number, RemoteItem>): SyncPlan {
  const plan: SyncPlan = { actions: [], skipped: [], blockers: [] };

  for (const ticket of tickets) {
    const dirty = !ticket.synced || ticket.pendingComments.length > 0;
    if (!dirty) {
      plan.skipped.push({ ticket, reason: "already synced" });
      continue;
    }

    if (ticket.issue === undefined) {
      const wanted = creationEdits(board, ticket);
      const missingOption = wanted.find((e) => e.field !== "Assigned Agent" && e.field !== "Due Date" && !e.optionId);
      if (missingOption) {
        plan.blockers.push({
          ticket,
          problem: `no board option for ${missingOption.field} = ${missingOption.to}`,
          fix: "add the option in the project web UI, then re-run `litecode board init --apply`",
        });
        continue;
      }
      plan.actions.push({ kind: "create", ticket, edits: wanted, comments: ticket.pendingComments });
      continue;
    }

    // Existing issue: title/body/comments, plus a Status edit if the local file (the
    // pipeline's own hand-off) disagrees with what `remote` just read off the board.
    // Priority/Size/Assigned Agent stay pull-only, per ADR 0001/0010 — nothing else is
    // diffed here.
    plan.actions.push({
      kind: "update",
      ticket,
      issue: ticket.issue,
      edits: statusEdit(board, ticket, remote),
      comments: ticket.pendingComments,
    });
  }
  return plan;
}

async function editField(itemId: string, projectId: string, edit: FieldEdit): Promise<void> {
  const args = ["project", "item-edit", "--id", itemId, "--project-id", projectId, "--field-id", edit.fieldId];
  if (edit.optionId) args.push("--single-select-option-id", edit.optionId);
  else if (edit.field === "Due Date") args.push("--date", edit.to);
  else args.push("--text", edit.to);
  await gh(args);
}

async function cacheItemId(root: string, cachePath: string, issue: number, itemId: string): Promise<void> {
  const abs = join(root, cachePath);
  const file = Bun.file(abs);
  const cache = (await file.exists()) ? ((await file.json()) as Record<string, string>) : {};
  cache[String(issue)] = itemId;
  const ordered = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => Number(a) - Number(b)));
  await Bun.write(abs, JSON.stringify(ordered, null, 2) + "\n");
}

/**
 * Per-ticket outcome of a ticket-sync run.
 *
 * `applyTicketSync` itself only ever processes `plan.actions` (tickets `planTicketSync`
 * decided are dirty and not blocked), so every entry it produces is "synced" — "blocked"
 * and "skipped" mirror `SyncPlan.blockers` / `SyncPlan.skipped` (reported separately, by
 * `planTicketSync`, not merged into this type). "hydrated" is now produced too, but by a
 * separate producer (`planTicketHydration`/`applyTicketHydration`), for a board item that
 * had no local file at all — see issue #27. Trim the type back to "synced"/"hydrated"
 * only if "blocked"/"skipped" never end up needing to merge in here.
 */
export type SyncOutcome = "synced" | "blocked" | "hydrated" | "skipped";

export type PerTicketResult = { ticket: Ticket; outcome: SyncOutcome; detail: string };

export type SyncOptions = {
  repo: string;
  owner: string;
  /** Project number, for `gh project item-add`. */
  number: number;
  itemIdCache: string;
  now?: () => string;
  /**
   * Proactive delay between mutating `gh` calls within a batch, in ms. A single ticket
   * create fires 3+ serial mutations (issue create, item-add, up to four field edits, N
   * comments); `board/gh.ts` only backs off *after* a failure, so a batch of several dirty
   * tickets can still burst past GitHub's secondary rate limit before any retry ever
   * triggers. Overridable per ADR 0001 via `LITECODE_TICKET_SYNC_DELAY_MS`, falling back
   * to this option, falling back to a conservative default.
   */
  delayMs?: number;
  /** Streamed as each mutating action completes, so a mid-batch failure leaves a trace. */
  onLog?: (line: string) => void;
};

const DEFAULT_THROTTLE_MS = 250;

function throttleMs(opts: SyncOptions): number {
  const envVal = process.env.LITECODE_TICKET_SYNC_DELAY_MS;
  if (envVal !== undefined) {
    const parsed = Number(envVal);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    return opts.delayMs ?? DEFAULT_THROTTLE_MS;
  }
  return opts.delayMs ?? DEFAULT_THROTTLE_MS;
}

async function throttle(opts: SyncOptions): Promise<void> {
  const ms = throttleMs(opts);
  if (ms > 0) await Bun.sleep(ms);
}

/**
 * Applies the plan and rewrites the touched file immediately after every mutation that
 * changes what it should say — never batched at the end of the loop.
 *
 * `ticket.issue` in particular is persisted the instant `gh issue create` returns, before
 * item-add, field edits, or comments run: a failure anywhere after that point means a
 * re-run sees `ticket.issue` already set and treats it as an `update`, not a second
 * `create`. Comments are shifted off `pendingComments` and the file rewritten after each
 * one posts, so a partial failure mid-batch only reposts what never made it, not the
 * whole batch.
 */
export async function applyTicketSync(
  root: string,
  plan: SyncPlan,
  board: BoardData,
  remote: Map<number, RemoteItem>,
  opts: SyncOptions,
): Promise<PerTicketResult[]> {
  const results: PerTicketResult[] = [];
  const stamp = opts.now ?? (() => new Date().toISOString());
  const emit = (line: string) => {
    opts.onLog?.(line);
  };

  for (const action of plan.actions) {
    let ticket = { ...action.ticket };
    let detail = "";

    if (action.kind === "create") {
      const url = (
        await gh([
          "issue", "create",
          "--repo", opts.repo,
          "--title", ticket.title,
          "--body", ticket.body,
          "--label", ticket.label,
        ])
      ).trim().split("\n").filter(Boolean).pop()!;
      const issue = Number(url.split("/").pop());
      if (!Number.isInteger(issue)) throw new Error(`Could not read an issue number out of '${url}'`);

      // Persist immediately: from this point on a re-run must see an existing issue, not
      // recreate one.
      ticket = { ...ticket, issue };
      await writeTicket(root, ticket);
      detail = `created #${issue} from ${ticket.path}`;
      emit(detail);
      await throttle(opts);

      const itemId = (
        await gh([
          "project", "item-add", String(opts.number),
          "--owner", opts.owner, "--url", url,
          "--format", "json", "--jq", ".id",
        ])
      ).trim();
      await cacheItemId(root, opts.itemIdCache, issue, itemId);
      emit(`  added #${issue} to the board`);
      await throttle(opts);

      for (const edit of action.edits) {
        await editField(itemId, board.projectId, edit);
        emit(`  ${edit.field} = ${edit.to}`);
        await throttle(opts);
      }
    } else {
      // The file is the thing that changed, so its title/body is what the issue should say.
      await gh([
        "issue", "edit", String(action.issue),
        "--repo", opts.repo,
        "--title", ticket.title,
        "--body", ticket.body,
      ]);
      detail = `updated #${action.issue} from ${ticket.path}`;
      emit(detail);
      await throttle(opts);

      if (action.edits.length > 0) {
        const itemId = remote.get(action.issue)?.itemId;
        if (!itemId) {
          throw new Error(
            `#${action.issue} has a Status edit to push but no board item id in \`remote\` — ` +
              `the board fetch this run started from should already have it for any issue it diffed against`,
          );
        }
        for (const edit of action.edits) {
          await editField(itemId, board.projectId, edit);
          emit(`  ${edit.field} = ${edit.to}`);
          await throttle(opts);
        }
      }
    }

    const issueNumber = ticket.issue!;
    while (ticket.pendingComments.length > 0) {
      const [comment, ...rest] = ticket.pendingComments;
      await gh(["issue", "comment", String(issueNumber), "--repo", opts.repo, "--body", comment!]);
      // Drop the just-posted comment and persist before moving to the next one: a failure
      // on comment N+1 must not repost comments 1..N on re-run.
      ticket = { ...ticket, pendingComments: rest };
      await writeTicket(root, ticket);
      emit(`  commented on #${issueNumber}`);
      await throttle(opts);
    }

    ticket = { ...ticket, synced: true, syncedAt: stamp() };
    await writeTicket(root, ticket);
    results.push({ ticket, outcome: "synced", detail });
  }
  return results;
}

export type PullChange = { ticket: Ticket; changes: string[] };

function statusRoleFor(board: BoardData, label: string): Ticket["status"] | null {
  for (const [role, v] of Object.entries(board.statusRoles)) {
    if (v.label === label) return role as Ticket["status"];
  }
  return null;
}

const KNOWN_LABELS: readonly TicketMeta["label"][] = ["bug", "feature", "doc", "chore"];

function labelFor(remote: RemoteItem): TicketMeta["label"] {
  return remote.labels.find((l): l is TicketMeta["label"] => (KNOWN_LABELS as readonly string[]).includes(l)) ?? "chore";
}

export type HydrationSkip = { issue: number; reason: string };

export type HydrationPlan = { toCreate: Ticket[]; skipped: HydrationSkip[] };

/**
 * Board -> file, for board items that have **no local file at all** yet (filed directly
 * on GitHub, or created before the local buffer existed). Without this, `dispatcher`
 * ranking from the local buffer would have a strictly worse view than querying the board
 * directly — a board item invisible to the pipeline is worse than one it can at least see
 * and rank. See ticket 0009 / issue #27.
 *
 * Every hydrated ticket is written `synced: true` — it mirrors exactly what the board
 * already holds, so there is nothing pending to push. A board item whose Status is not
 * yet set is skipped rather than hydrated with a fabricated default: there is nothing to
 * rank it by, and materialising a file with an invented status would misrepresent the
 * board, not reconcile it. `dispatcher` is expected to log these skips, not silently drop
 * them (Context section of issue #27: a board item with NULL fields must not be invisible).
 */
export function planTicketHydration(
  tickets: Ticket[],
  board: BoardData,
  remote: Map<number, RemoteItem>,
  dir: string,
): HydrationPlan {
  const known = new Set(tickets.filter((t) => t.issue !== undefined).map((t) => t.issue));
  const toCreate: Ticket[] = [];
  const skipped: HydrationSkip[] = [];
  // `nextNumber` looks at file ids only, so track pending creations in the same batch too
  // — otherwise two board items hydrated in one run would collide on the same NNNN.
  let pool = [...tickets];

  // Deterministic order (ascending issue number) so a hydration run's output — and the
  // NNNN each gets assigned — doesn't depend on GraphQL's pagination order.
  const items = [...remote.values()].sort((a, b) => a.issue - b.issue);

  for (const item of items) {
    if (known.has(item.issue)) continue;
    if (item.state && item.state !== "OPEN") {
      skipped.push({ issue: item.issue, reason: `issue is ${item.state.toLowerCase()}, not pipeline-relevant` });
      continue;
    }
    const statusLabel = item.fields.get("Status");
    if (!statusLabel) {
      skipped.push({ issue: item.issue, reason: "no Status set on the board item — nothing to rank it by" });
      continue;
    }
    const status = statusRoleFor(board, statusLabel);
    if (!status) {
      skipped.push({ issue: item.issue, reason: `Status '${statusLabel}' does not map to any known role (board.json may be stale)` });
      continue;
    }

    const priorityRaw = item.fields.get("Priority")?.toLowerCase();
    const priority = (PRIORITIES as readonly string[]).includes(priorityRaw ?? "") ? (priorityRaw as Ticket["priority"]) : "medium";
    const sizeRaw = item.fields.get("Size")?.toLowerCase();
    const size = (SIZES as readonly string[]).includes(sizeRaw ?? "") ? (sizeRaw as Ticket["size"]) : "medium";
    const dueDateRaw = item.fields.get("Due Date");
    const dueDate = dueDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dueDateRaw) ? dueDateRaw : undefined;

    const title = item.title ?? `Issue #${item.issue}`;
    const id = `${String(nextNumber(pool)).padStart(4, "0")}-${slugify(title)}`;
    const ticket: Ticket = {
      schemaVersion: 1,
      id,
      title,
      label: labelFor(item),
      status,
      priority,
      size,
      assignedAgent: item.fields.get("Assigned Agent") ?? "human",
      dueDate,
      issue: item.issue,
      synced: true,
      syncedAt: new Date().toISOString(),
      path: join(dir, `${id}.md`),
      body: (item.body?.trim() || `Hydrated from #${item.issue} — see the GitHub issue for the full body.`) + "\n",
      pendingComments: [],
    };
    toCreate.push(ticket);
    pool = [...pool, ticket];
  }

  return { toCreate, skipped };
}

/** Writes every hydrated ticket to its file. */
const MAX_HYDRATION_ATTEMPTS = 8;

/**
 * A plain `writeTicket` here would reopen the exact race `createTicket`'s exclusive
 * `wx`-flag write exists to close (see `store.ts`'s doc comment on it): `planTicketHydration`
 * assigns each candidate's NNNN from a listing taken at plan time, and a concurrent
 * `ticket new` or a second concurrent hydration run can pick the same next-id before this
 * runs. `writeTicketExclusive` refuses to overwrite whatever won that race; on collision,
 * `dir` lets this re-derive a fresh NNNN (the id is the only thing that can collide — issue
 * number, title, etc. came from the board and don't change) and retry, same pattern as
 * `createTicket`.
 */
export async function applyTicketHydration(root: string, dir: string, toCreate: Ticket[]): Promise<void> {
  for (const planned of toCreate) {
    let ticket = planned;
    for (let attempt = 1; ; attempt++) {
      try {
        await writeTicketExclusive(root, ticket);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        if (attempt >= MAX_HYDRATION_ATTEMPTS) {
          throw new Error(
            `Could not hydrate #${ticket.issue} after ${MAX_HYDRATION_ATTEMPTS} attempts — ` +
              "too many concurrent writers picking the same id.",
          );
        }
        const existing = await listTickets(root, dir);
        const id = `${String(nextNumber(existing)).padStart(4, "0")}-${slugify(ticket.title)}`;
        ticket = { ...ticket, id, path: join(dir, `${id}.md`) };
      }
    }
  }
}

/**
 * Board -> file. Only clean tickets are refreshed: overwriting a file that still holds
 * unpushed edits would silently destroy them, and a dirty file is exactly the case the
 * user asked to push, not to discard.
 *
 * `board` is an explicit parameter rather than a module-level global primed by a separate
 * `useBoardLabels(board)` call: a global that must be primed before this function works
 * correctly is exactly the initialization-order footgun that silently dropped Status
 * changes when a caller forgot the priming call.
 */
export function planTicketPull(tickets: Ticket[], board: BoardData, remote: Map<number, RemoteItem>): PullChange[] {
  const out: PullChange[] = [];
  for (const ticket of tickets) {
    if (ticket.issue === undefined || !ticket.synced || ticket.pendingComments.length > 0) continue;
    const item = remote.get(ticket.issue);
    if (!item) continue;

    const changes: string[] = [];
    const updated = { ...ticket };

    const status = item.fields.get("Status");
    if (status) {
      // An unrecognised label means board.json is stale or a status role got renamed
      // without a `board init --apply` — that is worth failing loudly over, unlike a
      // genuinely absent Status value (nothing set yet on the item), which stays a no-op.
      const match = statusRoleFor(board, status);
      if (!match) {
        throw new Error(
          `Board item for #${ticket.issue} has Status '${status}', which does not map to any ` +
            "known role — run `litecode board doctor` (board.json may be stale).",
        );
      }
      if (match !== ticket.status) {
        changes.push(`status ${ticket.status} -> ${match}`);
        updated.status = match;
      }
    }
    const priority = item.fields.get("Priority")?.toLowerCase();
    if (priority && (PRIORITIES as readonly string[]).includes(priority) && priority !== ticket.priority) {
      changes.push(`priority ${ticket.priority} -> ${priority}`);
      updated.priority = priority as Ticket["priority"];
    }
    const size = item.fields.get("Size")?.toLowerCase();
    if (size && (SIZES as readonly string[]).includes(size) && size !== ticket.size) {
      changes.push(`size ${ticket.size} -> ${size}`);
      updated.size = size as Ticket["size"];
    }
    const agent = item.fields.get("Assigned Agent");
    if (agent && agent !== ticket.assignedAgent) {
      changes.push(`assignedAgent ${ticket.assignedAgent} -> ${agent}`);
      updated.assignedAgent = agent;
    }

    if (changes.length > 0) out.push({ ticket: updated, changes });
  }
  return out;
}

export async function applyTicketPull(root: string, changes: PullChange[]): Promise<void> {
  for (const { ticket } of changes) await writeTicket(root, ticket);
}

export { fetchTicketItems };
export type { RemoteItem };
