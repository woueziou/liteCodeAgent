import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeTicket } from "../../src/tickets/store.ts";
import { startDashboardServer, buildAllowedHosts, type DashboardServer } from "../../src/dashboard/serve.ts";
import type { Ticket } from "../../src/tickets/spec.ts";

const dirs: string[] = [];
const servers: DashboardServer[] = [];

async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-serve-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (servers.length) servers.pop()!.stop();
  while (dirs.length) {
    const dir = dirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

function fixture(path: string, overrides: Partial<Ticket> = {}): Ticket {
  const id = path.split("/").pop()!.replace(/\.md$/, "");
  return {
    schemaVersion: 2,
    id,
    title: `Ticket ${id}`,
    label: "chore",
    status: "backlog",
    priority: "medium",
    size: "medium",
    assignedAgent: "human",
    dueDate: undefined,
    path,
    body: "Body.\n",
    extraFrontmatter: {},
    ...overrides,
  };
}

let nextPort = 41730;
function freshPort(): number {
  return nextPort++;
}

test("serves 200 with the rendered dashboard on the configured port/host", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/decisions"), { recursive: true });
  await writeTicket(root, fixture("docs/tickets/0001-x.md"));

  const port = freshPort();
  const server = await startDashboardServer(root, "docs/tickets", { port, host: "127.0.0.1" });
  servers.push(server);

  const res = await fetch(`http://127.0.0.1:${port}/`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("0001-x");
  expect(html).toContain("<!doctype html>");
});

test("an already-bracketed IPv6 --host isn't double-bracketed in the logged/returned URL (bug-hunter re-hunt finding on PR 74)", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/decisions"), { recursive: true });

  const server = await startDashboardServer(root, "docs/tickets", { port: 0, host: "[::1]" });
  servers.push(server);

  expect(server.url).not.toContain("[[");
  const res = await fetch(server.url);
  expect(res.status).toBe(200);
});

test("rebuilds on every request: a ticket added after startup shows up without restarting", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/decisions"), { recursive: true });
  const port = freshPort();
  const server = await startDashboardServer(root, "docs/tickets", { port });
  servers.push(server);

  let res = await fetch(`http://127.0.0.1:${port}/`);
  let html = await res.text();
  expect(html).not.toContain("0002-late");

  await writeTicket(root, fixture("docs/tickets/0002-late.md"));

  res = await fetch(`http://127.0.0.1:${port}/`);
  html = await res.text();
  expect(html).toContain("0002-late");
});

test("a partial load error (malformed ticket) still returns 200 with the error listed", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/tickets"), { recursive: true });
  await mkdir(join(root, "docs/decisions"), { recursive: true });
  await Bun.write(join(root, "docs/tickets/0001-bad.md"), "not a valid ticket\n");

  const port = freshPort();
  const server = await startDashboardServer(root, "docs/tickets", { port });
  servers.push(server);

  const res = await fetch(`http://127.0.0.1:${port}/`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("0001-bad.md");
});

test("a missing docs/ directory entirely is a fatal error: 500, no stack trace", async () => {
  const root = await tmpRoot(); // docs/ never created at all

  const port = freshPort();
  const server = await startDashboardServer(root, "docs/tickets", { port });
  servers.push(server);

  const res = await fetch(`http://127.0.0.1:${port}/`);
  expect(res.status).toBe(500);
  const html = await res.text();
  expect(html).not.toContain(".ts:");
  expect(html).not.toContain("at ");
});

test("an unexpected fatal build failure (docs/ present, but a subdir can't be traversed) is 500 with no stack trace, and logged server-side (bug-hunter finding on PR 74)", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/tickets"), { recursive: true });
  // A regular file where a directory is expected: `adrFiles`'s readdir throws ENOTDIR,
  // which is neither ENOENT (dropped silently) nor caught by `docsRootReadable` (docs/
  // itself exists) — it must be caught inside the request handler instead.
  await Bun.write(join(root, "docs/decisions"), "not a directory\n");

  const port = freshPort();
  const server = await startDashboardServer(root, "docs/tickets", { port });
  servers.push(server);

  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(500);
    const html = await res.text();
    expect(html).not.toContain(".ts:");
    expect(html).not.toContain("at ");
    expect(logged.length).toBeGreaterThan(0);
  } finally {
    console.error = originalError;
  }
});

