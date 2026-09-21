import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EMPTY_AUTO_SYNC_STATE,
  loadAutoSyncState,
  recordAttempt,
  resolveAutoMinIntervalMs,
  saveAutoSyncState,
  shouldSkipForCooldown,
} from "../src/tickets/auto-sync.ts";

test("shouldSkipForCooldown: no prior attempt never skips", () => {
  expect(shouldSkipForCooldown(EMPTY_AUTO_SYNC_STATE, new Date(), 60_000)).toBe(false);
});

test("shouldSkipForCooldown: recent attempt within the window skips", () => {
  const now = new Date("2026-01-01T00:01:00.000Z");
  const state = { lastAttemptAt: "2026-01-01T00:00:30.000Z" };
  expect(shouldSkipForCooldown(state, now, 60_000)).toBe(true);
});

test("shouldSkipForCooldown: attempt outside the window does not skip", () => {
  const now = new Date("2026-01-01T00:02:00.000Z");
  const state = { lastAttemptAt: "2026-01-01T00:00:30.000Z" };
  expect(shouldSkipForCooldown(state, now, 60_000)).toBe(false);
});

test("shouldSkipForCooldown: minIntervalMs of 0 disables the cooldown", () => {
  const now = new Date();
  const state = { lastAttemptAt: now.toISOString() };
  expect(shouldSkipForCooldown(state, now, 0)).toBe(false);
});

test("recordAttempt stamps lastAttemptAt", () => {
  const state = EMPTY_AUTO_SYNC_STATE;
  const now = new Date("2026-01-01T00:00:00.000Z");
  const next = recordAttempt(state, now);
  expect(next.lastAttemptAt).toBe(now.toISOString());
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

test("resolveAutoMinIntervalMs: empty-string env var falls back to configured value", () => {
  process.env.LITECODE_TICKET_AUTO_SYNC_MIN_INTERVAL_MS = "";
  try {
    expect(resolveAutoMinIntervalMs(60_000)).toBe(60_000);
  } finally {
    delete process.env.LITECODE_TICKET_AUTO_SYNC_MIN_INTERVAL_MS;
  }
});

test("loadAutoSyncState: missing file reads as EMPTY_AUTO_SYNC_STATE", async () => {
  const dir = await mkdtemp(join(tmpdir(), "litecode-auto-sync-"));
  try {
    const state = await loadAutoSyncState(dir, "does-not-exist.json");
    expect(state).toEqual(EMPTY_AUTO_SYNC_STATE);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadAutoSyncState: round-trips a saved state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "litecode-auto-sync-"));
  try {
    const state = { lastAttemptAt: "2026-01-01T00:00:00.000Z" };
    await saveAutoSyncState(dir, "state.json", state);
    const loaded = await loadAutoSyncState(dir, "state.json");
    expect(loaded).toEqual(state);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadAutoSyncState: a truncated/corrupted file does not throw, and does not reset the cooldown", async () => {
  const dir = await mkdtemp(join(tmpdir(), "litecode-auto-sync-"));
  try {
    const before = new Date();
    await Bun.write(join(dir, "corrupt.json"), "{ this is not valid json");
    const state = await loadAutoSyncState(dir, "corrupt.json");

    // Fails closed, not open: a parse failure must not look like "never attempted" (that
    // would let shouldSkipForCooldown skip the cooldown entirely). It recovers the file's
    // own mtime as a best-effort lastAttemptAt instead, so the cooldown still applies.
    expect(state.lastAttemptAt).toBeDefined();
    const recovered = Date.parse(state.lastAttemptAt as string);
    expect(Number.isNaN(recovered)).toBe(false);
    expect(recovered).toBeGreaterThanOrEqual(before.getTime() - 5000);
    expect(shouldSkipForCooldown(state, before, 60_000)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
