import { basename, isAbsolute, relative, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import type { Config } from "../config.ts";
import { parseFrontmatter, parseList } from "../frontmatter.ts";
import { loadPack, TIERS, type Tier } from "../packs.ts";
import { render } from "../template.ts";
import { delegationHelpers } from "../delegation.ts";
import type { AgentDefinition } from "./types.ts";

type SkillDefinition = { name: string; description: string; prompt: string };

async function canonicalIfPresent(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const GENERAL_PURPOSE: AgentDefinition = {
  name: "general-purpose",
  description: "Executes one self-contained implementation or investigation step delegated by another agent.",
  tier: "balanced",
  tools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob", "Skill"],
  skills: [],
  prompt:
    "You are a general-purpose subagent. Complete exactly the delegated task in the prompt, " +
    "work in the directory it names, verify your work, and return a concise result to the parent agent.",
};

export class AgentCatalog {
  private readonly agents = new Map<string, AgentDefinition>();
  private readonly skills = new Map<string, SkillDefinition>();

  private constructor(
    private readonly projectRoot: string,
    private readonly outDir: string,
    private readonly runnerSkillRoots: string[],
  ) {}

  static async load(projectRoot: string, packsRoot: string, config: Config): Promise<AgentCatalog> {
    const outRoot = resolve(projectRoot, config.outDir);
    const runnerSkillRoots = (config.runner?.skillDirs ?? []).map((dir) => resolve(projectRoot, dir));
    const canonicalOutRoot = await canonicalIfPresent(outRoot);
    for (const root of runnerSkillRoots) {
      if (within(outRoot, root) || within(canonicalOutRoot, await canonicalIfPresent(root))) {
        throw new Error(`runner.skillDirs cannot point inside ${config.outDir}; those files belong to the configured install target`);
      }
    }
    const catalog = new AgentCatalog(projectRoot, config.outDir, runnerSkillRoots);
    for (const packName of config.packs) {
      const pack = await loadPack(packsRoot, packName);
      for (const file of pack.files) {
        const where = `${packName}/${file.rel}`;
        const rendered = render(file.source, { project: config.project }, where, delegationHelpers("runner"));
        const { data, body } = parseFrontmatter(rendered, where);
        if (file.rel.startsWith("agents/")) {
          const name = data.name;
          const tier = data.tier as Tier;
          if (!name || !TIERS.includes(tier)) throw new Error(`${where}: invalid agent name or tier`);
          if (catalog.agents.has(name)) throw new Error(`Agent '${name}' is provided by more than one pack`);
          catalog.agents.set(name, {
            name,
            description: data.description ?? "",
            tier,
            tools: parseList(data.tools),
            skills: parseList(data.skills),
            prompt: body.trim(),
          });
        } else if (/^skills\/[^/]+\/SKILL\.md$/.test(file.rel)) {
          const name = data.name ?? basename(resolve(file.rel, ".."));
          if (catalog.skills.has(name)) throw new Error(`Skill '${name}' is provided by more than one pack`);
          catalog.skills.set(name, { name, description: data.description ?? "", prompt: body.trim() });
        }
      }
    }
    catalog.agents.set(GENERAL_PURPOSE.name, GENERAL_PURPOSE);

    // Fail at startup if a preloaded skill cannot resolve. Runner overlays use explicit roots
    // outside the configured native-agent output tree.
    for (const agent of catalog.agents.values()) {
      for (const skill of agent.skills) await catalog.skill(skill);
    }
    return catalog;
  }

  agent(name: string): AgentDefinition {
    const definition = this.agents.get(name);
    if (!definition) {
      throw new Error(`Unknown agent '${name}'. Available: ${this.agentNames().join(", ")}`);
    }
    return definition;
  }

  agentNames(): string[] {
    return [...this.agents.keys()].sort();
  }

  async skill(name: string): Promise<SkillDefinition> {
    const packed = this.skills.get(name);
    if (packed) return packed;
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Invalid skill name '${name}'`);

    for (const root of this.runnerSkillRoots) {
      const path = resolve(root, name, "SKILL.md");
      if (!within(root, path)) continue;
      if (!(await Bun.file(path).exists())) continue;
      const source = await Bun.file(path).text();
      const { data, body } = parseFrontmatter(source, relative(this.projectRoot, path));
      const local = { name: data.name ?? name, description: data.description ?? "", prompt: body.trim() };
      this.skills.set(name, local);
      return local;
    }
    throw new Error(
      `Unknown runner skill '${name}'. Install a pack that provides it or add its parent to runner.skillDirs ` +
        `(runner skill directories must stay outside ${this.outDir}).`,
    );
  }

  async systemPrompt(agent: AgentDefinition, workingDirectory: string): Promise<string> {
    const preloaded: string[] = [];
    for (const name of agent.skills) {
      const skill = await this.skill(name);
      preloaded.push(`<skill name="${skill.name}">\n${skill.prompt}\n</skill>`);
    }
    return [
      `You are the '${agent.name}' agent. Your working directory is ${workingDirectory}.`,
      "Use only the tools exposed in this run. Tool restrictions are enforced by the runner.",
      "An Agent tool call is synchronous: its returned text is the completed child result.",
      agent.prompt,
      preloaded.length ? `## Preloaded skills\n\n${preloaded.join("\n\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
}
