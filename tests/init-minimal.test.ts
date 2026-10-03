import { afterAll, expect, test } from "bun:test";
import { legacyExampleJson } from "./helpers/legacy-example.ts";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ConfigSchema, loadConfig } from "../src/config.ts";
import { init } from "../src/init.ts";
import { buildPlan } from "../src/install.ts";
import { cleanedConfig, obsoleteConfig } from "../src/project-upgrade-config.ts";

const PACKS = join(import.meta.dir, "..", "packs");
const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");

const scratch: string[] = [];
afterAll(async () => {
  await Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-minimal-"));
  scratch.push(dir);
  return dir;
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

/** A backend-only project: no web app, an oRPC API, scripts and a GitHub remote. */
async function backendProject(opts: { remote?: boolean; scripts?: Record<string, string> } = {}): Promise<string> {
  const root = await tempDir();
  await Bun.write(
    join(root, "package.json"),
    JSON.stringify({
      name: "demo-service",
      scripts: opts.scripts ?? { check: "tsc --noEmit", "check-types": "tsc" },
      dependencies: { "@orpc/server": "1" },
    }),
  );
  await Bun.write(join(root, "tsconfig.json"), "{}");
  await Bun.write(join(root, ".claude/skills/orpc-expert/SKILL.md"), "---\nname: orpc-expert\n---\n");
  await git(root, "init", "-b", "trunk");
  if (opts.remote !== false) await git(root, "remote", "add", "origin", "https://github.com/acme/demo-service.git");
  return root;
}

/** Runs the real CLI with a PATH holding only git (plus any `extraBin` dir) and no stdin. */
async function cli(root: string, args: string[], extraBin?: string) {
  const gitDir = dirname(Bun.which("git")!);
  const proc = Bun.spawn([process.execPath, CLI, ...args, "--project", root], {
    cwd: root,
    env: { ...process.env, PATH: [extraBin, gitDir].filter(Boolean).join(":") },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { stdout, stderr, exitCode: await proc.exited };
}

const readConfig = async (root: string) => (await Bun.file(join(root, "litecode.config.json")).json()) as any;

test("the generated file holds only the minimal keys, and detects name, branch, check and type-check commands", async () => {
  const root = await backendProject();
  const run = await cli(root, ["init", "--yes"]);
  expect(run.exitCode, run.stderr).toBe(0);

  const raw = await readConfig(root);
  expect(Object.keys(raw).sort()).toEqual(["packs", "project", "targets"]);
  expect(Object.keys(raw.project).sort()).toEqual([
    "checkCommand", "defaultBranch", "domains", "name", "repo", "typecheckCommands",
  ]);
  expect(raw.project).toMatchObject({
    name: "demo-service",
    repo: "acme/demo-service",
    defaultBranch: "trunk",
    checkCommand: "npm run check",
    typecheckCommands: ["npm run check-types"],
  });
});

test("everything left out takes its default and stays settable", async () => {
  const root = await backendProject();
  await cli(root, ["init", "--yes"]);
  const { config } = await loadConfig(root);
  expect(config.tiers).toEqual({ fast: "haiku", balanced: "sonnet", reasoning: "opus" });
  expect(config.project.worktreeRoot).toBe("../worktrees");
  expect(config.project.adrDir).toBe("docs/decisions");
  expect(config.project.conventions).toEqual([]);
  expect(config.project.trustBoundaries).toEqual([]);
  expect(config.project.language).toBeUndefined();
  expect(config.project.angles.length).toBeGreaterThan(0);

  const set = await cli(root, ["config", "set", "project.worktreeRoot", "../wt"]);
  expect(set.exitCode, set.stderr + set.stdout).toBe(0);
  expect((await loadConfig(root)).config.project.worktreeRoot).toBe("../wt");
});

test("targets are prefilled from the tools found on disk", async () => {
  const root = await backendProject();
  await mkdir(join(root, ".codex"));
  const bin = await tempDir();
  await Bun.write(join(bin, "opencode"), "#!/bin/sh\n");
  await chmod(join(bin, "opencode"), 0o755);

  const run = await cli(root, ["init", "--yes"], bin);
  expect(run.exitCode, run.stderr).toBe(0);
  // `.claude/` exists (the local skill), `.codex/` was added, `opencode` is on the PATH.
  expect((await readConfig(root)).targets).toEqual(["claude-code", "codex", "opencode"]);
});

test("with no tool found, the install falls back to Claude Code alone", async () => {
  const root = await tempDir();
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "bare" }));
  const run = await cli(root, ["init", "--yes"]);
  expect(run.exitCode, run.stderr).toBe(0);
  expect((await readConfig(root)).targets).toEqual(["claude-code"]);
});

test("non-interactive init writes the rules deduced from the stack without asking", async () => {
  const root = await backendProject();
  const run = await cli(root, ["init", "--yes"]);
  expect(run.exitCode, run.stderr).toBe(0);
  const { domains } = (await readConfig(root)).project;
  expect(domains.length).toBeGreaterThan(0);
  expect(domains[0].skills).toContain("orpc-expert");
});

test("a summary of targets and rules is printed before the file is written", async () => {
  const root = await backendProject();
  const run = await cli(root, ["init", "--yes"]);
  const summary = run.stdout.indexOf("claude-code");
  expect(summary).toBeGreaterThanOrEqual(0);
  expect(run.stdout).toContain("orpc-expert");
  expect(summary).toBeLessThan(run.stdout.indexOf("Wrote"));
});

// ---- the single question ------------------------------------------------------------

type Asked = { question: string; proposed: { match: string; skills: string[] }[] };

async function interactive(root: string, answers: string[][]) {
  const asked: Asked[] = [];
  await init(root, {
    yes: false,
    interactive: true,
    packsRoot: PACKS,
    answerRules: async (q) => {
      asked.push(q);
      return answers.shift() ?? [];
    },
  });
  return { asked, config: await readConfig(root) };
}

test("the interactive init asks one question, worded without the word domain", async () => {
  const root = await backendProject();
  const { asked } = await interactive(root, [[]]);
  expect(asked).toHaveLength(1);
  expect(asked[0]!.question).toMatch(/when a ticket touches/i);
  expect(asked[0]!.question).toMatch(/which guides/i);
  expect(asked[0]!.question.toLowerCase()).not.toContain("domain");
});

test("an empty answer accepts the proposed rules", async () => {
  const root = await backendProject();
  const { asked, config } = await interactive(root, [[]]);
  expect(asked[0]!.proposed.length).toBeGreaterThan(0);
  expect(config.project.domains).toEqual(asked[0]!.proposed);
});

test("rules are edited, added and removed in the same answer", async () => {
  const root = await backendProject();
  const { asked, config } = await interactive(root, [
    ["1: touches the billing API => orpc-expert", "payment webhooks => orpc-expert, critique-expert"],
  ]);
  expect(asked).toHaveLength(1);
  expect(config.project.domains).toEqual([
    { match: "touches the billing API", skills: ["orpc-expert"] },
    ...asked[0]!.proposed.slice(1),
    { match: "payment webhooks", skills: ["orpc-expert", "critique-expert"] },
  ]);

  const other = await backendProject();
  const removed = await interactive(other, [["-1"]]);
  expect(removed.config.project.domains).toEqual(removed.asked[0]!.proposed.slice(1));
});

async function bareProject(): Promise<string> {
  const root = await tempDir();
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "bare", scripts: { test: "bun test" } }));
  return root;
}

