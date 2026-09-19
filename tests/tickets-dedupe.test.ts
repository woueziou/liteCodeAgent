import { expect, test } from "bun:test";
import { findDuplicate, localDedupeCandidates, type DedupeCandidate } from "../src/tickets/dedupe.ts";

test("findDuplicate flags an identical title after normalization", () => {
  const candidates: DedupeCandidate[] = [{ source: "issue", ref: "18", title: "Fix the flaky login test" }];
  const match = findDuplicate("fix the flaky login test", candidates);
  expect(match?.candidate.ref).toBe("18");
  expect(match?.score).toBe(1);
});

test("findDuplicate ignores a conventional-commit prefix and case when normalizing", () => {
  const candidates: DedupeCandidate[] = [{ source: "issue", ref: "18", title: "feat(auth): add password reset flow" }];
  const match = findDuplicate("Feat(auth): Add Password Reset Flow", candidates);
  expect(match?.candidate.ref).toBe("18");
});

test("findDuplicate flags a title whose significant words are a subset of an open issue's", () => {
  // Reproduces the real incident: docs/tickets/0004 and 0005 had no `issue:` field, and
  // their titles overlapped GitHub issues #18/#19 closely enough that `ticket sync --apply`
  // opened duplicate issues #21/#22 instead of being blocked at draft time.
  const candidates: DedupeCandidate[] = [
    { source: "issue", ref: "18", title: "fix(install): pre-flight validate agentSkills config paths" },
    { source: "issue", ref: "19", title: "chore(board): sync ticket buffer status fields" },
  ];
  const match = findDuplicate("pre-flight validate agentSkills config paths before install", candidates);
  expect(match?.candidate.ref).toBe("18");
  expect(match?.reason).toMatch(/subset/);
});

test("findDuplicate does not flag genuinely unrelated titles", () => {
  const candidates: DedupeCandidate[] = [{ source: "issue", ref: "18", title: "Fix the flaky login test" }];
  const match = findDuplicate("Add dark mode to the settings page", candidates);
  expect(match).toBeUndefined();
});

test("findDuplicate picks the single strongest match when several candidates overlap", () => {
  const candidates: DedupeCandidate[] = [
    { source: "local", ref: "0002-x", title: "Improve error logging" },
    { source: "issue", ref: "7", title: "Improve error logging for the traveller agent" },
  ];
  const match = findDuplicate("Improve error logging for the traveller agent", candidates);
  expect(match?.candidate.ref).toBe("7");
});

test("localDedupeCandidates maps local ticket ids/titles into candidates", () => {
  const candidates = localDedupeCandidates([{ id: "0004-foo", title: "Foo thing" }]);
  expect(candidates).toEqual([{ source: "local", ref: "0004-foo", title: "Foo thing" }]);
});
