import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { delegationHelpers } from "../src/delegation.ts";
import { parseFrontmatter } from "../src/frontmatter.ts";
import { applyPlan, buildPlan, lockPath } from "../src/install.ts";
import { hash, readLockfile, writeLockfile } from "../src/lockfile.ts";
import { loadPack } from "../src/packs.ts";
import { applyUpgrade, planUpgrade } from "../src/project-upgrade.ts";

/** Ticket 0068: every agent and skill description is announced in every context, so they stay short. */
const PACKS = join(import.meta.dir, "..", "packs");
const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");
const MAX_WORDS = 20;
const MAX_TOTAL_WORDS = 17 * MAX_WORDS;
const INTERNAL = ["classifier", "panel-selector", "debate-angle", "synthesizer", "planner"];

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
const tempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "litecode-lean-"));
  dirs.push(dir);
  return dir;
};

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

async function descriptions() {
  const pack = await loadPack(PACKS, "core");
  return pack.files
    .filter((f) => /^(agents\/[^/]+\.md|skills\/[^/]+\/SKILL\.md)$/.test(f.rel))
    .map((f) => ({ rel: f.rel, description: parseFrontmatter(f.source, f.rel).data.description ?? "" }));
}

test("every agent and skill description fits in 20 words, and the total is bounded", async () => {
  const all = await descriptions();
  expect(all.length).toBeGreaterThanOrEqual(17);
  for (const { rel, description } of all) {
    expect({ rel, words: words(description), ok: words(description) > 0 && words(description) <= MAX_WORDS }).toEqual({
      rel,
      words: words(description),
      ok: true,
    });
  }
  expect(all.reduce((sum, d) => sum + words(d.description), 0)).toBeLessThanOrEqual(MAX_TOTAL_WORDS);
});

test("internal agents say in one line that orchestrator calls them", async () => {
  const all = await descriptions();
  for (const name of INTERNAL) {
    const entry = all.find((d) => d.rel === `agents/${name}.md`)!;
    expect(entry.description).toMatch(/orchestrator/);
  }
});

const raw = async () => structuredClone(await Bun.file(EXAMPLE).json());
const skillEntries = (plan: Awaited<ReturnType<typeof buildPlan>>, name: string) =>
  plan.entries.filter((e) => e.rel.endsWith(`skills/${name}/SKILL.md`));

/** A throwaway pack: one agent, one filtered skill, one always-on skill. */
async function fakePacks(agentSkills: string): Promise<string> {
  const root = await tempDir();
  await Bun.write(join(root, "demo/pack.json"), JSON.stringify({ name: "demo", version: "1.0.0", description: "d", requires: [] }));
  await Bun.write(join(root, "demo/agents/worker.md"), `---\nname: worker\ndescription: Does work.\ntools: Read\nskills: ${agentSkills}\n---\nBody.\n`);
  await Bun.write(join(root, "demo/skills/niche/SKILL.md"), "---\nname: niche\ndescription: Niche.\ninstall: referenced\n---\nNiche body.\n");
  await Bun.write(join(root, "demo/skills/always/SKILL.md"), "---\nname: always\ndescription: Always.\n---\nAlways body.\n");
  return root;
}

async function demoPlan(packs: string, agentSkills: Record<string, string[]> = {}) {
  const config = await raw();
  config.packs = ["demo"];
  config.project.agentSkills = agentSkills;
  for (const angle of config.project.angles) angle.skills = [];
  config.project.domains = [];
  return buildPlan(await tempDir(), packs, ConfigSchema.parse(config));
}

test("an install-on-reference skill nobody references is not installed; other skills always are", async () => {
  const plan = await demoPlan(await fakePacks(""));
  expect(skillEntries(plan, "niche")).toEqual([]);
  expect(skillEntries(plan, "always").length).toBeGreaterThan(0);
});

test("a skill an installed agent lists is installed, and the install marker never reaches the output", async () => {
  const plan = await demoPlan(await fakePacks("niche"));
  expect(skillEntries(plan, "niche").length).toBeGreaterThan(0);
  for (const e of plan.entries.filter((x) => x.rel.includes("/skills/"))) expect(e.content).not.toMatch(/^install:/m);
});

test("a skill a Domain rule asks for is installed; agentSkills no longer counts", async () => {
  const ignored = await demoPlan(await fakePacks(""), { worker: ["niche"] });
  expect(skillEntries(ignored, "niche")).toEqual([]);
  const config = await raw();
  config.packs = ["demo"];
  for (const angle of config.project.angles) angle.skills = [];
  config.project.domains = [{ match: "niche work", skills: ["niche"] }];
  const plan = await buildPlan(await tempDir(), await fakePacks(""), ConfigSchema.parse(config));
  expect(skillEntries(plan, "niche").length).toBeGreaterThan(0);
});

test("the core pack still installs its always-referenced expertise skills", async () => {
  const config = await raw();
  config.project.agentSkills = {};
  for (const angle of config.project.angles) angle.skills = [];
  config.project.domains = [];
  const plan = await buildPlan(await tempDir(), PACKS, ConfigSchema.parse(config));
  for (const name of ["agent-attribution", "idea-to-planned", "chained-implementation"]) {
    expect(skillEntries(plan, name).length).toBeGreaterThan(0);
  }
});

test("reference paths tolerate a trailing slash in outDir", () => {
  const out = delegationHelpers("claude-code", undefined, {}, ".claude/").reference!("implementer-resume");
  expect(out).toBe("`.claude/reference/implementer-resume.md` (relative to the primary checkout)");
});

test("upgrade deletes an unmodified old implementer-* skill copy and keeps an edited one", async () => {
  const config = await raw();
  const root = await tempDir();
  await Bun.write(join(root, ".claude/skills/orpc-expert/SKILL.md"), "---\nname: orpc-expert\n---\n");
  await Bun.write(join(root, "litecode.config.json"), `${JSON.stringify(config, null, 2)}\n`);
  await applyPlan(root, await buildPlan(root, PACKS, ConfigSchema.parse(config)), "1.0.0", { force: false });
  const lock = (await readLockfile(root, lockPath("claude-code")))!;
  const old = {
    ".claude/skills/implementer-resume/SKILL.md": "---\nname: implementer-resume\n---\nold\n",
    ".claude/skills/implementer-adr-gate/SKILL.md": "---\nname: implementer-adr-gate\n---\nold\n",
  };
  for (const [rel, content] of Object.entries(old)) {
    await Bun.write(join(root, rel), content);
    lock.files[rel] = { pack: "core", version: "0.3.0", hash: hash(content) };
  }
  await writeLockfile(root, lock, lockPath("claude-code"));
  await Bun.write(join(root, ".claude/skills/implementer-adr-gate/SKILL.md"), "edited by hand\n");

  const parsed = ConfigSchema.parse(config);
  const plans = await planUpgrade({ root, config: parsed, packsRoot: PACKS, litecodeVersion: "1.0.0" });
  await applyUpgrade(plans, () => {});
  expect(await Bun.file(join(root, ".claude/skills/implementer-resume/SKILL.md")).exists()).toBe(false);
  expect(await Bun.file(join(root, ".claude/skills/implementer-adr-gate/SKILL.md")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".claude/reference/implementer-resume.md")).exists()).toBe(true);
});
