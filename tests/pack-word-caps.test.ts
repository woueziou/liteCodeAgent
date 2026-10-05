import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCaps,loadBaselineConfig, measurePackSizes, renderedWords } from "../src/pack-sizes.ts";

/**
 * Ticket 0089 / ADR 0025: a cap in RENDERED words (what the model reads: frontmatter and template
 * output included, measured with the baseline fixture config) per agent, skill and reference file
 * of every pack, set from the size on 2026-10-03 plus about 8 %. Raising a cap is a reviewable
 * diff of this table. implementer.md also has its own byte and body-word caps in
 * implementer-size-flow.test.ts.
 */
const PACKS = join(import.meta.dir, "..", "packs");

//  file: cap   // rendered words when the cap was set
const CAPS: Record<string, number> = {
  "core/agents/bug-hunter.md": 975, // 901 now
  "core/agents/closer.md": 1020, // 943 now; ADR 0027: measured with the handoff on (installed only then)
  "core/agents/classifier.md": 295, // 271 now
  "core/agents/debate-angle.md": 230, // 210 now
  "core/agents/dispatcher.md": 1005, // 927 now
  "core/agents/implementer.md": 2225, // 2057 now
  "core/agents/orchestrator.md": 1485, // 1373 now
  "core/agents/panel-selector.md": 185, // 167 now
  "core/agents/planner.md": 765, // 704 now
  "core/agents/reviewer.md": 1255, // 1161 now
  "core/agents/synthesizer.md": 390, // 360 now
  "core/agents/tracker.md": 1270, // 1174 now
  "core/agents/triage.md": 1110, // 1026 now
  "core/reference/chained-implementation-no-report.md": 275, // 251 now
  "core/reference/implementer-adr-gate.md": 1405, // 1298 now
  "core/reference/implementer-batch.md": 325, // 297 now
  "core/reference/implementer-ci-red.md": 175, // 162 now
  "core/reference/implementer-cli-resolution.md": 130, // 118 now
  "core/reference/implementer-closer-handoff.md": 475, // 438 now; ADR 0027, handoff on only
  "core/reference/implementer-github-outage.md": 230, // 209 now
  "core/reference/implementer-inline-tail.md": 265, // 244 now; ADR 0027, steps 8 to 10 moved here from implementer.md
  "core/reference/implementer-language.md": 20, // 18 now
  "core/reference/implementer-leak-cleanup.md": 395, // 365 now
  "core/reference/implementer-packs-edit.md": 75, // 68 now
  "core/reference/implementer-progress-journal.md": 165, // 149 now
  "core/reference/implementer-rehunt.md": 205, // 186 now
  "core/reference/implementer-resume.md": 370, // 341 now
  "core/reference/implementer-review-disputes.md": 400, // 368 now
  "core/reference/implementer-review-handoff.md": 460, // 424 now
  "core/reference/implementer-stacked-pr.md": 220, // 200 now
  "core/reference/implementer-subagent-steps.md": 450, // 413 now
  "core/reference/implementer-test-first.md": 165, // 152 now
  "core/reference/implementer-verification-only.md": 160, // 148 now
  "core/reference/implementer-worktree-fallback.md": 270, // 248 now
  "core/reference/reviewer-acceptance-edge-cases.md": 265, // 241 now
  "core/reference/reviewer-batch.md": 165, // 152 now
  "core/reference/reviewer-single-pass.md": 135, // 122 now
  "core/reference/reviewer-test-first.md": 875, // 809 now
  "core/skills/agent-attribution/SKILL.md": 420, // 387 now
  "core/skills/chained-implementation/SKILL.md": 1135, // 1048 now
  "core/skills/critique-expert/SKILL.md": 440, // 405 now
  "core/skills/idea-to-planned/SKILL.md": 1055, // 974 now
  "core/skills/security-expert/SKILL.md": 420, // 388 now
  "web/skills/design-expert/SKILL.md": 785, // 724 now
  "web/skills/frontend-expert/SKILL.md": 390, // 360 now
  "web/skills/mobile-expert/SKILL.md": 395, // 364 now
  "web/skills/typescript-expert/SKILL.md": 440, // 407 now
  "web/skills/ui-ux-expert/SKILL.md": 700, // 647 now
};

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

test("every agent, skill and reference of every pack stays within its rendered word cap", async () => {
  const sizes = renderedWords(await measurePackSizes(PACKS, await loadBaselineConfig()));
  expect(checkCaps(sizes, CAPS)).toEqual([]);
});

test("a file that grows by N words crosses its cap, and the failure says where to raise it", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-caps-"));
  dirs.push(root);
  await Bun.write(join(root, "p", "pack.json"), JSON.stringify({ name: "p", version: "1.0.0", description: "d" }));
  const file = join(root, "p", "agents", "a.md");
  const text = (extra: number) => "---\nname: a\ndescription: d\n---\nbody " + "word ".repeat(extra);
  const measure = async () => renderedWords(await measurePackSizes(root, await loadBaselineConfig()));

  await Bun.write(file, text(0));
  const before = (await measure())["p/agents/a.md"]!;
  const caps = { "p/agents/a.md": before };
  expect(checkCaps(await measure(), caps)).toEqual([]);

  const grow = 7;
  await Bun.write(file, text(grow));
  const after = await measure();
  expect(after["p/agents/a.md"]).toBe(before + grow);
  expect(checkCaps(after, caps).join("\n")).toMatch(/p\/agents\/a\.md: .* rendered words, cap .*raise it in tests\/pack-word-caps\.test\.ts \(ADR 0025\)/);
});

test("a file without a cap, and a cap without a file, are flagged", () => {
  const problems = checkCaps({ "p/agents/new.md": 5, "p/agents/ok.md": 5 }, { "p/agents/ok.md": 5, "p/agents/gone.md": 10 });
  expect(problems).toHaveLength(2);
  expect(problems.join("\n")).toMatch(/p\/agents\/new\.md: .*no cap/);
  expect(problems.join("\n")).toMatch(/p\/agents\/gone\.md: cap for a file that does not exist/);
});
