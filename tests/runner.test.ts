import { expect, test } from "bun:test";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, type Config } from "../src/config.ts";
import { AgentCatalog } from "../src/runner/catalog.ts";
import { ProviderError } from "../src/runner/providers.ts";
import {
  AgentRuntime,
  RunCancelledError,
  RunnerExecutionError,
} from "../src/runner/runtime.ts";
import { LocalTools } from "../src/runner/tools.ts";
import type { AssistantMessage, CompletionRequest, Provider } from "../src/runner/types.ts";

const PACKS = join(import.meta.dir, "..", "packs");

function config(overrides: Record<string, unknown> = {}): Config & { runner: NonNullable<Config["runner"]> } {
  return ConfigSchema.parse({
    packs: ["core"],
    runner: {
      provider: "openai",
      models: { fast: "fast-model", balanced: "balanced-model", reasoning: "reasoning-model" },
      maxTurns: 5,
      maxDepth: 2,
      maxAgentCalls: 8,
      ...overrides,
    },
    project: {
      name: "runner-fixture",
      repo: "example/runner-fixture",
      checkCommand: "bun test",
      agentSkills: {
        "debate-angle": [],
        dispatcher: [],
        implementer: [],
        planner: [],
        reviewer: [],
        tracker: [],
        triage: [],
      },
      angles: [{ name: "correctness", covers: "correctness", triggeredBy: "always", always: true }],
      board: { owner: "example" },
    },
  }) as Config & { runner: NonNullable<Config["runner"]> };
}

const assistant = (content: string, toolCalls: AssistantMessage["toolCalls"] = []): AssistantMessage => ({
  role: "assistant",
  content,
  toolCalls,
});

test("Agent calls block for child results and sibling calls run in parallel", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-runner-"));
  const cfg = config();
  const catalog = await AgentCatalog.load(root, PACKS, cfg);
  let activeChildren = 0;
  let maxActiveChildren = 0;
  let rootTurns = 0;

  const provider: Provider = {
    name: "fake",
    async complete(request: CompletionRequest) {
      if (request.system.includes("'orchestrator'")) {
        rootTurns++;
        if (rootTurns === 1) {
          return {
            message: assistant("", [
              { id: "a", name: "Agent", input: { subagent_type: "classifier", prompt: "classify" } },
              { id: "b", name: "Agent", input: { subagent_type: "panel-selector", prompt: "select" } },
            ]),
            usage: { input: 10, output: 5, total: 15 },
          };
        }
        const results = request.messages.filter((message) => message.role === "tool");
        expect(results.map((message) => message.content).sort()).toEqual(["ANGLES: correctness", "SIZE: small"]);
        return {
          message: assistant("parent received both completed children"),
          usage: { input: 6, output: 2, total: 8 },
        };
      }

      activeChildren++;
      maxActiveChildren = Math.max(maxActiveChildren, activeChildren);
      await Bun.sleep(20);
      activeChildren--;
      return {
        message: assistant(request.system.includes("'classifier'") ? "SIZE: small" : "ANGLES: correctness"),
        usage: { input: 4, output: 1, total: 5 },
      };
    },
  };

  const result = await new AgentRuntime({ projectRoot: root, config: cfg, provider, catalog }).runDetailed(
    "orchestrator",
    "plan a change",
  );
  expect(result.output).toBe("parent received both completed children");
  expect(result.agentCalls).toBe(3);
  expect(result.usage).toMatchObject({ requests: 4, input: 24, output: 9, total: 33, costUsd: null });
  expect(result.usage.byAgent).toEqual([
    { agent: "classifier", model: "fast-model", requests: 1, input: 4, output: 1, total: 5, costUsd: null },
    { agent: "orchestrator", model: "reasoning-model", requests: 2, input: 16, output: 7, total: 23, costUsd: null },
    { agent: "panel-selector", model: "fast-model", requests: 1, input: 4, output: 1, total: 5, costUsd: null },
  ]);
  expect(maxActiveChildren).toBe(2);
});

test("maxCostUsd requires complete pricing and stops a run after reported usage crosses the limit", async () => {
  expect(() => config({ maxCostUsd: 1 })).toThrow(/pricing is required/);
  expect(() => config({ retryBaseDelayMs: 100, retryMaxDelayMs: 10 })).toThrow(
    /retryMaxDelayMs must be greater/,
  );

  const root = await mkdtemp(join(tmpdir(), "litecode-budget-"));
  const pricing = {
    "fast-model": { inputPerMillion: 2, outputPerMillion: 4 },
    "balanced-model": { inputPerMillion: 2, outputPerMillion: 4 },
    "reasoning-model": { inputPerMillion: 2, outputPerMillion: 4 },
  };
  const provider: Provider = {
    name: "fake",
    async complete() {
      return { message: assistant("done"), usage: { input: 500_000, output: 250_000, total: 750_000 } };
    },
  };

  const priced = config({ pricing, maxCostUsd: 3 });
  const catalog = await AgentCatalog.load(root, PACKS, priced);
  const report = await new AgentRuntime({ projectRoot: root, config: priced, provider, catalog }).runDetailed("classifier", "x");
  expect(report.usage.costUsd).toBe(2);
  expect(report.usage.byAgent[0]?.costUsd).toBe(2);

  const limited = config({ pricing, maxCostUsd: 1 });
  await expect(new AgentRuntime({ projectRoot: root, config: limited, provider, catalog }).run("classifier", "x"))
    .rejects.toThrow("Run cost $2.000000 exceeded maxCostUsd $1.000000");

  const noUsage: Provider = { name: "fake", async complete() { return { message: assistant("done") }; } };
  await expect(new AgentRuntime({ projectRoot: root, config: priced, provider: noUsage, catalog }).run("classifier", "x"))
    .rejects.toThrow("omitted usage; cannot enforce maxCostUsd");
});

