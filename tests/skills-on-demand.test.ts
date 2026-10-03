import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { parseFrontmatter } from "../src/frontmatter.ts";
import { buildPlan } from "../src/install.ts";
import { cleanedConfig, obsoleteConfig } from "../src/project-upgrade-config.ts";

/** Ticket 0087: nothing is preloaded, and the web pack is four skills with every original rule kept. */
const PACKS = join(import.meta.dir, "..", "packs");
const BASELINE = join(import.meta.dir, "..", "docs", "specs", "restructure-baseline", "litecode.config.json");

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
const tempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "litecode-ondemand-"));
  dirs.push(dir);
  return dir;
};

async function webPlan(overrides: (raw: any) => void = () => {}) {
  const raw = await Bun.file(BASELINE).json();
  raw.packs = ["core", "web"];
  raw.project.web = { appDir: "apps/web", framework: "React", apiClient: "c", typeSourceOfTruth: "t", typecheck: "tc", styling: "Tailwind" };
  overrides(raw);
  return buildPlan(await tempDir(), PACKS, ConfigSchema.parse(raw));
}

const agents = (plan: Awaited<ReturnType<typeof buildPlan>>) => plan.entries.filter((e) => /\/agents\/[^/]+\.md$/.test(e.rel));
const skill = (plan: Awaited<ReturnType<typeof buildPlan>>, name: string) =>
  plan.entries.find((e) => e.rel === `.claude/skills/${name}/SKILL.md`)?.content ?? "";

test("no rendered agent preloads a skill, bug-hunter included", async () => {
  const plan = await webPlan();
  expect(agents(plan).length).toBeGreaterThanOrEqual(12);
  for (const agent of agents(plan)) {
    const { data } = parseFrontmatter(agent.content, agent.rel);
    expect({ rel: agent.rel, skills: data.skills ?? "" }).toEqual({ rel: agent.rel, skills: "" });
    expect(agent.content).not.toMatch(/^skills:/m);
  }
});

test("project.agentSkills is ignored: no rendered agent has a skills line, whatever the config says", async () => {
  const plan = await webPlan((raw) => {
    raw.project.agentSkills = Object.fromEntries(
      ["debate-angle", "dispatcher", "planner", "reviewer", "tracker", "triage"].map((k) => [k, ["typescript-expert"]]),
    );
    raw.project.agentSkills.implementer = ["typescript-expert"];
  });
  for (const agent of agents(plan)) expect(agent.content).not.toMatch(/^skills:/m);
});

test("agentSkills no longer counts as a wanted skill: a skill only it names is not installed", async () => {
  const withKey = await webPlan((raw) => {
    raw.project.domains = [{ match: "visual layout", skills: ["design-expert"] }];
    for (const angle of raw.project.angles) angle.skills = [];
    raw.project.agentSkills = { implementer: ["security-expert"] };
  });
  expect(skill(withKey, "security-expert")).toBe("");
  expect(skill(withKey, "design-expert")).not.toBe("");
});

test("a skill named only under agentSkills is not looked up, so it cannot fail the install", async () => {
  await expect(
    webPlan((raw) => {
      raw.project.agentSkills = { planner: ["nonexistent-expert"] };
    }),
  ).resolves.toBeDefined();
});

test("the core pack's agent sources do not reference project.agentSkills", async () => {
  const sources = [...new Bun.Glob("*.md").scanSync({ cwd: join(PACKS, "core", "agents") })];
  expect(sources.length, "the glob matched no agent source, so the guard would pass vacuously").toBeGreaterThan(0);
  for (const rel of sources) {
    expect(await Bun.file(join(PACKS, "core", "agents", rel)).text(), rel).not.toContain("agentSkills");
  }
});

test("the implementer's report says when no Domain rule matched the ticket", async () => {
  const plan = await webPlan();
  const implementer = plan.entries.find((e) => e.rel === ".claude/agents/implementer.md")!.content;
  expect(implementer).toMatch(/no domain rule matched/i);
});

