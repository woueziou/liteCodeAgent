/** Reading and writing the ticket buffer directory. No GitHub access lives here. */

import { readdir, mkdir, open } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { CURRENT_SCHEMA_VERSION, parseTicket, serializeTicket, slugify, type Ticket, type TicketMeta } from "./spec.ts";

export function ticketsDir(root: string, dir: string): string {
  return resolve(root, dir);
}

/**
 * Returns ticket file paths relative to `abs`, whether they sit flat in the tickets
 * directory (today's layout: `docs/tickets/NNNN-slug.md`) or nested under an epic
 * directory (the layout the migration lot introduces: `docs/tickets/<epic>/NNNN-slug.md`)
 * — both forms must be picked up simultaneously, since the migration to epics happens in
 * a later lot and this fix cannot assume it's already done. `recursive: true` also
 * tolerates deeper nesting harmlessly, though only one level is used today. An epic
 * directory carrying its own `README.md` is excluded the same as the top-level one, and
 * an empty epic directory simply contributes no entries rather than erroring.
 */
async function ticketFiles(abs: string): Promise<string[]> {
  try {
    const entries = await readdir(abs, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "README.md")
      .map((e) => join(relative(abs, e.parentPath), e.name))
      // Sort by filename (the ticket id), not by the full joined path: sorting on the
      // path would put every flat ticket ahead of every nested epic ticket purely
      // because "0" < a directory letter, scrambling numeric-by-id order during the
      // flat/epic transition window even though ids themselves are unaffected.
      .sort((a, b) => a.split("/").pop()!.localeCompare(b.split("/").pop()!));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

export type TicketLoadError = { path: string; error: string };

export type TicketListing = { tickets: Ticket[]; errors: TicketLoadError[] };

/**
 * A malformed ticket file (hand-edited into an invalid shape, or half-written by a
 * crashed process) must not take down the listing for every other ticket — `list`/`doctor`/`migrate`
 * need to keep working for the tickets that do parse, and surface the bad one as an
 * error the caller can report instead of an uncaught throw.
 */
export async function listTicketsDetailed(root: string, dir: string): Promise<TicketListing> {
  const abs = ticketsDir(root, dir);
  const tickets: Ticket[] = [];
  const errors: TicketLoadError[] = [];
  for (const file of await ticketFiles(abs)) {
    const path = join(dir, file);
    try {
      tickets.push(parseTicket(await Bun.file(join(abs, file)).text(), path));
    } catch (e) {
      errors.push({ path, error: (e as Error).message });
    }
  }
  return { tickets, errors };
}

/** Convenience for callers that only care about the tickets that did parse. */
export async function listTickets(root: string, dir: string): Promise<Ticket[]> {
  return (await listTicketsDetailed(root, dir)).tickets;
}

export async function writeTicket(root: string, ticket: Ticket): Promise<void> {
  const abs = resolve(root, ticket.path);
  await mkdir(join(abs, ".."), { recursive: true });
  await Bun.write(abs, serializeTicket(ticket));
}

/**
 * Like `writeTicket`, but refuses to overwrite anything already at `ticket.path` — throws
 * an `EEXIST` error instead. `createTicket` needs this to avoid two concurrent drafters
 * silently clobbering each other's file for the same id.
 */
export async function writeTicketExclusive(root: string, ticket: Ticket): Promise<void> {
  const abs = resolve(root, ticket.path);
  await mkdir(join(abs, ".."), { recursive: true });
  // node:fs 'wx' flag: fails with EEXIST rather than silently overwriting a file that won
  // the race for this id since the caller last listed the directory.
  const fd = await open(abs, "wx");
  try {
    await fd.writeFile(serializeTicket(ticket));
  } finally {
    await fd.close();
  }
}

/** Ticket numbers are the tickets' own identity: sequential within the tickets directory. */
export function nextNumber(existing: Ticket[]): number {
  const highest = existing.reduce((max, t) => Math.max(max, Number(t.id.slice(0, 4))), 0);
  return highest + 1;
}

export type NewTicket = Omit<Partial<TicketMeta>, "id" | "schemaVersion"> & {
  title: string;
  label: TicketMeta["label"];
  body: string;
};

const MAX_CREATE_ATTEMPTS = 8;

/**
 * Two agents drafting a ticket at the same instant can both read the same `existing`
 * listing and pick the same NNNN. Rather than accept that collision (one draft silently
 * overwriting the other), the write is exclusive (`Bun.write`'s `createNew`-equivalent —
 * bail rather than overwrite) and retried against the next free number on collision. This
 * closes the race window without needing a lock file: worst case is a handful of wasted
 * listing reads under real concurrent drafting, which is the documented limit — see ADR
 * 0001 for why a full lock/sequence-counter was not built for this.
 */
export async function createTicket(root: string, dir: string, input: NewTicket): Promise<Ticket> {
  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt++) {
    const existing = await listTickets(root, dir);
    const id = `${String(nextNumber(existing)).padStart(4, "0")}-${slugify(input.title)}`;
    const ticket: Ticket = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id,
      title: input.title,
      label: input.label,
      status: input.status ?? "backlog",
      priority: input.priority ?? "medium",
      size: input.size ?? "medium",
      assignedAgent: input.assignedAgent ?? "human",
      dueDate: input.dueDate,
      path: join(dir, `${id}.md`),
      body: input.body.trimEnd() + "\n",
    };

    try {
      await writeTicketExclusive(root, ticket);
      return ticket;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") continue; // retry with a fresh listing
      throw e;
    }
  }
  throw new Error(
    `Could not create a ticket for '${input.title}' after ${MAX_CREATE_ATTEMPTS} attempts — ` +
      "too many concurrent writers picking the same id. Retry, or file it manually.",
  );
}