test("frontmatter tool restrictions are enforced even if a provider hallucinates a call", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-runner-"));
  const cfg = config();
  const catalog = await AgentCatalog.load(root, PACKS, cfg);
  let turn = 0;
  const provider: Provider = {
    name: "fake",
    async complete(request) {
      turn++;
      expect(request.tools.map((tool) => tool.name)).not.toContain("Write");
      if (turn === 1) {
        return { message: assistant("", [{ id: "bad", name: "Write", input: { path: "x", content: "x" } }]) };
      }
      const error = request.messages.find((message) => message.role === "tool");
      expect(error).toMatchObject({ isError: true });
      expect(error?.content).toContain("not available");
      return { message: assistant("restriction confirmed") };
    },
  };

  await expect(new AgentRuntime({ projectRoot: root, config: cfg, provider, catalog }).run("classifier", "x"))
    .resolves.toBe("restriction confirmed");
  expect(await Bun.file(join(root, "x")).exists()).toBe(false);
});

test("terminal failures expose a partial report with retries, request ids, and completed usage", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-failure-report-"));
  const cfg = config();
  const catalog = await AgentCatalog.load(root, PACKS, cfg);
  let turn = 0;
  const provider: Provider = {
    name: "fake",
    async complete(request) {
      turn++;
      if (turn === 1) {
        request.onRetry?.({ retry: 1, maxRetries: 2, delayMs: 10, status: 429, requestId: "req-retry" });
        return {
          message: assistant("", [{ id: "read", name: "Read", input: { path: "missing.txt" } }]),
          usage: { input: 10, output: 2, total: 12 },
          requestId: "req-ok",
          attempts: 2,
        };
      }
      throw new ProviderError("provider still unavailable", {
        status: 503,
        requestId: "req-failed",
        attempts: 3,
      });
    },
  };

  try {
    await new AgentRuntime({ projectRoot: root, config: cfg, provider, catalog }).runDetailed("classifier", "x");
    throw new Error("expected run to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(RunnerExecutionError);
    const report = (error as RunnerExecutionError).report;
    expect(report).toMatchObject({
      status: "failed",
      output: null,
      retries: 1,
      requestIds: ["req-retry", "req-ok", "req-failed"],
      usage: { requests: 1, input: 10, output: 2, total: 12 },
      error: {
        message: "provider still unavailable",
        code: "http_error",
        statusCode: 503,
        requestId: "req-failed",
        attempts: 3,
      },
    });
  }
});

test("the global run timeout aborts an in-flight provider request and returns a timed-out report", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-run-timeout-"));
  const cfg = config({ runTimeoutMs: 5, requestTimeoutMs: 1_000 });
  const catalog = await AgentCatalog.load(root, PACKS, cfg);
  const provider: Provider = {
    name: "fake",
    async complete(request) {
      return new Promise((_resolve, reject) => {
        request.signal!.addEventListener("abort", () => reject(request.signal!.reason), { once: true });
      });
    },
  };

  try {
    await new AgentRuntime({ projectRoot: root, config: cfg, provider, catalog }).runDetailed("classifier", "x");
    throw new Error("expected run to time out");
  } catch (error) {
    expect(error).toBeInstanceOf(RunnerExecutionError);
    expect((error as RunnerExecutionError).report).toMatchObject({
      status: "timed_out",
      agentCalls: 1,
      usage: { requests: 0, input: 0, output: 0, total: 0 },
      error: { name: "RunTimeoutError", message: "Run timed out after 5ms" },
    });
  }
});

test("local tools edit allowed files and reject paths outside configured roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-tools-"));
  const cfg = config();
  const catalog = await AgentCatalog.load(root, PACKS, cfg);
  const tools = new LocalTools(root, cfg.project.worktreeRoot, catalog, 10_000, 1_000);

  expect((await tools.execute("Write", { path: "note.txt", content: "before" }, root)).isError).toBeFalsy();
  expect((await tools.execute("Edit", { path: "note.txt", old_text: "before", new_text: "after" }, root)).isError).toBeFalsy();
  expect(await Bun.file(join(root, "note.txt")).text()).toBe("after");

  const escaped = await tools.execute("Read", { path: "/etc/passwd" }, root);
  expect(escaped.isError).toBe(true);
  expect(escaped.content).toContain("outside the project");

  await symlink("/etc", join(root, "escape"));
  const symlinkEscape = await tools.execute("Read", { path: "escape/passwd" }, root);
  expect(symlinkEscape.isError).toBe(true);
  expect(symlinkEscape.content).toContain("outside the project");

  const globEscape = await tools.execute("Glob", { pattern: "../*" }, root);
  expect(globEscape.isError).toBe(true);
});

