import { afterEach, expect, test } from "bun:test";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/init.ts";
import { ConfigSchema } from "../src/config.ts";

const realBin = process.env.LITECODE_GH_BIN;

/** Stands in for `gh issue list`, returning a fixed JSON array of open issues. */
async function stubGhIssueList(issues: { number: number; title: string }[]): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-gh-stub-"));
  const bin = join(dir, "gh");
  await writeFile(bin, `#!/usr/bin/env bash\necho '${JSON.stringify(issues)}'\n`);
  await chmod(bin, 0o755);
  process.env.LITECODE_GH_BIN = bin;
}

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
  raw.project.board.owner = "demo";
  await Bun.write(path, `${JSON.stringify(raw, null, 2)}\n`);
  return root;
}

test("`ticket new` drafts a file locally, dirty by default, once the duplicate check clears", async () => {
  await stubGhIssueList([]);
  const root = await project();
  const output = await runCli(root, ["ticket", "new", "--title", "Fix the flaky thing", "--label", "bug"]);
  expect(output).toContain("created");
  expect(output).toContain("docs/tickets");

  const list = await runCli(root, ["ticket", "list"]);
  expect(list).toContain("dirty");
  expect(list).toContain("(no issue yet)");
});

test("`ticket new` blocks a title that overlaps an open issue (the #18/#19 -> #21/#22 incident)", async () => {
  await stubGhIssueList([{ number: 18, title: "fix(install): pre-flight validate agentSkills config paths" }]);
  const root = await project();
  const output = await runCli(root, [
    "ticket", "new",
    "--title", "pre-flight validate agentSkills config paths before install",
    "--label", "bug",
  ]);
  expect(output).toMatch(/duplicate/i);
  expect(output).toContain("#18");

  const list = await runCli(root, ["ticket", "list"]);
  expect(list).not.toContain("pre-flight-validate");
});

test("`ticket new --force` creates the ticket despite an overlapping open issue", async () => {
  await stubGhIssueList([{ number: 18, title: "fix(install): pre-flight validate agentSkills config paths" }]);
  const root = await project();
  const output = await runCli(root, [
    "ticket", "new",
    "--title", "pre-flight validate agentSkills config paths before install",
    "--label", "bug",
    "--force",
  ]);
  expect(output).toContain("created");
});

test("`ticket new` blocks a title that overlaps an existing local ticket, naming its id", async () => {
  await stubGhIssueList([]);
  const root = await project();
  await runCli(root, ["ticket", "new", "--title", "Improve error logging for the traveller agent", "--label", "bug"]);

  const output = await runCli(root, [
    "ticket", "new",
    "--title", "Improve error logging for the traveller agent",
    "--label", "bug",
  ]);
  expect(output).toMatch(/duplicate/i);
  expect(output).toContain("0001-improve-error-logging-for-the-traveller-agent");
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

test("`ticket sync --auto` no-ops without touching `gh` when the last attempt is inside the cooldown", async () => {
  const root = await project();
  await runCli(root, ["ticket", "new", "--title", "Anything", "--label", "feature"]);

  await Bun.write(
    join(root, ".claude/data/ticket-sync-auto-state.json"),
    JSON.stringify({ lastAttemptAt: new Date().toISOString() }, null, 2) + "\n",
  );

  // No `gh` stub installed at all: if the cooldown didn't short-circuit before `ensureAuth`,
  // this would fail trying to invoke a real `gh` binary instead of just no-op'ing.
  const output = await runCli(root, ["ticket", "sync", "--auto"]);
  expect(output).toMatch(/skipping auto-sync/i);
});

test("`ticket sync --auto` runs (and records the attempt) once the cooldown has passed", async () => {
  const root = await project();

  await Bun.write(
    join(root, ".claude/data/ticket-sync-auto-state.json"),
    JSON.stringify({ lastAttemptAt: new Date(0).toISOString() }, null, 2) + "\n",
  );
  await stubGhIssueList([]);

  const output = await runCli(root, ["ticket", "sync", "--auto"]);
  expect(output).not.toMatch(/skipping auto-sync/i);

  const state = await Bun.file(join(root, ".claude/data/ticket-sync-auto-state.json")).json();
  expect(Date.now() - Date.parse(state.lastAttemptAt)).toBeLessThan(60_000);
});

test("`ticket sync` no-ops gracefully on a fresh repo with no tickets at all", async () => {
  const root = await project();
  // No `ticket new` ever ran — genuinely fresh, no board.json/board setup involved any more.
  await stubGhIssueList([]);

  const output = await runCli(root, ["ticket", "sync"]);
  expect(output).toMatch(/no tickets/i);
  expect(output).not.toMatch(/does not exist|Error/i);
});

/**
 * Stands in for the `gh` calls a real `ticket sync --apply` push makes: `auth status`
 * (always ok), `issue create` (echoes a fake issue URL so `applyTicketSync` can read the
 * number back out of it), and `issue comment`/`issue edit`. Anything else fails loudly so
 * an unexpected mutating call is caught rather than silently stubbed away — there is no
 * board left to call into at all.
 */
async function stubGhForPush(issueNumber: number): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-gh-stub-"));
  const bin = join(dir, "gh");
  await writeFile(
    bin,
    `#!/usr/bin/env bash
if [ "$1" = "auth" ]; then exit 0; fi
if [ "$1 $2" = "issue create" ]; then echo "https://github.com/demo/demo/issues/${issueNumber}"; exit 0; fi
if [ "$1 $2" = "issue edit" ]; then exit 0; fi
if [ "$1 $2" = "issue comment" ]; then exit 0; fi
echo "unexpected gh call: $*" >&2; exit 1
`,
  );
  await chmod(bin, 0o755);
  process.env.LITECODE_GH_BIN = bin;
}

test("`ticket sync --apply` pushes a new ticket with `gh issue create` and records the issue number", async () => {
  const root = await project();
  await stubGhIssueList([]);
  await runCli(root, ["ticket", "new", "--title", "Push me", "--label", "feature"]);

  await stubGhForPush(42);
  const { output, exitCode } = await runCliWithExit(root, ["ticket", "sync", "--apply"]);
  expect(exitCode).toBe(0);
  expect(output).toContain("created #42");

  const list = await runCli(root, ["ticket", "list"]);
  expect(list).toContain("#42");
  expect(list).toContain("synced");
});
