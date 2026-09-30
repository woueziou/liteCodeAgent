import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, selectedTargets } from "../src/config.ts";
import { delegationHelpers } from "../src/delegation.ts";
import { buildPlan } from "../src/install.ts";
import { loadPack } from "../src/packs.ts";

/**
 * Ticket 0061 / ADR 0021: implementer.md keeps only the nominal flow in its body; the rare
 * cases live in `implementer-*` skills loaded on demand, and the flow is proportioned to the
 * ticket's `size`.
 */
const PACKS = join(import.meta.dir, "..", "packs");
const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");
// 3150: ticket 0064 put the ticket-commit rules back inline (they run on every ticket move, not a rare case).
// 3170: ticket 0065 added one line pointing at implementer-batch.
const MAX_BODY_WORDS = 3170;

async function core() {
  const pack = await loadPack(PACKS, "core");
  const get = (rel: string) => {
    const file = pack.files.find((f) => f.rel === rel);
    if (!file) throw new Error(`${rel} not found in core pack`);
    return file.source;
  };
  return { pack, get };
}

const body = (source: string) => source.split("\n---\n").slice(1).join("\n---\n");
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const refNamesIn = (text: string) => [...new Set([...text.matchAll(/\{\{> reference (implementer-[a-z-]+)\}\}/g)].map((m) => m[1]!))];

test("implementer.md's body stays within the word budget", async () => {
  const { get } = await core();
  expect(words(body(get("agents/implementer.md")))).toBeLessThanOrEqual(MAX_BODY_WORDS);
});

test("every implementer-* reference file is referenced by the body, and every reference exists in the pack", async () => {
  const { pack, get } = await core();
  const referenced = refNamesIn(get("agents/implementer.md")).sort();
  const shipped = pack.files
    .map((f) => /^reference\/(implementer-[a-z-]+)\.md$/.exec(f.rel)?.[1])
    .filter((n): n is string => !!n)
    .sort();
  expect(referenced.length).toBeGreaterThanOrEqual(6);
  expect(referenced).toEqual(shipped);
  expect(pack.files.some((f) => /^skills\/implementer-/.test(f.rel))).toBe(false);
  for (const name of shipped) expect(get(`reference/${name}.md`)).toMatch(new RegExp(`^---\\nname: ${name}\\n`));
});

test("every implementer-* reference file is installed under each target's root, and loads no template syntax", async () => {
  const { pack } = await core();
  const names = pack.files.map((f) => /^reference\/(implementer-[a-z-]+)\.md$/.exec(f.rel)?.[1]).filter(Boolean) as string[];
  const config = ConfigSchema.parse(await Bun.file(EXAMPLE).json());
  const root = await mkdtemp(join(tmpdir(), "litecode-"));
  await Bun.write(join(root, ".claude", "skills", "orpc-expert", "SKILL.md"), "---\nname: orpc-expert\n---\n");
  const plan = await buildPlan(root, PACKS, config);
  for (const name of new Set(names)) {
    const entries = plan.entries.filter((e) => e.rel.endsWith(`/reference/${name}.md`));
    expect(entries.length).toBe(selectedTargets(config).length);
    for (const e of entries) expect(e.content).not.toContain("{{");
    expect(plan.entries.some((e) => e.rel.includes(`skills/${name}/`))).toBe(false);
  }
});

