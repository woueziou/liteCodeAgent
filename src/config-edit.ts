import { resolve } from "node:path";
import {
  CONFIG_FILENAME,
  ConfigSchema,
  TARGETS,
  selectedTargets,
  type Config,
  type InstallTarget,
} from "./config.ts";
import { listPacks, loadPack } from "./packs.ts";
import { heading, isInteractive, multiSelect, note } from "./prompt.ts";

export function parseTargetList(value: string): InstallTarget[] {
  const requested = value.split(",").map((part) => part.trim()).filter(Boolean);
  const invalid = requested.filter((target) => !(TARGETS as readonly string[]).includes(target));
  if (invalid.length) {
    throw new Error(`Unknown target(s): ${invalid.join(", ")}. Choose from ${TARGETS.join(", ")}.`);
  }
  const unique = [...new Set(requested)] as InstallTarget[];
  if (unique.length === 0) throw new Error("Choose at least one AI coding tool.");
  return unique;
}

export function parsePackList(value: string): string[] {
  const packs = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (packs.length === 0) throw new Error("Choose at least one pack.");
  return ensureCore(packs);
}

function ensureCore(packs: string[]): string[] {
  return packs.includes("core") ? packs : ["core", ...packs];
}

async function readConfigFile(projectRoot: string): Promise<{ config: Config; path: string }> {
  const path = resolve(projectRoot, CONFIG_FILENAME);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(
      `No ${CONFIG_FILENAME} at ${path}. Run \`bunx litecodeagent init\` in the target repo first.`,
    );
  }
  const raw = await file.text();
  if (/\bTODO\b/.test(raw)) {
    throw new Error(
      `${CONFIG_FILENAME} still has unfilled placeholders. Fill them in before changing preferences.`,
    );
  }
  const parsed = ConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`${CONFIG_FILENAME} is invalid:\n${issues}`);
  }
  return { config: parsed.data, path };
}

export async function saveConfig(path: string, config: Config): Promise<void> {
  const validated = ConfigSchema.parse(config);
  await Bun.write(path, `${JSON.stringify(validated, null, 2)}\n`);
}

export function withTargets(config: Config, targets: InstallTarget[]): Config {
  if (targets.length === 0) throw new Error("At least one target is required.");
  return { ...config, targets, target: targets[0] ?? config.target };
}

export function addTargets(config: Config, toAdd: InstallTarget[]): Config {
  return withTargets(config, [...new Set([...selectedTargets(config), ...toAdd])]);
}

export function removeTargets(config: Config, toRemove: InstallTarget[]): Config {
  const remove = new Set(toRemove);
  const next = selectedTargets(config).filter((target) => !remove.has(target));
  if (next.length === 0) {
    throw new Error("Cannot remove every target. At least one AI coding tool must remain.");
  }
  return withTargets(config, next);
}

export function withPacks(config: Config, packs: string[]): Config {
  const next = ensureCore(packs);
  if (next.length === 0) throw new Error("At least one pack is required.");
  return { ...config, packs: next };
}

export function addPacks(config: Config, toAdd: string[]): Config {
  return withPacks(config, [...new Set([...config.packs, ...toAdd])]);
}

export function removePacks(config: Config, toRemove: string[]): Config {
  const remove = new Set(toRemove);
  if (remove.has("core")) throw new Error("The core pack cannot be removed.");
  const next = config.packs.filter((pack) => !remove.has(pack));
  if (next.length === 0) throw new Error("At least one pack must remain.");
  return withPacks(config, next);
}