test("when nothing is detected, the init asks for at least one rule", async () => {
  const root = await bareProject();
  const { asked, config } = await interactive(root, [[], ["parsing code => critique-expert"]]);
  expect(asked).toHaveLength(2);
  expect(asked[0]!.proposed).toEqual([]);
  expect(config.project.domains).toEqual([{ match: "parsing code", skills: ["critique-expert"] }]);
});

test("skipping the question on an undetected stack still completes the install", async () => {
  const root = await bareProject();
  const { config } = await interactive(root, [["skip"]]);
  expect(config.project.domains).toEqual([]);
  const { config: loaded } = await loadConfig(root);
  await expect(buildPlan(root, PACKS, loaded)).resolves.toBeDefined();
});

test("non-interactive init on an undetected stack writes no rule and still installs", async () => {
  const root = await bareProject();
  const run = await cli(root, ["init", "--yes"]);
  expect(run.exitCode, run.stderr).toBe(0);
  expect((await readConfig(root)).project.domains).toEqual([]);
});

// ---- absent check command / repository ----------------------------------------------

test("without check command or GitHub repo the install succeeds and the agents refuse naming the exact command", async () => {
  const root = await backendProject({ remote: false, scripts: {} });
  const run = await cli(root, ["init", "--yes"]);
  expect(run.exitCode, run.stderr).toBe(0);
  const raw = await readConfig(root);
  expect(raw.project.checkCommand).toBeUndefined();
  expect(raw.project.repo).toBeUndefined();

  const { config } = await loadConfig(root);
  const plan = await buildPlan(root, PACKS, config);
  const text = (name: string) => plan.entries.find((e) => e.rel === `.claude/agents/${name}.md`)!.content;
  for (const name of ["implementer", "reviewer", "bug-hunter"]) {
    expect(text(name)).toContain('litecode config set project.checkCommand "<command>"');
  }
  for (const name of ["implementer", "triage"]) {
    expect(text(name)).toContain("litecode config set project.repo <owner/name>");
  }

  // Once both are set, the refusal is gone.
  const filled = ConfigSchema.parse({
    ...raw,
    project: { ...raw.project, checkCommand: "bun test", repo: "acme/demo-service" },
  });
  const ok = await buildPlan(root, PACKS, filled);
  for (const entry of ok.entries) expect(entry.content).not.toContain("litecode config set project.");
});

