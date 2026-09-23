import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, TARGETS, type InstallTarget } from "../src/config.ts";
import { buildPlan, type PlanEntry } from "../src/install.ts";
import { delegationHelpers, packAgentNames } from "../src/delegation.ts";
import { listPacks, loadPack } from "../src/packs.ts";
import { referencedPaths, render, TemplateError } from "../src/template.ts";

const ROOT = join(import.meta.dir, "..");
const PACKS = join(ROOT, "packs");

/**
 * ADR 0014: pack prompts name no harness's delegation tool directly — each target gets its
 * own wording from `src/delegation.ts`. Renders every pack file for every target (this
 * repo's own config, all five targets) and checks what each harness would actually read.
 */
let rendered: Promise<PlanEntry[]> | undefined;
let scratch: string | undefined;

/** Rendered once for the whole file: every test reads the same plan. */
function renderAll(): Promise<PlanEntry[]> {
  rendered ??= (async () => {
    const { config } = await loadConfig(ROOT);
    scratch = await mkdtemp(join(tmpdir(), "litecode-render-"));
    const plan = await buildPlan(scratch, PACKS, { ...config, targets: [...TARGETS] });
    return plan.entries;
  })();
  return rendered;
}

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

const byTarget = (entries: PlanEntry[], target: InstallTarget) => entries.filter((e) => e.harness === target);

/**
 * Claude Code's tool named on its own — "via `Agent`", "the Agent tool" — but not the
 * `Agent:` commit trailer or "Assigned Agent".
 */
const CLAUDE_TOOL = /`Agent`|\bAgent tool\b/;

/** Wording that only makes sense on one harness, and must not leak onto the others. */
const FOREIGN: Record<InstallTarget, RegExp[]> = {
  "claude-code": [/`task` tool/, /Codex subagent/],
  codex: [CLAUDE_TOOL, /`task` tool/, /subagent_type/],
  opencode: [CLAUDE_TOOL, /Codex subagent/],
  "kilo-code": [CLAUDE_TOOL, /Codex subagent/, /subagent_type/],
  pi: [CLAUDE_TOOL, /`task` tool/, /Codex subagent/, /subagent_type/],
};

test("no rendered file carries another harness's delegation wording, or an unrendered helper", async () => {
  const entries = await renderAll();
  const leaks: string[] = [];
  for (const target of TARGETS) {
    for (const entry of byTarget(entries, target)) {
      if (entry.content.includes("{{>")) leaks.push(`${target} ${entry.rel}: unrendered helper`);
      for (const pattern of FOREIGN[target]) {
        if (pattern.test(entry.content)) leaks.push(`${target} ${entry.rel}: ${pattern}`);
      }
    }
  }
  expect(leaks).toEqual([]);
});

test("the Agent: commit trailer survives on every target that installs agents", async () => {
  const entries = await renderAll();
  for (const target of ["claude-code", "codex", "opencode", "kilo-code"] as const) {
    const implementer = byTarget(entries, target).find((e) => /implementer\.(md|toml)$/.test(e.rel));
    expect(implementer?.content).toContain("`Agent: implementer`");
  }
});

test("skills delegate with their target's own mechanism, not Claude Code's", async () => {
  const entries = await renderAll();
  const chained = (target: InstallTarget) =>
    byTarget(entries, target).find((e) => e.rel.endsWith("chained-implementation/SKILL.md"))!.content;
  expect(chained("claude-code")).toContain("the `Agent` tool (subagent_type `implementer`)");
  expect(chained("opencode")).toContain("the `task` tool (subagent_type `implementer`)");
  expect(chained("kilo-code")).toContain("the `task` tool, targeting the `implementer` subagent");
  expect(chained("codex")).toContain("spawn the `implementer` custom agent by name");
  expect(chained("pi")).toContain("`litecode run implementer --prompt-file <file>`");
});

test("every native target falls back to the runner when it can't delegate", async () => {
  const entries = await renderAll();
  for (const target of ["claude-code", "codex", "opencode", "kilo-code"] as const) {
    const implementer = byTarget(entries, target).find((e) => /implementer\.(md|toml)$/.test(e.rel))!;
    expect(implementer.content).toContain("litecode run <agent> --prompt-file <file>");
  }
});

test("general-purpose maps to each harness's own built-in worker", () => {
  const worker = (target: Parameters<typeof delegationHelpers>[0]) =>
    render("{{> delegate general-purpose}}", {}, "t", delegationHelpers(target));
  expect(worker("claude-code")).toContain("subagent_type `general-purpose`");
  expect(worker("opencode")).toContain("subagent_type `general`");
  expect(worker("codex")).toContain("default worker");
});

test("a bad helper call fails the render instead of leaving a hole", () => {
  const helpers = delegationHelpers("claude-code");
  expect(() => render("{{> delegate}}", {}, "t", helpers)).toThrow("needs an agent name");
  expect(() => render("{{> delegation extra}}", {}, "t", helpers)).toThrow("takes no argument");
  expect(() => render("{{> nope}}", {}, "t", helpers)).toThrow("unknown helper");
});

test("the runner renders every pack file with its own wording and no leftover helper", async () => {
  const { config } = await loadConfig(ROOT);
  const packs = await Promise.all(
    (await listPacks(PACKS)).filter((n) => config.packs.includes(n)).map(async (name) => ({ name, pack: await loadPack(PACKS, name) })),
  );
  const helpers = delegationHelpers("runner", packAgentNames(packs));
  for (const { name, pack } of packs) {
    for (const file of pack.files) {
      const out = render(file.source, { project: config.project }, `${name}/${file.rel}`, helpers);
      expect(out).not.toContain("{{>");
      expect(out).not.toMatch(/`task` tool|Codex subagent/);
    }
  }
});

test("delegating to an agent no installed pack provides fails the render, naming the file", () => {
  const helpers = delegationHelpers("claude-code", new Set(["reviewer"]));
  expect(render("{{> delegate reviewer}}", {}, "t", helpers)).toContain("`reviewer`");
  expect(render("{{> delegate general-purpose}}", {}, "t", helpers)).toContain("general-purpose");
  expect(() => render("{{> delegate reviewr}}", {}, "agents/x.md", helpers)).toThrow(
    "agents/x.md: {{> delegate reviewr}} names no installed agent",
  );
});

test("inherited object members are not helpers, and malformed calls say so", () => {
  const helpers = delegationHelpers("opencode");
  for (const name of ["toString", "constructor", "hasOwnProperty"]) {
    expect(() => render(`{{> ${name} x}}`, {}, "t", helpers)).toThrow(TemplateError);
    expect(() => render(`{{> ${name} x}}`, {}, "t", helpers)).toThrow("unknown helper");
  }
  expect(() => render("{{> 9x}}", {}, "t", helpers)).toThrow("malformed helper call");
});

test("helper calls are never reported as required config paths", () => {
  expect(referencedPaths("{{> delegate reviewer}} {{>delegation}} {{ > delegate x }}")).toEqual([]);
  expect(referencedPaths("{{#each project.xs}}{{> delegate reviewer}} {{ name }}{{/each}}")).toEqual(["project.xs"]);
  expect(referencedPaths("{{#if project.language}}{{> delegation}}{{/if}}")).toEqual(["project.language"]);
});
