import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { buildPlan, applyPlan } from "../src/install.ts";
import { readLockfile } from "../src/lockfile.ts";

const PACKS = join(import.meta.dir, "..", "packs");
const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");

async function exampleConfig() {
  return ConfigSchema.parse(await Bun.file(EXAMPLE).json());
}

/**
 * A target repo as it really is: the example config references `orpc-expert`, which is
 * deliberately a local overlay rather than a pack skill.
 */
async function targetRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litecode-"));
  await Bun.write(join(root, ".claude", "skills", "orpc-expert", "SKILL.md"), "---\nname: orpc-expert\n---\n");
  return root;
}

test("the shipped example config is valid", async () => {
  await expect(exampleConfig()).resolves.toBeDefined();
});

test("a full render produces no unresolved template syntax", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  const plan = await buildPlan(root, PACKS, config);
  expect(plan.entries.length).toBeGreaterThan(20);
  for (const entry of plan.entries) {
    expect(`${entry.rel}:${entry.content.includes("{{")}`).toBe(`${entry.rel}:false`);
    expect(entry.status).toBe("create");
  }
});

test("install writes a lockfile that owns only what it rendered", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  const plan = await buildPlan(root, PACKS, config);
  await applyPlan(root, plan, "0.0.0-test", { force: false });

  const lock = await readLockfile(root);
  expect(lock).not.toBeNull();
  expect(Object.keys(lock!.files).length).toBe(plan.entries.length);
  expect(lock!.packs).toEqual({ core: "0.3.0", web: "0.1.0" });

  // A file the project owns is invisible to the kit.
  const second = await buildPlan(root, PACKS, config);
  expect(second.orphans).toEqual([]);
  expect(second.entries.every((e) => e.status === "unchanged")).toBe(true);
});

test("a hand-edited managed file is reported as drift and never silently overwritten", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  await applyPlan(root, await buildPlan(root, PACKS, config), "0.0.0-test", { force: false });

  const victim = join(root, ".claude", "agents", "planner.md");
  await Bun.write(victim, `${await Bun.file(victim).text()}\n<!-- local tweak -->\n`);

  const plan = await buildPlan(root, PACKS, config);
  expect(plan.entries.find((e) => e.rel.endsWith("planner.md"))!.status).toBe("drift");
  await expect(applyPlan(root, plan, "0.0.0-test", { force: false })).rejects.toThrow(/hand/);
  await applyPlan(root, plan, "0.0.0-test", { force: true });
  expect(await Bun.file(victim).text()).not.toContain("local tweak");
});

test("a skill reference that resolves to nothing fails the install", async () => {
  const config = await exampleConfig();
  config.project.agentSkills.planner = ["typescript-expert", "nonexistent-expert"];
  await expect(buildPlan(await targetRepo(), PACKS, config)).rejects.toThrow(/nonexistent-expert/);
});

test("a skill provided only as a local overlay is accepted", async () => {
  const config = await exampleConfig();
  // `orpc-expert` deliberately lives in the project, not in a pack.
  await expect(buildPlan(await targetRepo(), PACKS, config)).resolves.toBeDefined();
});

test("a config missing an agentSkills key a pack requires fails pre-flight with an actionable error, not a raw TemplateError", async () => {
  const config = await exampleConfig();
  delete (config.project.agentSkills as Record<string, string[]>).sync;
  const error = await buildPlan(await targetRepo(), PACKS, config).catch((e) => e);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).not.toMatch(/is not defined in the project config/);
  expect(error.message).toMatch(/project\.agentSkills\.sync/);
  expect(error.message).toMatch(/agents\/sync\.md/);
  expect(error.message).toMatch(/config doctor --fix/);
});

test("a typo'd agentSkills key does not mask the real missing key", async () => {
  const config = await exampleConfig();
  const skills = config.project.agentSkills as Record<string, string[]>;
  skills.agentSkils = skills.sync ?? [];
  delete skills.sync;
  await expect(buildPlan(await targetRepo(), PACKS, config)).rejects.toThrow(/project\.agentSkills\.sync/);
});

