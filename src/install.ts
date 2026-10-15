import { resolve, dirname, join, relative } from "node:path";
import { mkdir, chmod, readdir, realpath } from "node:fs/promises";
import type { Config, InstallTarget } from "./config.ts";
import { selectedTargets, TARGETS, TARGET_ROOTS } from "./config.ts";
import { loadPack, type PackFile } from "./packs.ts";
import { parseFrontmatter, parseList, serializeFrontmatter, type Frontmatter } from "./frontmatter.ts";
import { preflightRefusal, render, referencedPaths, templateProject } from "./template.ts";
import { delegationHelpers, packAgentNames } from "./delegation.ts";
import { configSkills, skipSkill, withoutInstallKey } from "./skill-filter.ts";
import { hash, readLockfile, writeLockfile, writeLockfileStable, type Lockfile } from "./lockfile.ts";

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
  /** The rendered `.githooks/pre-commit` branch guard (ticket 0033), if the `core` pack provides one. */
  hook: HookPlanEntry | null;
};

/**
 * The `.githooks/pre-commit` branch guard is harness-agnostic (git hooks aren't a
 * per-coding-tool concept the way agents/skills are), so it's tracked outside the
 * per-`InstallTarget` `PlanEntry`/lockfile machinery above rather than forcing it through
 * `outputFiles`, which would otherwise render (and race to write) the same physical file
 * once per selected target.
 */
export type HookPlanEntry = {
  rel: string;
  target: string;
  pack: string;
  version: string;
  content: string;
  /**
   * The litecodeagent CLI version (`kitVersion()`, off the kit's own `package.json`) used
   * to pin `content`'s `bunx` call — *not* `version` above, which is the core **pack**'s
   * own version and is a different number (e.g. pack `0.4.0` vs. CLI `1.1.1`). Any notice
   * telling a human to add a `bunx --yes litecodeagent@<version> guard-branch` line by
   * hand must use this field, or it prints a version that was never published.
   */
  kitVersion: string;
  /**
   * `preexisting` is distinct from `drift`: `drift` means litecodeagent installed this
   * file before and it was since hand-edited (still requires `--force` to overwrite, same
   * as any other managed file). `preexisting` means litecodeagent never installed this
   * file at all — the project already had its own `.githooks/pre-commit` before ever
   * running `litecode install`. That file must never be replaced or deleted, `--force`
   * included: it isn't ours to overwrite. See the "leave it alone" handling in
   * `applyPlan`.
   */
  status: PlanEntry["status"] | "preexisting";
};

export const HOOK_LOCK_PATH = ".githooks/.litecode-hook-lock.json";
export const HOOK_REL = ".githooks/pre-commit";

/**
 * The litecodeagent version doing the rendering, read off the kit's own `package.json`
 * (one directory up from `packsRoot`, same layout `cli.ts`'s `KIT_ROOT`/`VERSION` use) —
 * not a parameter threaded through `buildPlan`, so this stays an internal detail instead
 * of a breaking change to `buildPlan`'s signature and its many existing call sites.
 */
async function kitVersion(packsRoot: string): Promise<string> {
  const file = Bun.file(join(dirname(packsRoot), "package.json"));
  if (!(await file.exists())) return "latest";
  const pkg = (await file.json()) as { version?: string };
  return pkg.version ?? "latest";
}

async function planHook(
  projectRoot: string,
  packsRoot: string,
  packs: { packName: string; pack: Awaited<ReturnType<typeof loadPack>> }[],
): Promise<HookPlanEntry | null> {
  // Not a `.md` pack file (`loadPack` only walks those), so it's read straight off disk
  // rather than through `pack.files` — a pre-commit hook is a plain shell script, not
  // agent/skill prose that needs frontmatter or template rendering.
  for (const { packName, pack } of packs) {
    const source = Bun.file(join(packsRoot, packName, "hooks", "pre-commit"));
    if (!(await source.exists())) continue;
    // The rendered hook pins `bunx` to the litecodeagent version doing the rendering:
    // an unpinned `bunx litecodeagent guard-branch` would resolve to whatever's cached
    // or published, and an older/newer CLI that doesn't know `guard-branch` would fail
    // `set -e` and refuse every commit, not just ones on the default branch.
    const pinnedVersion = await kitVersion(packsRoot);
    const content = (await source.text()).replaceAll("__LITECODE_VERSION__", pinnedVersion);
    const target = resolve(projectRoot, HOOK_REL);
    const existing = Bun.file(target);
    const prior = await readLockfile(projectRoot, HOOK_LOCK_PATH);
    const priorEntry = prior?.files[HOOK_REL];
    let status: HookPlanEntry["status"];
    if (!(await existing.exists())) status = "create";
    else {
      const onDisk = hash(await existing.text());
      if (onDisk === hash(content)) status = "unchanged";
      // No prior lock entry at all means litecodeagent never wrote this file — it's a
      // project's own pre-existing hook (this repo's own `.githooks/pre-commit` is one).
      // Never replace or delete it, `--force` included: it isn't ours to overwrite.
      // `applyPlan` reports it as skipped and prints the exact line to add instead.
      else if (!priorEntry) status = "preexisting";
      // A prior lock entry exists but its hash no longer matches: litecodeagent installed
      // this file before and it's since been hand-edited. Same rule as any other managed
      // file — blocks unless `--force`.
      else if (onDisk !== priorEntry.hash) status = "drift";
      else status = "update";
    }
    return {
      rel: HOOK_REL,
      target,
      pack: packName,
      version: pack.manifest.version,
      kitVersion: pinnedVersion,
      content,
      status,
    };
  }
  return null;
}

