import { resolve, dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config, InstallTarget } from "./config.ts";
import { selectedTargets, TARGETS } from "./config.ts";
import { loadPack, type PackFile } from "./packs.ts";
import { parseFrontmatter, parseList, serializeFrontmatter, type Frontmatter } from "./frontmatter.ts";
import { render, referencedPaths } from "./template.ts";
import { hash, readLockfile, writeLockfile, type Lockfile } from "./lockfile.ts";

export type PlanEntry = {
  rel: string;
  target: string;
  harness: InstallTarget;
  pack: string;
  version: string;
  content: string;
  status: "create" | "update" | "unchanged" | "drift";
};

export type InstallPlan = {
  entries: PlanEntry[];
  /** Files the previous lockfiles owned that this install no longer produces. */
  orphans: string[];
  packVersions: Record<string, string>;
  lockfilePaths: Partial<Record<InstallTarget, string>>;
};

const ROOTS: Record<InstallTarget, string> = {
  "claude-code": ".claude",
  codex: ".codex",
  pi: ".pi",
  opencode: ".opencode",
  "kilo-code": ".kilo",
};

const SKILL_ROOTS: Record<InstallTarget, string> = {
  "claude-code": ".claude/skills",
  // Codex and several other harnesses support the cross-tool Agent Skills convention.
  codex: ".agents/skills",
  pi: ".pi/skills",
  opencode: ".opencode/skills",
  "kilo-code": ".kilo/skills",
};

function lockPath(target: InstallTarget): string {
  return `${ROOTS[target]}/.litecode-lock.json`;
}

