import { expect, test } from "bun:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

async function sh(cwd: string, cmd: string[]): Promise<{ out: string; code: number }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [o, e] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { out: o + e, code: await proc.exited };
}
const lc = (cwd: string, ...args: string[]) => sh(cwd, ["bun", "run", CLI, ...args]);

/** A committed repo for a project whose only target is codex (auto resolves to inline). */
async function repo(target: string | string[] = "codex", extra: Record<string, unknown> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litecode-isolation-"));
  const config = { packs: ["core"], targets: Array.isArray(target) ? target : [target], project: { name: "demo", ...extra } };
  await Bun.write(join(root, "litecode.config.json"), JSON.stringify(config));
  await sh(root, ["git", "init", "-q", "-b", "main"]);
  await sh(root, ["git", "-c", "user.name=t", "-c", "user.email=t@t", "add", "."]);
  await sh(root, ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
  return root;
}

test("`isolation start` reports the resolved mode: inline for codex, worktree for claude-code, forced by --mode", async () => {
  const codex = await repo("codex");
  expect((await lc(codex, "isolation", "start", "0001")).out).toContain("inline");
  expect((await lc(codex, "isolation", "start", "0001", "--mode", "worktree")).out.trim()).toBe("worktree");
  const claude = await repo("claude-code");
  expect((await lc(claude, "isolation", "start", "0001")).out.trim()).toBe("worktree");
  expect((await lc(claude, "isolation", "start", "0001", "--mode", "inline")).out).toContain("inline");
});

test("inline is refused on a dirty working tree", async () => {
  const root = await repo();
  await Bun.write(join(root, "stray.txt"), "unrelated\n");
  const r = await lc(root, "isolation", "start", "0001");
  expect(r.code).toBe(1);
  expect(r.out).toMatch(/dirty/i);
  expect((await lc(root, "isolation", "start", "0001", "--mode", "worktree")).code).toBe(0);
});

test("inline is refused while another implementer runs, and allowed again after `isolation end`", async () => {
  const root = await repo();
  expect((await lc(root, "isolation", "start", "0001")).code).toBe(0);
  const second = await lc(root, "isolation", "start", "0002");
  expect(second.code).toBe(1);
  expect(second.out).toMatch(/already running/i);
  expect(second.out).toContain("0001");
  expect((await lc(root, "isolation", "end", "0001")).code).toBe(0);
  expect((await lc(root, "isolation", "start", "0002")).code).toBe(0);
});

test("a lock left by a dead process is ignored", async () => {
  const root = await repo();
  const gitDir = (await sh(root, ["git", "rev-parse", "--git-common-dir"])).out.trim();
  const dir = gitDir.startsWith("/") ? gitDir : join(root, gitDir);
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, "litecode-implementer.lock"), JSON.stringify({ ticket: "0009", pid: 2 ** 22 + 12345 }));
  expect((await lc(root, "isolation", "start", "0001")).code).toBe(0);
});

test("ticket writes reach the primary checkout in both modes", async () => {
  const root = await repo();
  const ticket = `---\nschemaVersion: 2\nid: 0001-a\ntitle: "a"\nlabel: bug\nstatus: planned\npriority: high\nsize: small\nassignedAgent: human\ndueDate:\nimportedFrom:\n---\n\n## Contexte\nx\n`;
  await Bun.write(join(root, "docs/tickets/0001-a.md"), ticket);
  await sh(root, ["git", "-c", "user.name=t", "-c", "user.email=t@t", "add", "."]);
  await sh(root, ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "ticket"]);
  // inline: cwd is the primary checkout
  expect((await lc(root, "ticket", "move", "--project", root, "0001", "inProgress")).code).toBe(0);
  expect(await Bun.file(join(root, "docs/tickets/0001-a.md")).text()).toContain("status: inProgress");
  // worktree: cwd is another worktree, the write still lands in the primary checkout
  const wt = join(await mkdtemp(join(tmpdir(), "litecode-wt-")), "w");
  await sh(root, ["git", "worktree", "add", "-q", "-b", "x/0001", wt]);
  expect((await lc(wt, "ticket", "move", "--project", root, "0001", "review")).code).toBe(0);
  expect(await Bun.file(join(root, "docs/tickets/0001-a.md")).text()).toContain("status: review");
  expect(await Bun.file(join(wt, "docs/tickets/0001-a.md")).text()).toContain("status: planned\n");
});

test("a live lock held by the same ticket is refused too, while a stale one is ignored", async () => {
  const root = await repo();
  expect((await lc(root, "isolation", "start", "0001")).code).toBe(0);
  const again = await lc(root, "isolation", "start", "0001");
  expect(again.code).toBe(1);
  expect(again.out).toMatch(/already running/i);
  expect((await lc(root, "isolation", "end", "0001")).code).toBe(0);
  const gitDir = (await sh(root, ["git", "rev-parse", "--git-common-dir"])).out.trim();
  const dir = gitDir.startsWith("/") ? gitDir : join(root, gitDir);
  await Bun.write(join(dir, "litecode-implementer.lock"), JSON.stringify({ ticket: "0001", pid: 2 ** 22 + 12345 }));
  expect((await lc(root, "isolation", "start", "0001")).code).toBe(0);
});

test("with several targets, --target is required; with one it is implied", async () => {
  const multi = await repo(["claude-code", "codex"]);
  const refused = await lc(multi, "isolation", "start", "0001");
  expect(refused.code).toBe(1);
  expect(refused.out).toContain("--target <name>");
  expect((await lc(multi, "isolation", "start", "0001", "--target", "claude-code")).out.trim()).toBe("worktree");
  expect((await lc(multi, "isolation", "start", "0002", "--target", "runner")).out).toContain("inline");
});

test("an unknown --target fails clearly", async () => {
  const root = await repo();
  const r = await lc(root, "isolation", "start", "0001", "--target", "emacs");
  expect(r.code).toBe(1);
  expect(r.out).toMatch(/--target must be one of/);
  expect(r.out).toContain("emacs");
});

test("inline: ticket writes from a subdirectory still reach the primary checkout through --project", async () => {
  const root = await repo();
  const ticket = `---\nschemaVersion: 2\nid: 0001-a\ntitle: "a"\nlabel: bug\nstatus: planned\npriority: high\nsize: small\nassignedAgent: human\ndueDate:\nimportedFrom:\n---\n\n## Contexte\nx\n`;
  await Bun.write(join(root, "docs/tickets/0001-a.md"), ticket);
  await Bun.write(join(root, "sub/.keep"), "");
  await sh(root, ["git", "-c", "user.name=t", "-c", "user.email=t@t", "add", "."]);
  await sh(root, ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "ticket"]);
  expect((await lc(root, "isolation", "start", "0001")).out).toContain("inline");
  expect((await lc(join(root, "sub"), "ticket", "move", "--project", root, "0001", "inProgress")).code).toBe(0);
  expect(await Bun.file(join(root, "docs/tickets/0001-a.md")).text()).toContain("status: inProgress");
  expect((await sh(join(root, "sub"), ["git", "status", "--porcelain"])).out).not.toContain("sub/docs");
});
