import { expect, test } from "bun:test";
import { resolveIsolationMode } from "../src/isolation.ts";
import { ConfigSchema } from "../src/config.ts";

const project = (extra: Record<string, unknown> = {}) =>
  ConfigSchema.parse({ packs: ["core"], project: { name: "demo", ...extra } }).project;

test("auto gives worktree on claude-code and inline on every other target", () => {
  const p = project();
  expect(resolveIsolationMode(p, "claude-code")).toBe("worktree");
  for (const t of ["opencode", "kilo-code", "codex", "pi", "runner"] as const) {
    expect(resolveIsolationMode(p, t)).toBe("inline");
  }
});

test("the capability table is overridden by config, with no new required key", () => {
  expect(project().isolation).toBe("auto");
  const p = project({ worktreeSupport: { codex: true, "claude-code": false } });
  expect(resolveIsolationMode(p, "codex")).toBe("worktree");
  expect(resolveIsolationMode(p, "claude-code")).toBe("inline");
  expect(resolveIsolationMode(p, "pi")).toBe("inline");
});

test("worktree or inline is forced per project, and per call over the project", () => {
  expect(resolveIsolationMode(project({ isolation: "inline" }), "claude-code")).toBe("inline");
  expect(resolveIsolationMode(project({ isolation: "worktree" }), "codex")).toBe("worktree");
  expect(resolveIsolationMode(project({ isolation: "inline" }), "claude-code", "worktree")).toBe("worktree");
  expect(resolveIsolationMode(project(), "claude-code", "inline")).toBe("inline");
  expect(resolveIsolationMode(project(), "codex", "auto")).toBe("inline");
});

test("ticket size takes no part in auto: the resolver has no size input", () => {
  expect(resolveIsolationMode.length).toBeLessThanOrEqual(3);
});
