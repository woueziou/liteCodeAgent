import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { buildPlan } from "../src/install.ts";
import { parseJournal } from "../src/report/journal.ts";

/**
 * Ticket 0081, review fixes (ADR 0027): what the handoff text must say once it is on, checked
 * on the rendered claude-code files. The default render must keep the in-line wording.
 */
const PACKS = join(import.meta.dir, "..", "packs");
const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

async function render(project: Record<string, unknown>): Promise<Map<string, string>> {
  const raw = await Bun.file(EXAMPLE).json();
  const config = ConfigSchema.parse({ ...raw, targets: ["claude-code"], target: "claude-code", project: { ...raw.project, ...project } });
  const root = await mkdtemp(join(tmpdir(), "litecode-closer-defects-"));
  dirs.push(root);
  await Bun.write(join(root, ".claude", "skills", "orpc-expert", "SKILL.md"), "---\nname: orpc-expert\n---\n");
  const entries = (await buildPlan(root, PACKS, config)).entries;
  return new Map(entries.map((e) => [e.rel.replace(/^\.claude\//, ""), e.content]));
}

const on = await render({ handoff: "auto", handoffSupport: { "claude-code": true } });
const off = await render({});
const file = (rel: string, from = on) => {
  const text = from.get(rel);
  if (text === undefined) throw new Error(`${rel} was not rendered`);
  return text;
};
const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start);
  if (from === -1) throw new Error(`no "${start}"`);
  const to = text.indexOf(end, from + start.length);
  return text.slice(from, to === -1 ? undefined : to);
};

const closer = file("agents/closer.md");
const handoff = file("reference/implementer-closer-handoff.md");
const outcome = file("reference/implementer-closer-outcome.md");

// --- 1. single pass reaches readyToMerge -------------------------------------------------

test("a single pass can reach readyToMerge: the closer drops the bug-hunter condition", () => {
  const step4 = between(closer, "\n4. ", "\n5. ");
  expect(step4).toContain("A single pass has no `bug-hunter`: that condition drops, `reviewer` covered the bug hunt");
  expect(closer).toContain("not run (single pass)");
});

test("the enabled implementer no longer points the single pass at a step 10 it does not have", () => {
  const flow = between(file("agents/implementer.md"), "## Review flow by size", "\n## ");
  expect(flow).not.toMatch(/step 10/i);
  expect(flow).toContain("the closer's status rule");
  expect(between(file("agents/implementer.md", off), "## Review flow by size", "\n## ")).toContain("step 10's `bug-hunter` condition drops");
});

// --- 2. the fix loop is conditional ------------------------------------------------------

test("the move to inProgress happens only from review; a ci-red stop leaves the status unchanged", () => {
  expect(handoff).toMatch(/Read the ticket's `status` first/);
  expect(handoff).toMatch(/only if it is `review`/);
  expect(handoff).toContain("`TICKET_STATUS: unchanged`");
  expect(handoff).toMatch(/two relaunches/);
  expect(closer).toMatch(/`TICKET_STATUS: unchanged` whenever you stop before step 4/);
});

// --- 3. no dangling step numbers; the counters have one definition -----------------------

const DANGLING = /\bsteps? (8|9|10)\b|\bsteps? 8 to 10\b/i;
const REFERENCES = [
  "implementer-rehunt",
  "implementer-review-disputes",
  "implementer-github-outage",
  "implementer-stacked-pr",
  "implementer-review-handoff",
  "implementer-resume",
  "implementer-ci-red",
  "implementer-verification-only",
];

test.each(REFERENCES)("%s: no step 8/9/10 wording in the enabled render; the default render keeps it", (name) => {
  const rel = `reference/${name}.md`;
  expect(file(rel)).not.toMatch(DANGLING);
  expect(file(rel, off)).toMatch(DANGLING);
});

test("the re-hunt and attempt counters are defined once, in the outcome reference, from the base rules", () => {
  const counters = between(outcome, "## Counters", "\n## ");
  for (const phrase of ["`rehunts_used`", "`attempt`", "One re-hunt per run", "a second blocking finding", "second `reviewer` pass"]) expect(counters).toContain(phrase);
  expect(closer).toContain("`rehunts_used`");
  expect(file("reference/implementer-rehunt.md")).toContain("`rehunts_used`");
});

test("after a dispute the implementer, not the closer, moves review to readyToMerge", () => {
  const disputes = file("reference/implementer-review-disputes.md");
  expect(disputes).toMatch(/you move the ticket `review` to `readyToMerge`/);
  expect(disputes).toMatch(/closer is not relaunched/);
});

// --- 4. the journal ----------------------------------------------------------------------

test("the journal reference carries a full handoff block that parseJournal reads back", () => {
  const journal = file("reference/implementer-progress-journal.md");
  const flat = journal.split("\n").map((l) => l.replace(/^ {2}/, "")).join("\n");
  const block = /```progress-journal\nstep: step 8: closer in flight[\s\S]*?```/.exec(flat);
  expect(block).not.toBeNull();
  const { entries, warnings } = parseJournal(block![0]);
  expect(warnings).toEqual([]);
  const last = entries.at(-1)!;
  for (const field of ["step", "worktree", "branch", "pr", "handoff", "handoffAt"] as const) expect(last[field]).toBeDefined();
  expect(last.handoff).toBe("closer in flight");
  expect(file("reference/implementer-progress-journal.md", off)).not.toContain("handoffAt");
});

test("the handoff reference says the implementer writes `returned`, also when the closer fails", () => {
  expect(handoff).toMatch(/errors out or ends without its result block/);
  expect(handoff).toMatch(/`handoff: returned`[^.]*failure/);
});

test("the contract spec says the implementer writes `returned`, not the closer", async () => {
  const spec = await Bun.file(join(import.meta.dir, "..", "docs", "specs", "closer-handoff-contract.md")).text();
  expect(spec).not.toMatch(/the closer writes\s+`returned`/);
  expect(spec).toMatch(/`implementer` writes `closer in flight` before spawning the closer and `returned`/);
});

// --- 5. the report mapping ---------------------------------------------------------------

test("the report mapping covers every report field and every NEEDS value", () => {
  const mapping = between(outcome, "## The final report", "\n## ");
  for (const field of ["STATUS", "TICKET", "BRANCH", "PR", "BLOCKER", "CI", "CHECK_OUTPUT", "TOKENS"]) expect(mapping).toContain(`\`${field}\``);
  for (const needs of ["none", "code-fix:ci-red", "code-fix:review", "conflict", "github-unavailable", "nesting-unavailable"]) expect(mapping).toContain(`\`${needs}\``);
  expect(mapping).toMatch(/`pr-opened-for-review` only with a ticket in `review` or `readyToMerge`/);
  expect(mapping).toContain("`in-progress-blocked`");
});

// --- 6. what is verified and what is not -------------------------------------------------

test("the handoff reference says how far nesting is verified, and how to start the closer", () => {
  const note = between(handoff, "Subagent nesting", "\n");
  expect(note).toContain("depth 3");
  expect(note).toContain("verified only by the measurement of ADR 0027");
  expect(note).toContain("capability table stays empty");
  // The first real run failed because the closer was started in the foreground: say how not to.
  const start = between(handoff, "## Starting it", "## Before delegating");
  expect(start).toContain("never pass `run_in_background: false`");
  expect(start).toContain("not the result block");
});

test("the closer retries before calling CI missing", () => {
  expect(closer).toMatch(/if none is reported yet, retry every 15 seconds for up to two minutes/);
});
