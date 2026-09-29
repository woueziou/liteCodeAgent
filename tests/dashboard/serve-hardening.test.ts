import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDashboardServer, isWildcardBindHost, type DashboardServer } from "../../src/dashboard/serve.ts";

const dirs: string[] = [];
const servers: DashboardServer[] = [];

afterEach(async () => {
  while (servers.length) servers.pop()!.stop();
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

test("startDashboardServer prints the effective allowed hosts at startup (ticket 0058)", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-serve-hardening-"));
  dirs.push(root);
  await mkdir(join(root, "docs/tickets"), { recursive: true });
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  try {
    servers.push(await startDashboardServer(root, "docs/tickets", { port: 0, allowHosts: ["dash.example.com"] }));
  } finally {
    console.log = original;
  }
  const line = logs.find((l) => l.includes("allowed hosts"));
  expect(line).toBeDefined();
  expect(line).toContain("dash.example.com");
  expect(line).toContain("localhost");
});

test("isWildcardBindHost recognizes '0' and '::ffff:0.0.0.0' (ticket 0058)", () => {
  expect(isWildcardBindHost("0")).toBe(true);
  expect(isWildcardBindHost("::ffff:0.0.0.0")).toBe(true);
  expect(isWildcardBindHost("[::ffff:0.0.0.0]")).toBe(true);
  expect(isWildcardBindHost("0.0.0.0")).toBe(true);
  expect(isWildcardBindHost("::")).toBe(true);
  expect(isWildcardBindHost("127.0.0.1")).toBe(false);
  expect(isWildcardBindHost("::ffff:10.0.0.1")).toBe(false);
  expect(isWildcardBindHost("10")).toBe(false);
});
