import { expect, test } from "bun:test";
import { join } from "node:path";
import { ProjectSchema } from "../src/config.ts";
import { delegationHelpers, packInlineSources } from "../src/delegation.ts";
import { loadPack } from "../src/packs.ts";
import { render, templateProject } from "../src/template.ts";

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

const helpers = delegationHelpers("claude-code", undefined, {}, undefined, packInlineSources([{ pack: core }]));
const project = templateProject(ProjectSchema.parse({ name: "demo", repo: "owner/demo", agentSkills: { implementer: [], reviewer: [] } }));
const rendered = (rel: string) => render(get(rel), { project }, rel, helpers);

/** `expect(actual).toBe(expected)` that names the file or agent in the failure message. */
const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });

type Row = { rule: string; removedFrom: string[]; pointer: string; survivesIn: string; phrases: RegExp[] };

const rows: Row[] = [
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
      /whole file fails to load at the pre-fix code/,
      /If the branch has \*\*not\*\* been pushed yet/,
      /same-PR fix-up commit adding the coverage, never a history rewrite/,
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
      /`Agent: implementer` and `Task:` trailers/,
    ],
  },
  {
    rule: "reviewer-only batch rules",
    removedFrom: [],
    pointer: "",
    survivesIn: "reference/reviewer-batch.md",
    phrases: [
      /one `ACCEPTANCE:` block per ticket/,
      /caps only that ticket/,
      /Attribute each finding to a ticket id/,
      /Flag a commit or hunk that belongs to no listed ticket/,
    ],
  },
];

test.each(rows)("$rule: the surviving source states it and the other texts only point to it", (row) => {
  const source = get(row.survivesIn);
  for (const phrase of row.phrases) is(`${row.survivesIn} ~ ${phrase}`, phrase.test(source), true);
  for (const rel of row.removedFrom) is(`${rel} points to ${row.pointer}`, get(rel).includes(row.pointer), true);
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

test("chained-implementation gives the batch cap only as a pointer, and keeps its human-gate claim with its constraint", () => {
  const src = get("skills/chained-implementation/SKILL.md");
  expect(src).not.toMatch(/more than 4 tickets/);
  expect(src).toContain("implementer-batch");
  expect(src).toMatch(/not human oversight: it still requires an explicit human instruction/);
});

test("both gated skills render the shared human gate, and the partial refuses an empty argument", () => {
  for (const rel of ["skills/chained-implementation/SKILL.md", "skills/idea-to-planned/SKILL.md"]) {
    is(`${rel} uses the partial`, get(rel).includes("{{> humanGate"), true);
    const out = rendered(rel);
    for (const phrase of ["in the current turn", "never runs speculatively", "does not scan for work", "does not run periodically"]) {
      is(`${rel} renders '${phrase}'`, out.includes(phrase), true);
    }
  }
  expect(rendered("skills/chained-implementation/SKILL.md")).toContain("explicit human instruction naming a specific ticket");
  expect(rendered("skills/idea-to-planned/SKILL.md")).toContain("explicit human instruction that includes the idea itself");
  expect(() => helpers.humanGate?.("")).toThrow("needs a phrase");
});

test("the trailer rule keeps both lines, Agent and Task, wherever an agent commits or checks commits", () => {
  expect(rendered("agents/implementer.md")).toContain("`Agent: implementer` and `Task: <ticket id>`");
  expect(rendered("agents/reviewer.md")).toContain("`Agent: <agent-name>` and `Task: <ticket id>`");
  for (const name of ["implementer", "tracker", "triage", "dispatcher"]) {
    is(`${name} commit command`, get(`agents/${name}.md`).includes(`-m "Agent: ${name}" -m "Task: <NNNN>"`), true);
  }
  // The skill stays the source for the rare cases.
  const skill = get("skills/agent-attribution/SKILL.md");
  expect(skill).toMatch(/^Agent: <agent-name>\nTask: /m);
  expect(skill).toMatch(/Mismatch is a stop condition/);
});
