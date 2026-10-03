import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareSizes, loadBaselineConfig, measurePackSizes, renderedWords } from "../src/pack-sizes.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const PACKS = join(import.meta.dir, "..", "packs");

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
const tempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "litecode-sizes-"));
  dirs.push(dir);
  return dir;
};

test("compareSizes warns only above the threshold, stores the percent, and lists new and removed files", () => {
  const m = (rendered: number) => ({ rendered, source: rendered });
  const rows = compareSizes(
    { "a/agents/x.md": m(111), "a/agents/y.md": m(110), "a/agents/n.md": m(5) },
    { "a/agents/x.md": 100, "a/agents/y.md": 100, "a/agents/r.md": 9 },
    10,
  );
  const by = Object.fromEntries(rows.map((r) => [r.file, r]));
  expect(by["a/agents/x.md"]).toMatchObject({ now: 111, before: 100, percent: 11, warn: true });
  expect(by["a/agents/y.md"]).toMatchObject({ percent: 10, warn: false });
  expect(by["a/agents/n.md"]).toMatchObject({ now: 5, before: undefined, percent: undefined, warn: false });
  expect(by["a/agents/r.md"]).toMatchObject({ now: undefined, before: 9, percent: undefined, warn: false });
});

test("measurePackSizes counts what the install renders: template output, and reference files", async () => {
  const root = await tempDir();
  await Bun.write(join(root, "p", "pack.json"), JSON.stringify({ name: "p", version: "1.0.0", description: "d" }));
  await Bun.write(join(root, "p", "agents", "a.md"), "---\nname: a\ndescription: d\n---\nSee {{> reference more}} now.");
  await Bun.write(join(root, "p", "reference", "more.md"), "---\nname: more\ndescription: d\n---\n" + "x ".repeat(30));
  const sizes = await measurePackSizes(root, await loadBaselineConfig());
  expect(Object.keys(sizes).sort()).toEqual(["p/agents/a.md", "p/reference/more.md"]);
  // The helper expands to a longer text than the three source words it replaces.
  expect(sizes["p/agents/a.md"]!.rendered).toBeGreaterThan(sizes["p/agents/a.md"]!.source);
  expect(sizes["p/reference/more.md"]!.source).toBeGreaterThanOrEqual(30);
});

test("measurePackSizes gives every skill of the real packs, install-on-reference ones included, a rendered size", async () => {
  const sizes = await measurePackSizes(PACKS, await loadBaselineConfig());
  for (const f of [
    "core/agents/implementer.md",
    "core/skills/security-expert/SKILL.md",
    "core/reference/implementer-batch.md",
    "web/skills/ui-ux-expert/SKILL.md",
  ]) {
    expect(sizes[f]?.rendered).toBeGreaterThan(0);
  }
  // A rendered agent carries helper text the source only names, so it is not smaller than its source.
  expect(sizes["core/agents/implementer.md"]!.rendered).toBeGreaterThan(sizes["core/agents/implementer.md"]!.source);
});

async function run(args: string[], cwd: string) {
  const proc = Bun.spawn([process.execPath, CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { out, err, code };
}

test("packs --sizes prints rendered words per file and exits 0", async () => {
  const { out, code } = await run(["packs", "--sizes"], tmpdir());
  expect(code).toBe(0);
  for (const f of [
    "core/agents/implementer.md",
    "core/skills/security-expert/SKILL.md",
    "core/reference/implementer-batch.md",
    "web/skills/ui-ux-expert/SKILL.md",
  ]) {
    expect(out).toMatch(new RegExp(`${f.replace(/[./]/g, "\\$&")}\\s+\\d+`));
  }
});

test("packs --sizes warns on a file that grew past the threshold, still exits 0, and --update records the rendered sizes", async () => {
  const dir = await tempDir();
  const snap = join(dir, "snap.json");
  await Bun.write(snap, JSON.stringify({ "core/agents/implementer.md": 100, "core/agents/gone.md": 50 }));
  const warned = await run(["packs", "--sizes", "--snapshot", snap], dir);
  expect(warned.code).toBe(0);
  expect(warned.out).toMatch(/core\/agents\/implementer\.md .*100 .*!/);
  expect(warned.out).toContain("core/agents/gone.md");
  await run(["packs", "--sizes", "--update", "--snapshot", snap], dir);
  const recorded = await Bun.file(snap).json();
  const measured = renderedWords(await measurePackSizes(PACKS, await loadBaselineConfig()));
  expect(recorded).toEqual(measured);
  expect(recorded["core/agents/gone.md"]).toBeUndefined();
  const again = await run(["packs", "--sizes", "--snapshot", snap], dir);
  expect(again.code).toBe(0);
  expect(again.out).not.toContain("!");
});

test("the committed docs/token-sizes.json covers exactly the files measured now", async () => {
  const committed = await Bun.file(join(import.meta.dir, "..", "docs", "token-sizes.json")).json();
  const measured = await measurePackSizes(PACKS, await loadBaselineConfig());
  expect(Object.keys(committed).sort()).toEqual(Object.keys(measured).sort());
});

test("packs --update without --sizes is an error", async () => {
  const { err, code } = await run(["packs", "--update"], tmpdir());
  expect(code).not.toBe(0);
  expect(err).toContain("--sizes");
});
