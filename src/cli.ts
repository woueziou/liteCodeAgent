#!/usr/bin/env bun
import { resolve, dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadConfig, CONFIG_FILENAME, TARGETS, TARGET_INFO, selectedTargets, type InstallTarget } from "./config.ts";
import { buildPlan, applyPlan } from "./install.ts";
import { listPacks, loadPack } from "./packs.ts";
import { readLockfile } from "./lockfile.ts";
import { RateLimitError } from "./gh.ts";
import { doctor as ticketDoctor } from "./tickets/doctor.ts";
import { buildDashboard } from "./dashboard/build.ts";
import { renderDashboard } from "./dashboard/render.ts";
import { parseReport, verifyReport, type Finding as ReportFinding } from "./report/verify.ts";
import { realProbes } from "./report/probes.ts";
import { doctor as configDoctor, computeAgentSkillsFix } from "./config-doctor.ts";
import { createTicket, listTickets, listTicketsDetailed, writeTicket } from "./tickets/store.ts";
import { CURRENT_SCHEMA_VERSION, migrateTicket, PRIORITIES, SIZES, unknownKeys, type Priority, type Size } from "./tickets/spec.ts";
import { findDuplicate, localDedupeCandidates } from "./tickets/dedupe.ts";
import { init, summarize } from "./init.ts";
import { applyConfigMutation } from "./config-edit.ts";
import { isInteractive, multiSelect } from "./prompt.ts";
import { upgrade } from "./upgrade.ts";
import {
  RunCancelledError,
  RunnerExecutionError,
  runConfiguredAgentDetailed,
  type RunOutcome,
  type TraceEvent,
} from "./runner/index.ts";

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKS_ROOT = join(KIT_ROOT, "packs");
const VERSION = (await Bun.file(join(KIT_ROOT, "package.json")).json()).version as string;

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

function usage(): void {
  console.log(`${c.bold("litecodeagent")} ${c.dim(`v${VERSION}`)}

  ${c.bold("bunx litecodeagent setup")} [--apply] [--yes]
                                     initialize the project if needed, then render its packs
                                     ${c.dim("--targets claude-code,codex,pi,opencode,kilo-code (defaults to all)")}
                                     ${c.dim("(dry-run by default; --apply writes)")}
  ${c.bold("bunx litecodeagent init")} [--yes] [--targets …] interactive setup: detects your repo, asks, writes the config
                                     ${c.dim("--yes skips the questions and uses only what it detects")}
  ${c.bold("bunx litecodeagent targets")}                  list the coding tools you can install into
  ${c.bold("bunx litecodeagent packs")}                    list available packs
  ${c.bold("bunx litecodeagent install")} [--apply] [--force]
                                     render packs into configured AI coding tools
                                     ${c.dim("(dry-run by default; --apply writes)")}
  ${c.bold("bunx litecodeagent status")}                   show installed packs + drift
  ${c.bold("bunx litecodeagent config")} [show|edit|get|set|targets|packs|doctor]
                                     view or change litecode.config.json from the CLI
                                     ${c.dim("targets/packs: run with no argument to pick from a list")}
                                     ${c.dim("or set|add|remove <list>  ·  --apply runs install")}
  ${c.bold("bunx litecodeagent config doctor")} [--fix]     report config paths the installed packs require but are missing
                                     ${c.dim("--fix fills in missing agentSkills keys and writes the config")}
  ${c.bold("bunx litecodeagent run")} <agent> --prompt <text>
                                     run a pack agent through the configured API provider
                                     ${c.dim("--prompt-file <path>; --trace; --usage; --json; --record <path>")}
  ${c.bold("bunx litecodeagent ticket new")} --title <t> --label <bug|feature|doc|chore> [--body <text>] [--priority ..] [--size ..] [--force]
                                     draft a ticket file; blocks if its title reads like an existing
                                     ticket's — pass --force to create anyway
  ${c.bold("bunx litecodeagent ticket list")}              list ticket files with their status, priority and size
  ${c.bold("bunx litecodeagent ticket doctor")}            check the ticket directory for malformed/misplaced/duplicate/outdated files
  ${c.bold("bunx litecodeagent ticket migrate")} [--apply] [--force] rewrite schema-v1 (GitHub-synced) tickets as local-only v2
                                     ${c.dim("refuses to drop unknown frontmatter keys unless --force")}
                                     ${c.dim("(dry-run by default; --apply writes)")}
  ${c.bold("bunx litecodeagent dashboard")} --build [--out <path>]
                                     regenerate the standalone HTML dashboard from the local ticket buffer
                                     ${c.dim("current state only (status/priority/size/label/epic) — no trend, purely explicit, no watcher")}
                                     ${c.dim("--out defaults to docs/dashboard.html")}
  ${c.bold("bunx litecodeagent verify-report")} [--file <path>] [--json]
                                     check an implementer's final report (STATUS/TICKET/BRANCH/PR/CHECK_OUTPUT)
                                     against git, gh and the ticket buffer; exits 1 on any contradiction
                                     ${c.dim("reads the report from stdin when --file is omitted")}
  ${c.bold("litecode upgrade")}                   update a legacy git-clone install

Global: --project <dir>   target repo (default: cwd)
`);
}