function getAtPath(config: Config, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = config;
  for (const part of parts) {
    if (current === null || typeof current !== "object" || !(part in current)) {
      throw new Error(`Unknown config path: ${path}`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setAtPath(config: Config, path: string, value: unknown): Config {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) throw new Error("Config path is required.");
  const root = structuredClone(config) as Record<string, unknown>;
  let current: Record<string, unknown> = root;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      throw new Error(`Cannot set ${path}: ${part} is not an object.`);
    }
    current = next as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
  return ConfigSchema.parse(root);
}

export function parseSetValue(path: string, raw: string): unknown {
  if (path === "targets") return parseTargetList(raw);
  if (path === "packs") return parsePackList(raw);
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if ((raw.startsWith("[") && raw.endsWith("]")) || (raw.startsWith("{") && raw.endsWith("}"))) {
    return JSON.parse(raw);
  }
  return raw;
}

export async function configShow(config: Config): Promise<void> {
  console.log(`targets   ${selectedTargets(config).join(", ")}`);
  console.log(`packs     ${config.packs.join(", ")}`);
  console.log(`project   ${config.project.name} (${config.project.repo})`);
  console.log(`check     ${config.project.checkCommand}`);
  if (config.project.web) console.log(`web       ${config.project.web.framework} @ ${config.project.web.appDir}`);
  if (config.runner) console.log(`runner    ${config.runner.provider}`);
  else console.log("runner    (not configured)");
}

export async function configGet(config: Config, path: string): Promise<void> {
  const value = getAtPath(config, path);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

export async function configEditInteractive(
  projectRoot: string,
  packsRoot: string,
): Promise<{ config: Config; path: string; changed: boolean }> {
  const { config, path } = await readConfigFile(projectRoot);
  if (!isInteractive()) {
    throw new Error("Interactive config edit requires a TTY. Use `config set` or `config targets` instead.");
  }

  heading("AI coding tools");
  note("Choose which harnesses receive rendered agents, skills, and workflows.");
  const targets = await multiSelect(
    "Which tools should receive LiteCodeAgent?",
    TARGETS.map((target) => ({
      label: target,
      value: target,
      selected: selectedTargets(config).includes(target),
    })),
  );
  if (targets.length === 0) throw new Error("Choose at least one AI coding tool.");

  heading("Packs");
  const allPacks = await listPacks(packsRoot);
  const packs = await multiSelect(
    "Which packs do you want?",
    await Promise.all(
      allPacks.map(async (name) => {
        const pack = await loadPack(packsRoot, name);
        return {
          label: name,
          value: name,
          hint: pack.manifest.description,
          selected: config.packs.includes(name),
        };
      }),
    ),
  );
  const nextPacks = ensureCore(packs);

  const next = withPacks(withTargets(config, targets), nextPacks);
  const changed =
    JSON.stringify(selectedTargets(config)) !== JSON.stringify(selectedTargets(next)) ||
    JSON.stringify(config.packs) !== JSON.stringify(next.packs);

  if (changed) await saveConfig(path, next);
  return { config: next, path, changed };
}

export type ConfigMutation =
  | { kind: "show" }
  | { kind: "get"; path: string }
  | { kind: "set"; path: string; value: string }
  | { kind: "targets"; action: "set" | "add" | "remove"; value: string }
  | { kind: "packs"; action: "set" | "add" | "remove"; value: string }
  | { kind: "edit" }
  | { kind: "fix-agent-skills"; fill: Record<string, string[]> };

export async function applyConfigMutation(
  projectRoot: string,
  packsRoot: string,
  mutation: ConfigMutation,
): Promise<{ config: Config; path: string; changed: boolean }> {
  if (mutation.kind === "edit") return configEditInteractive(projectRoot, packsRoot);

  const { config, path } = await readConfigFile(projectRoot);
  let next = config;
  let changed = false;

  switch (mutation.kind) {
    case "show":
      await configShow(config);
      return { config, path, changed: false };
    case "get":
      await configGet(config, mutation.path);
      return { config, path, changed: false };
    case "set": {
      const value = parseSetValue(mutation.path, mutation.value);
      next = setAtPath(config, mutation.path, value);
      changed = true;
      break;
    }
    case "targets": {
      const targets = parseTargetList(mutation.value);
      next =
        mutation.action === "set" ? withTargets(config, targets)
        : mutation.action === "add" ? addTargets(config, targets)
        : removeTargets(config, targets);
      changed = JSON.stringify(selectedTargets(config)) !== JSON.stringify(selectedTargets(next));
      break;
    }
    case "packs": {
      const packs = parsePackList(mutation.value);
      next =
        mutation.action === "set" ? withPacks(config, packs)
        : mutation.action === "add" ? addPacks(config, packs)
        : removePacks(config, packs);
      changed = JSON.stringify(config.packs) !== JSON.stringify(next.packs);
      break;
    }
    case "fix-agent-skills": {
      if (Object.keys(mutation.fill).length === 0) break;
      next = ConfigSchema.parse({
        ...config,
        project: {
          ...config.project,
          agentSkills: { ...config.project.agentSkills, ...mutation.fill },
        },
      });
      changed = true;
      break;
    }
  }

  if (changed) await saveConfig(path, next);
  return { config: next, path, changed };
}
