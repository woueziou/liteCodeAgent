#!/usr/bin/env bun
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, CONFIG_FILENAME } from "./config.ts";
import { buildPlan, applyPlan } from "./install.ts";
import { listPacks, loadPack } from "./packs.ts";
import { readLockfile } from "./lockfile.ts";
import { ensureAuth } from "./board/gh.ts";
import { fetchProject } from "./board/query.ts";
import { planBoard, applyBoardPlan } from "./board/init.ts";
import { doctor } from "./board/doctor.ts";
import { init, summarize } from "./init.ts";
import { isInteractive } from "./prompt.ts";
import { upgrade } from "./upgrade.ts";
import { runConfiguredAgent, type TraceEvent } from "./runner/index.ts";

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
  console.log(`${c.bold("litecode")} ${c.dim(`v${VERSION}`)}

  ${c.bold("litecode init")} [--yes]              interactive setup: detects your repo, asks, writes the config
                                     ${c.dim("--yes skips the questions and uses only what it detects")}
  ${c.bold("litecode packs")}                    list available packs
  ${c.bold("litecode install")} [--apply] [--force]
                                     render packs into the target repo's .claude/
                                     ${c.dim("(dry-run by default; --apply writes)")}
  ${c.bold("litecode status")}                   show installed packs + drift
  ${c.bold("litecode run")} <agent> --prompt <text>
                                     run a pack agent through the configured API provider
                                     ${c.dim("--prompt-file <path>; --trace shows agent/tool activity")}
  ${c.bold("litecode board init")} [--apply]     provision/resolve the GitHub Project board
  ${c.bold("litecode board doctor")}             check board.json against the live board
  ${c.bold("litecode upgrade")}                   pull the latest packs into this install

Global: --project <dir>   target repo (default: cwd)
`);
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
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

  console.log(`${c.bold("Target")}   ${root}`);
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
  const lock = await readLockfile(root);
  if (!lock) {
    console.log("No LiteCodeAgent install found in this repo.");
    return 1;
  }
  console.log(`${c.bold("litecode")} v${lock.litecodeVersion}  ${c.dim(lock.installedAt)}`);
  for (const [name, version] of Object.entries(lock.packs)) console.log(`  ${name}@${version}`);
  console.log(`  ${Object.keys(lock.files).length} managed files`);
  console.log(c.dim("\nEverything else under .claude/ is this project's own and is never touched."));
  return 0;
}

function traceLine(event: TraceEvent): string {
  if (event.type === "agent-start") return `${"  ".repeat(event.depth)}→ ${event.agent} (${event.model})`;
  if (event.type === "agent-end") return `${"  ".repeat(event.depth)}← ${event.agent} (${event.turns} turn${event.turns === 1 ? "" : "s"})`;
  if (event.type === "tool-start") return `  ${"  ".repeat(1)}${event.agent}: ${event.tool}`;
  if (event.type === "tool-end") return "";
  return `  ${event.agent}: ${event.usage.input} in / ${event.usage.output} out`;
}

async function cmdRun(root: string, argv: string[]): Promise<number> {
  const agent = argv[1];
  if (!agent) throw new Error("Usage: litecode run <agent> --prompt <text>");
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
  const result = await runConfiguredAgent({
    projectRoot: root,
    packsRoot: PACKS_ROOT,
    config,
    agent,
    prompt,
    trace,
  });
  console.log(result);
  return 0;
}

async function cmdBoard(root: string, argv: string[]): Promise<number> {
  const sub = argv[1];
  const { config } = await loadConfig(root);
  await ensureAuth();

  if (sub === "doctor") {
    const findings = await doctor(root, config);
    if (findings.length === 0) {
      console.log(c.green("Board is consistent with board.json."));
      return 0;
    }
    for (const f of findings) {
      console.log(`  ${f.severity === "error" ? c.red("error") : c.yellow("warn ")} ${f.message}`);
    }
    return findings.some((f) => f.severity === "error") ? 1 : 0;
  }

  if (sub !== "init") {
    usage();
    return 1;
  }

  const number = Number(arg(argv, "--number") ?? config.project.board.number);
  if (!number) {
    console.log(c.red("No project number: set project.board.number in config, or pass --number <n>."));
    return 1;
  }
  const owner = arg(argv, "--owner") ?? config.project.board.owner;

  const remote = await fetchProject(owner, number);
  console.log(`${c.bold("Board")}    ${remote.title} ${c.dim(remote.url)}`);
  console.log(`${c.bold("Node id")}  ${remote.id}\n`);

  const plan = planBoard(remote, config);

  for (const a of plan.actions) {
    const verb = a.kind === "write-board-json" ? c.cyan("write   ") : c.green("create  ");
    console.log(`  ${verb} ${a.field} ${c.dim(a.detail)}`);
  }
  for (const b of plan.blockers) {
    console.log(`  ${c.red("BLOCKED ")} ${b.field}: ${b.problem}`);
    console.log(`           ${c.dim(`fix: ${b.fix}`)}`);
  }

  if (plan.data) {
    console.log(`\n${c.bold("Resolved ids")}`);
    for (const [name, f] of Object.entries(plan.data.fields)) {
      console.log(`  ${name.padEnd(16)} ${f.id}`);
      for (const [opt, id] of Object.entries(f.options ?? {})) {
        console.log(`    ${c.dim(opt.padEnd(16))} ${id}`);
      }
    }
  }

  if (!argv.includes("--apply")) {
    console.log(c.dim(`\nDry run. Re-run with --apply to create missing fields/labels and write ${config.project.board.dataFile}.`));
    return plan.blockers.length > 0 ? 1 : 0;
  }
  if (plan.blockers.length > 0) {
    console.log(c.red("\nNot applying: resolve the blockers above first."));
    return 1;
  }
  for (const line of await applyBoardPlan(root, plan, config)) console.log(`  ${c.green("done")} ${line}`);
  return 0;
}

const argv = process.argv.slice(2);
const root = resolve(arg(argv, "--project") ?? process.cwd());

try {
  const code = await (async () => {
    switch (argv[0]) {
      case "init": {
        const packsArg = arg(argv, "--packs");
        const yes = argv.includes("--yes") || argv.includes("-y");
        const path = await init(root, {
          packs: packsArg ? packsArg.split(",").map((s) => s.trim()) : undefined,
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
      case "packs": return cmdPacks();
      case "install": return cmdInstall(root, argv);
      case "status": return cmdStatus(root);
      case "run": return cmdRun(root, argv);
      case "board": return cmdBoard(root, argv);
      default: usage(); return argv[0] ? 1 : 0;
    }
  })();
  process.exit(code);
} catch (err) {
  console.error(c.red(`\n${(err as Error).message}`));
  process.exit(1);
}
