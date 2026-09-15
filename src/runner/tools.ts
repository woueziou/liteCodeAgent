import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { lstat, mkdir, realpath } from "node:fs/promises";
import type { AgentCatalog } from "./catalog.ts";
import type { ToolDefinition, ToolResult } from "./types.ts";

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const string = (description: string) => ({ type: "string", description });

const DEFINITIONS: Record<string, ToolDefinition> = {
  Read: {
    name: "Read",
    description: "Read a UTF-8 text file from the project or configured worktree area.",
    inputSchema: objectSchema(
      {
        path: string("Absolute path or path relative to the current working directory."),
        offset: { type: "integer", minimum: 1, description: "First line to return, one-based." },
        limit: { type: "integer", minimum: 1, description: "Maximum number of lines." },
      },
      ["path"],
    ),
  },
  Write: {
    name: "Write",
    description: "Create or replace a UTF-8 text file in the project or configured worktree area.",
    inputSchema: objectSchema({ path: string("File path."), content: string("Complete file content.") }, ["path", "content"]),
  },
  Edit: {
    name: "Edit",
    description: "Replace exact text in a UTF-8 file. Fails on missing or ambiguous matches.",
    inputSchema: objectSchema(
      {
        path: string("File path."),
        old_text: string("Exact text to replace."),
        new_text: string("Replacement text."),
        replace_all: { type: "boolean", description: "Replace every occurrence." },
      },
      ["path", "old_text", "new_text"],
    ),
  },
  Glob: {
    name: "Glob",
    description: "List files matching a glob below an allowed directory.",
    inputSchema: objectSchema(
      { pattern: string("Glob pattern."), path: string("Directory to search; defaults to the working directory.") },
      ["pattern"],
    ),
  },
  Grep: {
    name: "Grep",
    description: "Search file contents with ripgrep and return path:line:match results.",
    inputSchema: objectSchema(
      {
        pattern: string("Regular expression to search for."),
        path: string("File or directory; defaults to the working directory."),
        glob: string("Optional ripgrep file glob."),
      },
      ["pattern"],
    ),
  },
  Bash: {
    name: "Bash",
    description: "Run a zsh command locally. The command has the user's OS permissions and is not sandboxed.",
    inputSchema: objectSchema(
      {
        command: string("Shell command to run."),
        cwd: string("Working directory; defaults to the agent working directory."),
        timeout_ms: { type: "integer", minimum: 1, maximum: 600_000 },
      },
      ["command"],
    ),
  },
  Skill: {
    name: "Skill",
    description: "Load a named pack skill or explicitly referenced project-local skill.",
    inputSchema: objectSchema({ skill: string("Skill name.") }, ["skill"]),
  },
};

type ToolInput = Record<string, unknown>;

function record(input: unknown): ToolInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("tool input must be an object");
  return input as ToolInput;
}

function requiredString(input: ToolInput, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value) throw new Error(`'${key}' must be a non-empty string`);
  return value;
}

function stringValue(input: ToolInput, key: string): string {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`'${key}' must be a string`);
  return value;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("Run cancelled");
}

async function canonical(path: string): Promise<string> {
  let existing = path;
  const suffix: string[] = [];
  for (;;) {
    try {
      await lstat(existing);
      break;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) throw new Error(`Cannot resolve path ${path}`);
      suffix.unshift(basename(existing));
      existing = parent;
    }
  }
  return resolve(await realpath(existing), ...suffix);
}

export class LocalTools {
  private readonly allowedRoots: string[];

  constructor(
    projectRoot: string,
    worktreeRoot: string,
    private readonly catalog: AgentCatalog,
    private readonly outputLimit: number,
    private readonly bashTimeoutMs: number,
  ) {
    this.allowedRoots = [...new Set([resolve(projectRoot), resolve(projectRoot, worktreeRoot)])];
  }

  definitions(names: string[]): ToolDefinition[] {
    return names.filter((name) => name !== "Agent").map((name) => {
      const definition = DEFINITIONS[name];
      if (!definition) throw new Error(`Runner does not implement tool '${name}'`);
      return definition;
    });
  }

  private async path(value: string, cwd: string): Promise<string> {
    const path = await canonical(resolve(cwd, value));
    const roots = await Promise.all(this.allowedRoots.map(canonical));
    const allowed = roots.some((root) => {
      const rel = relative(root, path);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    });
    if (!allowed) throw new Error(`Path is outside the project and worktree roots: ${path}`);
    return path;
  }

  private truncate(value: string): string {
    if (value.length <= this.outputLimit) return value;
    return `${value.slice(0, this.outputLimit)}\n… truncated ${value.length - this.outputLimit} characters`;
  }

