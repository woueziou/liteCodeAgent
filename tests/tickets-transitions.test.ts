import { expect, test } from "bun:test";
import { isTransitionAllowed, TICKET_STATUSES } from "../src/tickets/spec.ts";

test("planned -> review is refused: inProgress is required first", () => {
  expect(isTransitionAllowed("planned", "review")).toBe(false);
  expect(isTransitionAllowed("planned", "readyToMerge")).toBe(false);
});

test("planned -> inProgress -> review/readyToMerge is allowed", () => {
  expect(isTransitionAllowed("planned", "inProgress")).toBe(true);
  expect(isTransitionAllowed("inProgress", "review")).toBe(true);
  expect(isTransitionAllowed("inProgress", "readyToMerge")).toBe(true);
});

test("a verification-only ticket can go straight from inProgress to done", () => {
  expect(isTransitionAllowed("inProgress", "done")).toBe(true);
});

test("any active status can escalate to blocked", () => {
  for (const from of ["backlog", "planned", "inProgress", "review", "readyToMerge"] as const) {
    expect(isTransitionAllowed(from, "blocked")).toBe(true);
  }
});

test("triage un-blocks to planned or inProgress, never straight to review/readyToMerge/done", () => {
  expect(isTransitionAllowed("blocked", "planned")).toBe(true);
  expect(isTransitionAllowed("blocked", "inProgress")).toBe(true);
  expect(isTransitionAllowed("blocked", "review")).toBe(false);
  expect(isTransitionAllowed("blocked", "readyToMerge")).toBe(false);
  expect(isTransitionAllowed("blocked", "done")).toBe(false);
});

test("review/readyToMerge can go back to inProgress for a same-PR fixup", () => {
  expect(isTransitionAllowed("review", "inProgress")).toBe(true);
  expect(isTransitionAllowed("readyToMerge", "inProgress")).toBe(true);
});

test("done is terminal", () => {
  for (const to of TICKET_STATUSES) {
    if (to === "done") continue;
    expect(isTransitionAllowed("done", to)).toBe(false);
  }
});

test("a same-status move is always a no-op allowed", () => {
  for (const status of TICKET_STATUSES) {
    expect(isTransitionAllowed(status, status)).toBe(true);
  }
});
