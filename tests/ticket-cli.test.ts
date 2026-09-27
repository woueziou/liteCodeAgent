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
  const output = plain(out + err);
  // The gh stub prints this on any call. A command that shelled out and then swallowed the
  // failure (try/catch, a fallback) would otherwise pass unnoticed.
  expect(output).not.toContain("gh must not be called");
  return { output, exitCode };
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

test("`ticket move` writes an allowed transition", async () => {
  const root = await project();
  await runCli(root, ["ticket", "new", "--title", "Move me", "--label", "feature"]);
  await runCli(root, ["ticket", "move", "0001-move-me", "planned"]);
  const output = await runCli(root, ["ticket", "move", "0001-move-me", "inProgress"]);
  expect(output).toContain("moved");
  expect(output).toContain("planned -> inProgress");

  const file = await Bun.file(join(root, "docs/tickets/0001-move-me.md")).text();
  expect(file).toMatch(/^status: inProgress$/m);
});

test("`ticket move` refuses planned -> review: inProgress is required first", async () => {
  const root = await project();
  await runCli(root, ["ticket", "new", "--title", "Cannot skip", "--label", "feature"]);
  await runCli(root, ["ticket", "move", "0001-cannot-skip", "planned"]);

  const { output, exitCode } = await runCliWithExit(root, ["ticket", "move", "0001-cannot-skip", "review"]);
  expect(exitCode).toBe(1);
  expect(output).toMatch(/refusing/i);

  const file = await Bun.file(join(root, "docs/tickets/0001-cannot-skip.md")).text();
  expect(file).toMatch(/^status: planned$/m);
});

test("`ticket move` accepts a bare NNNN id, not just the full slug", async () => {
  const root = await project();
  await runCli(root, ["ticket", "new", "--title", "Short id", "--label", "feature"]);
  const output = await runCli(root, ["ticket", "move", "0001", "planned"]);
  expect(output).toContain("moved 0001-short-id");
});

test("`ticket move` allows review -> inProgress and readyToMerge -> inProgress for a same-PR fixup", async () => {
  const root = await project();
  await runCli(root, ["ticket", "new", "--title", "Fixup me", "--label", "feature"]);
  await runCli(root, ["ticket", "move", "0001-fixup-me", "planned"]);
  await runCli(root, ["ticket", "move", "0001-fixup-me", "inProgress"]);
  await runCli(root, ["ticket", "move", "0001-fixup-me", "review"]);

  const output = await runCli(root, ["ticket", "move", "0001-fixup-me", "inProgress"]);
  expect(output).toContain("review -> inProgress");
});

test("`ticket move` rejects an unknown status and an unknown id", async () => {
  const root = await project();
  await runCli(root, ["ticket", "new", "--title", "Known ticket", "--label", "feature"]);

  const badStatus = await runCliWithExit(root, ["ticket", "move", "0001-known-ticket", "nonsense"]);
  expect(badStatus.exitCode).toBe(1);
  expect(badStatus.output).toMatch(/status/i);

  const badId = await runCliWithExit(root, ["ticket", "move", "9999-nope", "planned"]);
  expect(badId.exitCode).toBe(1);
  expect(badId.output).toMatch(/no ticket/i);
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

test("`ticket sync` no longer exists: it prints usage instead of planning a push", async () => {
  const root = await project();
  await runCli(root, ["ticket", "new", "--title", "Something to push", "--label", "bug"]);
  const { output, exitCode } = await runCliWithExit(root, ["ticket", "sync"]);
  expect(exitCode).toBe(1);
  expect(output).toContain("ticket migrate");
  expect(output).not.toMatch(/Dry run|create\s+docs\/tickets/);
});

test("`ticket migrate` refuses to drop unknown frontmatter keys unless --force", async () => {
  const root = await project();
  const path = join(root, "docs/tickets/0007-old-synced-ticket.md");
  const withEpic = V1_TICKET.replace("dueDate:\n", "dueDate:\nepic: payments\n");
  expect(withEpic).toContain("epic: payments");
  await Bun.write(path, withEpic);

  const refused = await runCliWithExit(root, ["ticket", "migrate", "--apply"]);
  expect(refused.exitCode).toBe(1);
  expect(refused.output).toContain("epic");
  expect(await Bun.file(path).text()).toContain("schemaVersion: 1");

  const forced = await runCliWithExit(root, ["ticket", "migrate", "--apply", "--force"]);
  expect(forced.exitCode).toBe(0);
  expect(await Bun.file(path).text()).not.toContain("epic");
});

test("`ticket doctor` warns about a ticket from a newer schema", async () => {
  const root = await project();
  await Bun.write(
    join(root, "docs/tickets/0008-from-the-future.md"),
    V1_TICKET.replace("schemaVersion: 1", "schemaVersion: 3").replace("0007-old-synced-ticket", "0008-from-the-future"),
  );
  expect((await runCliWithExit(root, ["ticket", "doctor"])).output).toContain("newer than this CLI understands");
});
