import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, TARGETS, type InstallTarget } from "../src/config.ts";
import { delegationHelpers, packInlineSources } from "../src/delegation.ts";
import { buildPlan, type PlanEntry } from "../src/install.ts";
import { countWords, loadBaselineConfig, measurePackSizes } from "../src/pack-sizes.ts";
import { loadPack } from "../src/packs.ts";
import { AgentCatalog } from "../src/runner/catalog.ts";
import { render } from "../src/template.ts";

/**
 * Ticket 0081 part B, ADR 0027 (seam 2, pack rendering): the `closer` agent and the handoff text.
 * Off by default: nothing about it may reach an install that did not turn the handoff on.
 */
const PACKS = join(import.meta.dir, "..", "packs");
const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
const tempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "litecode-closer-"));
  dirs.push(dir);
  return dir;
};

const core = await loadPack(PACKS, "core");
const source = (rel: string) => {
  const file = core.files.find((f) => f.rel === rel);
  if (!file) throw new Error(`${rel} not in the core pack`);
  return file.source;
};

async function plan(project: Record<string, unknown>, targets: InstallTarget[] = [...TARGETS]): Promise<PlanEntry[]> {
  const raw = await Bun.file(EXAMPLE).json();
  const config = ConfigSchema.parse({ ...raw, targets, target: targets[0], project: { ...raw.project, ...project } });
  const root = await tempDir();
  await Bun.write(join(root, ".claude", "skills", "orpc-expert", "SKILL.md"), "---\nname: orpc-expert\n---\n");
  return (await buildPlan(root, PACKS, config)).entries;
}

const isHandoffFile = (rel: string) => /(^|\/)(closer\.(md|toml)|implementer-closer-handoff\.md|implementer-inline-tail\.md)$/.test(rel);
const enabledFor = (...targets: InstallTarget[]) => ({ handoff: "auto", handoffSupport: Object.fromEntries(targets.map((t) => [t, true])) });

// --- the inline helper -------------------------------------------------------------------

test("{{> inline name}} renders a reference body in place, in the caller's context and helpers", () => {
  const helpers = delegationHelpers("codex", new Set(["reviewer"]), {}, undefined, new Map([["x", "Ask {{> delegate reviewer}} about {{ project.repo }}.\n{{#if handoff}}\nON\n{{/if}}"]]));
  const out = render("A\n{{> inline x}}\nB", { project: { repo: "o/r" }, handoff: true }, "t", helpers);
  expect(out).toBe("A\nAsk a Codex subagent — spawn the `reviewer` custom agent by name and wait for its result about o/r.\nON\n\nB");
  expect(() => render("{{> inline nope}}", {}, "t", helpers)).toThrow(/names no pack reference file/);
  const nested = delegationHelpers("codex", undefined, {}, undefined, new Map([["a", "{{> inline b}}"], ["b", "x"]]));
  expect(() => render("{{> inline a}}", {}, "t", nested)).toThrow(/cannot inline another/);
});

test("packInlineSources keys every reference by name, frontmatter and outer blank lines dropped", () => {
  const sources = packInlineSources([{ pack: core }]);
  const tail = sources.get("implementer-inline-tail")!;
  expect(tail.startsWith("8. Invoke **both** review passes")).toBe(true);
  expect(tail.endsWith("on `Review` the full `FINDINGS`/`REENTRY`).")).toBe(true);
  expect(tail).not.toContain("name: implementer-inline-tail");
});

// --- default config: nothing changes -----------------------------------------------------

test("default config: no closer, no handoff reference, no handoff text, on any target", async () => {
  const entries = await plan({});
  expect(entries.filter((e) => isHandoffFile(e.rel))).toEqual([]);
  expect(entries.some((e) => /^install: /m.test(e.content))).toBe(false);
  for (const e of entries.filter((x) => /implementer\.(md|toml)$/.test(x.rel))) {
    expect(e.content).not.toMatch(/\bcloser\b|NEEDS:|closer-handoff/i);
    // the in-line steps 8 to 10 render in place, from their single source
    expect(e.content).toContain("8. Invoke **both** review passes");
    expect(e.content).toContain("10. Move the ticket with");
  }
});

