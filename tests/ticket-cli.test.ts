import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/init.ts";
import { ConfigSchema } from "../src/config.ts";

const realBin = process.env.LITECODE_GH_BIN;

/**
 * Tickets are purely local (ADR 0015): no `ticket` command may call `gh`. A stub that
 * fails loudly on any invocation proves it — a command that shelled out would error.
 */
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "litecode-gh-stub-"));
  const bin = join(dir, "gh");
  await writeFile(bin, `#!/usr/bin/env bash\necho "gh must not be called by ticket commands: $*" >&2\nexit 97\n`);
  await chmod(bin, 0o755);
  process.env.LITECODE_GH_BIN = bin;
});

afterEach(() => {
  if (realBin) process.env.LITECODE_GH_BIN = realBin;
  else delete process.env.LITECODE_GH_BIN;
});

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const PACKS = join(import.meta.dir, "..", "packs");

function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

async function runCli(cwd: string, args: string[]): Promise<string> {
  const { output } = await runCliWithExit(cwd, args);
  return output;
}

async function runCliWithExit(cwd: string, args: string[]): Promise<{ output: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], { cwd, env: process.env, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { output: plain(out + err), exitCode };
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litecode-ticket-cli-"));
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "bun test" } }));
  const path = await init(root, { yes: true, packsRoot: PACKS, targets: ["claude-code"] });
  const raw = ConfigSchema.parse(await Bun.file(path).json());
  raw.project.repo = "demo/demo";
  raw.project.checkCommand = "bun test";
  await Bun.write(path, `${JSON.stringify(raw, null, 2)}\n`);
  return root;
}

test("`ticket new` drafts a v2 file locally, without calling gh", async () => {
  const root = await project();
  const { output, exitCode } = await runCliWithExit(root, ["ticket", "new", "--title", "Fix the flaky thing", "--label", "bug"]);
  expect(exitCode).toBe(0);
  expect(output).toContain("created");
  expect(output).not.toContain("sync");

  const file = await Bun.file(join(root, "docs/tickets/0001-fix-the-flaky-thing.md")).text();
  expect(file).toContain("schemaVersion: 2");
  expect(file).not.toMatch(/^(issue|synced|syncedAt):/m);

  const list = await runCli(root, ["ticket", "list"]);
  expect(list).toContain("backlog");
  expect(list).toContain("0001-fix-the-flaky-thing");
});

test("`ticket new` blocks a title that overlaps an existing ticket, naming its id", async () => {
  const root = await project();
  await runCli(root, ["ticket", "new", "--title", "Improve error logging for the traveller agent", "--label", "bug"]);

  const { output, exitCode } = await runCliWithExit(root, [
    "ticket", "new",
    "--title", "Improve error logging for the traveller agent",
    "--label", "bug",
  ]);
  expect(exitCode).toBe(1);
  expect(output).toMatch(/duplicate/i);
  expect(output).toContain("0001-improve-error-logging-for-the-traveller-agent");
});

test("`ticket new --force` creates the ticket despite an overlapping one", async () => {
  const root = await project();
  await runCli(root, ["ticket", "new", "--title", "Improve error logging", "--label", "bug"]);
  const output = await runCli(root, ["ticket", "new", "--title", "Improve error logging", "--label", "bug", "--force"]);
  expect(output).toContain("created");
});

test("`ticket new` rejects an unknown label or priority", async () => {
  const root = await project();
  const bad = await runCli(root, ["ticket", "new", "--title", "x", "--label", "nonsense"]);
  expect(bad).toMatch(/label/i);

  const badPriority = await runCli(root, [
    "ticket", "new", "--title", "x", "--label", "bug", "--priority", "urgent",
  ]);
  expect(badPriority).toMatch(/priority/i);
});

test("`ticket list` reports a malformed file as an error without losing the others", async () => {
  const root = await project();
  await runCli(root, ["ticket", "new", "--title", "Good ticket", "--label", "feature"]);
  await Bun.write(join(root, "docs/tickets", "0002-broken.md"), "not frontmatter at all");

  const list = await runCli(root, ["ticket", "list"]);
  expect(list).toContain("0001-good-ticket");
  expect(list).toContain("error");
  expect(list).toContain("0002-broken.md");
});

const V1_TICKET = `---
schemaVersion: 1
id: 0007-old-synced-ticket
title: Old synced ticket
label: bug
status: review
priority: high
size: small
assignedAgent: human
dueDate:
issue: 45
synced: false
syncedAt: 2026-09-21T15:36:13.172Z
---

The original body.

<!-- litecode:comment -->
A comment sync never got to post.
<!-- /litecode:comment -->
`;

test("`ticket doctor` flags a v1 ticket, and `ticket migrate --apply` rewrites it as v2", async () => {
  const root = await project();
  const path = join(root, "docs/tickets/0007-old-synced-ticket.md");
  await Bun.write(path, V1_TICKET);

  const doctor = await runCliWithExit(root, ["ticket", "doctor"]);
  expect(doctor.output).toContain("schema v1");
  expect(doctor.output).toContain("ticket migrate");

  const dry = await runCli(root, ["ticket", "migrate"]);
  expect(dry).toContain("0007-old-synced-ticket.md");
  expect(dry).toContain("Dry run");
  expect(await Bun.file(path).text()).toBe(V1_TICKET);

  const { exitCode } = await runCliWithExit(root, ["ticket", "migrate", "--apply"]);
  expect(exitCode).toBe(0);
  const migrated = await Bun.file(path).text();
  expect(migrated).toContain("schemaVersion: 2");
  expect(migrated).toContain("status: review");
  expect(migrated).not.toMatch(/^(issue|synced|syncedAt):/m);
  expect(migrated).not.toContain("litecode:comment");
  expect(migrated).toContain("The original body.");
  expect(migrated).toContain("A comment sync never got to post.");

  expect((await runCli(root, ["ticket", "migrate"]))).toContain("already schema v2");
  expect((await runCliWithExit(root, ["ticket", "doctor"])).output).not.toContain("schema v1");
});

test("`ticket sync` no longer exists", async () => {
  const root = await project();
  const { exitCode } = await runCliWithExit(root, ["ticket", "sync", "--apply"]);
  expect(exitCode).toBe(1);
});
