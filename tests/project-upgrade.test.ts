import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { applyPlan, buildPlan, lockPath } from "../src/install.ts";
import { hash, readLockfile, writeLockfile } from "../src/lockfile.ts";
import { applyUpgrade, hasChanges, planUpgrade, type MigrationPlan } from "../src/project-upgrade.ts";

const PACKS = join(import.meta.dir, "..", "packs");
const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");
const CLI = join(import.meta.dir, "..", "src", "cli.ts");

const V1_TICKET = `---
schemaVersion: 1
id: 0001-old-ticket
title: Old ticket
label: bug
status: planned
priority: medium
size: small
assignedAgent: human
dueDate:
issue: 12
synced: true
syncedAt: 2026-09-20T10:00:00.000Z
---

Do the thing.

<!-- litecode:comment -->
A comment never posted.
<!-- /litecode:comment -->
`;

const scratch: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * A project installed by a 0.x release, as far as `upgrade` can tell: current packs
 * installed, plus everything 0.x left behind — the `sync` agent and `github-project-sync`
 * skill as lockfile-owned files (one of them edited since), a config still naming that
 * skill and the removed settings, a v1 ticket, and the board's data file.
 */
async function legacyProject(): Promise<string> {
  const root = await tempDir("litecode-upgrade-");
  await Bun.write(join(root, ".claude/skills/orpc-expert/SKILL.md"), "---\nname: orpc-expert\n---\n");
  const raw = await Bun.file(EXAMPLE).json();
  await Bun.write(join(root, "litecode.config.json"), `${JSON.stringify(raw, null, 2)}\n`);
  await applyPlan(root, await buildPlan(root, PACKS, ConfigSchema.parse(raw)), "0.14.0", { force: false });

  const legacyFiles: Record<string, string> = {
    ".claude/agents/sync.md": "---\nname: sync\n---\nold sync agent\n",
    ".claude/skills/github-project-sync/SKILL.md": "---\nname: github-project-sync\n---\nold skill\n",
  };
  const lock = (await readLockfile(root, lockPath("claude-code")))!;
  for (const [rel, content] of Object.entries(legacyFiles)) {
    await Bun.write(join(root, rel), content);
    lock.files[rel] = { pack: "core", version: "0.3.0", hash: hash(content) };
  }
  await writeLockfile(root, lock, lockPath("claude-code"));
  await Bun.write(join(root, ".claude/skills/github-project-sync/SKILL.md"), "---\nname: github-project-sync\n---\nold skill, edited\n");

  raw.project.agentSkills.sync = ["github-project-sync", "agent-attribution"];
  raw.project.agentSkills.reviewer = [...raw.project.agentSkills.reviewer, "github-project-sync"];
  raw.project.board = { enabled: true, owner: "demo", dataFile: ".claude/data/board.json" };
  raw.project.tickets = { enabled: true, dir: "docs/tickets", autoStateFile: ".claude/data/ticket-sync-auto-state.json", autoMinIntervalMs: 60000 };
  await Bun.write(join(root, "litecode.config.json"), `${JSON.stringify(raw, null, 2)}\n`);

  await Bun.write(join(root, "docs/tickets/0001-old-ticket.md"), V1_TICKET);
  await Bun.write(join(root, ".claude/data/board.json"), "{}\n");
  return root;
}

async function plan(root: string): Promise<MigrationPlan[]> {
  const config = ConfigSchema.parse(await Bun.file(join(root, "litecode.config.json")).json());
  return planUpgrade({ root, config, packsRoot: PACKS, litecodeVersion: "1.0.0" });
}

const summaries = (plans: MigrationPlan[], id: string) => plans.find((p) => p.id === id)!.changes.map((c) => c.summary);

test("a 0.x project gets one plan covering every migration, and planning writes nothing", async () => {
  const root = await legacyProject();
  const before = await Bun.file(join(root, "litecode.config.json")).text();
  const plans = await plan(root);

  expect(plans.map((p) => p.id)).toEqual(["config", "packs", "orphans", "tickets", "legacy-data"]);
  expect(plans.find((p) => p.id === "config")!.changes[0]!.details).toEqual([
    "project.tickets.autoStateFile",
    "project.tickets.autoMinIntervalMs",
    "project.agentSkills.sync",
    "project.board",
    "github-project-sync from project.agentSkills.reviewer",
  ]);
  expect(summaries(plans, "orphans")).toEqual(["delete .claude/agents/sync.md"]);
  expect(plans.find((p) => p.id === "orphans")!.skipped.map((s) => s.summary)).toEqual([
    "keep .claude/skills/github-project-sync/SKILL.md",
  ]);
  expect(summaries(plans, "tickets")).toEqual(["migrate docs/tickets/0001-old-ticket.md"]);
  expect(summaries(plans, "legacy-data")).toEqual(["delete .claude/data/board.json"]);

  expect(await Bun.file(join(root, "litecode.config.json")).text()).toBe(before);
  expect(await Bun.file(join(root, ".claude/agents/sync.md")).exists()).toBe(true);
});