test("with handoff auto but no target in the table, the plan is the default plan", async () => {
  const dflt = await plan({});
  const auto = await plan({ handoff: "auto" });
  expect(auto.map((e) => [e.rel, e.content])).toEqual(dflt.map((e) => [e.rel, e.content]));
});

test("the default render of steps 8 to 10 is the in-line text, followed by Output economy", async () => {
  const entries = await plan({}, ["claude-code"]);
  const implementer = entries.find((e) => e.rel === ".claude/agents/implementer.md")!.content;
  const tail = render(packInlineSources([{ pack: core }]).get("implementer-inline-tail")!, {}, "t", delegationHelpers("claude-code", undefined, {}));
  expect(implementer).toContain(`${tail}\n\n## Output economy`);
});

test("the runner catalog has no closer by default", async () => {
  const raw = await Bun.file(EXAMPLE).json();
  const catalog = await AgentCatalog.load(await tempDir(), PACKS, ConfigSchema.parse(raw));
  expect(catalog.agentNames()).not.toContain("closer");
});

// --- enabled for one target --------------------------------------------------------------

test("enabled for claude-code only: the closer and its two references are installed there, nowhere else", async () => {
  const entries = await plan({ ...enabledFor("claude-code") });
  expect(entries.filter((e) => isHandoffFile(e.rel)).map((e) => e.rel).sort()).toEqual([
    ".claude/agents/closer.md",
    ".claude/reference/implementer-closer-handoff.md",
    ".claude/reference/implementer-inline-tail.md",
  ]);
  expect(entries.some((e) => /^install: /m.test(e.content))).toBe(false);
  const claude = entries.find((e) => e.rel === ".claude/agents/implementer.md")!.content;
  expect(claude).toContain("`closer`");
  expect(claude).toContain("`.claude/reference/implementer-closer-handoff.md`");
  expect(claude).toContain("`.claude/reference/implementer-inline-tail.md`");
  expect(claude).not.toContain("8. Invoke **both** review passes");
  expect(claude).not.toContain("{{");
  // every other target, and every other agent, is what it is by default
  const dflt = await plan({});
  const rest = (list: PlanEntry[]) => list.filter((e) => e.rel !== ".claude/agents/implementer.md" && !isHandoffFile(e.rel)).map((e) => [e.rel, e.content]);
  expect(rest(entries)).toEqual(rest(dflt));
  for (const e of entries.filter((x) => /implementer\.(md|toml)$/.test(x.rel) && x.harness !== "claude-code")) expect(e.content).not.toMatch(/closer/);
});

test("the closer's frontmatter declares the fast tier and the tools Bash, Read, Write, Agent", async () => {
  const entries = await plan({ ...enabledFor("claude-code") }, ["claude-code"]);
  const closer = entries.find((e) => e.rel === ".claude/agents/closer.md")!.content;
  expect(closer).toMatch(/^---\nname: closer\n/);
  expect(closer).toMatch(/\ntier: fast\n|\nmodel: haiku\n/);
  expect(closer).toMatch(/\ntools: Bash, Read, Write, Agent\n/);
});

// --- enabled for each target in turn -----------------------------------------------------

const OWN_WORDING: Record<string, RegExp> = {
  "claude-code": /the `Agent` tool \(subagent_type `reviewer`\)/,
  opencode: /the `task` tool \(subagent_type `reviewer`\)/,
  "kilo-code": /the `task` tool, targeting the `reviewer` subagent/,
  codex: /spawn the `reviewer` custom agent by name/,
};
const AGENT_PATH: Record<string, string> = {
  "claude-code": ".claude/agents/closer.md",
  opencode: ".opencode/agents/closer.md",
  "kilo-code": ".kilo/agents/closer.md",
  codex: ".codex/agents/closer.toml",
};

