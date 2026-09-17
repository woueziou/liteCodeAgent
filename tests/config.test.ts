import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import {
  addPacks,
  addTargets,
  applyConfigMutation,
  parseSetValue,
  removeTargets,
  withTargets,
} from "../src/config-edit.ts";
import { init } from "../src/init.ts";
import { buildPlan } from "../src/install.ts";
import { selectedTargets } from "../src/config.ts";

const PACKS = join(import.meta.dir, "..", "packs");

async function readyConfig(): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), "litecode-config-"));
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "bun test" } }));
  const path = await init(root, { yes: true, packsRoot: PACKS, targets: ["claude-code"] });
  const raw = ConfigSchema.parse(await Bun.file(path).json());
  raw.project.repo = "demo/demo";
  raw.project.checkCommand = "bun test";
  raw.project.board.owner = "demo";
  await Bun.write(path, `${JSON.stringify(raw, null, 2)}\n`);
  return { root, path };
}

test("addTargets extends a legacy single-target config", () => {
  const config = ConfigSchema.parse({
    target: "claude-code",
    packs: ["core"],
    project: {
      name: "demo",
      repo: "demo/demo",
      checkCommand: "bun test",
      angles: [{ name: "correctness", covers: "x", triggeredBy: "y", skills: [] }],
      board: { owner: "demo" },
    },
  });
  const next = addTargets(config, ["pi", "codex"]);
  expect(selectedTargets(next)).toEqual(["claude-code", "pi", "codex"]);
  expect(next.targets).toEqual(["claude-code", "pi", "codex"]);
});

test("removeTargets refuses to remove the last target", () => {
  const config = ConfigSchema.parse({
    targets: ["claude-code"],
    packs: ["core"],
    project: {
      name: "demo",
      repo: "demo/demo",
      checkCommand: "bun test",
      angles: [{ name: "correctness", covers: "x", triggeredBy: "y", skills: [] }],
      board: { owner: "demo" },
    },
  });
  expect(() => removeTargets(config, ["claude-code"])).toThrow(/Cannot remove every target/);
});

test("config targets add writes targets and keeps core pack", async () => {
  const { root } = await readyConfig();
  const { changed, config } = await applyConfigMutation(root, PACKS, {
    kind: "targets",
    action: "add",
    value: "pi,opencode",
  });
  expect(changed).toBe(true);
  expect(selectedTargets(config)).toEqual(["claude-code", "pi", "opencode"]);
  expect(config.packs).toEqual(["core"]);
});

test("config packs add keeps core and renders after repo is valid", async () => {
  const { root } = await readyConfig();
  const { config } = await applyConfigMutation(root, PACKS, { kind: "packs", action: "add", value: "web" });
  expect(config.packs).toEqual(["core", "web"]);

  const saved = ConfigSchema.parse(await Bun.file(join(root, "litecode.config.json")).json());
  saved.project.web = {
    appDir: ".",
    framework: "React",
    apiClient: "fetch",
    typeSourceOfTruth: "types",
    typecheck: "bun test",
    styling: "CSS",
  };
  await Bun.write(join(root, "litecode.config.json"), `${JSON.stringify(saved, null, 2)}\n`);
  await expect(buildPlan(root, PACKS, saved)).resolves.toBeDefined();
});

test("config set updates a dotted project field", async () => {
  const { root } = await readyConfig();
  const { config } = await applyConfigMutation(root, PACKS, {
    kind: "set",
    path: "project.defaultBranch",
    value: "develop",
  });
  expect(config.project.defaultBranch).toBe("develop");
});

test("parseSetValue parses targets and booleans", () => {
  expect(parseSetValue("targets", "pi,codex")).toEqual(["pi", "codex"]);
  expect(parseSetValue("project.board.enabled", "false")).toBe(false);
});

test("withTargets replaces the harness list", () => {
  const config = ConfigSchema.parse({
    targets: ["claude-code", "pi"],
    packs: ["core"],
    project: {
      name: "demo",
      repo: "demo/demo",
      checkCommand: "bun test",
      angles: [{ name: "correctness", covers: "x", triggeredBy: "y", skills: [] }],
      board: { owner: "demo" },
    },
  });
  const next = withTargets(config, ["codex", "kilo-code"]);
  expect(selectedTargets(next)).toEqual(["codex", "kilo-code"]);
});
