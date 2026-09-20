import { expect, test } from "bun:test";
import type { Ticket } from "../src/tickets/spec.ts";
import type { SyncPlan } from "../src/tickets/sync.ts";
import {
  EMPTY_AUTO_SYNC_STATE,
  reconcileBlockers,
  recordAttempt,
  resolveAutoMinIntervalMs,
  shouldSkipForCooldown,
} from "../src/tickets/auto-sync.ts";

function fakeTicket(id: string): Ticket {
  return {
    schemaVersion: 1,
    id,
    title: `ticket ${id}`,
    label: "feature",
    status: "backlog",
    priority: "medium",
    size: "medium",
    assignedAgent: "human",
    dueDate: undefined,
    issue: undefined,
    synced: false,
    syncedAt: undefined,
    path: `docs/tickets/${id}.md`,
    body: "body\n",
    pendingComments: [],
  };
}

function blocker(id: string, problem: string): SyncPlan["blockers"][number] {
  return { ticket: fakeTicket(id), problem, fix: "add the option" };
}

test("shouldSkipForCooldown: no prior attempt never skips", () => {
  expect(shouldSkipForCooldown(EMPTY_AUTO_SYNC_STATE, new Date(), 60_000)).toBe(false);
});

test("shouldSkipForCooldown: recent attempt within the window skips", () => {
  const now = new Date("2026-01-01T00:01:00.000Z");
  const state = { blockers: {}, lastAttemptAt: "2026-01-01T00:00:30.000Z" };
  expect(shouldSkipForCooldown(state, now, 60_000)).toBe(true);
});

test("shouldSkipForCooldown: attempt outside the window does not skip", () => {
  const now = new Date("2026-01-01T00:02:00.000Z");
  const state = { blockers: {}, lastAttemptAt: "2026-01-01T00:00:30.000Z" };
  expect(shouldSkipForCooldown(state, now, 60_000)).toBe(false);
});

test("shouldSkipForCooldown: minIntervalMs of 0 disables the cooldown", () => {
  const now = new Date();
  const state = { blockers: {}, lastAttemptAt: now.toISOString() };
  expect(shouldSkipForCooldown(state, now, 0)).toBe(false);
});

test("recordAttempt stamps lastAttemptAt without touching blockers", () => {
  const state = { blockers: { a: { problem: "p", fix: "f", firstSeenAt: "t", lastSeenAt: "t", attempts: 1 } } };
  const now = new Date("2026-01-01T00:00:00.000Z");
  const next = recordAttempt(state, now);
  expect(next.lastAttemptAt).toBe(now.toISOString());
  expect(next.blockers).toBe(state.blockers);
});

test("reconcileBlockers: a brand-new blocker is newly reported once", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const { state, newlyReported } = reconcileBlockers(EMPTY_AUTO_SYNC_STATE, [blocker("0001", "no board option")], now);
  expect(newlyReported).toHaveLength(1);
  expect(state.blockers["0001"]).toMatchObject({ problem: "no board option", attempts: 1 });
});

test("reconcileBlockers: the same unresolved blocker seen again is NOT re-reported", () => {
  const t0 = new Date("2026-01-01T00:00:00.000Z");
  const t1 = new Date("2026-01-01T00:05:00.000Z");
  const first = reconcileBlockers(EMPTY_AUTO_SYNC_STATE, [blocker("0001", "no board option")], t0);
  const second = reconcileBlockers(first.state, [blocker("0001", "no board option")], t1);

  expect(second.newlyReported).toHaveLength(0);
  expect(second.state.blockers["0001"]).toMatchObject({
    problem: "no board option",
    attempts: 2,
    firstSeenAt: t0.toISOString(),
    lastSeenAt: t1.toISOString(),
  });
});

test("reconcileBlockers: a changed problem on the same ticket is reported again, attempts reset", () => {
  const t0 = new Date("2026-01-01T00:00:00.000Z");
  const t1 = new Date("2026-01-01T00:05:00.000Z");
  const first = reconcileBlockers(EMPTY_AUTO_SYNC_STATE, [blocker("0001", "no board option for Priority")], t0);
  const second = reconcileBlockers(first.state, [blocker("0001", "no board option for Size")], t1);

  expect(second.newlyReported).toHaveLength(1);
  expect(second.state.blockers["0001"]).toMatchObject({ problem: "no board option for Size", attempts: 1 });
});

test("reconcileBlockers: a ticket no longer blocked drops out of the trace (resolved)", () => {
  const t0 = new Date("2026-01-01T00:00:00.000Z");
  const t1 = new Date("2026-01-01T00:05:00.000Z");
  const first = reconcileBlockers(EMPTY_AUTO_SYNC_STATE, [blocker("0001", "no board option")], t0);
  const second = reconcileBlockers(first.state, [], t1);

  expect(second.newlyReported).toHaveLength(0);
  expect(second.state.blockers).toEqual({});
});

test("resolveAutoMinIntervalMs: no env var falls back to configured value", () => {
  delete process.env.LITECODE_TICKET_AUTO_SYNC_MIN_INTERVAL_MS;
  expect(resolveAutoMinIntervalMs(60_000)).toBe(60_000);
});

test("resolveAutoMinIntervalMs: valid env var overrides the configured value", () => {
  process.env.LITECODE_TICKET_AUTO_SYNC_MIN_INTERVAL_MS = "5000";
  try {
    expect(resolveAutoMinIntervalMs(60_000)).toBe(5000);
  } finally {
    delete process.env.LITECODE_TICKET_AUTO_SYNC_MIN_INTERVAL_MS;
  }
});

test("resolveAutoMinIntervalMs: unparsable or negative env var falls back to configured value", () => {
  process.env.LITECODE_TICKET_AUTO_SYNC_MIN_INTERVAL_MS = "not-a-number";
  try {
    expect(resolveAutoMinIntervalMs(60_000)).toBe(60_000);
  } finally {
    delete process.env.LITECODE_TICKET_AUTO_SYNC_MIN_INTERVAL_MS;
  }

  process.env.LITECODE_TICKET_AUTO_SYNC_MIN_INTERVAL_MS = "-1";
  try {
    expect(resolveAutoMinIntervalMs(60_000)).toBe(60_000);
  } finally {
    delete process.env.LITECODE_TICKET_AUTO_SYNC_MIN_INTERVAL_MS;
  }
});