test("applying the plan brings the project fully up to date, and a second run has nothing to do", async () => {
  const root = await legacyProject();
  await applyUpgrade(await plan(root), () => {});

  const config = await Bun.file(join(root, "litecode.config.json")).json();
  expect(config.project.board).toBeUndefined();
  expect(config.project.agentSkills.sync).toBeUndefined();
  expect(config.project.agentSkills.reviewer).not.toContain("github-project-sync");
  expect(config.project.tickets).toEqual({ enabled: true, dir: "docs/tickets" });

  expect(await Bun.file(join(root, ".claude/agents/sync.md")).exists()).toBe(false);
  expect(await Bun.file(join(root, ".claude/skills/github-project-sync/SKILL.md")).text()).toContain("edited");
  expect(await Bun.file(join(root, ".claude/agents/reviewer.md")).text()).not.toContain("github-project-sync");
  expect(await Bun.file(join(root, ".claude/data/board.json")).exists()).toBe(false);

  const ticket = await Bun.file(join(root, "docs/tickets/0001-old-ticket.md")).text();
  expect(ticket).toContain("schemaVersion: 2");
  expect(ticket).toContain("A comment never posted.");
  expect(ticket).not.toMatch(/^issue:/m);

  expect(hasChanges(await plan(root))).toBe(false);
});

test("a ticket with an unknown frontmatter key is left alone and reported, not stripped", async () => {
  const root = await legacyProject();
  await Bun.write(join(root, "docs/tickets/0001-old-ticket.md"), V1_TICKET.replace("dueDate:\n", "dueDate:\nepic: pay\n"));
  const tickets = (await plan(root)).find((p) => p.id === "tickets")!;
  expect(tickets.changes).toEqual([]);
  expect(tickets.skipped[0]!.reason).toContain("epic");
});

test("a failed change stops the upgrade and says what was already applied", async () => {
  const log: string[] = [];
  const plans: MigrationPlan[] = [
    {
      id: "a",
      title: "A",
      skipped: [],
      changes: [
        { summary: "first", apply: async () => void log.push("first") },
        { summary: "second", apply: async () => { throw new Error("disk full"); } },
        { summary: "third", apply: async () => void log.push("third") },
      ],
    },
  ];
  const err = await applyUpgrade(plans, () => {}).catch((e: Error) => e);
  expect((err as Error).message).toContain('stopped at "second": disk full');
  expect((err as Error).message).toContain("- first");
  expect(log).toEqual(["first"]);
});