/** Resolves a provider-neutral tier without tying non-Claude agents to Claude model ids. */
function renderClaudeAgent(data: Frontmatter, body: string, config: Config, where: string): string {
  if (data.tier) {
    const tier = data.tier as keyof Config["tiers"];
    const model = config.tiers[tier];
    if (!model) throw new Error(`${where}: no model configured for tier '${data.tier}'`);
    delete data.tier;
    data.model = model;
  }
  return serializeFrontmatter(data, body);
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function renderCodexAgent(data: Frontmatter, body: string): string {
  const tierToEffort: Record<string, string> = { fast: "low", balanced: "medium", reasoning: "high" };
  const effort = tierToEffort[data.tier ?? "balanced"] ?? "medium";
  const tools = parseList(data.tools);
  const sandbox = tools.some((tool) => ["Edit", "Write", "Bash"].includes(tool))
    ? "workspace-write"
    : "read-only";
  const skills = parseList(data.skills);
  const skillNote = skills.length
    ? `\n\nAvailable project skills: ${skills.map((skill) => `\`${skill}\``).join(", ")}. Load the relevant skill instructions before applying them.`
    : "";
  const instructions = `${body}${skillNote}`
    .replace(/\bAgent\b/g, "Codex subagent")
    .replace(/`subagent_type`/g, "`agent name`")
    .trim();
  return [
    `name = ${JSON.stringify(data.name ?? "agent")}`,
    `description = ${JSON.stringify(data.description ?? "")}`,
    `model_reasoning_effort = ${JSON.stringify(effort)}`,
    `sandbox_mode = ${JSON.stringify(sandbox)}`,
    `developer_instructions = ${JSON.stringify(instructions)}`,
    "",
  ].join("\n");
}

function renderOpenCodeAgent(data: Frontmatter, body: string): string {
  const toolMap: Record<string, string> = {
    Read: "read", Edit: "edit", Write: "write", Bash: "bash", Grep: "grep",
    Glob: "glob", Agent: "task", Skill: "skill",
  };
  const tools = Object.fromEntries(Object.values(toolMap).map((name) => [name, false]));
  for (const tool of parseList(data.tools)) {
    if (toolMap[tool]) tools[toolMap[tool]!] = true;
  }
  const name = data.name ?? "agent";
  const mode = name === "orchestrator" ? "primary" : "subagent";
  const skills = parseList(data.skills);
  const skillNote = skills.length
    ? `\n\nAvailable project skills: ${skills.map((skill) => `\`${skill}\``).join(", ")}. Use the skill tool to load relevant instructions before applying them.`
    : "";
  const instructions = `${body}${skillNote}`.replace(/\bAgent\b/g, "task").trim();
  return [
    "---",
    `description: ${yamlScalar(data.description ?? "")}`,
    `mode: ${mode}`,
    "tools:",
    ...Object.entries(tools).map(([tool, enabled]) => `  ${tool}: ${enabled}`),
    "---",
    "",
    instructions,
    "",
  ].join("\n");
}

function renderKiloAgent(data: Frontmatter, body: string): string {
  const permissions: Record<string, string> = {
    read: "deny", edit: "deny", bash: "deny", glob: "deny", grep: "deny", task: "deny", skill: "deny",
  };
  const toolMap: Record<string, string> = {
    Read: "read", Edit: "edit", Write: "edit", Bash: "bash", Grep: "grep",
    Glob: "glob", Agent: "task", Skill: "skill",
  };
  for (const tool of parseList(data.tools)) {
    if (toolMap[tool]) permissions[toolMap[tool]!] = "allow";
  }
  const name = data.name ?? "agent";
  const mode = name === "orchestrator" ? "primary" : "subagent";
  const skills = parseList(data.skills);
  const skillNote = skills.length
    ? `\n\nAvailable project skills: ${skills.map((skill) => `\`${skill}\``).join(", ")}. Use the skill tool to load relevant instructions before applying them.`
    : "";
  const instructions = `${body}${skillNote}`
    .replace(/\bAgent\b/g, "task")
    .replace(/`subagent_type`/g, "`mode`")
    .trim();
  return [
    "---",
    `name: ${name}`,
    `description: ${yamlScalar(data.description ?? "")}`,
    `mode: ${mode}`,
    "permission:",
    ...Object.entries(permissions).map(([tool, permission]) => `  ${tool}: ${permission}`),
    "---",
    "",
    instructions,
    "",
  ].join("\n");
}

const PI_EXTENSION = `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "litecode_run",
    label: "LiteCodeAgent planning workflow",
    description: "Run LiteCodeAgent's discussion, debate, synthesis, and planning workflow. This does not create issues or edit project files.",
    parameters: Type.Object({
      prompt: Type.String({ description: "The raw idea, feature request, bug report, or doc need to discuss and plan." }),
    }),
    async execute(_toolCallId, params, signal) {
      const result = await pi.exec(
        "bunx",
        ["--yes", "litecodeagent", "run", "orchestrator", "--prompt", params.prompt],
        { signal, timeout: 1_800_000 },
      );
      const output = result.stdout.trim() || result.stderr.trim() || "LiteCodeAgent returned no output.";
      if (result.code !== 0) throw new Error(output);
      return { content: [{ type: "text", text: output }] };
    },
  });
}
`;

function renderWorkflow(source: string, target: InstallTarget): string {
  const { data, body } = parseFrontmatter(source, "core/workflows/litecodeagent.md");
  const description = data.description ?? "Discuss an idea and produce a plan without creating work items or implementing it.";
  const workflow = body.trim();
  if (target === "claude-code") {
    return [
      "---",
      `description: ${description}`,
      "argument-hint: <idea or request>",
      "---",
      "",
      workflow,
      "",
      "## Request",
      "",
      "$ARGUMENTS",
      "",
      "Invoke the `orchestrator` agent with the complete request above. Return its plan to the user, and do not continue into ticket creation or implementation.",
      "",
    ].join("\n");
  }
  if (target === "codex") {
    return serializeFrontmatter({
      name: "litecodeagent",
      description: "Run the LiteCodeAgent discussion and planning workflow for an idea, feature, bug, or documentation request. Invoke when the user types /litecodeagent <request> or $litecodeagent <request>.",
    }, `${workflow}\n\nWhen invoked, treat the text following /litecodeagent or $litecodeagent as the raw request. Delegate to the installed \`orchestrator\` Codex subagent if available; otherwise follow its sequence directly. Stop after presenting the plan. Never create an issue, update a board, or implement the work.\n`);
  }
  if (target === "opencode" || target === "kilo-code") {
    return [
      "---",
      `description: ${yamlScalar(description)}`,
      "agent: orchestrator",
      "---",
      "",
      workflow,
      "",
      "## Request",
      "",
      "$ARGUMENTS",
      "",
      "Return the discussion and plan only. Do not create a ticket, touch the board, or implement anything.",
      "",
    ].join("\n");
  }
  // Pi prompt templates expand $ARGUMENTS. Pi has no built-in subagents, so the project
  // extension delegates to LiteCodeAgent's configured provider-neutral API runner.
  return [
    "---",
    `description: ${yamlScalar(description)}`,
    "argument-hint: <idea or request>",
    "---",
    "",
    workflow,
    "",
    "Call the `litecode_run` tool exactly once with this complete request:",
    "",
    "$ARGUMENTS",
    "",
    "Return the tool's plan to the user without creating an issue, touching a board, or implementing the work.",
    "",
  ].join("\n");
}

