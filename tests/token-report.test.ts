import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentTypeFromMeta, aggregateByAgent, instanceStatsFromTranscript, renderDetail, renderReport, usageFromTranscript } from "../src/token-report/aggregate.ts";
import { instancesForSession, latestSession, projectDirName, reportForSession, transcriptsDir } from "../src/token-report/transcripts.ts";

const line = (id: string, u: Partial<Record<string, number>>) =>
  JSON.stringify({ type: "assistant", message: { id, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...u } } });

test("usage is counted once per message id, keeping the last (final) line", () => {
  const text = [line("m1", { input_tokens: 2, output_tokens: 1, cache_creation_input_tokens: 100 }), line("m1", { input_tokens: 2, output_tokens: 288, cache_creation_input_tokens: 100 }), line("m2", { cache_read_input_tokens: 50, output_tokens: 5 })].join("\n");
  expect(usageFromTranscript(text)).toEqual({ input: 2, output: 293, cacheRead: 50, cacheCreation: 100 });
});

test("malformed lines, blank lines and lines without usage are ignored", () => {
  const text = ["", "not json", "null", JSON.stringify({ type: "user", message: { content: "hi" } }), line("m1", { input_tokens: 3 })].join("\n");
  expect(usageFromTranscript(text).input).toBe(3);
});

test("aggregation merges same agent type and sorts by total descending", () => {
  const u = (input: number) => ({ input, output: 0, cacheRead: 0, cacheCreation: 0 });
  const rows = aggregateByAgent([{ agent: "a", usage: u(5) }, { agent: "b", usage: u(50) }, { agent: "a", usage: u(10) }]);
  expect(rows.map((r) => [r.agent, r.total])).toEqual([["b", 50], ["a", 15]]);
});

test("agentTypeFromMeta falls back to subagent", () => {
  expect(agentTypeFromMeta('{"agentType":"Explore"}')).toBe("Explore");
  expect(agentTypeFromMeta("garbage")).toBe("subagent");
  expect(agentTypeFromMeta(undefined)).toBe("subagent");
});

test("project dir name mirrors Claude Code's encoding", () => {
  expect(projectDirName("/Users/a/my.proj_x")).toBe("-Users-a-my-proj-x");
  expect(transcriptsDir("/p/q", "/h")).toBe("/h/.claude/projects/-p-q");
});

test("renderReport has all four columns and a total row", () => {
  const out = renderReport("s1", aggregateByAgent([{ agent: "main", usage: { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 } }]));
  expect(out).toContain("session s1");
  expect(out).toContain("cache creation");
  expect(out.split("\n").at(-1)).toMatch(/^TOTAL\s+1\s+2\s+3\s+4\s+10$/);
});

let tmp: string | undefined;
afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
  tmp = undefined;
});

async function fixture() {
  tmp = await mkdtemp(join(tmpdir(), "tokrep-"));
  await mkdir(join(tmp, "s-new", "subagents"), { recursive: true });
  await writeFile(join(tmp, "s-old.jsonl"), line("o", { input_tokens: 1 }));
  await writeFile(join(tmp, "s-new.jsonl"), line("n", { output_tokens: 7 }));
  await utimes(join(tmp, "s-old.jsonl"), 1000, 1000);
  const sub = join(tmp, "s-new", "subagents");
  await writeFile(join(sub, "agent-1.jsonl"), line("x", { input_tokens: 100 }));
  await writeFile(join(sub, "agent-1.meta.json"), '{"agentType":"reviewer"}');
  await writeFile(join(sub, "agent-2.jsonl"), line("y", { input_tokens: 20 }));
  await writeFile(join(sub, "agent-2.meta.json"), '{"agentType":"reviewer"}');
  await writeFile(join(sub, "agent-3.jsonl"), line("z", { cache_read_input_tokens: 500 }));
  return tmp;
}

test("latestSession picks the most recently modified transcript", async () => {
  expect(await latestSession(await fixture())).toBe("s-new");
  expect(await latestSession("/nonexistent-dir-xyz")).toBeUndefined();
});

test("reportForSession splits main and sub-agent types, sorted by total", async () => {
  const rows = await reportForSession(await fixture(), "s-new");
  expect(rows.map((r) => [r.agent, r.total])).toEqual([["subagent", 500], ["reviewer", 120], ["main", 7]]);
  expect(rows[1]!.input).toBe(120);
});

test("reportForSession rejects path-traversal ids and missing sessions", async () => {
  const dir = await fixture();
  await expect(reportForSession(dir, "../x")).rejects.toThrow("invalid session id");
  await expect(reportForSession(dir, "nope")).rejects.toThrow("no transcript");
});

// ---- ticket 0080: --detail, one row per agent instance -------------------------------------

