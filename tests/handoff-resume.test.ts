import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resumeState, type ResumeProbes } from "../src/resume.ts";

const NOW = new Date("2026-10-05T12:00:00Z");

const body = (extra: string) =>
  `\`\`\`progress-journal\nstep: closing\nbranch: feat/x/0034\ncommit: abc123\n${extra}\n\`\`\`\n`;

function probes(): ResumeProbes {
  return {
    branchExists: async () => true,
    prView: async () => ({ kind: "missing" }),
    prChecks: async () => ({ kind: "none" }),
    dirtyFiles: async () => [],
    branchFiles: async () => [],
    ticketStatus: async () => "inProgress",
    forcePushed: async () => ({ kind: "no" }),
    worktreeExists: async () => true,
    commitInBranch: async () => true,
    headCommit: async () => "abc123",
    openPrForBranch: async () => null,
    closedPrForBranch: async () => null,
  };
}

test("a fresh in-flight closer marker blocks resuming and says who and when", async () => {
  const result = await resumeState(body("handoff: closer in flight\nhandoffAt: 2026-10-05T11:30:00Z"), probes(), NOW);
  if (result.kind !== "closer-in-flight") throw new Error(`expected closer-in-flight, got ${result.kind}`);
  expect(result.reason).toContain("closer");
  expect(result.reason).toContain("2026-10-05T11:30:00Z");
  expect(result.ageMinutes).toBe(30);
});

test("a stale in-flight marker (over 2 hours) is reported and resume proceeds", async () => {
  const result = await resumeState(body("handoff: closer in flight\nhandoffAt: 2026-10-05T09:00:00Z"), probes(), NOW);
  if (result.kind !== "resolved") throw new Error("expected resolved");
  expect(result.findings).toContainEqual({ severity: "warn", message: expect.stringContaining("stale closer handoff marker") });
});

test("a returned marker or none behaves as before", async () => {
  for (const b of [body("handoff: returned\nhandoffAt: 2026-10-05T11:59:00Z"), body("")]) {
    const result = await resumeState(b, probes(), NOW);
    if (result.kind !== "resolved") throw new Error("expected resolved");
    expect(result.findings).toEqual([]);
  }
});

test("litecode resume exits 1 with the reason while a closer is in flight, and proceeds once it returned", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "litecode-resume-handoff-")));
  try {
    await Bun.spawn(["git", "init", "-q", "-b", "main"], { cwd: root, stdout: "ignore", stderr: "ignore" }).exited;
    await Bun.write(join(root, "litecode.config.json"), JSON.stringify({ packs: ["core"], project: { name: "demo", repo: "o/r" } }));
    const ticketPath = join(root, "docs/tickets/0034-demo.md");
    const run = async () => {
      const proc = Bun.spawn([process.execPath, join(import.meta.dir, "..", "src", "cli.ts"), "resume", "0034", "--project", root], {
        cwd: root,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [o, e] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      return { out: (o + e).replace(/\x1b\[[0-9;]*m/g, ""), code: await proc.exited };
    };
    const ticket = (journal: string) =>
      `---\nschemaVersion: 2\nid: 0034-demo\ntitle: Demo\nlabel: chore\nstatus: inProgress\npriority: medium\nsize: small\nassignedAgent: human\n---\nBody.\n\n\`\`\`progress-journal\nstep: closing\n${journal}\n\`\`\`\n`;
    await Bun.write(ticketPath, ticket(`handoff: closer in flight\nhandoffAt: ${new Date(Date.now() - 10 * 60_000).toISOString()}`));
    const blocked = await run();
    expect(blocked.code, blocked.out).toBe(1);
    expect(blocked.out).toContain("closer in flight");
    await Bun.write(ticketPath, ticket("handoff: returned"));
    const back = await run();
    expect(back.out).not.toContain("closer in flight");
    expect(back.out).toContain("closing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