test("nothing is written when pre-flight config validation fails", async () => {
  const config = await exampleConfig();
  delete (config.project.agentSkills as Record<string, string[]>).sync;
  const root = await targetRepo();
  await expect(buildPlan(root, PACKS, config)).rejects.toThrow();
  expect(await Bun.file(join(root, ".claude", "agents", "sync.md")).exists()).toBe(false);
});

test("renders native agents and the discussion-to-plan command for every configured harness", async () => {
  const config = await exampleConfig();
  config.targets = ["claude-code", "codex", "pi", "opencode", "kilo-code"];
  const root = await targetRepo();
  const plan = await buildPlan(root, PACKS, config);
  const content = (rel: string) => plan.entries.find((entry) => entry.rel === rel)?.content;

  expect(content(".claude/commands/litecodeagent.md")).toContain("$ARGUMENTS");
  expect(content(".codex/agents/orchestrator.toml")).toContain('sandbox_mode = "read-only"');
  expect(content(".codex/agents/orchestrator.toml")).not.toContain('model = "opus"');
  expect(content(".agents/skills/litecodeagent/SKILL.md")).toContain("/litecodeagent");
  expect(content(".agents/skills/litecodeagent/SKILL.md")).toContain("$litecodeagent");
  expect(content(".opencode/agents/orchestrator.md")).toContain("mode: primary");
  expect(content(".opencode/agents/orchestrator.md")).toContain("task: true");
  expect(content(".opencode/commands/litecodeagent.md")).toContain("agent: orchestrator");
  expect(content(".kilo/agents/orchestrator.md")).toContain("mode: primary");
  expect(content(".kilo/agents/orchestrator.md")).toContain("task: allow");
  expect(content(".kilo/commands/litecodeagent.md")).toContain("$ARGUMENTS");
  expect(content(".pi/prompts/litecodeagent.md")).toContain("litecode_run");
  expect(content(".pi/extensions/litecodeagent.ts")).toContain('"orchestrator"');
  expect(plan.entries.some((entry) => entry.rel === ".pi/agents/orchestrator.md")).toBe(false);

  await applyPlan(root, plan, "0.0.0-test", { force: false });
  const codexLock = await readLockfile(root, ".codex/.litecode-lock.json");
  expect(codexLock).not.toBeNull();
  const second = await buildPlan(root, PACKS, config);
  expect(second.entries.every((entry) => entry.status === "unchanged")).toBe(true);

  config.targets = ["codex"];
  const reduced = await buildPlan(root, PACKS, config);
  expect(reduced.orphans).toContain(".claude/agents/planner.md");
  expect(reduced.orphans).toContain(".pi/extensions/litecodeagent.ts");
});

test("dropping the web pack surfaces the now-dangling skill references", async () => {
  const config = await exampleConfig();
  config.packs = ["core"];
  await expect(buildPlan(await targetRepo(), PACKS, config)).rejects.toThrow(/frontend-expert/);
});

test("a config listing the web pack without a project.web block fails pre-flight with an actionable error, not a raw TemplateError", async () => {
  const config = await exampleConfig();
  delete (config.project as { web?: unknown }).web;
  const error = await buildPlan(await targetRepo(), PACKS, config).catch((e) => e);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).not.toMatch(/is not defined in the project config/);
  expect(error.message).toMatch(/project\.web/);
  expect(error.message).toMatch(/SKILL\.md/);
});

test("dropping the web pack itself does not falsely demand a project.web block", async () => {
  const config = await exampleConfig();
  config.packs = ["core"];
  delete (config.project as { web?: unknown }).web;
  const error = await buildPlan(await targetRepo(), PACKS, config).catch((e) => e);
  // core-only install fails on the dangling frontend-expert skill reference, never on project.web.
  expect(error.message).not.toMatch(/project\.web/);
});

test("nothing is written when project.web pre-flight validation fails", async () => {
  const config = await exampleConfig();
  delete (config.project as { web?: unknown }).web;
  const root = await targetRepo();
  await expect(buildPlan(root, PACKS, config)).rejects.toThrow();
  expect(await Bun.file(join(root, ".claude", "agents", "sync.md")).exists()).toBe(false);
});
