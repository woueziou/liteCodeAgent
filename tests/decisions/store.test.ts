import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAdrsDetailed } from "../../src/decisions/store.ts";

const dirs: string[] = [];

async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-adr-store-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

function adrText(id: string, title: string, status = "proposed", date = "2026-09-27"): string {
  return `---\ngenerated_by: implementer\ntask: "0032"\n---\n\n# ${id}. ${title}\n\nStatus: ${status}\nDate: ${date}\n\n## Context\n\nSome context.\n`;
}

test("happy path: parses id/title/status/date from a well-formed ADR", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/decisions"), { recursive: true });
  await writeFile(join(root, "docs/decisions/0017-read-only-dashboard.md"), adrText("0017", "Read-only dashboard"));

  const { adrs, errors } = await listAdrsDetailed(root, "docs/decisions");
  expect(errors).toEqual([]);
  expect(adrs).toHaveLength(1);
  expect(adrs[0]).toMatchObject({
    id: "0017",
    slug: "read-only-dashboard",
    title: "Read-only dashboard",
    status: "proposed",
    date: "2026-09-27",
  });
});

test("newest ADR first", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/decisions"), { recursive: true });
  await writeFile(join(root, "docs/decisions/0001-first.md"), adrText("0001", "First"));
  await writeFile(join(root, "docs/decisions/0017-second.md"), adrText("0017", "Second"));

  const { adrs } = await listAdrsDetailed(root, "docs/decisions");
  expect(adrs.map((a) => a.id)).toEqual(["0017", "0001"]);
});

test("a malformed ADR is reported as a load error, not thrown", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/decisions"), { recursive: true });
  await writeFile(join(root, "docs/decisions/0018-broken.md"), "---\ngenerated_by: x\n---\n\nno heading here\n");
  await writeFile(join(root, "docs/decisions/0019-good.md"), adrText("0019", "Good"));

  const { adrs, errors } = await listAdrsDetailed(root, "docs/decisions");
  expect(adrs).toHaveLength(1);
  expect(adrs[0]!.id).toBe("0019");
  expect(errors).toHaveLength(1);
  expect(errors[0]!.path).toBe("docs/decisions/0018-broken.md");
});

test("a file gone by read time (ENOENT — the readdir/read race, simulated via a dangling symlink) is dropped silently", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/decisions"), { recursive: true });
  const ghostTarget = join(root, "docs/decisions/.ghost-target.md");
  await writeFile(ghostTarget, adrText("0020", "Ghost"));
  await symlink(ghostTarget, join(root, "docs/decisions/0020-ghost.md"));
  await rm(ghostTarget); // the target disappears between listing the dir and reading the entry

  const { adrs, errors } = await listAdrsDetailed(root, "docs/decisions");
  expect(adrs).toEqual([]);
  expect(errors).toEqual([]);
});

test("a symlink resolving outside the project is rejected on every read, not only the first", async () => {
  const root = await tmpRoot();
  const outside = await tmpRoot();
  await mkdir(join(root, "docs/decisions"), { recursive: true });
  await writeFile(join(outside, "secret.md"), adrText("0021", "Secret"));
  await symlink(join(outside, "secret.md"), join(root, "docs/decisions/0021-escape.md"));

  for (let i = 0; i < 3; i++) {
    const { adrs, errors } = await listAdrsDetailed(root, "docs/decisions");
    expect(adrs).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error).toContain("outside the project");
  }
});
