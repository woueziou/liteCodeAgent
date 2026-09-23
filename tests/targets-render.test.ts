import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, TARGETS, type InstallTarget } from "../src/config.ts";
import { buildPlan, type PlanEntry } from "../src/install.ts";
import { delegationHelpers } from "../src/delegation.ts";
import { render } from "../src/template.ts";

const ROOT = join(import.meta.dir, "..");
const PACKS = join(ROOT, "packs");

/**
 * ADR 0014: pack prompts name no harness's delegation tool directly — each target gets its
 * own wording from `src/delegation.ts`. Renders every pack file for every target (this
 * repo's own config, all five targets) and checks what each harness would actually read.
 */
async function renderAll(): Promise<PlanEntry[]> {
  const { config } = await loadConfig(ROOT);
  const all = { ...config, targets: [...TARGETS] };
  const plan = await buildPlan(await mkdtemp(join(tmpdir(), "litecode-render-")), PACKS, all);
  return plan.entries;
}

const byTarget = (entries: PlanEntry[], target: InstallTarget) => entries.filter((e) => e.harness === target);

/** Claude Code's tool named on its own, e.g. "via `Agent`" — but not the `Agent:` trailer. */
const CLAUDE_TOOL = /`Agent`/;

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
