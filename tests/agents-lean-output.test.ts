import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { buildPlan } from "../src/install.ts";
import { loadPack } from "../src/packs.ts";

/** Ticket 0064: lean tool output, capped final report, single review pass, lighter reviewer.md. */
const PACKS = join(import.meta.dir, "..", "packs");
const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");
const MAX_REVIEWER_WORDS = 1500;

async function core() {
  const pack = await loadPack(PACKS, "core");
  return (rel: string) => {
    const file = pack.files.find((f) => f.rel === rel);
    if (!file) throw new Error(`${rel} not found in core pack`);
    return file.source;
  };
}
const body = (source: string) => source.split("\n---\n").slice(1).join("\n---\n");
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

test("implementer: targeted tests while working, full suite once before the push, filtered output", async () => {
  const src = (await core())("agents/implementer.md");
  expect(src).toMatch(/only the targeted tests/);
  expect(src).toMatch(/full suite[^\n]*once, before the push/);
  expect(src).toMatch(/## Output economy/);
  expect(src).toMatch(/`--jq`/);
  expect(src).toMatch(/`git diff --stat` before any full diff/);
});

test("implementer: final report is the STATUS block plus at most 10 lines, verify-report fields unchanged", async () => {
  const src = (await core())("agents/implementer.md");
  expect(src).toMatch(/at most 10 lines of context/);
  for (const key of ["STATUS", "TICKET", "BRANCH", "PR", "BLOCKER", "CI", "CHECK_OUTPUT", "TOKENS"]) {
    expect(src).toMatch(new RegExp(`^${key}: <`, "m"));
  }
});

test("implementer: chore/doc without src changes and small without logic get one fast reviewer pass and no bug-hunter", async () => {
  const src = (await core())("agents/implementer.md");
  expect(src).toMatch(/\*\*Single pass\*\*[^\n]*`chore`\/`doc`[^\n]*nothing under `src\/`/);
  expect(src).toMatch(/\*\*Single pass\*\*[^\n]*`small` ticket with no logic change/);
  expect(src).toMatch(/\*\*Single pass\*\*[^\n]*`fast` tier/);
  expect(src).toMatch(/\*\*Single pass\*\*[^\n]*No `bug-hunter`/);
  expect(src).toContain("{{> delegateTier fast}}");
});

test("reviewer.md stays within the word budget; rare cases are reference files, not registered skills", async () => {
  const get = await core();
  const src = get("agents/reviewer.md");
  expect(words(body(src))).toBeLessThanOrEqual(MAX_REVIEWER_WORDS);
  const pack = await loadPack(PACKS, "core");
  const refs = ["reviewer-acceptance-edge-cases", "reviewer-single-pass", "reviewer-test-first", "implementer-test-first", "implementer-ticket-commits"];
  const shipped = pack.files.map((f) => /^reference\/([a-z-]+)\.md$/.exec(f.rel)?.[1]).filter((n): n is string => !!n).sort();
  expect(shipped).toEqual([...refs].sort());
  for (const name of refs) {
    expect(pack.files.some((f) => f.rel === `skills/${name}/SKILL.md`)).toBe(false);
    const referrer = get(name.startsWith("reviewer") ? "agents/reviewer.md" : "agents/implementer.md");
    expect(referrer).toContain(`reference/${name}.md`);
  }
});

test("rules moved out of reviewer.md are readable in their reference file", async () => {
  const get = await core();
  expect(get("reference/reviewer-test-first.md")).toMatch(/ticket 0056/);
  expect(get("reference/reviewer-test-first.md")).toMatch(/throwaway worktree/);
  expect(get("reference/reviewer-acceptance-edge-cases.md")).toMatch(/no ticket path given/);
  expect(get("reference/reviewer-acceptance-edge-cases.md")).toMatch(/Present but empty/);
  expect(get("reference/reviewer-single-pass.md")).toMatch(/failure scenario/);
  expect(get("agents/reviewer.md")).toMatch(/\*\*Never\*\* propose a remedy that requires rewriting, squashing, or force-pushing/);
});

test("reference files install next to the agents on every target that has agents, without registering as skills", async () => {
  const config = ConfigSchema.parse(await Bun.file(EXAMPLE).json());
  const root = await mkdtemp(join(tmpdir(), "litecode-"));
  await Bun.write(join(root, ".claude", "skills", "orpc-expert", "SKILL.md"), "---\nname: orpc-expert\n---\n");
  const plan = await buildPlan(root, PACKS, config);
  const rels = plan.entries.map((e) => e.rel).filter((r) => r.includes("reviewer-test-first"));
  expect(rels.length).toBeGreaterThan(0);
  for (const r of rels) expect(r).toMatch(/reference\/reviewer-test-first\.md$/);
  for (const e of plan.entries.filter((e) => e.rel.includes("/reference/"))) expect(e.content).not.toContain("{{");
});

test("implementer's hard rules and steps agree with the single pass: no unconditional both-reports rule", async () => {
  const src = (await core())("agents/implementer.md");
  expect(src).not.toMatch(/reviewer` and `bug-hunter` calls first/);
  expect(src).not.toMatch(/receiving both reports/);
  expect(src).not.toMatch(/Neither pass is optional;/);
  expect(src).toMatch(/except a single pass/);
  expect((await core())("agents/reviewer.md")).toMatch(/unless you were told this is a single pass/);
});
