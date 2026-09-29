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

test("an expertise skill nobody references is not installed; the human-invoked ones always are", async () => {
  const config = await raw();
  config.project.agentSkills = Object.fromEntries(Object.keys(config.project.agentSkills).map((k) => [k, []]));
  for (const angle of config.project.angles) angle.skills = [];
  config.project.domains = [];
  const root = await tempDir();
  const plan = await buildPlan(root, PACKS, ConfigSchema.parse(config));
  // security-expert and critique-expert stay only through bug-hunter's own `skills:` line.
  expect(skillEntries(plan, "agent-attribution")).toEqual([]);
  expect(skillEntries(plan, "security-expert").length).toBeGreaterThan(0);
  expect(skillEntries(plan, "idea-to-planned").length).toBeGreaterThan(0);
  expect(skillEntries(plan, "chained-implementation").length).toBeGreaterThan(0);
});

test("a skill the config asks for is installed, and the install marker never reaches the output", async () => {
  const config = await raw();
  config.project.agentSkills = Object.fromEntries(Object.keys(config.project.agentSkills).map((k) => [k, []]));
  for (const angle of config.project.angles) angle.skills = [];
  config.project.domains = [];
  config.project.agentSkills.tracker = ["agent-attribution"];
  const root = await tempDir();
  const plan = await buildPlan(root, PACKS, ConfigSchema.parse(config));
  const entries = skillEntries(plan, "agent-attribution");
  expect(entries.length).toBeGreaterThan(0);
  for (const e of plan.entries.filter((x) => x.rel.includes("/skills/"))) expect(e.content).not.toMatch(/^install:/m);
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
