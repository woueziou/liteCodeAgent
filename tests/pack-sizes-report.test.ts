import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareSizes } from "../src/pack-sizes.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

test("compareSizes warns only above the threshold and lists new and removed files", () => {
  const rows = compareSizes(
    { "a/agents/x.md": 111, "a/agents/y.md": 110, "a/agents/n.md": 5 },
    { "a/agents/x.md": 100, "a/agents/y.md": 100, "a/agents/r.md": 9 },
    10,
  );
  const by = Object.fromEntries(rows.map((r) => [r.file, r]));
  expect(by["a/agents/x.md"]).toMatchObject({ now: 111, before: 100, warn: true });
  expect(by["a/agents/y.md"]).toMatchObject({ warn: false });
  expect(by["a/agents/n.md"]).toMatchObject({ now: 5, before: undefined, warn: false });
  expect(by["a/agents/r.md"]).toMatchObject({ now: undefined, before: 9, warn: false });
});

async function run(args: string[], cwd: string) {
  const proc = Bun.spawn([process.execPath, CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { out, err, code };
}

test("packs --sizes prints every agent and skill with its size and exits 0", async () => {
  const { out, code } = await run(["packs", "--sizes"], tmpdir());
  expect(code).toBe(0);
  for (const f of ["core/agents/implementer.md", "core/skills/security-expert/SKILL.md", "web/skills/ui-ux-expert/SKILL.md"]) expect(out).toContain(f);
  expect(out).toMatch(/core\/agents\/implementer\.md\s+\d+/);
});

test("packs --sizes warns on a file that grew past the threshold, still exits 0, and --update records the snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "litecode-sizes-"));
  try {
    const snap = join(dir, "snap.json");
    await Bun.write(snap, JSON.stringify({ "core/agents/implementer.md": 100, "core/agents/gone.md": 50 }));
    const warned = await run(["packs", "--sizes", "--snapshot", snap], dir);
    expect(warned.code).toBe(0);
    expect(warned.out).toMatch(/core\/agents\/implementer\.md .*100 .*!/);
    expect(warned.out).toContain("core/agents/gone.md");
    await run(["packs", "--sizes", "--update", "--snapshot", snap], dir);
    const recorded = await Bun.file(snap).json();
    expect(recorded["core/agents/implementer.md"]).toBeGreaterThan(1000);
    expect(recorded["core/agents/gone.md"]).toBeUndefined();
    const again = await run(["packs", "--sizes", "--snapshot", snap], dir);
    expect(again.code).toBe(0);
    expect(again.out).not.toContain("!");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