async function cmdSetup(root: string, argv: string[]): Promise<number> {
  const configPath = resolve(root, CONFIG_FILENAME);
  if (!(await Bun.file(configPath).exists())) {
    const packsArg = arg(argv, "--packs");
    const yes = argv.includes("--yes") || argv.includes("-y");
    const path = await init(root, {
      packs: packsArg ? packsArg.split(",").map((s) => s.trim()) : undefined,
      targets: parseTargets(arg(argv, "--targets")),
      yes,
      packsRoot: PACKS_ROOT,
    });
    console.log(`\n${c.green("Wrote")} ${path}\n`);
  }
  return cmdInstall(root, argv);
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

function parseTargets(value: string | undefined): InstallTarget[] | undefined {
  if (!value) return undefined;
  const requested = value.split(",").map((part) => part.trim()).filter(Boolean);
  const invalid = requested.filter((target) => !(TARGETS as readonly string[]).includes(target));
  if (invalid.length) throw new Error(`Unknown target(s): ${invalid.join(", ")}. Choose from ${TARGETS.join(", ")}.`);
  return [...new Set(requested)] as InstallTarget[];
}

/**
 * Reads the configured tools for display. Returns null only when the project has no
 * config at all: a config that exists but still has `TODO` placeholders makes
 * `loadConfig` throw, and reporting that as "not configured" would be a lie.
 */
async function currentTargets(root: string): Promise<InstallTarget[] | null> {
  const file = Bun.file(resolve(root, CONFIG_FILENAME));
  if (!(await file.exists())) return null;
  try {
    const { config } = await loadConfig(root);
    return selectedTargets(config);
  } catch {
    const raw = (await file.json().catch(() => null)) as { target?: string; targets?: string[] } | null;
    const listed = raw?.targets ?? (raw?.target ? [raw.target] : []);
    return listed.filter((t): t is InstallTarget => (TARGETS as readonly string[]).includes(t));
  }
}

async function cmdTargets(root: string): Promise<number> {
  const enabled = await currentTargets(root);
  console.log(`${c.bold("Coding tools LiteCodeAgent can install into")}\n`);
  for (const target of TARGETS) {
    const info = TARGET_INFO[target];
    const on = enabled?.includes(target) ?? false;
    const mark = enabled === null ? c.dim("·") : on ? c.green("\u25cf") : c.dim("\u25cb");
    const state = enabled === null ? "" : on ? c.green("  on") : c.dim("  off");
    console.log(`  ${mark} ${c.bold(info.label.padEnd(12))} ${c.dim(target.padEnd(12))}${state}`);
    console.log(`      ${info.description}`);
    console.log(`      ${c.dim(`installs into ${info.directory}`)}\n`);
  }
  if (enabled === null) {
    console.log(c.dim(`No ${CONFIG_FILENAME} here yet. Run \`litecode init\` to choose.`));
  } else {
    console.log(c.dim("Change them with `litecode config targets` (interactive)"));
    console.log(c.dim("or `litecode config targets set claude-code,pi`."));
  }
  return 0;
}

async function cmdPacks(): Promise<number> {
  for (const name of await listPacks(PACKS_ROOT)) {
    const pack = await loadPack(PACKS_ROOT, name);
    const agents = pack.files.filter((f) => f.rel.startsWith("agents/")).length;
    const skills = pack.files.filter((f) => f.rel.startsWith("skills/")).length;
    console.log(
      `${c.bold(pack.manifest.name.padEnd(10))} ${c.dim(`v${pack.manifest.version}`)}  ` +
        `${agents} agents, ${skills} skills`,
    );
    console.log(`  ${c.dim(pack.manifest.description)}`);
  }
  return 0;
}

async function cmdInstall(root: string, argv: string[]): Promise<number> {
  const { config } = await loadConfig(root);
  const plan = await buildPlan(root, PACKS_ROOT, config);
  const apply = argv.includes("--apply");

  const counts = { create: 0, update: 0, unchanged: 0, drift: 0 };
  for (const e of plan.entries) counts[e.status]++;

  console.log(`${c.bold("Project")}  ${root}`);
  console.log(`${c.bold("Tools")}    ${selectedTargets(config).join(", ")}`);
  console.log(`${c.bold("Packs")}    ${Object.entries(plan.packVersions).map(([n, v]) => `${n}@${v}`).join(", ")}`);
  console.log("");
  for (const e of plan.entries) {
    const tag =
      e.status === "create" ? c.green("create  ")
      : e.status === "update" ? c.cyan("update  ")
      : e.status === "drift" ? c.red("DRIFT   ")
      : c.dim("ok      ");
    console.log(`  ${tag} ${e.rel} ${c.dim(`(${e.pack})`)}`);
  }
  for (const orphan of plan.orphans) {
    console.log(`  ${c.yellow("orphan  ")} ${orphan} ${c.dim("(no longer produced; left on disk, remove manually)")}`);
  }

  console.log(
    `\n${counts.create} to create, ${counts.update} to update, ${counts.unchanged} unchanged` +
      (counts.drift ? c.red(`, ${counts.drift} hand-edited`) : ""),
  );

  if (!apply) {
    console.log(c.dim("\nDry run. Re-run with --apply to write these files."));
    return counts.drift > 0 ? 1 : 0;
  }
  await applyPlan(root, plan, VERSION, { force: argv.includes("--force") });
  console.log(c.green("\nInstalled."));
  return 0;
}

async function cmdStatus(root: string): Promise<number> {
  const lockPaths: [InstallTarget, string][] = [
    ["claude-code", ".claude/.litecode-lock.json"],
    ["codex", ".codex/.litecode-lock.json"],
    ["pi", ".pi/.litecode-lock.json"],
    ["opencode", ".opencode/.litecode-lock.json"],
    ["kilo-code", ".kilo/.litecode-lock.json"],
  ];
  const locks = (await Promise.all(lockPaths.map(async ([target, path]) => [target, await readLockfile(root, path)] as const)))
    .filter((entry): entry is readonly [InstallTarget, NonNullable<(typeof entry)[1]>] => entry[1] !== null);
  if (locks.length === 0) {
    console.log("No LiteCodeAgent install found in this repo.");
    return 1;
  }
  for (const [target, lock] of locks) {
    console.log(`${c.bold(target)} · litecode v${lock.litecodeVersion}  ${c.dim(lock.installedAt)}`);
    for (const [name, version] of Object.entries(lock.packs)) console.log(`  ${name}@${version}`);
    console.log(`  ${Object.keys(lock.files).length} managed files`);
  }
  console.log(c.dim("\nFiles not listed in LiteCodeAgent lockfiles remain project-owned and are never touched."));
  return 0;
}

function traceLine(event: TraceEvent): string {
  if (event.type === "agent-start") return `${"  ".repeat(event.depth)}→ ${event.agent} (${event.model})`;
  if (event.type === "agent-end") return `${"  ".repeat(event.depth)}← ${event.agent} (${event.turns} turn${event.turns === 1 ? "" : "s"})`;
  if (event.type === "tool-start") return `  ${"  ".repeat(1)}${event.agent}: ${event.tool}`;
  if (event.type === "tool-end") return "";
  if (event.type === "retry") {
    const request = event.requestId ? ` · ${event.requestId}` : "";
    return `  ${event.agent}: retry ${event.retry}/${event.maxRetries} after HTTP ${event.status} in ${event.delayMs}ms${request}`;
  }
  const cost = event.totalCostUsd === null ? "cost unknown" : `$${event.totalCostUsd.toFixed(6)}`;
  if (!event.usage) return `  ${event.agent}: usage unavailable · ${cost}`;
  return `  ${event.agent}: ${event.usage.input} in / ${event.usage.output} out · ${cost}`;
}

function usageLine(report: RunOutcome): string {
  const cost = report.usage.costUsd === null ? "cost unknown" : `$${report.usage.costUsd.toFixed(6)}`;
  return `${report.usage.requests} request${report.usage.requests === 1 ? "" : "s"} · ` +
    `${report.usage.input} input / ${report.usage.output} output tokens · ${cost}`;
}

async function cmdRun(root: string, argv: string[]): Promise<number> {
  const agent = argv[1];
  if (!agent) throw new Error("Usage: bunx litecodeagent run <agent> --prompt <text>");
  const directPrompt = arg(argv, "--prompt");
  const promptFile = arg(argv, "--prompt-file");
  if (directPrompt && promptFile) throw new Error("Pass either --prompt or --prompt-file, not both");
  let prompt = directPrompt;
  if (promptFile) prompt = await Bun.file(resolve(root, promptFile)).text();
  if (!prompt && !process.stdin.isTTY) prompt = await Bun.stdin.text();
  if (!prompt?.trim()) throw new Error("Provide a prompt with --prompt, --prompt-file, or stdin");

  const { config } = await loadConfig(root);
  const trace = argv.includes("--trace")
    ? (event: TraceEvent) => {
        const line = traceLine(event);
        if (line) console.error(c.dim(line));
      }
    : undefined;
  const controller = new AbortController();
  const cancel = (signal: string) => controller.abort(new RunCancelledError(`Run cancelled by ${signal}`));
  const onSigint = () => cancel("SIGINT");
  const onSigterm = () => cancel("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  let report: RunOutcome;
  try {
    report = await runConfiguredAgentDetailed({
      projectRoot: root,
      packsRoot: PACKS_ROOT,
      config,
      agent,
      prompt,
      trace,
      signal: controller.signal,
    });
  } catch (error) {
    if (!(error instanceof RunnerExecutionError)) throw error;
    report = error.report;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
  const recordPath = arg(argv, "--record");
  if (recordPath) {
    const destination = resolve(root, recordPath);
    await mkdir(dirname(destination), { recursive: true });
    await Bun.write(destination, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else if (report.status === "completed") console.log(report.output);
  else console.error(c.red(`\n${report.error.message}`));
  if (!argv.includes("--json") && (argv.includes("--usage") || argv.includes("--trace"))) {
    console.error(c.dim(usageLine(report)));
  }
  return report.status === "completed" ? 0 : 1;
}

/** Turns `config targets` / `config packs` with no action into a pick-from-a-list prompt. */
async function chooseInteractively(
  root: string,
  kind: "targets" | "packs",
): Promise<string | null> {
  if (!isInteractive()) {
    console.error(
      `Usage: bunx litecodeagent config ${kind} <set|add|remove> <list>\n` +
        `Run it in a terminal to pick from a list instead, or see \`litecode ${kind}\`.`,
    );
    return null;
  }

  const { config } = await loadConfig(root);
  if (kind === "targets") {
    const enabled = selectedTargets(config);
    const picked = await multiSelect(
      "Which coding tools should LiteCodeAgent install into?",
      TARGETS.map((target) => ({
        label: TARGET_INFO[target].label,
        hint: `${TARGET_INFO[target].description} \u2192 ${TARGET_INFO[target].directory}`,
        value: target as string,
        selected: enabled.includes(target),
      })),
    );
    return picked.join(",");
  }

  const available = await listPacks(PACKS_ROOT);
  const picked = await multiSelect(
    "Which packs should be installed?",
    await Promise.all(
      available.map(async (name) => {
        const pack = await loadPack(PACKS_ROOT, name);
        return {
          label: name,
          hint: pack.manifest.description,
          value: name as string,
          selected: config.packs.includes(name),
        };
      }),
    ),
  );
  return picked.join(",");
}

async function cmdConfig(root: string, argv: string[]): Promise<number> {
  const sub = argv[1];
  const apply = argv.includes("--apply");

  if (sub === "doctor") {
    const { config } = await loadConfig(root);
    const findings = await configDoctor(PACKS_ROOT, config);
    if (findings.length === 0) {
      console.log(c.green(`${CONFIG_FILENAME} has every config path the installed packs require.`));
      return 0;
    }
    for (const f of findings) console.log(`  ${c.red("error")} ${f.message}`);
    if (!argv.includes("--fix")) {
      console.log(c.dim("\nRun `bunx litecodeagent config doctor --fix` to fill in missing agentSkills keys."));
      return 1;
    }
    const fill = await computeAgentSkillsFix(PACKS_ROOT, config);
    const { path, changed } = await applyConfigMutation(root, PACKS_ROOT, { kind: "fix-agent-skills", fill });
    if (changed) console.log(`\n${c.green("Fixed")} ${path}`);
    return 0;
  }

  // An empty `config targets` used to be an error; now it opens the picker.
  if ((sub === "targets" || sub === "packs") && !argv[2]) {
    const chosen = await chooseInteractively(root, sub);
    if (chosen === null) return 1;
    if (!chosen) {
      console.log(c.dim("Nothing selected; leaving the config unchanged."));
      return 0;
    }
    argv = [argv[0] ?? "config", sub, "set", chosen, ...(apply ? ["--apply"] : [])];
  }

  const mutation = (() => {
    if (!sub || sub === "show") return { kind: "show" as const };
    if (sub === "edit") return { kind: "edit" as const };
    if (sub === "get") {
      const path = argv[2];
      if (!path) throw new Error("Usage: bunx litecodeagent config get <path>");
      return { kind: "get" as const, path };
    }
    if (sub === "set") {
      const path = argv[2];
      const value = argv[3];
      if (!path || value === undefined) throw new Error("Usage: bunx litecodeagent config set <path> <value>");
      return { kind: "set" as const, path, value };
    }
    if (sub === "targets" || sub === "packs") {
      const action = argv[2];
      const value = argv[3];
      if (!action || !value || !["set", "add", "remove"].includes(action)) {
        throw new Error(`Usage: bunx litecodeagent config ${sub} <set|add|remove> <list>`);
      }
      const verb = action as "set" | "add" | "remove";
      return sub === "targets"
        ? { kind: "targets" as const, action: verb, value }
        : { kind: "packs" as const, action: verb, value };
    }
    throw new Error(`Unknown config command: ${sub}`);
  })();

  const { config, path, changed } = await applyConfigMutation(root, PACKS_ROOT, mutation);
  if (changed) {
    console.log(`${c.green("Updated")} ${path}`);
    if (mutation.kind === "targets" || mutation.kind === "packs" || mutation.kind === "set") {
      console.log(`${c.bold("Tools")}    ${selectedTargets(config).join(", ")}`);
      console.log(`${c.bold("Packs")}    ${config.packs.join(", ")}`);
    }
  } else if (mutation.kind === "edit" && !changed) {
    console.log(c.dim("No changes."));
  }

  if (apply && changed) return cmdInstall(root, ["install", "--apply"]);
  if (apply && !changed) console.log(c.dim("Nothing to install."));
  if (changed && !apply) {
    console.log(c.dim("\nRe-run with --apply to render packs for the new settings."));
  }
  return 0;
}

async function cmdTicket(root: string, argv: string[]): Promise<number> {
  const sub = argv[1];
  const { config } = await loadConfig(root);
  const dir = config.project.tickets.dir;

  if (!config.project.tickets.enabled) {
    console.log(c.red("Ticket buffer is disabled: set project.tickets.enabled to true in config to use `litecode ticket`."));
    return 1;
  }

  if (sub === "new") {
    const title = arg(argv, "--title");
    const label = arg(argv, "--label") as "bug" | "feature" | "doc" | "chore" | undefined;
    const LABELS = ["bug", "feature", "doc", "chore"] as const;
    if (!title || !label) {
      console.log(c.red("ticket new requires --title <text> and --label <bug|feature|doc|chore>"));
      return 1;
    }
    if (!(LABELS as readonly string[]).includes(label)) {
      console.log(c.red(`--label must be one of ${LABELS.join(", ")}`));
      return 1;
    }
    const priority = arg(argv, "--priority") as Priority | undefined;
    const size = arg(argv, "--size") as Size | undefined;
    if (priority && !(PRIORITIES as readonly string[]).includes(priority)) {
      console.log(c.red(`--priority must be one of ${PRIORITIES.join(", ")}`));
      return 1;
    }
    if (size && !(SIZES as readonly string[]).includes(size)) {
      console.log(c.red(`--size must be one of ${SIZES.join(", ")}`));
      return 1;
    }
    if (!argv.includes("--force")) {
      const duplicate = findDuplicate(title, localDedupeCandidates(await listTickets(root, dir)));
      if (duplicate) {
        console.log(
          c.red(`Likely duplicate of local ticket ${duplicate.candidate.ref}: "${duplicate.candidate.title}" (${duplicate.reason}).`),
        );
        console.log(c.dim("If this is genuinely different work that just reads similarly, re-run with --force to create it anyway."));
        return 1;
      }
    }
    const body = arg(argv, "--body") ?? `${title}\n`;
    const ticket = await createTicket(root, dir, { title, label, body, priority, size });
    console.log(`${c.green("created")} ${ticket.path}`);
    return 0;
  }

  if (sub === "list") {
    const { tickets, errors } = await listTicketsDetailed(root, dir);
    for (const t of tickets) {
      console.log(`  ${t.status.padEnd(12)} ${t.id.padEnd(52)} ${c.dim(`${t.priority}/${t.size}`)}`);
    }
    for (const e of errors) {
      console.log(`  ${c.red("error ")} ${e.path}: ${e.error}`);
    }
    if (tickets.length === 0 && errors.length === 0) {
      console.log(c.dim(`No tickets in ${dir}. Create one with \`litecode ticket new\`.`));
    }
    return errors.length > 0 ? 1 : 0;
  }

  if (sub === "doctor") {
    const findings = await ticketDoctor(root, dir);
    if (findings.length === 0) {
      console.log(c.green(`${dir} is consistent — no malformed, misplaced, or duplicate ticket files.`));
      return 0;
    }
    for (const f of findings) {
      console.log(`  ${f.severity === "error" ? c.red("error") : c.yellow("warn ")} ${f.message}`);
    }
    return findings.some((f) => f.severity === "error") ? 1 : 0;
  }

  if (sub === "migrate") {
    const { tickets, errors } = await listTicketsDetailed(root, dir);
    for (const e of errors) console.log(`  ${c.red("error ")} ${e.path}: ${e.error}`);
    const legacy = tickets.filter((t) => t.schemaVersion < CURRENT_SCHEMA_VERSION);
    if (legacy.length === 0) {
      console.log(c.green(`Every ticket in ${dir} is already schema v${CURRENT_SCHEMA_VERSION}.`));
      return errors.length > 0 ? 1 : 0;
    }
    const dropped = new Map<string, string[]>();
    for (const t of legacy) {
      console.log(`  ${c.yellow("migrate")} ${t.path} ${c.dim(`(v${t.schemaVersion} → v${CURRENT_SCHEMA_VERSION})`)}`);
      const extra = unknownKeys(await Bun.file(resolve(root, t.path)).text(), t.path);
      if (extra.length > 0) {
        dropped.set(t.path, extra);
        console.log(`    ${c.red("drops")} unknown frontmatter key(s): ${extra.join(", ")}`);
      }
    }
    if (dropped.size > 0 && !argv.includes("--force")) {
      console.log(
        c.red(`\n${dropped.size} ticket(s) carry frontmatter keys v2 doesn't know; migrating would delete them.`) +
          c.dim("\nMove that information into the ticket body first, or re-run with --force to drop the keys."),
      );
      return 1;
    }
    if (!argv.includes("--apply")) {
      console.log(c.dim(`\nDry run. Re-run with --apply to rewrite ${legacy.length} ticket(s).`));
      return 0;
    }
    for (const t of legacy) await writeTicket(root, migrateTicket(t));
    console.log(c.green(`\nMigrated ${legacy.length} ticket(s).`));
    return errors.length > 0 ? 1 : 0;
  }

  usage();
  return 1;
}

/**
 * `--build` is the only trigger — deliberately no hook, watcher, or install-time
 * regeneration (see the ticket's "no server, no process" rule). Output is one
 * self-contained HTML file so it opens offline with a double-click.
 */
async function cmdDashboard(root: string, argv: string[]): Promise<number> {
  if (!argv.includes("--build")) {
    console.log(c.red("dashboard requires --build (regeneration is purely explicit, run again after any ticket mutation)"));
    return 1;
  }
  const { config } = await loadConfig(root);
  const dir = config.project.tickets.dir;
  const outArg = arg(argv, "--out");
  const outPath = resolve(root, outArg ?? "docs/dashboard.html");

  const data = await buildDashboard(root, dir);
  const html = renderDashboard(data);
  await mkdir(dirname(outPath), { recursive: true });
  await Bun.write(outPath, html);

  console.log(`${c.green("built")} ${outPath} (${data.total} ticket(s), ${data.blockedTickets.length} bloqué(s))`);
  if (data.loadErrors.length > 0) {
    console.log(c.yellow(`  ${data.loadErrors.length} fichier(s) en échec de lecture — voir \`litecode ticket doctor\`.`));
  }
  return 0;
}

/**
 * Never trusts the report on its own: every checkable claim is compared against the repo,
 * the PR and the ticket file (ticket 0017). Errors mean the report contradicts reality;
 * warnings mean a claim couldn't be checked, or something looks off but may be benign.
 */
async function cmdVerifyReport(root: string, argv: string[]): Promise<number> {
  const file = arg(argv, "--file");
  if (!file && process.stdin.isTTY) {
    console.log(c.red("verify-report needs a report: pass --file <path>, or pipe the report on stdin"));
    return 1;
  }
  const text = file ? await Bun.file(resolve(root, file)).text() : await Bun.stdin.text();
  const { config } = await loadConfig(root);

  const parsed = parseReport(text);
  const findings: ReportFinding[] =
    "error" in parsed
      ? [parsed.error]
      : await verifyReport(
          parsed.report,
          realProbes({
            root,
            repo: config.project.repo,
            ticketsDir: config.project.tickets.dir,
          }),
          { repo: config.project.repo },
        );
  const errors = findings.filter((f) => f.severity === "error").length;

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ ok: errors === 0, findings }, null, 2));
  } else if (findings.length === 0) {
    console.log(c.green("Report matches the repo, the PR and the ticket buffer."));
  } else {
    for (const f of findings) console.log(`  ${f.severity === "error" ? c.red("error") : c.yellow("warn ")} ${f.message}`);
  }
  return errors === 0 ? 0 : 1;
}

const argv = process.argv.slice(2);
const root = resolve(arg(argv, "--project") ?? process.cwd());

try {
  const code = await (async () => {
    switch (argv[0]) {
      case "--version":
      case "-v":
        console.log(VERSION);
        return 0;
      case "--help":
      case "-h":
        usage();
        return 0;
      case "setup": return cmdSetup(root, argv);
      case "init": {
        const packsArg = arg(argv, "--packs");
        const yes = argv.includes("--yes") || argv.includes("-y");
        const path = await init(root, {
          packs: packsArg ? packsArg.split(",").map((s) => s.trim()) : undefined,
          targets: parseTargets(arg(argv, "--targets")),
          yes,
          packsRoot: PACKS_ROOT,
        });
        console.log(`\n${summarize(path, !yes && isInteractive())}`);
        return 0;
      }
      case "upgrade": {
        for (const line of await upgrade(KIT_ROOT)) console.log(line ? `  ${line}` : "");
        return 0;
      }
      case "targets": return cmdTargets(root);
      case "packs": return cmdPacks();
      case "install": return cmdInstall(root, argv);
      case "status": return cmdStatus(root);
      case "config": return cmdConfig(root, argv);
      case "run": return cmdRun(root, argv);
      case "ticket": return cmdTicket(root, argv);
      case "dashboard": return cmdDashboard(root, argv);
      case "verify-report": return cmdVerifyReport(root, argv);
      default: usage(); return argv[0] ? 1 : 0;
    }
  })();
  process.exit(code);
} catch (err) {
  if (err instanceof RateLimitError) {
    console.error(c.yellow(`\n${err.message}`));
    process.exit(2);
  }
  console.error(c.red(`\n${(err as Error).message}`));
  process.exit(1);
}