// ---- upgrade ------------------------------------------------------------------------

test("upgrade drops the obsolete keys and keeps what is still read", async () => {
  const raw = await legacyExampleJson();
  raw.target = "claude-code";
  raw.targets = ["claude-code", "codex"];
  raw.outDir = ".claude";
  raw.project.lessons = [];
  const listed = obsoleteConfig(raw);
  for (const key of ["target", "outDir", "project.lessons", "project.agentSkills"]) expect(listed).toContain(key);

  const cleaned = cleanedConfig(raw) as any;
  expect(cleaned.target).toBeUndefined();
  expect(cleaned.outDir).toBeUndefined();
  expect(cleaned.project.lessons).toBeUndefined();
  expect(cleaned.project.agentSkills).toBeUndefined();
  expect(cleaned.targets).toEqual(["claude-code", "codex"]);
  expect(cleaned.project.domains).toEqual(raw.project.domains);
  expect(() => ConfigSchema.parse(cleaned)).not.toThrow();
});

test("upgrade keeps a custom outDir, filled lessons, and turns a lone legacy target into targets", async () => {
  const raw = await legacyExampleJson();
  delete raw.targets;
  raw.target = "codex";
  raw.outDir = ".custom";
  raw.project.lessons = ["never force-push"];
  const cleaned = cleanedConfig(raw) as any;
  expect(cleaned.targets).toEqual(["codex"]);
  expect(cleaned.target).toBeUndefined();
  expect(cleaned.outDir).toBe(".custom");
  expect(cleaned.project.lessons).toEqual(["never force-push"]);
});

test("a config cleaned by upgrade still installs, with no skill preloaded", async () => {
  const raw = await legacyExampleJson();
  const root = await tempDir();
  await Bun.write(join(root, ".claude/skills/orpc-expert/SKILL.md"), "---\nname: orpc-expert\n---\n");
  const config = ConfigSchema.parse(cleanedConfig(raw));
  const plan = await buildPlan(root, PACKS, config);
  const implementer = plan.entries.find((e) => e.rel === ".claude/agents/implementer.md")!.content;
  expect(implementer).not.toMatch(/^skills: *\S/m);
});
