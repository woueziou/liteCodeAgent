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

test("a full render produces no unresolved template syntax when `project.language` is set", async () => {
  const config = await exampleConfig();
  config.project.language = "Brazilian Portuguese";
  const root = await targetRepo();
  const plan = await buildPlan(root, PACKS, config);
  expect(plan.entries.length).toBeGreaterThan(20);
  for (const entry of plan.entries) {
    expect(`${entry.rel}:${entry.content.includes("{{")}`).toBe(`${entry.rel}:false`);
    expect(entry.status).toBe("create");
  }
});

test("a full render produces no unresolved template syntax for every `project.testFirst` value", async () => {
  for (const value of ["bugs", "all", "off"] as const) {
    const config = await exampleConfig();
    config.project.testFirst = value;
    const root = await targetRepo();
    const plan = await buildPlan(root, PACKS, config);
    expect(plan.entries.length).toBeGreaterThan(20);
    for (const entry of plan.entries) {
      expect(`${value}:${entry.rel}:${entry.content.includes("{{")}`).toBe(`${value}:${entry.rel}:false`);
    }
  }
});

test("`project.testFirst: off` renders no test-first instructions on implementer or reviewer", async () => {
  const config = await exampleConfig();
  config.project.testFirst = "off";
  const root = await targetRepo();
  const plan = await buildPlan(root, PACKS, config);
  const implementer = plan.entries.find((e) => e.rel === ".claude/agents/implementer.md");
  const reviewer = plan.entries.find((e) => e.rel === ".claude/agents/reviewer.md");
  expect(implementer).toBeDefined();
  expect(reviewer).toBeDefined();
  expect(implementer!.content).not.toContain("write the test first and commit it failing");
  expect(reviewer!.content).not.toContain("TEST_FIRST");
  expect(reviewer!.content).not.toContain("Test first");
});

test("`project.testFirst: bugs` renders bug-only wording; `all` renders every-ticket wording", async () => {
  const root = await targetRepo();

  const bugsConfig = await exampleConfig();
  bugsConfig.project.testFirst = "bugs";
  const bugsPlan = await buildPlan(root, PACKS, bugsConfig);
  const bugsImplementer = bugsPlan.entries.find((e) => e.rel === ".claude/agents/implementer.md")!;
  const bugsReviewer = bugsPlan.entries.find((e) => e.rel === ".claude/agents/reviewer.md")!;
  expect(bugsImplementer.content).toContain("For a ticket labeled `bug`");
  expect(bugsReviewer.content).toContain("a ticket labeled `bug`");
  expect(bugsReviewer.content).toContain("TEST_FIRST");

  const allConfig = await exampleConfig();
  allConfig.project.testFirst = "all";
  const allPlan = await buildPlan(root, PACKS, allConfig);
  const allImplementer = allPlan.entries.find((e) => e.rel === ".claude/agents/implementer.md")!;
  const allReviewer = allPlan.entries.find((e) => e.rel === ".claude/agents/reviewer.md")!;
  expect(allImplementer.content).toContain("For every ticket");
  expect(allReviewer.content).toContain("every ticket");
  expect(allReviewer.content).toContain("TEST_FIRST");
});

test("install writes a lockfile that owns only what it rendered", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  const plan = await buildPlan(root, PACKS, config);
  await applyPlan(root, plan, "0.0.0-test", { force: false });

  const lock = await readLockfile(root);
  expect(lock).not.toBeNull();
  expect(Object.keys(lock!.files).length).toBe(plan.entries.length);
  expect(lock!.packs).toEqual({ core: "0.4.0", web: "0.1.0" });

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

test("install renders an executable .githooks/pre-commit branch guard (ticket 0033)", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  const plan = await buildPlan(root, PACKS, config);
  expect(plan.hook).not.toBeNull();
  expect(plan.hook!.status).toBe("create");
  await applyPlan(root, plan, "0.0.0-test", { force: false });

  const hookPath = join(root, ".githooks", "pre-commit");
  const content = await Bun.file(hookPath).text();
  expect(content).toContain("guard-branch");
  const mode = (await Bun.file(hookPath).stat()).mode;
  expect(mode & 0o111).not.toBe(0);

  // Re-planning with nothing changed reports the hook as already up to date.
  const second = await buildPlan(root, PACKS, config);
  expect(second.hook!.status).toBe("unchanged");
});

