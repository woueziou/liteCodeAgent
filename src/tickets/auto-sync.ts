/**
 * Safety rails for an unattended `ticket sync --auto` run: a cooldown so a failing trigger
 * can't retry in a tight loop, and a durable trace for a detect-and-block conflict that
 * happens when nobody is watching stdout. See ADR 0009 (issue #31).
 *
 * Deliberately pure/stateless functions over a plain `AutoSyncState` value: the only I/O
 * (reading/writing `config.project.tickets.autoStateFile`) lives in the CLI glue, so this
 * module can be tested without touching the filesystem or `gh`.
 */

import { join } from "node:path";
import type { SyncPlan } from "./sync.ts";

export type BlockerTrace = {
  /** `SyncPlan.blockers[].problem`, the identity of a blocker for dedupe purposes. */
  problem: string;
  fix: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** How many `--auto` runs in a row have seen this exact blocker still unresolved. */
  attempts: number;
};

export type AutoSyncState = {
  lastAttemptAt?: string;
  /** Keyed by ticket id. A ticket blocked pre-creation has no issue number to key on. */
  blockers: Record<string, BlockerTrace>;
};

export const EMPTY_AUTO_SYNC_STATE: AutoSyncState = { blockers: {} };

/**
 * `true` when the last `--auto` run was recent enough that this one should no-op instead
 * of hitting `gh` again. A failing auto-trigger that gets invoked on every subsequent agent
 * action would otherwise retry as fast as it's called, which is exactly the runaway ticket
 * #31 flags — the cooldown is what actually bounds that, not the per-call `gh` throttle
 * from ADR 0001 (that only paces calls *within* a run that already started).
 */
export function shouldSkipForCooldown(state: AutoSyncState, now: Date, minIntervalMs: number): boolean {
  if (!state.lastAttemptAt) return false;
  if (minIntervalMs <= 0) return false;
  const last = Date.parse(state.lastAttemptAt);
  if (Number.isNaN(last)) return false;
  return now.getTime() - last < minIntervalMs;
}

export function recordAttempt(state: AutoSyncState, now: Date): AutoSyncState {
  return { ...state, lastAttemptAt: now.toISOString() };
}

/**
 * Folds `plan.blockers` into the persisted trace: a blocker seen again bumps `attempts` and
 * `lastSeenAt`; a ticket that was blocked before and is no longer in `plan.blockers` is
 * dropped (it resolved). Detect-and-block never auto-resolves a conflict itself — this only
 * tracks that the *report* of the same still-unresolved conflict shouldn't re-alert as if it
 * were new every single run.
 */
export function reconcileBlockers(
  state: AutoSyncState,
  blockers: SyncPlan["blockers"],
  now: Date,
): { state: AutoSyncState; newlyReported: SyncPlan["blockers"] } {
  const nowIso = now.toISOString();
  const nextBlockers: Record<string, BlockerTrace> = {};
  const newlyReported: SyncPlan["blockers"] = [];

  for (const b of blockers) {
    const key = b.ticket.id;
    const prior = state.blockers[key];
    const sameProblem = prior && prior.problem === b.problem;
    if (sameProblem) {
      nextBlockers[key] = { ...prior, lastSeenAt: nowIso, attempts: prior.attempts + 1 };
    } else {
      nextBlockers[key] = { problem: b.problem, fix: b.fix, firstSeenAt: nowIso, lastSeenAt: nowIso, attempts: 1 };
      newlyReported.push(b);
    }
  }

  return { state: { ...state, blockers: nextBlockers }, newlyReported };
}

/** Missing file reads as `EMPTY_AUTO_SYNC_STATE`: a first-ever `--auto` run has nothing to skip. */
export async function loadAutoSyncState(root: string, path: string): Promise<AutoSyncState> {
  const file = Bun.file(join(root, path));
  if (!(await file.exists())) return EMPTY_AUTO_SYNC_STATE;
  const raw = (await file.json()) as Partial<AutoSyncState>;
  return { lastAttemptAt: raw.lastAttemptAt, blockers: raw.blockers ?? {} };
}

export async function saveAutoSyncState(root: string, path: string, state: AutoSyncState): Promise<void> {
  await Bun.write(join(root, path), JSON.stringify(state, null, 2) + "\n");
}