/** Each rule moved out of the body must still be readable in the skill that took it. */
const MOVED_RULES: { skill: string; rule: RegExp }[] = [
  { skill: "implementer-adr-gate", rule: /ADR draft approval gate/ },
  { skill: "implementer-adr-gate", rule: /## ADR à valider : <NNNN>/ },
  { skill: "implementer-adr-gate", rule: /`adr_posted: true` as an idempotency guard/ },
  { skill: "implementer-adr-gate", rule: /`commit: none` is a valid/ },
  { skill: "implementer-adr-gate", rule: /Whoever invoked you must relay that ADR to the human verbatim/ },
  { skill: "implementer-resume", rule: /bunx litecodeagent resume <NNNN>/ },
  { skill: "implementer-resume", rule: /move the ticket from `Review` back to `In Progress`/ },
  { skill: "implementer-resume", rule: /skip straight to step 7/ },
  { skill: "implementer-github-outage", rule: /do not fabricate a PR URL/ },
  { skill: "implementer-github-outage", rule: /implemented-pending-github/ },
  { skill: "implementer-subagent-steps", rule: /only edit files/ },
  { skill: "implementer-subagent-steps", rule: /a subagent's self-report is a claim, not proof/ },
  { skill: "implementer-stacked-pr", rule: /a green `gh pr checks` is not proof the tests ran/i },
  { skill: "implementer-stacked-pr", rule: /git worktree add .*<pr-branch-name>/ },
  { skill: "implementer-review-disputes", rule: /re-invoke `reviewer` with your evidence/ },
  { skill: "implementer-review-disputes", rule: /This applies even when `reviewer` explicitly asks for it/ },
  { skill: "implementer-review-disputes", rule: /ticket 0056/ },
  { skill: "implementer-leak-cleanup", rule: /git status --short --untracked-files=all/ },
  { skill: "implementer-leak-cleanup", rule: /git -C <primary-checkout> restore --staged --worktree/ },
  { skill: "implementer-leak-cleanup", rule: /do not touch or discard it/ },
  { skill: "implementer-verification-only", rule: /independently re-derive/ },
  { skill: "implementer-verification-only", rule: /straight from `In Progress` to `Done`/ },
  { skill: "implementer-cli-resolution", rule: /ticket note --help/ },
  { skill: "implementer-cli-resolution", rule: /never fall back to `Edit`\/`Write`|do not fall back to `Edit`\/`Write`/ },
];

test("each rule moved out of implementer.md is found in its skill", async () => {
  const { get } = await core();
  for (const { skill, rule } of MOVED_RULES) {
    expect({ skill, rule: String(rule), found: rule.test(get(`reference/${skill}.md`)) }).toEqual({
      skill,
      rule: String(rule),
      found: true,
    });
  }
});

test("the body points at the skill for each rare case instead of restating it", async () => {
  const { get } = await core();
  const src = get("agents/implementer.md");
  for (const name of new Set(MOVED_RULES.map((m) => m.skill))) expect(src).toContain(`{{> reference ${name}}}`);
  expect(src).not.toMatch(/`adr_posted: true` as an idempotency guard/);
});

test("the flow is proportioned to size in implementer.md and reviewer.md", async () => {
  const { get } = await core();
  const implementer = get("agents/implementer.md");
  expect(implementer).toMatch(/## Review flow by size \(ADR 0021\)/);
  expect(implementer).toMatch(/\*\*`small`\*\*[^\n]*`balanced` tier/);
  expect(implementer).toMatch(/No re-hunt unless a finding is blocking/);
  expect(implementer).toMatch(/No second `reviewer` pass for non-blocking corrections/);
  expect(implementer).toMatch(/\*\*`medium` \/ `large`\*\*[^\n]*the full flow/);
  expect(implementer).toContain("{{> delegateTier balanced}}");
  expect(implementer).toMatch(/the ticket's `size`/);
  const reviewer = get("agents/reviewer.md");
  expect(reviewer).toMatch(/## Review flow by size \(ADR 0021\)/);
  expect(reviewer).toMatch(/without calling you a second time/);
  expect(get("agents/bug-hunter.md")).toMatch(/`balanced` tier for a `small` ticket/);
});

test("delegateTier picks the model per call where the target allows it, and says so where it doesn't", () => {
  expect(delegationHelpers("claude-code").delegateTier!("balanced")).toBe('pass `model: "sonnet"` on that call (the `balanced` tier)');
  expect(delegationHelpers("claude-code", undefined, { balanced: "haiku" }).delegateTier!("balanced")).toContain('model: "haiku"');
  for (const target of ["runner", "opencode", "kilo-code", "codex", "pi"] as const) {
    const text = delegationHelpers(target).delegateTier!("balanced");
    expect(text).toMatch(/cannot choose a model per call/);
    expect(text).not.toContain("model:");
  }
  expect(() => delegationHelpers("claude-code").delegateTier!("Not A Tier")).toThrow();
  expect(() => delegationHelpers("claude-code").delegateTier!("constructor")).toThrow(/unknown tier/);
  expect(() => delegationHelpers("codex").delegateTier!("balnced")).toThrow(/unknown tier/);
});

test("the rendered implementer carries the per-call model on Claude Code and the plain fallback elsewhere", async () => {
  const config = ConfigSchema.parse({ ...(await Bun.file(EXAMPLE).json()), targets: ["claude-code", "codex"], target: "claude-code" });
  const root = await mkdtemp(join(tmpdir(), "litecode-"));
  await Bun.write(join(root, ".claude", "skills", "orpc-expert", "SKILL.md"), "---\nname: orpc-expert\n---\n");
  const plan = await buildPlan(root, PACKS, config);
  const claude = plan.entries.find((e) => e.rel === ".claude/agents/implementer.md")!;
  expect(claude.content).toContain('pass `model: "sonnet"` on that call');
  const codex = plan.entries.find((e) => e.rel === ".codex/agents/implementer.toml")!;
  expect(codex.content).toContain("cannot choose a model per call");
});

test("chained-implementation tells the caller to pass only the ticket and the launch specifics", async () => {
  const { get } = await core();
  const src = get("skills/chained-implementation/SKILL.md");
  expect(src).toMatch(/Pass only the ticket id and the specifics of this launch/);
  expect(src).toMatch(/Do not restate what `implementer` already carries/);
});