async function runCli(cwd: string, args: string[]) {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { output: (out + err).replace(/\x1b\[[0-9;]*m/g, ""), exitCode: await proc.exited };
}

test("`upgrade` outside a terminal shows the plan and applies nothing; `--yes` applies it", async () => {
  const root = await legacyProject();
  const shown = await runCli(root, ["upgrade", "--no-self-update"]);
  expect(shown.exitCode).toBe(1);
  expect(shown.output).toContain("delete .claude/agents/sync.md");
  expect(shown.output).toContain("Re-run with --yes");
  expect(await Bun.file(join(root, ".claude/agents/sync.md")).exists()).toBe(true);

  // The edited github-project-sync copy is kept and reported, so the run ends at 1.
  const applied = await runCli(root, ["upgrade", "--no-self-update", "--yes"]);
  expect(applied.exitCode).toBe(1);
  expect(applied.output).toContain("Upgraded:");
  expect(applied.output).toContain("need your attention");
  expect(await Bun.file(join(root, ".claude/agents/sync.md")).exists()).toBe(false);

  await rm(join(root, ".claude/skills/github-project-sync"), { recursive: true });
  const current = await runCli(root, ["upgrade", "--no-self-update"]);
  expect(current.output).toContain("Already up to date");
  expect(current.exitCode).toBe(0);
});

test("`upgrade` in a directory that isn't a LiteCodeAgent project says so and changes nothing", async () => {
  const root = await tempDir("litecode-upgrade-empty-");
  const { output, exitCode } = await runCli(root, ["upgrade", "--no-self-update"]);
  expect(exitCode).toBe(0);
  expect(output).toContain("nothing to upgrade here");
});

async function editConfig(root: string, edit: (raw: any) => void, indent: string | number = 2) {
  const path = join(root, "litecode.config.json");
  const raw = await Bun.file(path).json();
  edit(raw);
  await Bun.write(path, `${JSON.stringify(raw, null, indent)}\n`);
}

test("nothing outside the project is ever deleted, whatever the config or a lockfile says", async () => {
  const root = await legacyProject();
  const victim = await tempDir("litecode-victim-");
  await Bun.write(join(victim, "notes.txt"), "keep me\n");
  await Bun.write(join(victim, "empty.keep"), "");
  await editConfig(root, (raw) => {
    raw.project.board.dataFile = join(victim, "notes.txt");
    raw.project.board.itemIdCache = "../" + join("..", victim, "notes.txt");
  });
  const lock = (await readLockfile(root, lockPath("claude-code")))!;
  lock.files["../outside/empty.keep"] = { pack: "core", version: "0.3.0", hash: hash("") };
  lock.files[join(victim, "empty.keep")] = { pack: "core", version: "0.3.0", hash: hash("") };
  await writeLockfile(root, lock, lockPath("claude-code"));

  const plans = await plan(root);
  const deletes = plans.flatMap((p) => p.changes.map((c) => c.summary)).filter((s) => s.startsWith("delete"));
  expect(deletes.some((s) => s.includes("victim") || s.includes(".."))).toBe(false);
  expect(plans.flatMap((p) => p.skipped).some((s) => s.reason.includes("outside the project"))).toBe(true);

  await applyUpgrade(plans, () => {});
  expect(await Bun.file(join(victim, "notes.txt")).text()).toBe("keep me\n");
  expect(await Bun.file(join(victim, "empty.keep")).exists()).toBe(true);
});

test("a hand-edited agent blocks the re-render, and then nothing it may reference is deleted", async () => {
  const root = await legacyProject();
  await Bun.write(join(root, ".claude/agents/reviewer.md"), "---\nname: reviewer\n---\nmy own reviewer\n");
  const plans = await plan(root);
  expect(plans.find((p) => p.id === "packs")!.changes).toEqual([]);
  expect(plans.find((p) => p.id === "packs")!.skipped[0]!.reason).toContain("edited by hand");
  const orphans = plans.find((p) => p.id === "orphans")!;
  expect(orphans.changes).toEqual([]);
  expect(orphans.skipped.map((s) => s.summary)).toContain("keep .claude/agents/sync.md for now");
});

test("orphans a newer `install --apply` already dropped from the lockfile are still reported, never silently kept", async () => {
  const root = await legacyProject();
  const config = ConfigSchema.parse(await Bun.file(join(root, "litecode.config.json")).json());
  await applyPlan(root, await buildPlan(root, PACKS, config), "1.0.0", { force: false });
  expect((await readLockfile(root, lockPath("claude-code")))!.files[".claude/agents/sync.md"]).toBeUndefined();

  const orphans = (await plan(root)).find((p) => p.id === "orphans")!;
  expect(orphans.changes).toEqual([]);
  const kept = orphans.skipped.find((s) => s.summary === "keep .claude/agents/sync.md")!;
  expect(kept.reason).toContain("no lockfile records it");
  expect(await Bun.file(join(root, ".claude/agents/sync.md")).exists()).toBe(true);
});

test("a domain whose only skill was removed is dropped, instead of failing the whole upgrade", async () => {
  const root = await legacyProject();
  await editConfig(root, (raw) => raw.project.domains.push({ match: "board automation", skills: ["github-project-sync"] }));
  const config = (await plan(root)).find((p) => p.id === "config")!;
  expect(config.changes[0]!.details!.some((d) => /^project\.domains\[\d+\] \(board automation\), left with no skill$/.test(d))).toBe(true);
  await applyUpgrade(await plan(root), () => {});
  const domains = (await Bun.file(join(root, "litecode.config.json")).json()).project.domains;
  expect(domains.some((d: { match: string }) => d.match === "board automation")).toBe(false);
});

test("the config keeps its own indentation when obsolete settings are removed", async () => {
  const root = await legacyProject();
  await editConfig(root, () => {}, "\t");
  await applyUpgrade(await plan(root), () => {});
  const text = await Bun.file(join(root, "litecode.config.json")).text();
  expect(text).toMatch(/^\t"project"/m);
  expect(text).not.toMatch(/^  "project"/m);
});

test("an invalid ticket is reported, not silently skipped", async () => {
  const root = await legacyProject();
  await Bun.write(join(root, "docs/tickets/0002-broken.md"), V1_TICKET.replace("priority: medium", "priority: urgent").replace("0001-old-ticket", "0002-broken"));
  const tickets = (await plan(root)).find((p) => p.id === "tickets")!;
  expect(tickets.skipped.map((s) => s.summary)).toContain("leave docs/tickets/0002-broken.md as it is");
});

test("an orphan edited after the plan was shown is not deleted", async () => {
  const root = await legacyProject();
  const plans = await plan(root);
  await Bun.write(join(root, ".claude/agents/sync.md"), "edited while the prompt was open\n");
  const err = await applyUpgrade(plans, () => {}).catch((e: Error) => e);
  expect((err as Error).message).toContain("changed since the plan was shown");
  expect(await Bun.file(join(root, ".claude/agents/sync.md")).text()).toBe("edited while the prompt was open\n");
});

test("deleting a removed skill's file also removes its now-empty folder", async () => {
  const root = await legacyProject();
  await Bun.write(join(root, ".claude/skills/github-project-sync/SKILL.md"), "---\nname: github-project-sync\n---\nold skill\n");
  await applyUpgrade(await plan(root), () => {});
  expect(await Bun.file(join(root, ".claude/skills/github-project-sync/SKILL.md")).exists()).toBe(false);
  const { readdir } = await import("node:fs/promises");
  expect(await readdir(join(root, ".claude/skills"))).not.toContain("github-project-sync");
});

test("angles and domains that never named a removed skill are left untouched, even with no skills", async () => {
  const root = await legacyProject();
  await editConfig(root, (raw) => {
    raw.project.angles.push({ name: "no-skills-angle", covers: "API contracts", triggeredBy: "src/api", skills: [] });
    raw.project.angles.push({ name: "legacy-board-angle", covers: "old board", triggeredBy: "board", skills: ["github-project-sync"] });
  });
  const details = (await plan(root)).find((p) => p.id === "config")!.changes[0]!.details!;
  expect(details.some((d) => d.includes("left with no skill"))).toBe(false);
  expect(details.some((d) => d.includes("github-project-sync from project.angles"))).toBe(true);

  await applyUpgrade(await plan(root), () => {});
  const angles = (await Bun.file(join(root, "litecode.config.json")).json()).project.angles;
  expect(angles.find((a: { name: string }) => a.name === "no-skills-angle").skills).toEqual([]);
  expect(angles.find((a: { name: string }) => a.name === "legacy-board-angle").skills).toEqual([]);
});

test("a symlinked directory can't lead a deletion out of the project", async () => {
  const root = await legacyProject();
  const outside = await tempDir("litecode-outside-");
  await Bun.write(join(outside, "victim.txt"), "keep me\n");
  const { symlink } = await import("node:fs/promises");
  await symlink(outside, join(root, "h"));
  await editConfig(root, (raw) => {
    raw.project.board.dataFile = "h/victim.txt";
  });
  const lock = (await readLockfile(root, lockPath("claude-code")))!;
  lock.files["h/victim.txt"] = { pack: "core", version: "0.3.0", hash: hash("keep me\n") };
  await writeLockfile(root, lock, lockPath("claude-code"));

  const plans = await plan(root);
  expect(plans.flatMap((p) => p.changes.map((c) => c.summary))).not.toContain("delete h/victim.txt");
  await applyUpgrade(plans, () => {});
  expect(await Bun.file(join(outside, "victim.txt")).text()).toBe("keep me\n");
});

test("deleting the last legacy data file removes the emptied data folder; a non-file path is reported", async () => {
  const root = await legacyProject();
  await applyUpgrade(await plan(root), () => {});
  const { readdir } = await import("node:fs/promises");
  expect(await readdir(join(root, ".claude"))).not.toContain("data");

  const other = await legacyProject();
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(other, "cache/board"), { recursive: true });
  await editConfig(other, (raw) => {
    raw.project.board.dataFile = "cache/board";
  });
  const data = (await plan(other)).find((p) => p.id === "legacy-data")!;
  expect(data.skipped.map((s) => s.summary)).toContain("keep cache/board");
});