test("cancelling a run terminates an in-flight Bash tool", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-tools-cancel-"));
  const cfg = config();
  const catalog = await AgentCatalog.load(root, PACKS, cfg);
  const tools = new LocalTools(root, cfg.project.worktreeRoot, catalog, 10_000, 10_000);
  const controller = new AbortController();
  const started = Date.now();
  const execution = tools.execute("Bash", { command: "sleep 10" }, root, controller.signal);
  setTimeout(() => controller.abort(new RunCancelledError("cancel test")), 10);

  await expect(execution).rejects.toThrow("cancel test");
  expect(Date.now() - started).toBeLessThan(1_000);
});

test("runner skill directories cannot enter the Claude-owned output tree, including through symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-skill-roots-"));
  await Bun.write(join(root, ".claude/skills/local/SKILL.md"), "---\nname: local\ndescription: local\n---\n");
  await symlink(join(root, ".claude", "skills"), join(root, "linked-skills"));

  await expect(AgentCatalog.load(root, PACKS, config({ skillDirs: [".claude/skills"] }))).rejects.toThrow(
    /cannot point inside \.claude/,
  );
  await expect(AgentCatalog.load(root, PACKS, config({ skillDirs: ["linked-skills"] }))).rejects.toThrow(
    /cannot point inside \.claude/,
  );
});

test("litecode run crosses the CLI and OpenAI adapter end to end", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-cli-run-"));
  const receivedPath = join(root, "received.json");
  const reportPath = join(root, "run-report.json");
  const preload = join(root, "mock-fetch.ts");
  await Bun.write(
    preload,
    `globalThis.fetch = async (_input, init) => {\n` +
      `  await Bun.write(${JSON.stringify(receivedPath)}, String(init?.body));\n` +
      `  return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: "SIZE: trivial" }] }], usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } });\n` +
      `};\n`,
  );
  const cfg = config({ apiKeyEnv: "LITECODE_TEST_API_KEY", baseUrl: "https://provider.test/v1" });
  await Bun.write(join(root, "litecode.config.json"), `${JSON.stringify(cfg)}\n`);
  const cli = join(import.meta.dir, "..", "src", "cli.ts");
  const proc = Bun.spawn(
    [
      process.execPath,
      "--preload",
      preload,
      cli,
      "run",
      "classifier",
      "--prompt",
      "classify this",
      "--json",
      "--record",
      "run-report.json",
      "--project",
      root,
    ],
    {
      cwd: root,
      env: { ...process.env, LITECODE_TEST_API_KEY: "secret" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(exit, stderr).toBe(0);
  const report = JSON.parse(stdout);
  expect(report).toMatchObject({
    output: "SIZE: trivial",
    provider: "openai",
    agent: "classifier",
    agentCalls: 1,
    usage: { requests: 1, input: 3, output: 2, total: 5, costUsd: null },
  });
  expect(await Bun.file(reportPath).json()).toEqual(report);
  expect(await Bun.file(receivedPath).json()).toMatchObject({ model: "fast-model", store: false });
});

test("litecode run emits and records a structured partial report on provider failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-cli-failure-"));
  const reportPath = join(root, "failed-run.json");
  const preload = join(root, "mock-failure.ts");
  await Bun.write(
    preload,
    `globalThis.fetch = async () => new Response("overloaded", { status: 503, headers: { "x-request-id": "req-down" } });\n`,
  );
  const cfg = config({
    apiKeyEnv: "LITECODE_TEST_API_KEY",
    baseUrl: "https://provider.test/v1",
    maxRetries: 0,
  });
  await Bun.write(join(root, "litecode.config.json"), `${JSON.stringify(cfg)}\n`);
  const cli = join(import.meta.dir, "..", "src", "cli.ts");
  const proc = Bun.spawn(
    [
      process.execPath,
      "--preload",
      preload,
      cli,
      "run",
      "classifier",
      "--prompt",
      "classify this",
      "--json",
      "--record",
      "failed-run.json",
      "--project",
      root,
    ],
    {
      cwd: root,
      env: { ...process.env, LITECODE_TEST_API_KEY: "secret" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(exit, stderr).toBe(1);
  const report = JSON.parse(stdout);
  expect(report).toMatchObject({
    status: "failed",
    output: null,
    retries: 0,
    requestIds: ["req-down"],
    usage: { requests: 0, input: 0, output: 0, total: 0 },
    error: { code: "http_error", statusCode: 503, requestId: "req-down", attempts: 1 },
  });
  expect(await Bun.file(reportPath).json()).toEqual(report);
});
