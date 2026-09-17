import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TARGETS, TARGET_INFO } from "../src/config.ts";
import { init } from "../src/init.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const PACKS = join(import.meta.dir, "..", "packs");

function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

async function runCli(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  return plain(out + err);
}

test("every install target is described for humans, not just named", () => {
  for (const target of TARGETS) {
    const info = TARGET_INFO[target];
    expect(info.label.length).toBeGreaterThan(0);
    expect(info.description.length).toBeGreaterThan(0);
    // The directory is what tells a reader where the files will actually land.
    expect(info.directory).toContain(".");
  }
});

test("`targets` lists every tool and says nothing is configured yet", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-targets-"));
  const output = await runCli(root, ["targets"]);

  for (const target of TARGETS) {
    expect(output).toContain(TARGET_INFO[target].label);
    expect(output).toContain(TARGET_INFO[target].description);
    expect(output).toContain(target);
  }
  expect(output).toContain("litecode init");
});

test("`targets` marks the configured tools on and the rest off", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-targets-on-"));
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "demo" }));
  await init(root, { yes: true, packsRoot: PACKS, targets: ["claude-code", "pi"] });

  const output = await runCli(root, ["targets"]);
  const line = (target: string) => output.split("\n").find((l) => l.includes(` ${target} `)) ?? "";

  expect(line("claude-code")).toContain("on");
  expect(line("pi")).toContain("on");
  expect(line("codex")).toContain("off");
  expect(line("opencode")).toContain("off");
});

// init --yes leaves TODO placeholders, which makes loadConfig throw. Reporting that as
// "no config here" would tell the user to re-run init on a repo that is already set up.
test("`targets` still reports state when the config has unresolved placeholders", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-targets-todo-"));
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "demo" }));
  await init(root, { yes: true, packsRoot: PACKS, targets: ["pi"] });

  const output = await runCli(root, ["targets"]);
  expect(output).not.toContain("No litecode.config.json here yet");
  expect(output).toContain("config targets");
});

test("`config targets` without an argument explains itself when there is no terminal", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-targets-pipe-"));
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "demo" }));
  await init(root, { yes: true, packsRoot: PACKS, targets: ["claude-code"] });

  const output = await runCli(root, ["config", "targets"]);
  expect(output).toContain("pick from a list");
  expect(output).toContain("set|add|remove");
});
