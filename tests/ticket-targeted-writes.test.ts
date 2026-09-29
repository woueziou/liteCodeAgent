import { expect, test } from "bun:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPack } from "../src/packs.ts";
import { init } from "../src/init.ts";
import { ConfigSchema } from "../src/config.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const PACKS = join(import.meta.dir, "..", "packs");

async function run(cwd: string, args: string[]): Promise<{ out: string; code: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [o, e] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { out: o + e, code: await proc.exited };
}

// Hand-formatted on purpose: single quotes, padded values, a comment, unusual key order.
// A parse + re-serialize round trip cannot reproduce this byte for byte.
const HAND_FORMATTED = `---
schemaVersion: 2
title:   'Hand   formatted'
id: 0001-hand
# a comment the serializer would drop
label: bug
priority:   high
status:   planned
size: small
assignedAgent: human
dueDate:
importedFrom:
---

## Contexte
body   with  odd   spacing
`;

async function setup(): Promise<{ root: string; file: string }> {
  const root = await mkdtemp(join(tmpdir(), "litecode-targeted-"));
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "bun test" } }));
  const cfg = await init(root, { yes: true, packsRoot: PACKS, targets: ["claude-code"] });
  const raw = ConfigSchema.parse(await Bun.file(cfg).json());
  raw.project.repo = "demo/demo";
  raw.project.checkCommand = "bun test";
  await Bun.write(cfg, `${JSON.stringify(raw, null, 2)}\n`);
  await mkdir(join(root, "docs/tickets"), { recursive: true });
  const file = join(root, "docs/tickets/0001-hand.md");
  await Bun.write(file, HAND_FORMATTED);
  return { root, file };
}

test("`ticket move` changes only the status line, byte for byte", async () => {
  const { root, file } = await setup();
  const { code, out } = await run(root, ["ticket", "move", "--project", root, "0001", "inProgress"]);
  expect(out).toContain("moved");
  expect(code).toBe(0);
  expect(await Bun.file(file).text()).toBe(HAND_FORMATTED.replace("status:   planned", "status: inProgress"));
});

test("`ticket note` only appends to the end of the body, rest untouched byte for byte", async () => {
  const { root, file } = await setup();
  const notePath = join(root, "note.txt");
  await Bun.write(notePath, "### 2026-09-29 — implementer: n\n\ndetails\n");
  const { code, out } = await run(root, ["ticket", "note", "--project", root, "0001", "--file", notePath]);
  expect(out).toContain("noted");
  expect(code).toBe(0);
  const after = await Bun.file(file).text();
  expect(after.startsWith(HAND_FORMATTED.trimEnd())).toBe(true);
  expect(after.slice(HAND_FORMATTED.trimEnd().length)).toBe("\n\n### 2026-09-29 — implementer: n\n\ndetails\n");
});

test("implementer.md says how to resolve the CLI when the installed version lacks `ticket note`", async () => {
  const pack = await loadPack(PACKS, "core");
  const src = pack.files.find((f) => f.rel.endsWith("agents/implementer.md"))!.source;
  const skill = pack.files.find((f) => f.rel.endsWith("skills/implementer-cli-resolution/SKILL.md"))!.source;
  expect(src).toMatch(/ticket note --help/);
  expect(src).toContain("implementer-cli-resolution");
  expect(skill).toMatch(/ticket note --help/);
  expect(skill).toMatch(/lacking|lacks|does not have|doesn't have|missing/i);
});

test("dashboard tests never bind a fixed port", async () => {
  const src = await Bun.file(join(import.meta.dir, "dashboard", "serve.test.ts")).text();
  expect(src).not.toMatch(/freshPort|nextPort|41730/);
});

test("two simultaneous runs of the dashboard suite both pass", async () => {
  const spawn = () =>
    Bun.spawn(["bun", "test", join(import.meta.dir, "dashboard", "serve.test.ts")], { stdout: "pipe", stderr: "pipe" });
  const [a, b] = [spawn(), spawn()];
  const codes = await Promise.all([a.exited, b.exited]);
  expect(codes).toEqual([0, 0]);
}, 120_000);

test("`ticket move` rewrites the last of duplicate status lines and an indented one (parser parity)", async () => {
  const { root, file } = await setup();
  await Bun.write(file, HAND_FORMATTED.replace("status:   planned", "status: planned\n  status : backlog"));
  const { code } = await run(root, ["ticket", "move", "--project", root, "0001", "planned"]);
  expect(code).toBe(0);
  const after = await Bun.file(file).text();
  expect(after).toContain("status: planned\nstatus: planned");
});

test("`ticket note` keeps trailing spaces (markdown hard break) of the last existing line", async () => {
  const { root, file } = await setup();
  await Bun.write(file, HAND_FORMATTED.replace("odd   spacing\n", "odd   spacing  \n\n\n"));
  const notePath = join(root, "n.txt");
  await Bun.write(notePath, "note\n");
  await run(root, ["ticket", "note", "--project", root, "0001", "--file", notePath]);
  expect(await Bun.file(file).text()).toContain("odd   spacing  \n\nnote\n");
});