test("CRLF line endings survive the config rewrite", async () => {
  const root = await legacyProject();
  const path = join(root, "litecode.config.json");
  await Bun.write(path, (await Bun.file(path).text()).replace(/\n/g, "\r\n"));
  await applyUpgrade(await plan(root), () => {});
  const text = await Bun.file(path).text();
  expect(text.includes("\r\n")).toBe(true);
  expect(/[^\r]\n/.test(text)).toBe(false);
});

test("a project freshly set up with this release gets an empty upgrade plan", async () => {
  const root = await tempDir("litecode-upgrade-fresh-");
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "bun test" } }));
  const { init } = await import("../src/init.ts");
  const path = await init(root, { yes: true, packsRoot: PACKS, targets: ["claude-code", "codex", "opencode", "kilo-code", "pi"] });
  const raw = await Bun.file(path).json();
  raw.project.repo = "demo/demo";
  raw.project.checkCommand = "bun test";
  await Bun.write(path, JSON.stringify(raw, null, 2) + "\n");
  await applyPlan(root, await buildPlan(root, PACKS, ConfigSchema.parse(raw)), "1.1.0", { force: false });

  const plans = await plan(root);
  expect(plans.flatMap((p) => [...p.changes.map((c) => c.summary), ...p.skipped.map((s) => s.summary)])).toEqual([]);
});

