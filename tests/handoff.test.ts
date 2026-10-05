import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, HANDOFF_SUPPORT, TARGETS, type InstallTarget } from "../src/config.ts";
import { resolveHandoff } from "../src/handoff.ts";
import { buildPlan } from "../src/install.ts";
import { listPacks, loadPack } from "../src/packs.ts";
import { render, templateProject } from "../src/template.ts";
import { templateContext } from "../src/handoff.ts";
import { delegationHelpers } from "../src/delegation.ts";
import { loadConfig } from "../src/config.ts";

const project = (extra: Record<string, unknown> = {}) =>
  ConfigSchema.parse({ packs: ["core"], project: { name: "demo", ...extra } }).project;

test("a config without the keys loads, handoff defaults to off with no override", () => {
  const p = project();
  expect(p.handoff).toBe("off");
  expect(p.handoffSupport).toEqual({});
});

test("the capability table is empty of supported targets today, runner included", () => {
  expect(Object.keys(HANDOFF_SUPPORT).sort()).toEqual([...TARGETS, "runner"].sort());
  expect(Object.values(HANDOFF_SUPPORT).every((v) => v === false)).toBe(true);
});

test("off disables every target, even with an override", () => {
  const p = project({ handoff: "off", handoffSupport: { "claude-code": true } });
  expect(resolveHandoff(p, "claude-code")).toEqual({ enabled: false, reason: expect.stringContaining("off") });
});

test("auto reads the table (all false today) and the override wins per target", () => {
  const p = project({ handoff: "auto", handoffSupport: { "claude-code": true, codex: false } });
  expect(resolveHandoff(p, "claude-code").enabled).toBe(true);
  expect(resolveHandoff(p, "codex").enabled).toBe(false);
  expect(resolveHandoff(p, "pi").enabled).toBe(false);
  expect(resolveHandoff(project({ handoff: "auto" }), "claude-code").enabled).toBe(false);
  expect(resolveHandoff(p, "runner").reason).toContain("capability table");
});

// --- template contract: the same source, rendered per target -----------------------------

const scratch: string[] = [];
afterAll(async () => {
  await Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true })));
});

const FIXTURE_AGENT = `---
name: probe
description: Fixture agent for the handoff render test.
tier: fast
---

Start.
{{#if handoff}}
HANDOFF: delegate the tail to the closer.
{{/if}}
{{^if handoff}}
INLINE: run the tail steps yourself.
{{/if}}
End.
`;

async function fixturePacks(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litecode-handoff-"));
  scratch.push(root);
  await mkdir(join(root, "fx", "agents"), { recursive: true });
  await Bun.write(join(root, "fx", "pack.json"), JSON.stringify({ name: "fx", version: "0.0.1", description: "fixture", requires: [] }));
  await Bun.write(join(root, "fx", "agents", "probe.md"), FIXTURE_AGENT);
  return root;
}

test("one agent source renders the handoff text only where enabled, the in-line steps elsewhere", async () => {
  const packs = await fixturePacks();
  const out = await mkdtemp(join(tmpdir(), "litecode-handoff-out-"));
  scratch.push(out);
  const config = ConfigSchema.parse({
    packs: ["fx"],
    targets: ["claude-code", "codex"],
    project: { name: "demo", handoff: "auto", handoffSupport: { "claude-code": true } },
  });
  const plan = await buildPlan(out, packs, config);
  const probe = (h: string) => plan.entries.find((e) => e.harness === h && /probe\./.test(e.rel))!.content;
  expect(probe("claude-code")).toContain("HANDOFF: delegate the tail to the closer.");
  expect(probe("claude-code")).not.toContain("INLINE");
  expect(probe("codex")).toContain("INLINE: run the tail steps yourself.");
  expect(probe("codex")).not.toContain("HANDOFF");

  const off = await buildPlan(out, packs, ConfigSchema.parse({ packs: ["fx"], targets: ["claude-code"], project: { name: "demo", handoffSupport: { "claude-code": true } } }));
  const content = off.entries.find((e) => /probe\./.test(e.rel))!.content;
  expect(content).toContain("INLINE");
  expect(content).not.toContain("HANDOFF");
});

test("with the default config every real pack file renders byte-identically with or without the handoff flag", async () => {
  const { config } = await loadConfig(join(import.meta.dir, ".."));
  const packsRoot = join(import.meta.dir, "..", "packs");
  const agents = new Set<string>();
  for (const name of await listPacks(packsRoot)) {
    const pack = await loadPack(packsRoot, name);
    for (const f of pack.files) {
      const m = /^agents\/([^/]+)\.md$/.exec(f.rel);
      if (m) agents.add(m[1]!);
    }
  }
  let count = 0;
  for (const name of config.packs) {
    const pack = await loadPack(packsRoot, name);
    for (const file of pack.files) {
      for (const target of [...TARGETS, "runner"] as (InstallTarget | "runner")[]) {
        const helpers = delegationHelpers(target, agents, config.tiers);
        const before = render(file.source, { project: templateProject(config.project) }, file.rel, helpers);
        const after = render(file.source, templateContext(config.project, target, templateProject(config.project)), file.rel, helpers);
        expect(after).toBe(before);
        count++;
      }
    }
  }
  expect(count).toBeGreaterThan(0);
});
