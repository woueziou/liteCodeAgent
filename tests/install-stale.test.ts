import { expect, test } from "bun:test";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { buildPlan, applyPlan } from "../src/install.ts";
import { readLockfile } from "../src/lockfile.ts";
import { staleEntries, staleFindings } from "../src/install-stale.ts";

const PACKS = join(import.meta.dir, "..", "packs");
const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");

async function setup() {
  const config = ConfigSchema.parse(await Bun.file(EXAMPLE).json());
  const root = await mkdtemp(join(tmpdir(), "litecode-stale-"));
  await Bun.write(join(root, ".claude", "skills", "orpc-expert", "SKILL.md"), "---\nname: orpc-expert\n---\n");
  const packs = await mkdtemp(join(tmpdir(), "litecode-packs-"));
  await cp(PACKS, packs, { recursive: true });
  return { config, root, packs };
}

test("a fresh install has nothing stale", async () => {
  const { config, root, packs } = await setup();
  await applyPlan(root, await buildPlan(root, packs, config), "9.9.9", { force: false });
  const plan = await buildPlan(root, packs, config);
  expect(staleEntries(plan)).toEqual([]);
  expect(staleFindings(plan)).toEqual([]);
});

test("a pack change not yet regenerated is reported as stale, not as hand-edit drift", async () => {
  const { config, root, packs } = await setup();
  await applyPlan(root, await buildPlan(root, packs, config), "9.9.9", { force: false });
  const planner = join(packs, "core", "agents", "planner.md");
  await Bun.write(planner, `${await Bun.file(planner).text()}\nA new pack rule.\n`);
  const plan = await buildPlan(root, packs, config);
  const stale = staleEntries(plan);
  expect(stale.length).toBeGreaterThan(0);
  expect(stale.every((rel) => rel.endsWith("planner.md"))).toBe(true);
  const findings = staleFindings(plan);
  expect(findings).toHaveLength(1);
  expect(findings[0]!.severity).toBe("warn");
  expect(findings[0]!.message).toContain("install --apply");
});

test("re-applying an unchanged plan keeps the lockfile byte-identical (no timestamp churn)", async () => {
  const { config, root, packs } = await setup();
  await applyPlan(root, await buildPlan(root, packs, config), "9.9.9", { force: false });
  const path = join(root, ".claude", ".litecode-lock.json");
  const first = await Bun.file(path).text();
  await Bun.sleep(5);
  await applyPlan(root, await buildPlan(root, packs, config), "9.9.9", { force: false });
  expect(await Bun.file(path).text()).toBe(first);
  expect((await readLockfile(root))!.litecodeVersion).toBe("9.9.9");
});

test("a real change still refreshes installedAt", async () => {
  const { config, root, packs } = await setup();
  await applyPlan(root, await buildPlan(root, packs, config), "9.9.9", { force: false });
  const before = (await readLockfile(root))!;
  await Bun.sleep(5);
  const planner = join(packs, "core", "agents", "planner.md");
  await Bun.write(planner, `${await Bun.file(planner).text()}\nA new pack rule.\n`);
  await applyPlan(root, await buildPlan(root, packs, config), "9.9.9", { force: false });
  expect((await readLockfile(root))!.installedAt).not.toBe(before.installedAt);
});

test("the sync workflow proposes a bot PR on main pushes and never pushes to main", async () => {
  const wf = await Bun.file(join(import.meta.dir, "..", ".github", "workflows", "sync-installed.yml")).text();
  expect(wf).toContain("branches: [main]");
  expect(wf).toContain("install --apply --force");
  expect(wf).toContain("github.actor != 'github-actions[bot]'");
  expect(wf).toContain("pull-requests: write");
  expect(wf).toContain("chore/sync-installed");
  expect(wf).toContain("gh pr create");
  expect(wf).toContain("core.hooksPath=/dev/null commit");
  expect(wf).toContain("gh pr close");
  expect(wf).not.toContain("HEAD:main");
  expect(wf).not.toContain("pull_request:");
});

test("implementer.md tells the agent to leave installed copies to CI", async () => {
  // Ticket 0069: the rule moved out of implementer.md into a reference it points at.
  expect(await Bun.file(join(PACKS, "core", "agents", "implementer.md")).text()).toContain("{{> reference implementer-packs-edit}}");
  const md = await Bun.file(join(PACKS, "core", "reference", "implementer-packs-edit.md")).text();
  expect(md).toContain("commit only `packs/`");
  expect(md).toContain("or resolve a conflict on them by hand");
});
