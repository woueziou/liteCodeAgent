import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
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

/**
 * A project installed by a 0.x release, as far as `upgrade` can tell: current packs
 * installed, plus everything 0.x left behind — the `sync` agent and `github-project-sync`
 * skill as lockfile-owned files (one of them edited since), a config still naming that
 * skill and the removed settings, a v1 ticket, and the board's data file.
 */
async function legacyProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litecode-upgrade-"));
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
  expect(shown.exitCode).toBe(0);
  expect(shown.output).toContain("delete .claude/agents/sync.md");
  expect(shown.output).toContain("Re-run with --yes");
  expect(await Bun.file(join(root, ".claude/agents/sync.md")).exists()).toBe(true);

  const applied = await runCli(root, ["upgrade", "--no-self-update", "--yes"]);
  expect(applied.exitCode).toBe(0);
  expect(applied.output).toContain("Upgraded:");
  expect(await Bun.file(join(root, ".claude/agents/sync.md")).exists()).toBe(false);

  expect((await runCli(root, ["upgrade", "--no-self-update"])).output).toContain("Already up to date");
});

test("`upgrade` in a directory that isn't a LiteCodeAgent project says so and changes nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-upgrade-empty-"));
  const { output, exitCode } = await runCli(root, ["upgrade", "--no-self-update"]);
  expect(exitCode).toBe(0);
  expect(output).toContain("nothing to upgrade here");
});
