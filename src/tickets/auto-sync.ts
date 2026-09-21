/**
 * Safety rails for an unattended `ticket sync --auto` run: a cooldown so a failing trigger
 * can't retry in a tight loop. See ADR 0009 (issue #31).
 *
 * A detect-and-block conflict trace used to live here too, keyed off `SyncPlan.blockers` —
 * that concept only ever existed for a missing board option (`planTicketSync` refusing to
 * push a create with no matching Priority/Size option on the board). There is no board to
 * be missing an option on any more, so `planTicketSync` no longer produces blockers and
 * this module no longer tracks them; see lot 6 of the local-first-tickets epic.
 *
 * Deliberately pure/stateless functions over a plain `AutoSyncState` value: the only I/O
 * (reading/writing `config.project.tickets.autoStateFile`) lives in the CLI glue, so this
 * module can be tested without touching the filesystem or `gh`.
 */

import { join } from "node:path";

export type AutoSyncState = {
  lastAttemptAt?: string;
};

export const EMPTY_AUTO_SYNC_STATE: AutoSyncState = {};

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
 * `LITECODE_TICKET_AUTO_SYNC_MIN_INTERVAL_MS` overrides `tickets.autoMinIntervalMs` for a
 * single invocation, mirroring how ADR 0001's `LITECODE_TICKET_SYNC_DELAY_MS` overrides
 * `delayMs` in `sync.ts`'s `throttleMs`. An unparsable or negative value falls back to the
 * configured/default value rather than silently disabling the cooldown.
 */
export function resolveAutoMinIntervalMs(configuredMs: number): number {
  const envVal = process.env.LITECODE_TICKET_AUTO_SYNC_MIN_INTERVAL_MS;
  if (envVal === undefined || envVal === "") return configuredMs;
  const parsed = Number(envVal);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return configuredMs;
}

/**
 * Missing file reads as `EMPTY_AUTO_SYNC_STATE`: a first-ever `--auto` run has nothing to
 * skip. A truncated/corrupted file (e.g. the process was killed mid-`Bun.write` during a
 * prior unattended run) must not read the same way, though: that would report no prior
 * attempt at all, which makes `shouldSkipForCooldown` skip the cooldown entirely — silently
 * defeating the anti-runaway guard exactly in the failure mode (a supervisor killing the
 * process at a consistent point) most likely to recur. Instead, a parse failure fails
 * *closed*: it falls back to the file's own last-modified time as `lastAttemptAt`, so the
 * cooldown still applies (worst case, once) while the caller recovers a fresh trace on the
 * next successful write.
 */
export async function loadAutoSyncState(root: string, path: string): Promise<AutoSyncState> {
  const file = Bun.file(join(root, path));
  if (!(await file.exists())) return EMPTY_AUTO_SYNC_STATE;
  try {
    const raw = (await file.json()) as Partial<AutoSyncState>;
    return { lastAttemptAt: raw.lastAttemptAt };
  } catch {
    const lastModified = file.lastModified;
    const lastAttemptAt = Number.isFinite(lastModified) ? new Date(lastModified).toISOString() : undefined;
    return { lastAttemptAt };
  }
}

export async function saveAutoSyncState(root: string, path: string, state: AutoSyncState): Promise<void> {
  await Bun.write(join(root, path), JSON.stringify(state, null, 2) + "\n");
}