const tline = (ts: string, id: string, input: number, cacheRead: number, cacheCreation: number, output = 1) =>
  JSON.stringify({
    type: "assistant",
    timestamp: `2026-01-01T${ts}Z`,
    message: { id, usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreation } },
  });

/** Hand-checkable session: main (2 calls, m1 logged twice), Explore (1 call), reviewer (3 calls, growing context). */
async function detailFixture() {
  tmp = await mkdtemp(join(tmpdir(), "tokdet-"));
  const sub = join(tmp, "s1", "subagents");
  await mkdir(sub, { recursive: true });
  await writeFile(
    join(tmp, "s1.jsonl"),
    [tline("10:00:00", "m1", 1, 0, 1000, 5), tline("10:00:01", "m1", 1, 0, 1000, 90), tline("10:00:20", "m2", 1, 1000, 200)].join("\n"),
  );
  // reviewer sorts before Explore on disk but starts later: ordering must follow first-call time
  await writeFile(
    join(sub, "agent-arev.jsonl"),
    [tline("10:00:05", "a1", 3, 0, 500), tline("10:00:06", "a2", 2, 503, 100), tline("10:00:07", "a3", 1, 600, 50), tline("10:00:07", "a3", 1, 600, 50, 9)].join("\n"),
  );
  await writeFile(join(sub, "agent-arev.meta.json"), '{"agentType":"reviewer"}');
  await writeFile(join(sub, "agent-bexp.jsonl"), tline("10:00:02", "b1", 0, 0, 40));
  await writeFile(join(sub, "agent-bexp.meta.json"), '{"agentType":"Explore"}');
  return tmp;
}

test("context size is input + cache read + cache creation, once per message id", () => {
  const text = [tline("10:00:00", "m1", 1, 0, 1000, 5), tline("10:00:01", "m1", 1, 0, 1000, 90), tline("10:00:20", "m2", 1, 1000, 200)].join("\n");
  expect(instanceStatsFromTranscript(text)).toEqual({ calls: 2, firstContext: 1001, maxContext: 1201, sumContext: 2202, startedAt: Date.parse("2026-01-01T10:00:00Z") });
});

test("instancesForSession lists main and each subagent run in first-call order", async () => {
  const rows = await instancesForSession(await detailFixture(), "s1");
  expect(rows.map((r) => [r.instance, r.type, r.calls, r.firstContext, r.maxContext, r.sumContext])).toEqual([
    ["main", "main", 2, 1001, 1201, 2202],
    ["bexp", "Explore", 1, 40, 40, 40],
    ["arev", "reviewer", 3, 503, 651, 1759],
  ]);
});

test("renderDetail appends an instance table with a TOTAL line", async () => {
  const rows = await instancesForSession(await detailFixture(), "s1");
  const lines = renderDetail(rows).split("\n");
  expect(lines[0]).toMatch(/^instance\s+type\s+calls\s+first context\s+max context\s+context read$/);
  expect(lines.at(-1)).toMatch(/^TOTAL\s+6\s+-\s+1201\s+4001$/);
});

const runCli = async (home: string, ...args: string[]) => {
  const p = Bun.spawn(["bun", join(import.meta.dir, "..", "src", "cli.ts"), ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: home } });
  return { out: await new Response(p.stdout).text(), code: await p.exited };
};

test("token-report without --detail is unchanged byte for byte; --detail only appends", async () => {
  const home = await mkdtemp(join(tmpdir(), "tokhome-"));
  const proj = await mkdtemp(join(tmpdir(), "tokproj-"));
  try {
    const dir = transcriptsDir(proj, home);
    const sub = join(dir, "s1", "subagents");
    await mkdir(sub, { recursive: true });
    await writeFile(join(dir, "s1.jsonl"), line("m", { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }));
    await writeFile(join(sub, "agent-x.jsonl"), line("x", { input_tokens: 10 }));
    await writeFile(join(sub, "agent-x.meta.json"), '{"agentType":"reviewer"}');
    const plain = await runCli(home, "token-report", "--project", proj, "--session", "s1");
    expect(plain.code).toBe(0);
    expect(plain.out).toBe(
      [
        "session s1",
        "agent     input  output  cache read  cache creation  total",
        "main          1       2           3               4     10",
        "reviewer     10       0           0               0     10",
        "TOTAL        11       2           3               4     20",
        "",
      ].join("\n"),
    );
    const detailed = await runCli(home, "token-report", "--project", proj, "--session", "s1", "--detail");
    expect(detailed.code).toBe(0);
    expect(detailed.out.startsWith(plain.out)).toBe(true);
    expect(detailed.out).toContain("instance");
  } finally {
    await rm(proj, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});