test("a hand-edited .githooks/pre-commit is reported as drift and never silently overwritten", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  await applyPlan(root, await buildPlan(root, PACKS, config), "0.0.0-test", { force: false });

  const hookPath = join(root, ".githooks", "pre-commit");
  await Bun.write(hookPath, `${await Bun.file(hookPath).text()}\n# local tweak\n`);

  const plan = await buildPlan(root, PACKS, config);
  expect(plan.hook!.status).toBe("drift");
  await expect(applyPlan(root, plan, "0.0.0-test", { force: false })).rejects.toThrow(/hand/);
  await applyPlan(root, plan, "0.0.0-test", { force: true });
  expect(await Bun.file(hookPath).text()).not.toContain("local tweak");
});

test("the rendered hook pins the litecodeagent version instead of a bare `bunx litecodeagent`", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  const plan = await buildPlan(root, PACKS, config);
  const pkg = await Bun.file(join(import.meta.dir, "..", "package.json")).json();
  expect(plan.hook!.content).toContain(`litecodeagent@${pkg.version}`);
  expect(plan.hook!.content).not.toMatch(/bunx --yes litecodeagent guard-branch/);
});

test("a pre-existing project-owned .githooks/pre-commit (no prior litecodeagent lock entry) is left untouched, not blocked behind --force", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  const hookPath = join(root, ".githooks", "pre-commit");
  await Bun.write(hookPath, "#!/usr/bin/env bash\necho \"this project's own hook\"\n");

  const plan = await buildPlan(root, PACKS, config);
  expect(plan.hook!.status).toBe("preexisting");
  // Must not require --force, and must not touch any other pending file either.
  await applyPlan(root, plan, "0.0.0-test", { force: false });
  expect(await Bun.file(hookPath).text()).toContain("this project's own hook");
});

test("install/upgrade prints a notice with the exact line to add when a pre-existing hook is left alone", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  const hookPath = join(root, ".githooks", "pre-commit");
  await Bun.write(hookPath, "#!/usr/bin/env bash\necho \"this project's own hook\"\n");

  const plan = await buildPlan(root, PACKS, config);
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  try {
    await applyPlan(root, plan, "0.0.0-test", { force: false });
  } finally {
    console.log = originalLog;
  }
  const combined = logs.join("\n");
  expect(combined).toContain(".githooks/pre-commit");
  // Must be pinned to the litecodeagent CLI version (package.json), not the core pack's
  // own (different, unpublished) version — round 3 bug-hunter caught this printing an
  // unpublished pack version that `bunx` could never resolve.
  const pkg = await Bun.file(join(import.meta.dir, "..", "package.json")).json();
  expect(combined).toContain(`bunx --yes litecodeagent@${pkg.version} guard-branch`);
});

test("a pre-existing hook in a subdirectory project also gets a cd-into-project instruction", async () => {
  const config = await exampleConfig();
  const repoRoot = await mkdtemp(join(tmpdir(), "litecode-"));
  await Bun.spawn(["git", "init", "-q"], { cwd: repoRoot }).exited;
  const projectRoot = join(repoRoot, "sub");
  await Bun.write(join(projectRoot, ".claude", "skills", "orpc-expert", "SKILL.md"), "---\nname: orpc-expert\n---\n");
  const hookPath = join(projectRoot, ".githooks", "pre-commit");
  await Bun.write(hookPath, "#!/usr/bin/env bash\necho \"this project's own hook\"\n");

  const plan = await buildPlan(projectRoot, PACKS, config);
  expect(plan.hook!.status).toBe("preexisting");
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  try {
    await applyPlan(projectRoot, plan, "0.0.0-test", { force: false });
  } finally {
    console.log = originalLog;
  }
  const combined = logs.join("\n");
  // Following this notice verbatim from a hook that runs at the repo's git top-level must
  // not fail with "no litecode.config.json found" (round 4 bug-hunter finding 1).
  expect(combined).toContain("(cd 'sub' &&");
  expect(combined).toMatch(/guard-branch/);
});

test("install activates the hook by setting core.hooksPath, without overriding one already set on purpose", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  await Bun.spawn(["git", "init", "-q"], { cwd: root }).exited;

  await applyPlan(root, await buildPlan(root, PACKS, config), "0.0.0-test", { force: false });
  const configured = await new Response(
    Bun.spawn(["git", "config", "--get", "core.hooksPath"], { cwd: root, stdout: "pipe" }).stdout,
  ).text();
  expect(configured.trim()).toBe(".githooks");
});

async function captureWarnings<T>(run: () => Promise<T>): Promise<{ result: T; warnings: string }> {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    const result = await run();
    return { result, warnings: warnings.join("\n") };
  } finally {
    console.warn = originalWarn;
  }
}