const ROOTS = TARGET_ROOTS;

export const SKILL_ROOTS: Record<InstallTarget, string> = {
  "claude-code": ".claude/skills",
  // Codex and several other harnesses support the cross-tool Agent Skills convention.
  codex: ".agents/skills",
  pi: ".pi/skills",
  opencode: ".opencode/skills",
  "kilo-code": ".kilo/skills",
};

export function lockPath(target: InstallTarget): string {
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
  const instructions = `${body}${skillNote}`.trim();
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
  const instructions = `${body}${skillNote}`.trim();
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
  const instructions = `${body}${skillNote}`.trim();
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
  const { data, body } = parseFrontmatter(source, "core/workflows/litecode.md");
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
      name: "litecode",
      description: "Run the LiteCodeAgent discussion and planning workflow for an idea, feature, bug, or documentation request. Invoke when the user types /litecode <request> or $litecode <request>.",
    }, `${workflow}\n\nWhen invoked, treat the text following /litecode or $litecode as the raw request. Delegate to the installed \`orchestrator\` Codex subagent and wait for its result; if you can't spawn it, run \`litecode run orchestrator --prompt-file <file>\` via the shell instead (ADR 0014) — never improvise the orchestrator's sequence yourself. Stop after presenting the plan. Never create an issue, update a board, or implement the work.\n`);
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
 * Missing `project.web` block despite being referenced unconditionally (no `{{#if}}` guard)
 * by an installed pack's templates — e.g. every `packs/web/**\/SKILL.md`. Unlike
 * `project.web` is a single `.optional()` object (`src/config.ts`), not a per-key record,
 * so there is no finer granularity to report: either the whole block is present (in which
 * case its own required fields are already schema-enforced) or it's entirely absent.
 */
export function missingWebConfigPaths(
  files: { rel: string; source: string; packName: string }[],
  web: unknown,
): MissingConfigPath[] {
  if (web !== undefined) return [];
  const sources = new Set<string>();
  for (const file of files) {
    for (const path of referencedPaths(file.source)) {
      if (path === "project.web" || path.startsWith("project.web.")) sources.add(`${file.packName}:${file.rel}`);
    }
  }
  if (sources.size === 0) return [];
  return [{ path: "project.web", sources: [...sources].sort() }];
}

/**
 * Pre-flight: fail before any render/write with an actionable error, instead of letting
 * the strict template renderer throw a raw `TemplateError` mid-render (see #17).
 */
function validateRequiredConfigPaths(
  config: Config,
  files: { rel: string; source: string; packName: string }[],
): void {
  const missing = missingWebConfigPaths(files, config.project.web);
  if (missing.length === 0) return;
  throw new Error(
    "litecode.config.json is missing config path(s) the installed packs require:\n" +
      missing.map((m) => `  - ${m.path} (referenced by ${m.sources.join(", ")})`).join("\n") +
      "\n\nAdd the missing `project.web` block by hand (required when the `web` pack is installed).",
  );
}

