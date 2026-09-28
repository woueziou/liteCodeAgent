import { afterEach, expect, test } from "bun:test";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/init.ts";
import { ConfigSchema } from "../src/config.ts";

const realBin = process.env.LITECODE_GH_BIN;

afterEach(() => {
  if (realBin) process.env.LITECODE_GH_BIN = realBin;
  else delete process.env.LITECODE_GH_BIN;
});

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const PACKS = join(import.meta.dir, "..", "packs");

function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

async function runCliWithExit(cwd: string, args: string[]): Promise<{ output: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], { cwd, env: process.env, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { output: plain(out + err), exitCode };
}

/** A project with `project.board.number` configured, since `import-board` requires it. */
async function projectWithBoard(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litecode-import-board-cli-"));
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "bun test" } }));
  const path = await init(root, { yes: true, packsRoot: PACKS, targets: ["claude-code"] });
  const raw = ConfigSchema.parse(await Bun.file(path).json());
  raw.project.repo = "acme/widgets";
  raw.project.checkCommand = "bun test";
  raw.project.board = { enabled: true, owner: "acme", number: 7, dataFile: ".claude/data/board.json", itemIdCache: ".claude/data/x.json" };
  await Bun.write(path, `${JSON.stringify(raw, null, 2)}\n`);
  return root;
}

async function stubGhForBoard(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-gh-board-"));
  const bin = join(dir, "gh");
  await writeFile(
    bin,
    `#!/usr/bin/env bash
if [ "$1 $2 $3" = "project item-list 7" ]; then
  cat <<'JSON'
{"items":[
  {"id":"PVTI_1","status":"In Progress","priority":"High","content":{"type":"Issue","number":42,"repository":"acme/widgets"}},
  {"id":"PVTI_2","content":{"type":"DraftIssue","title":"Draft idea","body":"raw text"}}
]}
JSON
  exit 0
fi
if [ "$1 $2" = "issue view" ]; then
  echo '{"number":42,"title":"Fix the thing","body":"## Contexte\\nc\\n\\n## Critères d'"'"'acceptation\\nc\\n\\n## Plan\\np\\n\\n## Hors périmètre\\nn/a"}'
  exit 0
fi
echo "unexpected gh args: $*" >&2
exit 1
`,
  );
  await chmod(bin, 0o755);
  process.env.LITECODE_GH_BIN = bin;
}

test("`ticket import-board` without --apply simulates and writes nothing, GitHub reads are read-only calls", async () => {
  const root = await projectWithBoard();
  await stubGhForBoard();
  const { output, exitCode } = await runCliWithExit(root, ["ticket", "import-board"]);
  expect(exitCode).toBe(0);
  expect(output).toContain("would import");
  expect(output).toMatch(/2 importé/);
  expect(await Bun.file(join(root, "docs/tickets/0001-fix-the-thing.md")).exists()).toBe(false);
});

test("`ticket import-board --apply` writes tickets and is idempotent on a second run", async () => {
  const root = await projectWithBoard();
  await stubGhForBoard();
  const first = await runCliWithExit(root, ["ticket", "import-board", "--apply"]);
  expect(first.exitCode).toBe(0);
  expect(first.output).toContain("imported");
  expect(first.output).toMatch(/2 importé/);

  const files = await Array.fromAsync(new Bun.Glob("docs/tickets/*.md").scan({ cwd: root }));
  expect(files).toHaveLength(2);
  const issueFile = await Bun.file(join(root, files.find((f) => f.includes("fix-the-thing"))!)).text();
  expect(issueFile).toContain("importedFrom: github:acme/widgets#42");

  const second = await runCliWithExit(root, ["ticket", "import-board", "--apply"]);
  expect(second.exitCode).toBe(0);
  expect(second.output).toMatch(/0 importé/);
  expect(second.output).toMatch(/2 ignoré/);
});

test("`ticket import-board` refuses when project.board.number is not configured", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-import-board-noboard-"));
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "bun test" } }));
  const path = await init(root, { yes: true, packsRoot: PACKS, targets: ["claude-code"] });
  const raw = ConfigSchema.parse(await Bun.file(path).json());
  raw.project.repo = "acme/widgets";
  raw.project.checkCommand = "bun test";
  await Bun.write(path, `${JSON.stringify(raw, null, 2)}\n`);

  const { output, exitCode } = await runCliWithExit(root, ["ticket", "import-board"]);
  expect(exitCode).toBe(1);
  expect(output).toMatch(/not configured/);
});

test("`ticket import-board --board <owner>/<number>` overrides config, for a project whose config was already cleaned", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-import-board-boardflag-"));
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "bun test" } }));
  const path = await init(root, { yes: true, packsRoot: PACKS, targets: ["claude-code"] });
  const raw = ConfigSchema.parse(await Bun.file(path).json());
  raw.project.repo = "acme/widgets";
  raw.project.checkCommand = "bun test";
  await Bun.write(path, `${JSON.stringify(raw, null, 2)}\n`); // no project.board at all — already cleaned
  await stubGhForBoard();

  const { output, exitCode } = await runCliWithExit(root, ["ticket", "import-board", "--board", "acme/7"]);
  expect(exitCode).toBe(0);
  expect(output).toContain("would import");
  expect(output).toMatch(/2 importé/);
});

test("`ticket import-board --board` rejects a malformed value", async () => {
  const root = await projectWithBoard();
  const { output, exitCode } = await runCliWithExit(root, ["ticket", "import-board", "--board", "not-owner-slash-number"]);
  expect(exitCode).toBe(1);
  expect(output).toMatch(/--board expects/);
});

test("`ticket import-board --board` with no trailing value errors instead of silently using the configured board", async () => {
  const root = await projectWithBoard();
  const { output, exitCode } = await runCliWithExit(root, ["ticket", "import-board", "--board"]);
  expect(exitCode).toBe(1);
  expect(output).toMatch(/--board expects/);
});

test("end-to-end: `upgrade --apply` keeps project.board.number, then `ticket import-board` still works", async () => {
  const root = await projectWithBoard();
  await stubGhForBoard();

  // Exit code 1: `upgrade` always flags a configured board as a "skip" needing attention
  // (it never imports on its own), not a failure — the config write itself still lands.
  const upgrade = await runCliWithExit(root, ["upgrade", "--yes"]);
  expect(upgrade.exitCode).toBe(1);
  expect(upgrade.output).toContain("ticket import-board");

  const configAfterUpgrade = await Bun.file(join(root, "litecode.config.json")).json();
  expect(configAfterUpgrade.project.board.number).toBe(7);

  const importResult = await runCliWithExit(root, ["ticket", "import-board", "--apply"]);
  expect(importResult.exitCode).toBe(0);
  expect(importResult.output).toContain("imported");
  expect(importResult.output).toMatch(/2 importé/);
});