// The ticket says "four" but names five survivors (design, ux, mobile, frontend, typescript):
// seven minus the two absorbed ones. The named mapping is what is asserted.
test("the web pack ships the five named skills and the two absorbed ones are gone", () => {
  const onDisk = [...new Bun.Glob("*/SKILL.md").scanSync({ cwd: join(PACKS, "web", "skills") })].map((p) => p.split("/")[0]!).sort();
  expect(onDisk).toEqual(["design-expert", "frontend-expert", "mobile-expert", "typescript-expert", "ui-ux-expert"]);
});

/** Distinctive phrases of every rule of the seven original skills. */
const RULES: Record<string, string[]> = {
  "design-expert": [
    "Hierarchy", "Spacing system", "Typography", "Color", "Density vs breathing room",
    // absorbed from mobile-design-expert
    "Small viewport", "Type scale compression", "Spacing compression, not elimination",
    "Information density tradeoffs", "Single-column defaults", "Visual weight of navigation chrome",
    "Contrast/legibility outdoors",
  ],
  "ui-ux-expert": [
    "States, not just the happy path", "Feedback", "Errors are actionable", "Forms",
    "Accessibility baseline", "Navigation & wayfinding", "explicit confirmation step",
    // absorbed from mobile-ui-ux-expert
    "Touch", "Thumb reach", "Gesture vs. explicit control", "Mobile navigation idioms",
    "Feedback under touch", "Modal/sheet patterns", "Interruption resilience", "full-width",
  ],
  "mobile-expert": [
    "not a native app", "Viewport correctness", "Touch targets", "Safe areas",
    "Network/performance", "Input ergonomics", "Orientation",
  ],
  "frontend-expert": [],
  "typescript-expert": [],
};

test("every rule of the seven original skills is still in the four", async () => {
  const plan = await webPlan();
  for (const [name, phrases] of Object.entries(RULES)) {
    const body = skill(plan, name);
    expect({ name, present: body.length > 0 }).toEqual({ name, present: true });
    for (const phrase of phrases) expect({ name, phrase, found: body.toLowerCase().includes(phrase.toLowerCase()) }).toEqual({ name, phrase, found: true });
  }
});

test("the duplicated HR confirmation block is merged into one, and the native preamble stays in mobile-expert only", async () => {
  const plan = await webPlan();
  expect(skill(plan, "ui-ux-expert").match(/HR-domain specifics/g)?.length).toBe(1);
  expect(skill(plan, "design-expert")).not.toMatch(/not a native app/i);
  expect(skill(plan, "ui-ux-expert")).not.toMatch(/not a native app/i);
  expect(skill(plan, "mobile-design-expert")).toBe("");
  expect(skill(plan, "mobile-ui-ux-expert")).toBe("");
});

test("init's candidate rules and every doc name only skills that exist", async () => {
  const plan = await webPlan();
  for (const e of plan.entries) {
    expect(e.content).not.toMatch(/mobile-design-expert|mobile-ui-ux-expert/);
  }
});

// --- seam 1: upgrade migrates the old names in a project's Domain rules -------------------

test("upgrade rewrites the merged skills' old names in Domain rules and de-duplicates the list", () => {
  const raw = {
    project: {
      domains: [
        { match: "phone layout", skills: ["mobile-design-expert", "design-expert"] },
        { match: "touch flows", skills: ["mobile-ui-ux-expert", "mobile-expert"] },
        { match: "everything small", skills: ["mobile-design-expert", "mobile-ui-ux-expert", "mobile-expert"] },
        { match: "backend", skills: ["typescript-expert"] },
      ],
      angles: [{ name: "ux", covers: "c", triggeredBy: "t", skills: ["mobile-ui-ux-expert", "ui-ux-expert"] }],
    },
  };
  expect(obsoleteConfig(raw).join("\n")).toMatch(/mobile-design-expert/);
  const cleaned = cleanedConfig(raw) as typeof raw;
  expect(cleaned.project.domains.map((d) => d.skills)).toEqual([
    ["design-expert"],
    ["ui-ux-expert", "mobile-expert"],
    ["design-expert", "ui-ux-expert", "mobile-expert"],
    ["typescript-expert"],
  ]);
  expect(cleaned.project.angles[0]!.skills).toEqual(["ui-ux-expert"]);
  // idempotent: a cleaned config has nothing left to report
  expect(obsoleteConfig(cleaned)).toEqual([]);
});