test("binding to a port already in use fails clearly instead of hanging or crashing silently", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/decisions"), { recursive: true });
  const port = freshPort();
  const first = await startDashboardServer(root, "docs/tickets", { port });
  servers.push(first);

  await expect(startDashboardServer(root, "docs/tickets", { port })).rejects.toThrow(/already in use/);
});

test("Host header validation: a valid Host (127.0.0.1:port) is served", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/decisions"), { recursive: true });

  const port = freshPort();
  const server = await startDashboardServer(root, "docs/tickets", { port });
  servers.push(server);

  const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { host: `127.0.0.1:${port}` } });
  expect(res.status).toBe(200);
});

test("Host header validation: a foreign Host is rejected with 403, before touching the filesystem", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/decisions"), { recursive: true });

  const port = freshPort();
  const server = await startDashboardServer(root, "docs/tickets", { port });
  servers.push(server);

  const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { host: "evil.example:1234" } });
  expect(res.status).toBe(403);
});

test("Host header validation: a missing Host header is rejected (never reaches 200)", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/decisions"), { recursive: true });

  const port = freshPort();
  const server = await startDashboardServer(root, "docs/tickets", { port });
  servers.push(server);

  // fetch() always sets a Host header itself, so hit the raw socket to actually omit it.
  // HTTP/1.0 makes Host optional at the protocol level, so this reaches our handler
  // instead of being rejected upstream by Bun's own HTTP/1.1 Host requirement.
  let buf = "";
  const statusLine = await new Promise<string>(async (resolvePromise) => {
    await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        data(_sock, data) {
          buf += data.toString();
          if (buf.includes("\r\n")) resolvePromise(buf.split("\r\n")[0]!);
        },
        open(sock) {
          sock.write("GET / HTTP/1.0\r\nConnection: close\r\n\r\n");
        },
      },
    });
  });
  expect(statusLine).toContain("403");
});

test("Host header validation: an IPv6 [::1] Host on an IPv6-bound server is accepted", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/decisions"), { recursive: true });

  const server = await startDashboardServer(root, "docs/tickets", { port: 0, host: "[::1]" });
  servers.push(server);

  const res = await fetch(server.url, { headers: { host: `[::1]:${new URL(server.url).port}` } });
  expect(res.status).toBe(200);
});

test("Method validation: a non-GET/HEAD method is rejected with 405", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/decisions"), { recursive: true });

  const port = freshPort();
  const server = await startDashboardServer(root, "docs/tickets", { port });
  servers.push(server);

  const res = await fetch(`http://127.0.0.1:${port}/`, { method: "POST" });
  expect(res.status).toBe(405);
});

test("buildAllowedHosts: an explicit --host with uppercase letters is lowercased, so it matches the (lowercased) Host header comparison (bug-hunter finding on PR 85)", () => {
  const allowed = buildAllowedHosts(4173, "MyBox.Local");
  expect(allowed.has("mybox.local:4173")).toBe(true);
  expect(allowed.has("MyBox.Local:4173")).toBe(false);
});

test("filters the queue from the request's query string", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/decisions"), { recursive: true });
  await writeTicket(root, fixture("docs/tickets/0001-alpha.md", { label: "bug" }));
  await writeTicket(root, fixture("docs/tickets/0002-beta.md", { label: "feature" }));

  const port = freshPort();
  const server = await startDashboardServer(root, "docs/tickets", { port });
  servers.push(server);

  const res = await fetch(`http://127.0.0.1:${port}/?label=bug`);
  const html = await res.text();
  expect(html).toContain("0001-alpha");
  expect(html).not.toContain("id=\"ticket-0002-beta\"");
});