/** Returns all generated output paths for a source pack file. */
function outputFiles(
  file: PackFile,
  config: Config,
  target: InstallTarget,
  agents: ReadonlySet<string>,
  wantedSkills: ReadonlySet<string>,
): { rel: string; content: string }[] {
  const rendered = render(
    file.source,
    { project: templateProject(config.project) },
    `${file.rel}`,
    delegationHelpers(target, agents, config.tiers, target === "claude-code" ? config.outDir : undefined),
  );
  const parsed = parseFrontmatter(rendered, file.rel);
  const skillName = /^skills\/([^/]+)\/SKILL\.md$/.exec(file.rel)?.[1];
  if (skillName && skipSkill(parsed.data, skillName, wantedSkills)) return [];
  const agent = /^agents\/([^/]+)\.md$/.exec(file.rel);
  const data = skillName ? withoutInstallKey(parsed.data) : { ...parsed.data };
  // Nothing is preloaded by default (ticket 0087): an agent whose `skills` rendered empty has no such line.
  if (agent && !data.skills?.trim()) delete data.skills;
  const body = agent ? preflightRefusal(agent[1]!, config.project) + parsed.body : parsed.body;
  const skill = /^(skills\/.+)$/.exec(file.rel);
  const workflow = file.rel === "workflows/litecode.md";

  if (target === "claude-code") {
    if (agent) {
      return [{ rel: join(config.outDir, file.rel), content: renderClaudeAgent(data, body, config, file.rel) }];
    }
    if (workflow) return [{ rel: ".claude/commands/litecode.md", content: renderWorkflow(rendered, target) }];
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
      return [{ rel: ".agents/skills/litecode/SKILL.md", content: renderWorkflow(rendered, target) }];
    }
    if (target === "pi") {
      return [
        { rel: ".pi/prompts/litecode.md", content: renderWorkflow(rendered, target) },
        { rel: ".pi/extensions/litecode.ts", content: PI_EXTENSION },
      ];
    }
    return [{ rel: `${ROOTS[target]}/commands/litecode.md`, content: renderWorkflow(rendered, target) }];
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

/** Skills something asks for: Domain rules and angles, or the `skills:` line of an agent being installed. */
function referencedSkills(
  packs: { pack: { files: PackFile[] } }[],
  config: Config,
  agents: ReadonlySet<string>,
): Set<string> {
  const wanted = new Set(configSkills(config.project));
  const helpers = delegationHelpers("claude-code", agents, config.tiers, config.outDir);
  for (const { pack } of packs) {
    for (const file of pack.files) {
      if (!/^agents\/[^/]+\.md$/.test(file.rel)) continue;
      const rendered = render(file.source, { project: templateProject(config.project) }, file.rel, helpers);
      for (const skill of parseList(parseFrontmatter(rendered, file.rel).data.skills)) wanted.add(skill);
    }
  }
  return wanted;
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

  const packFiles = packs.flatMap(({ packName, pack }) => pack.files.map((file) => ({ ...file, packName })));
  validateRequiredConfigPaths(config, packFiles);

  const agents = packAgentNames(packs);
  const wantedSkills = referencedSkills(packs, config, agents);
  for (const targetName of targets) {
    for (const { packName, pack } of packs) {
      for (const file of pack.files) {
        for (const output of outputFiles(file, config, targetName, agents, wantedSkills)) {
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
  const hook = await planHook(projectRoot, packsRoot, packs);
  return { entries, orphans, packVersions, lockfilePaths, hook };
}

export async function applyPlan(
  projectRoot: string,
  plan: InstallPlan,
  litecodeVersion: string,
  opts: {
    force: boolean;
    /** `project.defaultBranch`, used only for the post-activation commit warning below. */
    defaultBranch?: string;
    /** `project.allowDefaultBranchCommits`, used only for the post-activation commit warning below. */
    allowDefaultBranchCommits?: boolean;
  },
): Promise<void> {
  const drifted = plan.entries.filter((entry) => entry.status === "drift");
  if (plan.hook?.status === "drift") drifted.push({ ...plan.hook, status: "drift", harness: "claude-code" });
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
    await writeLockfileStable(projectRoot, {
      litecodeVersion,
      installedAt: new Date().toISOString(),
      packs: plan.packVersions,
      files,
    }, plan.lockfilePaths[target]);
  }

  if (plan.hook?.status === "preexisting") {
    const guardLine = await guardBranchLine(projectRoot, plan.hook.kitVersion);
    console.log(
      `\nSkipping ${plan.hook.rel}: it already exists and wasn't installed by litecode, so it's left untouched.\n` +
        `To enable the branch guard, add this line to your existing ${plan.hook.rel}:\n\n` +
        `  ${guardLine}\n`,
    );
  } else if (plan.hook) {
    if (plan.hook.status !== "unchanged") {
      await mkdir(dirname(plan.hook.target), { recursive: true });
      await Bun.write(plan.hook.target, plan.hook.content);
      await chmod(plan.hook.target, 0o755);
    }
    await writeLockfileStable(
      projectRoot,
      {
        litecodeVersion,
        installedAt: new Date().toISOString(),
        packs: plan.packVersions,
        files: { [plan.hook.rel]: { pack: plan.hook.pack, version: plan.hook.version, hash: hash(plan.hook.content) } },
      },
      HOOK_LOCK_PATH,
    );
    const activated = await activateGitHooksPath(projectRoot, plan.hook.kitVersion);
    if (activated) {
      await warnIfCommittingSetupOnDefaultBranch(
        projectRoot,
        opts.defaultBranch ?? "main",
        opts.allowDefaultBranchCommits ?? false,
      );
    }
  }
}

/**
 * Ticket 0055: once this install run has just activated the branch guard, a human who
 * follows the quick-start straight into `git commit` on the default branch gets refused
 * with no warning from `setup`/`install` itself having told them that was coming — the
 * README explains it (PR #94), but nothing in the CLI output did. Only fires when this
 * exact run is the one that turned the guard on (see `activated` above): a guard that was
 * already active before this run, or never activated at all (pre-existing hook,
 * `core.hooksPath` already set to something else), prints nothing here — those cases are
 * unrelated to "the mise en place I'm about to commit".
 */
async function warnIfCommittingSetupOnDefaultBranch(
  projectRoot: string,
  defaultBranch: string,
  allowDefaultBranchCommits: boolean,
): Promise<void> {
  if (allowDefaultBranchCommits) return;
  const branchProc = Bun.spawn(["git", "branch", "--show-current"], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "ignore",
  });
  const currentBranch = (await new Response(branchProc.stdout).text()).trim();
  await branchProc.exited;
  if (!currentBranch || currentBranch !== defaultBranch) return;

  console.warn(
    `\nWarning: the branch guard is now active, and you're on '${defaultBranch}' (the project's default branch). ` +
      `Committing this setup here will be refused. Move it onto a branch first (e.g. \`git switch -c setup/litecode\`), ` +
      `or set project.allowDefaultBranchCommits: true in litecode.config.json, ` +
      `or set LITECODE_ALLOW_DEFAULT_BRANCH_COMMIT=1 for this one commit.\n`,
  );
}

/**
 * Writing `.githooks/pre-commit` does nothing on its own — git only runs hooks from
 * `core.hooksPath` (default `.git/hooks`, never version-controlled). Without this, the
 * rendered branch guard silently never runs for any consumer project, which is exactly
 * the gap ticket 0033 exists to close. Best-effort and non-destructive: skipped outside a
 * git repo, and it never sets `core.hooksPath` when doing so could break something
 * already there — a `core.hooksPath` set on purpose to something else, or real hooks
 * already living under `.git/hooks` (the layout used by `pre-commit`-the-framework,
 * lefthook, overcommit, a hand-written secret scanner, ...). In every case where it
 * doesn't act, it warns and prints how to wire the guard in manually instead of silently
 * doing nothing.
 */
/** Single-quotes a shell argument, escaping any embedded single quotes POSIX-style. */
function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

/**
 * The exact `bunx --yes litecodeagent@<kitVersion> guard-branch` line to hand a human for
 * their own pre-commit hook — `cd`-qualified (and shell-quoted) when `projectRoot` is a
 * subdirectory of the git repo, since the hook always runs with cwd at the repo's git
 * top-level while `guard-branch` reads `litecode.config.json` relative to its own cwd.
 * Shared by both the "preexisting hook" notice and `activateGitHooksPath`'s manual notice
 * so a fix to one doesn't leave the other suggesting a line that breaks every commit.
 */
async function guardBranchLine(projectRoot: string, kitVersion: string): Promise<string> {
  // Pinned to the litecodeagent CLI version, same reasoning as the rendered hook itself
  // (see `planHook`'s comment): an unpinned `bunx` call can resolve to a stale cached CLI
  // that doesn't know `guard-branch` and, under `set -e`, refuse every commit rather than
  // just the ones this is meant to guard.
  const base = `bunx --yes litecodeagent@${kitVersion} guard-branch`;

  const toplevel = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "ignore",
  });
  const gitRoot = (await new Response(toplevel.stdout).text()).trim();
  await toplevel.exited;
  if (!gitRoot) return base;
  // `git rev-parse --show-toplevel` resolves symlinks (e.g. macOS's /tmp -> /private/tmp),
  // so `projectRoot` must be resolved the same way before comparing, or every project
  // under a symlinked ancestor would misfire as "subdirectory of the repo".
  const resolvedProjectRoot = await realpath(projectRoot).catch(() => resolve(projectRoot));
  if (gitRoot === resolvedProjectRoot) return base;
  const relProjectDir = relative(gitRoot, resolvedProjectRoot) || ".";
  return `(cd ${shellQuote(relProjectDir)} && ${base})`;
}

/**
 * Returns `true` only when this call is the one that actually flips `core.hooksPath` to
 * `.githooks` — i.e. the guard was off before and is on now. Every other outcome (not a
 * git repo, a subdirectory project, `core.hooksPath` already `.githooks` or set to
 * something else on purpose, real hooks already under `.git/hooks`) returns `false`, so a
 * caller can tell "the guard just became active" apart from "the guard was already active
 * or never became active" without re-deriving the same warn/skip logic itself.
 */
async function activateGitHooksPath(projectRoot: string, kitVersion: string): Promise<boolean> {
  const check = Bun.spawn(["git", "rev-parse", "--is-inside-work-tree"], {
    cwd: projectRoot,
    stdout: "ignore",
    stderr: "ignore",
  });
  if ((await check.exited) !== 0) return false;

  const guardLine = await guardBranchLine(projectRoot, kitVersion);
  const manualNotice = `To enable it manually, add this line to your pre-commit hook (create it if missing):\n\n  ${guardLine}\n`;

  const toplevel = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "ignore",
  });
  const gitRoot = (await new Response(toplevel.stdout).text()).trim();
  await toplevel.exited;
  // `git rev-parse --show-toplevel` resolves symlinks (e.g. macOS's /tmp -> /private/tmp),
  // so `projectRoot` must be resolved the same way before comparing, or every project
  // under a symlinked ancestor would misfire as "subdirectory of the repo".
  const resolvedProjectRoot = await realpath(projectRoot).catch(() => resolve(projectRoot));
  if (gitRoot && gitRoot !== resolvedProjectRoot) {
    // The hook always runs with cwd at the repo's top level, not the project subdirectory,
    // and `guard-branch` looks for `litecode.config.json` in its cwd — so the suggested
    // line must `cd` into the project first (see `guardBranchLine`), or it fails (and
    // refuses every commit in the whole repo) instead of doing anything useful.
    console.warn(
      `\nWarning: ${projectRoot} is a subdirectory of the git repo at ${gitRoot}. ` +
        "core.hooksPath is repo-wide, so litecode won't change it from here.\n" + manualNotice,
    );
    return false;
  }

  const current = Bun.spawn(["git", "config", "--get", "core.hooksPath"], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "ignore",
  });
  const existing = (await new Response(current.stdout).text()).trim();
  await current.exited;
  if (existing === ".githooks") return false;
  if (existing) {
    console.warn(
      `\nWarning: core.hooksPath is already set to '${existing}'. Leaving it as-is.\n` + manualNotice,
    );
    return false;
  }

  const hooksPathOutput = Bun.spawn(["git", "rev-parse", "--git-path", "hooks"], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "ignore",
  });
  const hooksDirRel = (await new Response(hooksPathOutput.stdout).text()).trim();
  await hooksPathOutput.exited;
  if (hooksDirRel) {
    const hooksDir = resolve(projectRoot, hooksDirRel);
    let realHooks: string[] = [];
    try {
      realHooks = (await readdir(hooksDir)).filter((f) => !f.endsWith(".sample"));
    } catch {
      // No .git/hooks directory at all — nothing to protect, fall through to activation.
    }
    if (realHooks.length > 0) {
      console.warn(
        `\nWarning: ${hooksDirRel} already has hook(s) installed (${realHooks.join(", ")}) — ` +
          "leaving core.hooksPath unset so they keep running.\n" + manualNotice,
      );
      return false;
    }
  }

  console.log(`\nSetting core.hooksPath to .githooks so the branch guard runs.`);
  const setHooksPath = await Bun.spawn(["git", "config", "core.hooksPath", ".githooks"], {
    cwd: projectRoot,
    stdout: "ignore",
    stderr: "ignore",
  }).exited;
  if (setHooksPath !== 0) {
    console.warn(
      "\nWarning: could not set core.hooksPath (`git config core.hooksPath .githooks` failed), " +
        "so the branch guard is NOT active.\n" + manualNotice,
    );
    return false;
  }
  return true;
}
