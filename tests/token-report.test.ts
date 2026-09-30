import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentTypeFromMeta, aggregateByAgent, renderReport, usageFromTranscript } from "../src/token-report/aggregate.ts";
import { latestSession, projectDirName, reportForSession, transcriptsDir } from "../src/token-report/transcripts.ts";

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