test("ticket 0055: activating the guard on the default branch warns that the setup commit itself would be refused", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  await Bun.spawn(["git", "init", "-q", "-b", "main"], { cwd: root }).exited;

  const { warnings } = await captureWarnings(async () =>
    applyPlan(root, await buildPlan(root, PACKS, config), "0.0.0-test", {
      force: false,
      defaultBranch: "main",
      allowDefaultBranchCommits: false,
    }),
  );
  expect(warnings).toMatch(/branch guard is now active/i);
  expect(warnings).toContain("git switch -c");
  expect(warnings).toContain("project.allowDefaultBranchCommits");
  expect(warnings).toContain("LITECODE_ALLOW_DEFAULT_BRANCH_COMMIT");
});

test("ticket 0055: no warning when not on the default branch", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  await Bun.spawn(["git", "init", "-q", "-b", "feat/x"], { cwd: root }).exited;

  const { warnings } = await captureWarnings(async () =>
    applyPlan(root, await buildPlan(root, PACKS, config), "0.0.0-test", {
      force: false,
      defaultBranch: "main",
      allowDefaultBranchCommits: false,
    }),
  );
  expect(warnings).not.toMatch(/branch guard is now active/i);
});

test("ticket 0055: no warning when project.allowDefaultBranchCommits is true", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  await Bun.spawn(["git", "init", "-q", "-b", "main"], { cwd: root }).exited;

  const { warnings } = await captureWarnings(async () =>
    applyPlan(root, await buildPlan(root, PACKS, config), "0.0.0-test", {
      force: false,
      defaultBranch: "main",
      allowDefaultBranchCommits: true,
    }),
  );
  expect(warnings).not.toMatch(/branch guard is now active/i);
});

test("ticket 0055: no warning when the guard was already active before this run (not just-activated)", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  await Bun.spawn(["git", "init", "-q", "-b", "main"], { cwd: root }).exited;

  // First run activates the guard.
  await applyPlan(root, await buildPlan(root, PACKS, config), "0.0.0-test", {
    force: false,
    defaultBranch: "main",
    allowDefaultBranchCommits: false,
  });

  // Second run: the guard is already active, so nothing new gets activated this time.
  const { warnings } = await captureWarnings(async () =>
    applyPlan(root, await buildPlan(root, PACKS, config), "0.0.0-test", {
      force: false,
      defaultBranch: "main",
      allowDefaultBranchCommits: false,
    }),
  );
  expect(warnings).not.toMatch(/branch guard is now active/i);
});

test("ticket 0055: no warning when the guard never activates (a pre-existing hook is left untouched)", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  await Bun.spawn(["git", "init", "-q", "-b", "main"], { cwd: root }).exited;
  await Bun.write(join(root, ".githooks", "pre-commit"), "#!/usr/bin/env bash\necho existing\n");

  const { warnings } = await captureWarnings(async () =>
    applyPlan(root, await buildPlan(root, PACKS, config), "0.0.0-test", {
      force: false,
      defaultBranch: "main",
      allowDefaultBranchCommits: false,
    }),
  );
  expect(warnings).not.toMatch(/branch guard is now active/i);
});

test("install never overrides a core.hooksPath a project already set to something else", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  await Bun.spawn(["git", "init", "-q"], { cwd: root }).exited;
  await Bun.spawn(["git", "config", "core.hooksPath", "tools/hooks"], { cwd: root }).exited;

  await applyPlan(root, await buildPlan(root, PACKS, config), "0.0.0-test", { force: false });
  const configured = await new Response(
    Bun.spawn(["git", "config", "--get", "core.hooksPath"], { cwd: root, stdout: "pipe" }).stdout,
  ).text();
  expect(configured.trim()).toBe("tools/hooks");
});

test("install leaves core.hooksPath unset when .git/hooks already holds a real (non-sample) hook", async () => {
  const config = await exampleConfig();
  const root = await targetRepo();
  await Bun.spawn(["git", "init", "-q"], { cwd: root }).exited;
  await Bun.write(join(root, ".git", "hooks", "pre-commit"), "#!/usr/bin/env bash\necho existing\n");

  await applyPlan(root, await buildPlan(root, PACKS, config), "0.0.0-test", { force: false });
  const configured = await new Response(
    Bun.spawn(["git", "config", "--get", "core.hooksPath"], { cwd: root, stdout: "pipe" }).stdout,
  ).text();
  expect(configured.trim()).toBe("");
});