test.each(Object.keys(OWN_WORDING))("enabled for %s: the closer renders that target's own delegation wording and no other's", async (target) => {
  const entries = await plan({ ...enabledFor(target as InstallTarget) }, [target as InstallTarget]);
  const closer = entries.find((e) => e.rel === AGENT_PATH[target])!.content;
  expect(closer).toMatch(OWN_WORDING[target]!);
  expect(closer).toContain("bug-hunter");
  expect(closer).not.toMatch(/\{\{|\}\}/);
  for (const [other, wording] of Object.entries(OWN_WORDING)) if (other !== target) expect(closer).not.toMatch(wording);
  // the tier helper: a per-call model only where the target has one
  if (target === "claude-code") expect(closer).toContain('pass `model: "haiku"` on that call');
  else expect(closer).toContain("cannot choose a model per call");
  expect(closer).toContain("--project <primary-checkout>");
});

test("enabled for pi: no native agent file, and the implementer keeps the in-line steps", async () => {
  const entries = await plan({ ...enabledFor("pi") }, ["pi"]);
  expect(entries.filter((e) => /closer\./.test(e.rel))).toEqual([]);
});

test("enabled for the runner: the catalog carries the closer, worded for the runner", async () => {
  const raw = await Bun.file(EXAMPLE).json();
  const config = ConfigSchema.parse({ ...raw, project: { ...raw.project, handoff: "auto", handoffSupport: { runner: true } } });
  const catalog = await AgentCatalog.load(await tempDir(), PACKS, config);
  const closer = catalog.agent("closer");
  expect(closer.tier).toBe("fast");
  expect(closer.tools).toEqual(["Bash", "Read", "Write", "Agent"]);
  expect(closer.prompt).toContain("the `Agent` tool (subagent_type `reviewer`)");
  expect(closer.prompt).not.toMatch(/\{\{|`task` tool|Codex subagent/);
});

// --- pins: the surviving sources keep the contract ---------------------------------------

test("the closer states the brief fields of Decision 2", () => {
  const closer = source("agents/closer.md");
  for (const field of [
    "ticket id and file path",
    "`size` and label",
    "branch, base, PR number and URL",
    "the worktree path",
    "the primary checkout's absolute path",
    "the head commit",
    "`CHECK_OUTPUT`",
    "the expected CI test check(s)",
    "the attempt number",
    "the verdicts and counters of earlier attempts (re-hunts used)",
  ]) expect(closer).toContain(field);
  // the same fields are what the implementer is told to send
  const ref = source("reference/implementer-closer-handoff.md");
  for (const field of ["ticket id and file path", "`size` and label", "PR number and URL", "primary checkout's absolute path", "head commit", "`CHECK_OUTPUT`", "attempt number", "re-hunts used"]) {
    expect(ref).toContain(field);
  }
});

test("the closer returns the block of Decision 4, with its NEEDS values", () => {
  const closer = source("agents/closer.md");
  const block = closer.slice(closer.indexOf("## Output"));
  for (const key of ["VERDICTS", "CI", "POSTED", "TICKET_STATUS", "NEEDS", "EVIDENCE", "TOKENS"]) expect(block).toMatch(new RegExp(`^${key}: <`, "m"));
  expect(block).toContain("<none | code-fix:ci-red | code-fix:review | conflict | github-unavailable | nesting-unavailable>");
  expect(closer).toContain("`NEEDS: nesting-unavailable`");
  expect(closer).toMatch(/Return one result block and nothing else/);
});

test("the closer never writes to the worktree or the primary checkout, never fixes code or rewrites history", () => {
  const closer = source("agents/closer.md");
  expect(closer).toMatch(/Never write a file in the worktree or the primary checkout/);
  expect(closer).toMatch(/only writes are PR comments and `ticket move`\/`ticket note` with `--project <primary-checkout>`/);
  expect(closer).toMatch(/Never fix code, never rewrite history/);
  expect(closer).toContain("{{> delegation}}");
});

test("the closer decides the status with the conditions of step 10, and the CI wait is bounded", () => {
  const closer = source("agents/closer.md");
  const tail = source("reference/implementer-inline-tail.md");
  for (const phrase of [
    "`approve-with-notes` with no blocking finding unresolved",
    "`HUNT: complete` with no blocking finding unresolved",
    "CI is green (pass, or none configured; never pending or failing)",
    "the expected test check(s) run and passed",
    "there are no merge conflicts",
  ]) expect(closer).toContain(phrase);
  expect(tail).toContain("`approve-with-notes` with no blocking finding unresolved");
  expect(closer).toContain("`gh pr checks <pr> --watch`, bounded");
  expect(closer).toContain("{{> delegate reviewer}}");
  expect(closer).toContain("{{> delegate bug-hunter}}");
  expect(closer).toContain("{{> delegateTier balanced}}");
});

test("the handoff reference pins the journal markers, the relaunch limit, the fix loop and the fallback", () => {
  const ref = source("reference/implementer-closer-handoff.md");
  expect(ref).toContain("`handoff: closer in flight`");
  expect(ref).toContain("`handoffAt: <now, ISO 8601 UTC>`");
  expect(ref).toMatch(/\*\*before\*\* you start `closer`/);
  expect(ref).toContain("`handoff: returned`");
  expect(ref).toMatch(/At most \*\*two relaunches\*\*/);
  expect(ref).toMatch(/attempt number plus one/);
  expect(ref).toMatch(/Move the ticket `review` to `inProgress` \*\*before\*\* touching code/);
  expect(ref).toContain("`TOKENS` is yours plus the closer's");
  expect(ref).toMatch(/`NEEDS: nesting-unavailable`: do the tail yourself, exactly as in-line/);
  for (const needs of ["code-fix:ci-red", "code-fix:review", "conflict", "github-unavailable", "none"]) expect(ref).toContain(needs);
});

test("implementer.md carries the handoff only behind the flag, and the step text exists once", () => {
  const implementer = source("agents/implementer.md");
  const flagged = [...implementer.matchAll(/\{\{#if handoff\}\}([\s\S]*?)\{\{\/if\}\}/g)].map((m) => m[1]);
  expect(flagged).toHaveLength(1);
  expect(flagged[0]).toContain("{{> delegate closer}}");
  expect(flagged[0]).toContain("{{> reference implementer-closer-handoff}}");
  expect(flagged[0]).toContain("{{> reference implementer-inline-tail}}");
  expect(implementer.replace(flagged[0]!, "")).not.toMatch(/closer/);
  expect(implementer).toContain("{{> inline implementer-inline-tail}}");
  expect(implementer).not.toContain("Invoke **both** review passes");
  expect(source("reference/implementer-inline-tail.md")).toContain("Invoke **both** review passes");
});

test("every file only the handoff uses is marked, and the closer's description fits", () => {
  for (const rel of ["agents/closer.md", "reference/implementer-closer-handoff.md", "reference/implementer-inline-tail.md"]) {
    expect(source(rel).split("\n---\n")[0]).toMatch(/^install: handoff$/m);
  }
  const description = /^description: (.*)$/m.exec(source("agents/closer.md"))![1]!;
  expect(countWords(description)).toBeLessThanOrEqual(20);
  expect(description).toMatch(/Called by implementer/);
});

// --- budgets -----------------------------------------------------------------------------

test("the size report covers the files only the handoff installs", async () => {
  const sizes = await measurePackSizes(PACKS, await loadBaselineConfig());
  for (const rel of ["agents/closer.md", "reference/implementer-closer-handoff.md", "reference/implementer-inline-tail.md"]) {
    expect(sizes[`core/${rel}`]?.rendered).toBeGreaterThan(0);
  }
});
