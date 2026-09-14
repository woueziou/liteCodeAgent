import { expect, test } from "bun:test";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, type Config } from "../src/config.ts";
import { AgentCatalog } from "../src/runner/catalog.ts";
import { AgentRuntime } from "../src/runner/runtime.ts";
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
          };
        }
        const results = request.messages.filter((message) => message.role === "tool");
        expect(results.map((message) => message.content).sort()).toEqual(["ANGLES: correctness", "SIZE: small"]);
        return { message: assistant("parent received both completed children") };
      }

      activeChildren++;
      maxActiveChildren = Math.max(maxActiveChildren, activeChildren);
      await Bun.sleep(20);
      activeChildren--;
      return {
        message: assistant(request.system.includes("'classifier'") ? "SIZE: small" : "ANGLES: correctness"),
      };
    },
  };

  const result = await new AgentRuntime({ projectRoot: root, config: cfg, provider, catalog }).run(
    "orchestrator",
    "plan a change",
  );
  expect(result).toBe("parent received both completed children");
  expect(maxActiveChildren).toBe(2);
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
    [process.execPath, "--preload", preload, cli, "run", "classifier", "--prompt", "classify this", "--project", root],
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
  expect(stdout.trim()).toBe("SIZE: trivial");
  expect(await Bun.file(receivedPath).json()).toMatchObject({ model: "fast-model", store: false });
});
