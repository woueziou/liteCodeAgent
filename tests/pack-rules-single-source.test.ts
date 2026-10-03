import { expect, test } from "bun:test";
import { join } from "node:path";
import { delegationHelpers } from "../src/delegation.ts";
import { loadPack } from "../src/packs.ts";

/**
 * Ticket 0088 (seam 2, pack rendering): a duplicated rule keeps ONE source, and a rule is
 * only removed from a text when this table proves the surviving source still states it.
 * Each row: the rule, where it was restated (and must now only point), where it still
 * lives, and distinctive phrases of the surviving source. Losing the phrase fails the row.
 */
const PACKS = join(import.meta.dir, "..", "packs");
const core = await loadPack(PACKS, "core");
const get = (rel: string) => {
  const file = core.files.find((f) => f.rel === rel);
  if (!file) throw new Error(`${rel} not in the core pack`);
  return file.source;
};

const rows: { rule: string; removedFrom: string[]; pointer: string; survivesIn: string; phrases: RegExp[] }[] = [
  {
    rule: "test-first verification protocol and the ticket 0056 rationale",
    removedFrom: ["reference/implementer-test-first.md", "agents/reviewer.md"],
    pointer: "reviewer-test-first",
    survivesIn: "reference/reviewer-test-first.md",
    phrases: [
      /without mutating the worktree you were given/,
      /git worktree add --detach/,
      /ticket 0056 exists because/,
      /not satisfied but non-blocking/,
      /\*\*blocking\*\* `FINDINGS` item/,
    ],
  },
  {
    rule: "batch protocol (limits, one branch/PR, per-ticket status, one review round)",
    removedFrom: ["reference/reviewer-batch.md", "skills/chained-implementation/SKILL.md"],
    pointer: "implementer-batch",
    survivesIn: "reference/implementer-batch.md",
    phrases: [
      /more than 4 tickets or one is not `small`/,
      /One worktree and one branch/,
      /one `Ticket: <NNNN-slug>` line/,
      /One review round/,
      /Move each ticket on its own/,
    ],
  },
];

test.each(rows)("$rule: the surviving source states it and the other texts only point to it", (row) => {
  const source = get(row.survivesIn);
  for (const phrase of row.phrases) expect(source).toMatch(phrase);
  for (const rel of row.removedFrom) expect({ rel, points: get(rel).includes(row.pointer) }).toEqual({ rel, points: true });
});

test("the 0056 rationale appears once across the test-first texts", () => {
  expect(get("reference/implementer-test-first.md")).not.toMatch(/ticket 0056|public history/);
  expect(get("agents/reviewer.md")).not.toMatch(/never ask for a rewrite or force-push/);
  expect(get("reference/reviewer-test-first.md")).toMatch(/PRs #95 and #98/);
});

test("the implementer-side test-first file keeps the push checkpoint", () => {
  const src = get("reference/implementer-test-first.md");
  expect(src).toMatch(/blocking checkpoint, not a reminder/);
  expect(src).toMatch(/before your first `git push` on this branch/);
});

test("reviewer-batch keeps its reviewer-only rules", () => {
  const src = get("reference/reviewer-batch.md");
  expect(src).toMatch(/one `ACCEPTANCE:` block per ticket/);
  expect(src).toMatch(/caps only that ticket/);
  expect(src).toMatch(/Attribute each finding to a ticket id/);
  expect(src).toMatch(/belongs to no listed ticket/);
});

test("chained-implementation does not restate the batch cap", () => {
  const src = get("skills/chained-implementation/SKILL.md");
  expect(src).not.toMatch(/more than 4 tickets/);
  expect(src).toContain("implementer-batch");
});

test("the human-instruction gate of both skills comes from one shared partial", () => {
  const gate = delegationHelpers("claude-code").humanGate;
  expect(gate).toBeDefined();
  const text = gate!("naming a specific ticket");
  expect(text).toMatch(/explicit human instruction naming a specific ticket/);
  expect(text).toMatch(/in the current turn/);
  expect(text).toMatch(/speculatively, on a schedule/);
  for (const rel of ["skills/chained-implementation/SKILL.md", "skills/idea-to-planned/SKILL.md"]) {
    const src = get(rel);
    expect({ rel, partial: src.includes("{{> humanGate") }).toEqual({ rel, partial: true });
    expect({ rel, restated: /originate from an explicit human instruction|must never be invoked speculatively/.test(src) }).toEqual({
      rel,
      restated: false,
    });
  }
  expect(() => delegationHelpers("claude-code").humanGate!("")).toThrow();
});

test("every agent that commits or checks commits states the Agent trailer rule in one line", () => {
  for (const name of ["implementer", "tracker", "triage", "dispatcher"]) {
    expect({ name, ok: get(`agents/${name}.md`).includes(`Agent: ${name}`) }).toEqual({ name, ok: true });
  }
  const implementer = get("agents/implementer.md");
  expect(implementer).toMatch(/every commit[^\n]*`Agent: implementer` trailer/i);
  expect(get("agents/reviewer.md")).toMatch(/\*\*Attribution\*\*[^\n]*`Agent: <agent-name>` trailer/);
  // The skill stays the source for the rare cases.
  const skill = get("skills/agent-attribution/SKILL.md");
  expect(skill).toMatch(/Every commit created by an agent/);
  expect(skill).toMatch(/Mismatch is a stop condition/);
});

test("rules enforced by other guards are not re-tested here", () => {
  // Documented hand-off: verify-report (tests/report-verify.test.ts) checks the implementer's final report
  // against the repo; tests/agents-no-force-rewrite.test.ts and tests/agents-batch.test.ts pin the rest.
  expect(true).toBe(true);
});
