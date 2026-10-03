import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCaps, measurePackSizes } from "../src/pack-sizes.ts";

/**
 * Ticket 0089 / ADR 0025: a word cap per agent and per skill (pack source file), set from the
 * sizes after tickets 0087 and 0088 plus a margin of about 8 %. Raising a cap is a reviewable
 * diff of this table. implementer.md also has its own body and byte caps in
 * implementer-size-flow.test.ts.
 */
const PACKS = join(import.meta.dir, "..", "packs");

const CAPS: Record<string, number> = {
  "core/agents/bug-hunter.md": 1020,
  "core/agents/classifier.md": 360,
  "core/agents/debate-angle.md": 250,
  "core/agents/dispatcher.md": 1010,
  "core/agents/implementer.md": 1860,
  "core/agents/orchestrator.md": 1210,
  "core/agents/panel-selector.md": 180,
  "core/agents/planner.md": 900,
  "core/agents/reviewer.md": 1440,
  "core/agents/synthesizer.md": 435,
  "core/agents/tracker.md": 1290,
  "core/agents/triage.md": 830,
  "core/skills/agent-attribution/SKILL.md": 420,
  "core/skills/chained-implementation/SKILL.md": 660,
  "core/skills/critique-expert/SKILL.md": 440,
  "core/skills/idea-to-planned/SKILL.md": 670,
  "core/skills/security-expert/SKILL.md": 440,
  "web/skills/design-expert/SKILL.md": 790,
  "web/skills/frontend-expert/SKILL.md": 395,
  "web/skills/mobile-expert/SKILL.md": 400,
  "web/skills/typescript-expert/SKILL.md": 440,
  "web/skills/ui-ux-expert/SKILL.md": 700,
};

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

test("every agent and skill of every pack stays within its word cap", async () => {
  const sizes = await measurePackSizes(PACKS);
  expect(checkCaps(sizes, CAPS)).toEqual([]);
});

test("the cap logic flags a file over its cap, a file without a cap, and a cap without a file", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-caps-"));
  dirs.push(root);
  await Bun.write(join(root, "p", "pack.json"), JSON.stringify({ name: "p", version: "1.0.0", description: "d" }));
  await Bun.write(join(root, "p", "agents", "big.md"), "---\nname: big\n---\n" + "word ".repeat(50));
  await Bun.write(join(root, "p", "agents", "ok.md"), "---\nname: ok\n---\nfew words");
  await Bun.write(join(root, "p", "agents", "new.md"), "---\nname: new\n---\nhi");
  await Bun.write(join(root, "p", "reference", "ignored.md"), "---\nname: ignored\n---\n" + "word ".repeat(500));
  const sizes = await measurePackSizes(root);
  expect(Object.keys(sizes).sort()).toEqual(["p/agents/big.md", "p/agents/new.md", "p/agents/ok.md"]);
  const problems = checkCaps(sizes, { "p/agents/big.md": 40, "p/agents/ok.md": 20, "p/agents/gone.md": 10 });
  expect(problems).toHaveLength(3);
  expect(problems.join("\n")).toMatch(/p\/agents\/big\.md: 54 words, cap 40/);
  expect(problems.join("\n")).toMatch(/p\/agents\/new\.md: no cap/);
  expect(problems.join("\n")).toMatch(/p\/agents\/gone\.md: cap for a file that does not exist/);
});
