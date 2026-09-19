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
  const proc = Bun.spawn(["bun", "run", CLI, ...args], { cwd, env: process.env, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  return plain(out + err);
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
