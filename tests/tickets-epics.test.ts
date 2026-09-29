import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseEpicDir, parseEpicName } from "../src/tickets/epics.ts";
import { doctor } from "../src/tickets/doctor.ts";
import { createTicket } from "../src/tickets/store.ts";

const dirs: string[] = [];
async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-epics-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

const input = (title: string, epic?: string) => ({ title, label: "feature" as const, body: "b", epic });

test("parseEpicName splits number and name", () => {
  expect(parseEpicName("07-resilience")).toEqual({ number: 7, name: "resilience" });
  expect(parseEpicName("plain")).toEqual({ number: null, name: "plain" });
});

test("chooseEpicDir: new name gets next free NN prefix", () => {
  expect(chooseEpicDir(["01-a", "07-b"], "Ma Suite")).toBe("08-ma-suite");
  expect(chooseEpicDir([], "x")).toBe("01-x");
});

test("chooseEpicDir: keeps an explicit prefix, reuses existing by unprefixed name", () => {
  expect(chooseEpicDir(["07-resilience"], "12-other")).toBe("12-other");
  expect(chooseEpicDir(["07-resilience"], "resilience")).toBe("07-resilience");
  expect(chooseEpicDir(["07-resilience"], "99-resilience")).toBe("07-resilience");
});

test("chooseEpicDir neutralizes path traversal", () => {
  expect(chooseEpicDir([], "../..")).not.toMatch(/[./]/);
  expect(chooseEpicDir([], "../evil")).toBe("01-evil");
});

test("createTicket --epic creates a new epic directory", async () => {
  const root = await tmpRoot();
  const t = await createTicket(root, "docs/tickets", input("First", "Alpha"));
  expect(t.path).toBe("docs/tickets/01-alpha/0001-first.md");
  expect(await Bun.file(join(root, t.path)).exists()).toBe(true);
});

test("createTicket --epic reuses an existing epic and numbers across epics", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/tickets/03-alpha"), { recursive: true });
  const a = await createTicket(root, "docs/tickets", input("One", "alpha"));
  const b = await createTicket(root, "docs/tickets", input("Two", "03-alpha"));
  expect(a.path).toBe("docs/tickets/03-alpha/0001-one.md");
  expect(b.path).toBe("docs/tickets/03-alpha/0002-two.md");
});

test("createTicket without epic still writes at the root", async () => {
  const root = await tmpRoot();
  const t = await createTicket(root, "docs/tickets", input("Flat"));
  expect(t.path).toBe("docs/tickets/0001-flat.md");
});

test("doctor warns (not errors) about root tickets when epics exist", async () => {
  const root = await tmpRoot();
  await createTicket(root, "docs/tickets", input("Root one"));
  expect((await doctor(root, "docs/tickets")).filter((f) => /epics exist/.test(f.message))).toHaveLength(0);
  await createTicket(root, "docs/tickets", input("Nested", "alpha"));
  const findings = (await doctor(root, "docs/tickets")).filter((f) => /epics exist/.test(f.message));
  expect(findings).toHaveLength(1);
  expect(findings[0]!.severity).toBe("warn");
  expect(findings[0]!.message).toContain("0001-root-one.md");
});
