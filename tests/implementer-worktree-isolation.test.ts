import { expect, test } from "bun:test";
import { join } from "node:path";
import { delegationHelpers, type RenderTarget } from "../src/delegation.ts";
import { loadPack } from "../src/packs.ts";

const PACKS = join(import.meta.dir, "..", "packs");

async function coreSource(rel: string) {
  const pack = await loadPack(PACKS, "core");
  const file = pack.files.find((f) => f.rel === rel);
  if (!file) throw new Error(`${rel} not found in core pack`);
  return file.source;
}

/**
 * Ticket 0057 / ADR 0020: only Claude Code's `Agent` tool documents a per-call worktree
 * isolation option (`isolation: "worktree"`). Every other target here starts a delegated
 * sub-agent in the caller's existing working directory, so `{{> delegateImplementerIsolation}}`
 * must say so plainly instead of inventing an equivalent capability for a target that
 * doesn't have one.
 */
const TARGETS: RenderTarget[] = ["claude-code", "opencode", "kilo-code", "codex", "pi", "runner"];

test("delegateImplementerIsolation only claims real per-call isolation for claude-code", () => {
  for (const target of TARGETS) {
    const text = delegationHelpers(target).delegateImplementerIsolation!("");
    if (target === "claude-code") {
      expect(text).toMatch(/isolation:\s*"worktree"/);
      expect(text).toMatch(/absolute path of the primary checkout/);
    } else {
      expect(text).toMatch(/no per-call worktree isolation/);
      expect(text).not.toMatch(/isolation:\s*"worktree"/);
    }
  }
});

test("delegateImplementerIsolation rejects an argument, like the other delegation helpers", () => {
  expect(() => delegationHelpers("claude-code").delegateImplementerIsolation!("x")).toThrow();
});

test("implementer.md documents using a caller-provided worktree as its ticket worktree", async () => {
  const source = await coreSource("agents/implementer.md");
  expect(source).toMatch(/invoked with your own worktree already provided/);
  expect(source).toMatch(/Do not run `git worktree add`/);
  expect(source).toMatch(/escalate to `triage`/);
});

test("implementer.md routes every ticket status/note write through the CLI, explicitly rooted, never bare Edit/Write", async () => {
  const source = await coreSource("agents/implementer.md");
  expect(source).toMatch(/ticket note --project <primary-checkout>/);
  expect(source).toMatch(/ticket move --project <primary-checkout>/);
  expect(source).toMatch(/never through `Edit`\/`Write` on a relative path/);
});

test("implementer.md never tells the agent to clean a leak in the primary checkout with git restore/checkout without first comparing byte-for-byte", async () => {
  const source = await coreSource("skills/implementer-leak-cleanup/SKILL.md");
  expect(source).toMatch(/byte for byte|byte-identical|no difference/);
  expect(source).toMatch(/do not touch or discard it/);
});

test("chained-implementation SKILL.md asks for worktree isolation when delegating to implementer", async () => {
  const source = await coreSource("skills/chained-implementation/SKILL.md");
  expect(source).toMatch(/delegateImplementerIsolation|isolation/i);
});