/** Config paths a set of packs requires, so invalid project config can fail before writes. */
export function requiredPaths(files: { rel: string; source: string }[]): string[] {
  const paths = new Set<string>();
  for (const file of files) for (const path of referencedPaths(file.source)) paths.add(path);
  return [...paths].sort();
}

export type MissingConfigPath = { path: string; sources: string[] };

/**
 * Missing `project.agentSkills.*` leaves the installed packs require. Scoped narrowly to
 * `agentSkills` rather than every path `requiredPaths` could in principle yield — see
 * ADR 0006 for why the broader scope was rejected (false positives on `{{#if}}`-guarded
 * and `{{#each}}` item-scoped paths). A key entirely absent from the config is the failure;
 * a key present with an empty array is a legitimate "no skills for this agent" and is fine.
 */
export function missingAgentSkillPaths(
  files: { rel: string; source: string; packName: string }[],
  agentSkills: Record<string, string[]>,
): MissingConfigPath[] {
  const sourcesByPath = new Map<string, string[]>();
  for (const file of files) {
    for (const path of referencedPaths(file.source)) {
      if (!/^project\.agentSkills\.[^.]+$/.test(path)) continue;
      sourcesByPath.set(path, [...(sourcesByPath.get(path) ?? []), `${file.packName}:${file.rel}`]);
    }
  }
  const missing: MissingConfigPath[] = [];
  for (const [path, sources] of sourcesByPath) {
    const key = path.slice("project.agentSkills.".length);
    if (agentSkills[key] === undefined) missing.push({ path, sources: [...new Set(sources)] });
  }
  return missing.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Pre-flight: fail before any render/write with an actionable error, instead of letting
 * the strict template renderer throw a raw `TemplateError` mid-render (see #17).
 */
function validateRequiredConfigPaths(
  config: Config,
  files: { rel: string; source: string; packName: string }[],
): void {
  const missing = missingAgentSkillPaths(files, config.project.agentSkills);
  if (missing.length === 0) return;
  throw new Error(
    "litecode.config.json is missing config path(s) the installed packs require:\n" +
      missing.map((m) => `  - ${m.path} (referenced by ${m.sources.join(", ")})`).join("\n") +
      "\n\nRun `litecode config doctor --fix` to fill in missing agentSkills keys, or add them by hand.",
  );
}

/** Returns all generated output paths for a source pack file. */
function outputFiles(file: PackFile, config: Config, target: InstallTarget): { rel: string; content: string }[] {
  const rendered = render(file.source, { project: config.project }, `${file.rel}`);
  const { data, body } = parseFrontmatter(rendered, file.rel);
  const agent = /^agents\/([^/]+)\.md$/.exec(file.rel);
  const skill = /^(skills\/.+)$/.exec(file.rel);
  const workflow = file.rel === "workflows/litecodeagent.md";

  if (target === "claude-code") {
    if (agent) {
      return [{ rel: join(config.outDir, file.rel), content: renderClaudeAgent(data, body, config, file.rel) }];
    }
    if (workflow) return [{ rel: ".claude/commands/litecodeagent.md", content: renderWorkflow(rendered, target) }];
    return [{ rel: join(config.outDir, file.rel), content: serializeFrontmatter(data, body) }];
  }

  if (agent) {
    if (target === "codex") {
      return [{ rel: `.codex/agents/${agent[1]}.toml`, content: renderCodexAgent(data, body) }];
    }
    if (target === "opencode") {
      return [{ rel: `.opencode/agents/${agent[1]}.md`, content: renderOpenCodeAgent(data, body) }];
    }
    if (target === "kilo-code") {
      return [{ rel: `.kilo/agents/${agent[1]}.md`, content: renderKiloAgent(data, body) }];
    }
    // Pi has no native agent definitions; its LiteCode extension calls the shared runner.
    return [];
  }

  if (skill) {
    return [{ rel: join(SKILL_ROOTS[target], skill[1]!), content: serializeFrontmatter(data, body) }];
  }

  if (workflow) {
    if (target === "codex") {
      return [{ rel: ".agents/skills/litecodeagent/SKILL.md", content: renderWorkflow(rendered, target) }];
    }
    if (target === "pi") {
      return [
        { rel: ".pi/prompts/litecodeagent.md", content: renderWorkflow(rendered, target) },
        { rel: ".pi/extensions/litecodeagent.ts", content: PI_EXTENSION },
      ];
    }
    return [{ rel: `${ROOTS[target]}/commands/litecodeagent.md`, content: renderWorkflow(rendered, target) }];
  }

  return [{ rel: join(ROOTS[target], file.rel), content: serializeFrontmatter(data, body) }];
}

/** Local skill overlays are accepted under any enabled harness's native skill root. */
async function validateSkillReferences(
  projectRoot: string,
  config: Config,
  targets: InstallTarget[],
  packSkills: Set<string>,
): Promise<void> {
  const refs = new Map<string, string[]>();
  const add = (skill: string, where: string) => refs.set(skill, [...(refs.get(skill) ?? []), where]);
  for (const [agent, skills] of Object.entries(config.project.agentSkills)) {
    for (const skill of skills) add(skill, `agentSkills.${agent}`);
  }
  for (const angle of config.project.angles) for (const skill of angle.skills) add(skill, `angles.${angle.name}`);
  for (const [i, domain] of config.project.domains.entries()) {
    for (const skill of domain.skills) add(skill, `domains[${i}]`);
  }

  const roots = [...new Set([config.outDir ? `${config.outDir}/skills` : "", ...targets.map((t) => SKILL_ROOTS[t])])];
  const problems: string[] = [];
  for (const [skill, where] of refs) {
    if (packSkills.has(skill)) continue;
    let found: string | undefined;
    for (const root of roots) {
      if (root && (await Bun.file(resolve(projectRoot, root, skill, "SKILL.md")).exists())) {
        found = root;
        break;
      }
    }
    if (found) continue;
    problems.push(
      `  - '${skill}' (referenced by ${[...new Set(where)].join(", ")}) — not in any installed pack, ` +
        `and no local skill file under ${roots.filter(Boolean).join(" or ")}`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `litecode.config.json references skill(s) that do not exist:\n${problems.join("\n")}\n\n` +
        `Install the pack that provides them, write them as a local overlay under an enabled harness's skill directory, or remove the reference.`,
    );
  }
}

export async function buildPlan(projectRoot: string, packsRoot: string, config: Config): Promise<InstallPlan> {
  const targets = selectedTargets(config);
  const lockfilePaths = Object.fromEntries(targets.map((target) => [target, lockPath(target)])) as Partial<Record<InstallTarget, string>>;
  const previous = new Map<InstallTarget, Lockfile | null>();
  // Read all known harness locks so changing `targets` surfaces files no longer produced.
  for (const target of TARGETS) previous.set(target, await readLockfile(projectRoot, lockPath(target)));

  const entries: PlanEntry[] = [];
  const packVersions: Record<string, string> = {};
  const seen = new Map<string, string>();
  const packSkills = new Set<string>();
  const packs = [];
  for (const packName of config.packs) {
    const pack = await loadPack(packsRoot, packName);
    packs.push({ packName, pack });
    packVersions[pack.manifest.name] = pack.manifest.version;
    for (const missing of pack.manifest.requires.filter((r) => !config.packs.includes(r))) {
      throw new Error(`Pack '${packName}' requires pack '${missing}', which is not in config.packs`);
    }
    for (const file of pack.files) {
      const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(file.rel);
      if (match?.[1]) packSkills.add(match[1]);
    }
  }

  validateRequiredConfigPaths(
    config,
    packs.flatMap(({ packName, pack }) => pack.files.map((file) => ({ ...file, packName }))),
  );

  for (const targetName of targets) {
    for (const { packName, pack } of packs) {
      for (const file of pack.files) {
        for (const output of outputFiles(file, config, targetName)) {
          const rel = output.rel;
          const ownerKey = `${targetName}:${rel}`;
          const owner = seen.get(ownerKey);
          if (owner) {
            throw new Error(
              `Conflict: '${rel}' is produced by both pack '${owner}' and pack '${packName}'. ` +
                `Packs must not overwrite each other — rename one of the two files.`,
            );
          }
          seen.set(ownerKey, packName);
          const target = resolve(projectRoot, rel);
          const existing = Bun.file(target);
          const prior = previous.get(targetName)?.files[rel];
          let status: PlanEntry["status"];
          if (!(await existing.exists())) status = "create";
          else {
            const onDisk = hash(await existing.text());
            if (prior && onDisk !== prior.hash) status = "drift";
            else if (onDisk === hash(output.content)) status = "unchanged";
            else status = "update";
          }
          entries.push({
            rel,
            target,
            harness: targetName,
            pack: packName,
            version: pack.manifest.version,
            content: output.content,
            status,
          });
        }
      }
    }
  }

  await validateSkillReferences(projectRoot, config, targets, packSkills);
  const orphans: string[] = [];
  for (const target of TARGETS) {
    const produced = new Set(entries.filter((entry) => entry.harness === target).map((entry) => entry.rel));
    for (const rel of Object.keys(previous.get(target)?.files ?? {})) {
      if (!produced.has(rel)) orphans.push(rel);
    }
  }
  return { entries, orphans, packVersions, lockfilePaths };
}

export async function applyPlan(
  projectRoot: string,
  plan: InstallPlan,
  litecodeVersion: string,
  opts: { force: boolean },
): Promise<void> {
  const drifted = plan.entries.filter((entry) => entry.status === "drift");
  if (drifted.length > 0 && !opts.force) {
    throw new Error(
      `Refusing to overwrite ${drifted.length} file(s) edited by hand since the last install:\n` +
        drifted.map((entry) => `  - ${entry.rel}`).join("\n") +
        `\n\nEither move your changes upstream into the pack, or re-run with --force to discard them.`,
    );
  }

  const filesByTarget = new Map<InstallTarget, Lockfile["files"]>();
  for (const entry of plan.entries) {
    if (entry.status !== "unchanged") {
      await mkdir(dirname(entry.target), { recursive: true });
      await Bun.write(entry.target, entry.content);
    }
    const files = filesByTarget.get(entry.harness) ?? {};
    files[entry.rel] = { pack: entry.pack, version: entry.version, hash: hash(entry.content) };
    filesByTarget.set(entry.harness, files);
  }

  for (const [target, files] of filesByTarget) {
    await writeLockfile(projectRoot, {
      litecodeVersion,
      installedAt: new Date().toISOString(),
      packs: plan.packVersions,
      files,
    }, plan.lockfilePaths[target]);
  }
}
