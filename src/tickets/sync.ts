/**
 * Push the ticket buffer to GitHub. The local ticket file is now the source of truth for
 * pipeline state — there is no board to pull from or hydrate against any more (the
 * board-hydration path was removed once the local buffer became authoritative).
 *
 * `priority`/`size`/`assignedAgent` are plain local fields: they're written at creation
 * (`createTicket`, `src/tickets/store.ts`) and stay freely editable by hand or by any
 * agent afterwards, same as `status`. None of the three is ever pushed anywhere — there is
 * no board field left to push them to.
 *
 * `status` is what the pipeline itself drives (`dispatcher`/`implementer`/`triage` handing
 * a ticket between `Planned`/`In Progress`/`Review`/`Ready to Merge`/`Blocked`) by writing
 * this field directly on the local file. It's a purely local pipeline state now: nothing
 * in this module syncs it anywhere.
 *
 * What `sync` still does is push: create the GitHub issue for a ticket that doesn't have
 * one yet (`gh issue create`), keep an existing issue's title/body in sync with the file
 * (`gh issue edit`), and post any comments staged locally (`gh issue comment`). Batching
 * every dirty ticket's creates/edits/comments into one bounded, retryable run is what
 * turns N agents each doing their own scattered `gh` calls into the one durable answer to
 * GitHub's secondary rate limit — that part of the design is unchanged.
 */

import { gh } from "../gh.ts";
import type { Ticket } from "./spec.ts";
import { writeTicket } from "./store.ts";

export type TicketAction =
  | { kind: "create"; ticket: Ticket; comments: string[] }
  | { kind: "update"; ticket: Ticket; issue: number; comments: string[] };

export type SyncPlan = {
  actions: TicketAction[];
  skipped: { ticket: Ticket; reason: string }[];
};

export function planTicketSync(tickets: Ticket[]): SyncPlan {
  const plan: SyncPlan = { actions: [], skipped: [] };

  for (const ticket of tickets) {
    const dirty = !ticket.synced || ticket.pendingComments.length > 0;
    if (!dirty) {
      plan.skipped.push({ ticket, reason: "already synced" });
      continue;
    }

    if (ticket.issue === undefined) {
      plan.actions.push({ kind: "create", ticket, comments: ticket.pendingComments });
      continue;
    }

    // Existing issue: only title/body/comments push now — status is purely local, and
    // priority/size/assignedAgent were never pushed past creation.
    plan.actions.push({ kind: "update", ticket, issue: ticket.issue, comments: ticket.pendingComments });
  }
  return plan;
}

/**
 * Per-ticket outcome of a ticket-sync run. "hydrated"/"blocked" no longer apply — there is
 * no board to hydrate from or to leave a Status push unresolved against — so this is just
 * "synced" for anything `applyTicketSync` processed, mirroring `SyncPlan.skipped`
 * separately.
 */
export type SyncOutcome = "synced" | "skipped";

export type PerTicketResult = { ticket: Ticket; outcome: SyncOutcome; detail: string };

export type SyncOptions = {
  repo: string;
  now?: () => string;
  /**
   * Proactive delay between mutating `gh` calls within a batch, in ms. A single ticket
   * create fires 1+ serial mutations (issue create, then N comments); `gh.ts` only backs
   * off *after* a failure, so a batch of several dirty tickets can still burst past
   * GitHub's secondary rate limit before any retry ever triggers. Overridable per ADR 0001
   * via `LITECODE_TICKET_SYNC_DELAY_MS`, falling back to this option, falling back to a
   * conservative default.
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
 * comments run: a failure anywhere after that point means a re-run sees `ticket.issue`
 * already set and treats it as an `update`, not a second `create`. Comments are shifted
 * off `pendingComments` and the file rewritten after each one posts, so a partial failure
 * mid-batch only reposts what never made it, not the whole batch.
 */
export async function applyTicketSync(root: string, plan: SyncPlan, opts: SyncOptions): Promise<PerTicketResult[]> {
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