test("a project root that's a subdirectory of the git repo gets a cd-into-project instruction, not a bare guard-branch line", async () => {
  const config = await exampleConfig();
  const repoRoot = await mkdtemp(join(tmpdir(), "litecode-"));
  await Bun.spawn(["git", "init", "-q"], { cwd: repoRoot }).exited;
  const projectRoot = join(repoRoot, "sub");
  await Bun.write(join(projectRoot, ".claude", "skills", "orpc-expert", "SKILL.md"), "---\nname: orpc-expert\n---\n");

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    await applyPlan(projectRoot, await buildPlan(projectRoot, PACKS, config), "0.0.0-test", { force: false });
  } finally {
    console.warn = originalWarn;
  }
  const combined = warnings.join("\n");
  expect(combined).toMatch(/subdirectory/);
  // guard-branch reads litecode.config.json from its cwd, and the hook always runs at the
  // repo's top level — so the suggested line must cd into the (shell-quoted) project dir
  // first, or following it verbatim refuses every commit in the whole repo (round 3/4
  // bug-hunter).
  expect(combined).toContain("(cd 'sub' &&");
  expect(combined).toMatch(/guard-branch/);

  const configured = await new Response(
    Bun.spawn(["git", "config", "--get", "core.hooksPath"], { cwd: repoRoot, stdout: "pipe" }).stdout,
  ).text();
  expect(configured.trim()).toBe("");
});

test("a subdirectory project path containing a space is shell-quoted in the cd instruction", async () => {
  const config = await exampleConfig();
  const repoRoot = await mkdtemp(join(tmpdir(), "litecode-"));
  await Bun.spawn(["git", "init", "-q"], { cwd: repoRoot }).exited;
  const projectRoot = join(repoRoot, "my app");
  await Bun.write(join(projectRoot, ".claude", "skills", "orpc-expert", "SKILL.md"), "---\nname: orpc-expert\n---\n");

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    await applyPlan(projectRoot, await buildPlan(projectRoot, PACKS, config), "0.0.0-test", { force: false });
  } finally {
    console.warn = originalWarn;
  }
  const combined = warnings.join("\n");
  // Unquoted, `(cd my app && ...)` fails under bash with "cd: too many arguments" and
  // `set -e` refuses every commit (round 4 bug-hunter finding 2).
  expect(combined).toContain("(cd 'my app' &&");
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
  delete (config.project.agentSkills as Record<string, string[]>).tracker;
  const error = await buildPlan(await targetRepo(), PACKS, config).catch((e) => e);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).not.toMatch(/is not defined in the project config/);
  expect(error.message).toMatch(/project\.agentSkills\.tracker/);
  expect(error.message).toMatch(/agents\/tracker\.md/);
  expect(error.message).toMatch(/config doctor --fix/);
});

test("a typo'd agentSkills key does not mask the real missing key", async () => {
  const config = await exampleConfig();
  const skills = config.project.agentSkills as Record<string, string[]>;
  skills.agentSkils = skills.tracker ?? [];
  delete skills.tracker;
  await expect(buildPlan(await targetRepo(), PACKS, config)).rejects.toThrow(/project\.agentSkills\.tracker/);
});

test("nothing is written when pre-flight config validation fails", async () => {
  const config = await exampleConfig();
  delete (config.project.agentSkills as Record<string, string[]>).tracker;
  const root = await targetRepo();
  await expect(buildPlan(root, PACKS, config)).rejects.toThrow();
  expect(await Bun.file(join(root, ".claude", "agents", "tracker.md")).exists()).toBe(false);
});

test("hides the five orchestrator-internal agents on opencode only", async () => {
  const config = await exampleConfig();
  config.targets = ["claude-code", "codex", "pi", "opencode", "kilo-code"];
  const plan = await buildPlan(await targetRepo(), PACKS, config);
  const content = (rel: string) => plan.entries.find((entry) => entry.rel === rel)?.content ?? "";

  for (const name of ["classifier", "panel-selector", "debate-angle", "synthesizer", "planner"]) {
    expect(content(`.opencode/agents/${name}.md`)).toContain("hidden: true");
    expect(content(`.kilo/agents/${name}.md`)).not.toContain("hidden");
    expect(content(`.claude/agents/${name}.md`)).not.toContain("hidden");
    expect(content(`.codex/agents/${name}.toml`)).not.toContain("hidden");
  }
  for (const name of ["orchestrator", "implementer", "reviewer"]) {
    expect(content(`.opencode/agents/${name}.md`)).not.toContain("hidden");
  }
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
  expect(await Bun.file(join(root, ".claude", "agents", "tracker.md")).exists()).toBe(false);
});
