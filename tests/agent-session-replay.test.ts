import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parseReport } from "../src/report/verify.ts";
import {
  BUG_HUNTER_KEYS,
  ORCHESTRATOR_KEYS,
  REVIEWER_KEYS,
  HUNTS,
  PANELS,
  SIZES,
  VERDICTS,
  outputEnum,
  outputKeys,
  parseBugHunter,
  parseOrchestrator,
  parseReviewer,
} from "./helpers/agent-contracts.ts";

/**
 * Ticket 0039: replays recorded agent outputs against the output contracts. See
 * tests/fixtures/agent-sessions/README.md for provenance and how to re-record.
 */
const DIR = join(import.meta.dir, "fixtures", "agent-sessions");
const ROOT = join(import.meta.dir, "..");

type Entry = {
  file: string;
  agent: "reviewer" | "bug-hunter" | "implementer" | "orchestrator";
  provenance: "recorded" | "pr-comment" | "synthetic";
  source: string;
  legacy?: boolean;
  expect: Record<string, string>;
};

const manifest: Entry[] = await Bun.file(join(DIR, "manifest.json")).json();
const outputs = new Map<string, string>();
for (const e of manifest) {
  const report = await Bun.file(join(DIR, e.file)).json();
  expect(report.status).toBe("completed");
  expect(report.agent).toBe(e.agent);
  outputs.set(e.file, report.output);
}
const of = (agent: Entry["agent"]) => manifest.filter((e) => e.agent === agent);
// Read the pack source, not the installed copy: PRs change packs/ only (ADR 0022).
const prompt = (agent: string) => Bun.file(join(ROOT, "packs", "core", "agents", `${agent}.md`)).text();

describe("fixture set", () => {
  test("manifest and files on disk agree", () => {
    const onDisk = readdirSync(DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => readdirSync(join(DIR, d.name)).map((f) => `${d.name}/${f}`))
      .sort();
    expect(manifest.map((e) => e.file).sort()).toEqual(onDisk);
  });

  test("every contract named by the ticket has fixtures, and real ones for reviewer and bug-hunter", () => {
    for (const agent of ["orchestrator", "implementer", "reviewer", "bug-hunter"] as const) {
      expect(of(agent).length).toBeGreaterThan(0);
    }
    for (const agent of ["reviewer", "bug-hunter"] as const) {
      expect(of(agent).some((e) => e.provenance !== "synthetic")).toBe(true);
    }
  });

  test("reviewer and bug-hunter fixtures cover every verdict / hunt outcome", () => {
    const verdicts = new Set(of("reviewer").map((e) => e.expect.verdict));
    expect([...verdicts].sort()).toEqual(["approve", "approve-with-notes", "changes-requested"]);
    const hunts = new Set(of("bug-hunter").map((e) => e.expect.hunt));
    expect([...hunts].sort()).toEqual(["complete", "partial"]);
  });
});

describe("prompt Output blocks vs the contract readers", () => {
  // A renamed or added key in a prompt fails here: re-record the fixtures (README).
  test.each([
    ["reviewer", REVIEWER_KEYS],
    ["bug-hunter", BUG_HUNTER_KEYS],
    ["orchestrator", ORCHESTRATOR_KEYS],
  ] as const)("%s prompt lists the keys the replay reader expects", async (agent, keys) => {
    expect(outputKeys(await prompt(agent))).toEqual([...keys]);
  });
});

describe("prompt enum values vs the contract readers", () => {
  test.each([
    ["reviewer", "VERDICT", VERDICTS],
    ["bug-hunter", "HUNT", HUNTS],
    ["orchestrator", "PANEL", PANELS],
    ["orchestrator", "SIZE", SIZES],
  ] as const)("%s %s", async (agent, key, known) => {
    const alts = outputEnum(await prompt(agent), key);
    expect(alts.length).toBeGreaterThan(1);
    for (const a of alts) expect(known as readonly string[]).toContain(a);
  });
});

describe("reviewer replay", () => {
  test.each(of("reviewer"))("$file", async (e) => {
    const { fields, verdict } = parseReviewer(outputs.get(e.file)!);
    expect(verdict).toBeDefined();
    expect(verdict).toBe(e.expect.verdict as string);
    const required = e.legacy ? ["VERDICT", "CHECK_OUTPUT", "FINDINGS", "PLAN_FIDELITY", "REENTRY"] : outputKeys(await prompt("reviewer"));
    for (const key of required) expect(fields.get(key), `${key} present and non-empty`).toBeTruthy();
    // A blocking verdict has to say what blocks.
    if (verdict === "changes-requested") expect(fields.get("FINDINGS")).toContain("(blocking)");
  });
});

describe("bug-hunter replay", () => {
  test.each(of("bug-hunter"))("$file", (e) => {
    const { fields, hunt } = parseBugHunter(outputs.get(e.file)!);
    expect(hunt).toBeDefined();
    expect(hunt).toBe(e.expect.hunt as string);
    for (const key of BUG_HUNTER_KEYS) expect(fields.get(key), `${key} present and non-empty`).toBeTruthy();
    // A partial hunt must say what it did not cover.
    if (hunt === "partial") expect(fields.get("HUNT")!.length).toBeGreaterThan("partial".length + 10);
  });
});

describe("implementer report replay (real parseReport)", () => {
  test.each(of("implementer"))("$file", (e) => {
    const parsed = parseReport(outputs.get(e.file)!);
    if ("error" in parsed) throw new Error(parsed.error.message);
    const r = parsed.report;
    expect(r.status as string).toBe(e.expect.status as string);
    for (const [k, v] of Object.entries(e.expect)) {
      if (k === "status") continue;
      expect(r[k as "ticket" | "branch" | "pr" | "ci"]).toBe(v);
    }
  });

  test("the prompt still lists the fields parseReport reads", async () => {
    expect(outputKeys(await prompt("implementer"))).toEqual(["STATUS", "TICKET", "BRANCH", "PR", "BLOCKER", "CI", "CHECK_OUTPUT", "TOKENS"]);
  });
});

describe("orchestrator report replay", () => {
  test.each(of("orchestrator"))("$file", (e) => {
    const { fields, panel, size } = parseOrchestrator(outputs.get(e.file)!);
    expect(panel).toBeDefined();
    expect(size).toBeDefined();
    expect(panel).toBe(e.expect.panel as string);
    expect(size).toBe(e.expect.size as string);
    for (const key of ORCHESTRATOR_KEYS) expect(fields.get(key), `${key} present and non-empty`).toBeTruthy();
    // ADR 0007: a degraded panel never carries a usable plan.
    if (panel === "degraded") expect(fields.get("PLAN")).toMatch(/^none/);
  });
});