  async execute(name: string, rawInput: unknown, cwd: string, signal?: AbortSignal): Promise<ToolResult> {
    try {
      throwIfAborted(signal);
      const input = record(rawInput);
      switch (name) {
        case "Read": {
          const path = await this.path(requiredString(input, "path"), cwd);
          const lines = (await Bun.file(path).text()).split("\n");
          const offset = typeof input.offset === "number" ? Math.max(1, Math.trunc(input.offset)) : 1;
          const limit = typeof input.limit === "number" ? Math.max(1, Math.trunc(input.limit)) : lines.length;
          return { content: this.truncate(lines.slice(offset - 1, offset - 1 + limit).join("\n")) };
        }
        case "Write": {
          const path = await this.path(requiredString(input, "path"), cwd);
          const content = stringValue(input, "content");
          await mkdir(dirname(path), { recursive: true });
          await Bun.write(path, content);
          return { content: `Wrote ${content.length} bytes to ${path}` };
        }
        case "Edit": {
          const path = await this.path(requiredString(input, "path"), cwd);
          const oldText = requiredString(input, "old_text");
          const newText = typeof input.new_text === "string" ? input.new_text : (() => { throw new Error("'new_text' must be a string"); })();
          const source = await Bun.file(path).text();
          const occurrences = source.split(oldText).length - 1;
          if (occurrences === 0) throw new Error("old_text was not found");
          if (occurrences > 1 && input.replace_all !== true) {
            throw new Error(`old_text matched ${occurrences} times; set replace_all or provide more context`);
          }
          const content = input.replace_all === true ? source.split(oldText).join(newText) : source.replace(oldText, newText);
          await Bun.write(path, content);
          return { content: `Updated ${path}` };
        }
        case "Glob": {
          const base = await this.path(typeof input.path === "string" ? input.path : ".", cwd);
          const pattern = requiredString(input, "pattern");
          if (isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..")) {
            throw new Error("Glob pattern must stay below its search directory");
          }
          const glob = new Bun.Glob(pattern);
          const files: string[] = [];
          for await (const entry of glob.scan({ cwd: base, onlyFiles: true })) {
            throwIfAborted(signal);
            files.push(entry);
          }
          files.sort();
          return { content: this.truncate(files.join("\n")) };
        }
        case "Grep": {
          const target = await this.path(typeof input.path === "string" ? input.path : ".", cwd);
          const args = ["rg", "--line-number", "--no-heading", "--color", "never"];
          if (typeof input.glob === "string") args.push("--glob", input.glob);
          args.push(requiredString(input, "pattern"), target);
          const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe", signal });
          const [stdout, stderr, exit] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ]);
          throwIfAborted(signal);
          if (exit > 1) throw new Error(stderr.trim() || `rg exited ${exit}`);
          return { content: this.truncate(stdout.trim()) };
        }
        case "Bash": {
          const command = requiredString(input, "command");
          const base = await this.path(typeof input.cwd === "string" ? input.cwd : ".", cwd);
          const requested = typeof input.timeout_ms === "number" ? Math.trunc(input.timeout_ms) : this.bashTimeoutMs;
          const timeoutMs = Math.min(600_000, Math.max(1, requested));
          // macOS ships zsh by default; GitHub's Ubuntu runners do not. Use the
          // current user's shell when available and fall back to POSIX sh so the
          // same cancellation semantics work on every supported runner.
          const shell = process.env.SHELL || (process.platform === "win32" ? "sh" : "/bin/sh");
          const proc = Bun.spawn([shell, "-lc", command], {
            cwd: base,
            stdout: "pipe",
            stderr: "pipe",
            signal,
          });
          let timedOut = false;
          const timer = setTimeout(() => {
            timedOut = true;
            proc.kill();
          }, timeoutMs);
          const [stdout, stderr, exit] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ]).finally(() => clearTimeout(timer));
          throwIfAborted(signal);
          const output = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n");
          return {
            content: this.truncate(`${output}${output ? "\n" : ""}[exit ${exit}${timedOut ? ", timed out" : ""}]`),
            isError: timedOut || exit !== 0,
          };
        }
        case "Skill": {
          const skill = await this.catalog.skill(requiredString(input, "skill"));
          return { content: `<skill name="${skill.name}">\n${skill.prompt}\n</skill>` };
        }
        default:
          throw new Error(`Runner does not implement tool '${name}'`);
      }
    } catch (error) {
      throwIfAborted(signal);
      return { content: (error as Error).message, isError: true };
    }
  }
}

export function agentToolDefinition(agentNames: string[]): ToolDefinition {
  return {
    name: "Agent",
    description: "Run a child agent synchronously and return its completed result. Multiple Agent calls in one turn run in parallel.",
    inputSchema: objectSchema(
      {
        subagent_type: { type: "string", enum: agentNames, description: "Agent to invoke." },
        prompt: string("Self-contained task and context for the child agent."),
      },
      ["subagent_type", "prompt"],
    ),
  };
}