test("a tool directory symlinked outside the project raises no skip for files that aren't there", async () => {
  const root = await tempDir("litecode-upgrade-linked-");
  const shared = await tempDir("litecode-shared-claude-");
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "bun test" } }));
  const { init } = await import("../src/init.ts");
  const path = await init(root, { yes: true, packsRoot: PACKS, targets: ["claude-code"] });
  const raw = await Bun.file(path).json();
  raw.project.repo = "demo/demo";
  raw.project.checkCommand = "bun test";
  await Bun.write(path, JSON.stringify(raw, null, 2) + "\n");
  const { symlink, rename } = await import("node:fs/promises");
  await applyPlan(root, await buildPlan(root, PACKS, ConfigSchema.parse(raw)), "1.1.0", { force: false });
  await rename(join(root, ".claude"), join(shared, ".claude"));
  await symlink(join(shared, ".claude"), join(root, ".claude"));
  expect((await plan(root)).flatMap((p) => p.skipped)).toEqual([]);
});

test("a data folder symlinked within the project: the file is deleted, the link is left alone, and the run succeeds", async () => {
  const root = await legacyProject();
  const { mkdir, rename, symlink, lstat } = await import("node:fs/promises");
  await mkdir(join(root, "cache"));
  await rename(join(root, ".claude/data"), join(root, "cache/data"));
  await symlink("../cache/data", join(root, ".claude/data"));
  await editConfig(root, (raw) => {
    raw.project.board.dataFile = "./.claude/data/board.json";
  });
  const plans = await plan(root);
  expect(plans.find((p) => p.id === "legacy-data")!.changes.map((c) => c.summary)).toEqual([
    "delete .claude/data/board.json",
  ]);
  await applyUpgrade(plans, () => {});
  expect((await lstat(join(root, ".claude/data"))).isSymbolicLink()).toBe(true);
  expect(await Bun.file(join(root, "cache/data/board.json")).exists()).toBe(false);
});

test("the config rewrite follows the file's dominant indent, and its missing trailing newline", async () => {
  const { formatLike } = await import("../src/project-upgrade-config.ts");
  const value = { a: { b: 1 }, c: 2 };
  expect(formatLike('{\n  "a": {\n    "b": 2\n  },\n "c": 2\n}\n', value)).toBe('{\n  "a": {\n    "b": 1\n  },\n  "c": 2\n}\n');
  expect(formatLike('{\n    "a": 1\n}', value)).toBe('{\n    "a": {\n        "b": 1\n    },\n    "c": 2\n}');
  expect(formatLike('{\r\n\t"a": 1\r\n}\r\n', value)).toBe('{\r\n\t"a": {\r\n\t\t"b": 1\r\n\t},\r\n\t"c": 2\r\n}\r\n');
});
