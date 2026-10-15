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

/** An API-error line Claude Code logs when a stream dies: not a model call, usage all zeros. */
const synthetic = (ts: string, id = "synth") =>
  JSON.stringify({
    type: "assistant",
    timestamp: `2026-01-01T${ts}Z`,
    isApiErrorMessage: true,
    message: { id, model: "<synthetic>", content: [{ type: "text", text: "API Error: The response stopped arriving..." }], usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  });

/** Main session of the fixture: 2 calls (m1 logged twice); a synthetic error line comes first. */
const MAIN_LINES = [synthetic("09:59:59"), tline("10:00:00", "m1", 1, 0, 1000, 5), tline("10:00:01", "m1", 1, 0, 1000, 90), tline("10:00:20", "m2", 1, 1000, 200)];

/** Writes `<tmp>/<session>.jsonl` and one `agent-<name>.jsonl` (+ optional meta) per entry of `subs`. */
async function sessionDir(main: string[], subs: Record<string, { lines: string[]; meta?: string }> = {}, session = "s1") {
  tmp = await mkdtemp(join(tmpdir(), "tokdet-"));
  const sub = join(tmp, session, "subagents");
  await mkdir(sub, { recursive: true });
  await writeFile(join(tmp, `${session}.jsonl`), main.join("\n"));
  for (const [name, { lines, meta }] of Object.entries(subs)) {
    await writeFile(join(sub, `agent-${name}.jsonl`), lines.join("\n"));
    if (meta !== undefined) await writeFile(join(sub, `agent-${name}.meta.json`), meta);
  }
  return tmp;
}

/** Hand-checkable session: main (2 calls), Explore (1 call), reviewer (3 calls, growing context). */
const detailFixture = () =>
  sessionDir(MAIN_LINES, {
    // reviewer sorts before Explore on disk but starts later: ordering must follow first-call time
    arev: { lines: [tline("10:00:05", "a1", 3, 0, 500), tline("10:00:06", "a2", 2, 503, 100), tline("10:00:07", "a3", 1, 600, 50), tline("10:00:07", "a3", 1, 600, 50, 9)], meta: '{"agentType":"reviewer"}' },
    bexp: { lines: [tline("10:00:02", "b1", 0, 0, 40)], meta: '{"agentType":"Explore"}' },
  });

const rowsOf = (rows: Awaited<ReturnType<typeof instancesForSession>>) => rows.map((r) => [r.instance, r.type, r.calls, r.firstContext, r.maxContext, r.contextRead]);

test("context size is input + cache read + cache creation, once per message id", () => {
  expect(instanceStatsFromTranscript(MAIN_LINES.join("\n"))).toEqual({ calls: 2, firstContext: 1001, maxContext: 1201, contextRead: 2202, startedAt: Date.parse("2026-01-01T10:00:00Z") });
});

test("a synthetic API-error line is not a call, in the detail rows nor in the plain report", () => {
  const withErr = MAIN_LINES.join("\n");
  const without = MAIN_LINES.slice(1).join("\n");
  expect(instanceStatsFromTranscript(withErr)).toEqual(instanceStatsFromTranscript(without));
  expect(usageFromTranscript(withErr)).toEqual(usageFromTranscript(without));
  // either marker alone is enough
  const modelOnly = JSON.stringify({ type: "assistant", message: { id: "s", model: "<synthetic>", usage: { input_tokens: 9 } } });
  const flagOnly = JSON.stringify({ type: "assistant", isApiErrorMessage: true, message: { id: "f", usage: { input_tokens: 9 } } });
  expect(instanceStatsFromTranscript([modelOnly, flagOnly].join("\n")).calls).toBe(0);
  expect(usageFromTranscript([modelOnly, flagOnly].join("\n")).input).toBe(0);
});

test("detail TOTAL context read equals the plain TOTAL minus output (they reconcile)", async () => {
  const dir = await detailFixture();
  const plain = (await reportForSession(dir, "s1")).reduce((s, r) => s + r.total - r.output, 0);
  const rows = await instancesForSession(dir, "s1");
  expect(rows.reduce((s, r) => s + r.contextRead, 0)).toBe(plain);
});

test("instancesForSession lists main and each subagent run in first-call order", async () => {
  const rows = await instancesForSession(await detailFixture(), "s1");
  expect(rowsOf(rows)).toEqual([
    ["main", "main", 2, 1001, 1201, 2202],
    ["bexp", "Explore", 1, 40, 40, 40],
    ["arev", "reviewer", 3, 503, 651, 1759],
  ]);
});

test("renderDetail appends an instance table with a TOTAL line derived from the rows", async () => {
  const rows = await instancesForSession(await detailFixture(), "s1");
  const lines = renderDetail(rows).split("\n");
  expect(lines[0]).toMatch(/^instance\s+type\s+calls\s+first context\s+max context\s+context read$/);
  const calls = rows.reduce((s, r) => s + r.calls, 0);
  const max = Math.max(...rows.map((r) => r.maxContext));
  const read = rows.reduce((s, r) => s + r.contextRead, 0);
  expect(lines.at(-1)).toMatch(new RegExp(`^TOTAL\\s+${calls}\\s+-\\s+${max}\\s+${read}$`));
});

test("a call's time is its first line with a timestamp; firstContext is the context of the earliest call", () => {
  // transcript order disagrees with time: "late" is first in the file but later in time
  const text = [tline("10:00:09", "late", 100, 0, 0), tline("10:00:03", "early", 50, 0, 0)].join("\n");
  expect(instanceStatsFromTranscript(text)).toMatchObject({ firstContext: 50, startedAt: Date.parse("2026-01-01T10:00:03Z") });
  // a duplicate id whose first line has no timestamp falls back to the later line's timestamp
  const noTs = (id: string) => JSON.stringify({ type: "assistant", message: { id, usage: { input_tokens: 7 } } });
  const stats = instanceStatsFromTranscript([noTs("d"), tline("10:00:01", "d", 7, 0, 0)].join("\n"));
  expect(stats.startedAt).toBe(Date.parse("2026-01-01T10:00:01Z"));
  // identical times: transcript order decides
  const tie = [tline("10:00:00", "t1", 11, 0, 0), tline("10:00:00", "t2", 22, 0, 0)].join("\n");
  expect(instanceStatsFromTranscript(tie).firstContext).toBe(11);
  // an untimed call never beats a timed one, even when it comes first in the file
  const untimed = [noTs("u"), tline("10:00:00", "t", 5, 0, 0)].join("\n");
  expect(instanceStatsFromTranscript(untimed)).toMatchObject({ calls: 2, firstContext: 5 });
});

test("an instance with no timestamp sorts last; identical timestamps keep main first, then file name", async () => {
  const dir = await sessionDir([tline("10:00:00", "m", 1, 0, 0)], {
    anone: { lines: [line("n", { input_tokens: 2 })], meta: '{"agentType":"x"}' },
    btie2: { lines: [tline("10:00:00", "t2", 3, 0, 0)], meta: '{"agentType":"x"}' },
    ctie1: { lines: [tline("10:00:00", "t1", 4, 0, 0)], meta: '{"agentType":"x"}' },
  });
  const rows = await instancesForSession(dir, "s1");
  expect(rows.map((r) => r.instance)).toEqual(["main", "btie2", "ctie1", "anone"]);
  expect(rows.at(-1)!.startedAt).toBeUndefined();
});

test("a malformed JSON line is skipped without crashing", () => {
  const text = [tline("10:00:00", "m", 4, 0, 0), '{"message": {"id": "broken', tline("10:00:01", "n", 6, 0, 0)].join("\n");
  expect(instanceStatsFromTranscript(text)).toMatchObject({ calls: 2, contextRead: 10 });
});

test("a duplicated id counts once, the last line wins", () => {
  const text = [tline("10:00:00", "m", 1, 0, 10), tline("10:00:01", "m", 2, 0, 20)].join("\n");
  expect(instanceStatsFromTranscript(text)).toMatchObject({ calls: 1, firstContext: 22, contextRead: 22 });
});

test("a subagent without .meta.json has type subagent", async () => {
  const rows = await instancesForSession(await sessionDir([line("m", {})], { z: { lines: [tline("10:00:00", "z", 1, 0, 0)] } }), "s1");
  expect(rows.find((r) => r.instance === "z")!.type).toBe("subagent");
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

test("--detail with no subagents, or an empty session file, lists only main and exits 0", async () => {
  const home = await mkdtemp(join(tmpdir(), "tokhome-"));
  const proj = await mkdtemp(join(tmpdir(), "tokproj-"));
  try {
    const dir = transcriptsDir(proj, home);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "empty.jsonl"), "");
    await writeFile(join(dir, "solo.jsonl"), tline("10:00:00", "m", 5, 0, 0));
    const empty = await runCli(home, "token-report", "--project", proj, "--session", "empty", "--detail");
    expect(empty.code).toBe(0);
    expect(empty.out.trimEnd().split("\n").at(-2)).toMatch(/^main\s+main\s+0\s+0\s+0\s+0$/);
    const solo = await runCli(home, "token-report", "--project", proj, "--session", "solo", "--detail");
    expect(solo.code).toBe(0);
    expect(solo.out.trimEnd().split("\n").at(-2)).toMatch(/^main\s+main\s+1\s+5\s+5\s+5$/);
  } finally {
    await rm(proj, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});
