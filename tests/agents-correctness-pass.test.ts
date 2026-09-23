import { expect, test } from "bun:test";
import { join } from "node:path";
import { listPacks, loadPack } from "../src/packs.ts";

const PACKS = join(import.meta.dir, "..", "packs");

/**
 * ADR 0013: the correctness pass is the `bug-hunter` pack agent, invoked by `implementer`.
 * The `code-review` skill it replaced is built into Claude Code only, and never returned
 * when invoked from inside a sub-agent — so no pack prompt may lean on it again.
 */
async function packFiles() {
  const files: { name: string; rel: string; source: string }[] = [];
  for (const name of await listPacks(PACKS)) {
    const pack = await loadPack(PACKS, name);
    for (const f of pack.files) files.push({ name, rel: f.rel, source: f.source });
  }
  return files;
}

/**
 * The one sanctioned mention: implementer's step 8 naming what `bug-hunter` replaced. It's
 * stripped verbatim before scanning, so anything else that mentions code-review — in any
 * file, including implementer and reviewer, the two that used to depend on it — fails.
 */
const HISTORICAL_MENTION = "it replaces the `code-review` sub-pass `reviewer` used to invoke";

test("no pack file depends on the Claude-only code-review skill", async () => {
  const offenders = (await packFiles())
    .filter((f) => /code[-_ ]review/i.test(f.source.replace(HISTORICAL_MENTION, "")))
    .map((f) => `${f.name}/${f.rel}`);
  expect(offenders).toEqual([]);
});

test("the sanctioned historical mention is still there verbatim", async () => {
  const implementer = (await packFiles()).find((f) => f.rel === "agents/implementer.md")!;
  expect(implementer.source).toContain(HISTORICAL_MENTION);
});

test("implementer invokes bug-hunter alongside reviewer, and gates Ready to Merge on it", async () => {
  const implementer = (await packFiles()).find((f) => f.rel === "agents/implementer.md")!;
  expect(implementer.source).toContain("subagent_type `bug-hunter`");
  expect(implementer.source).toContain("`HUNT: complete`");
});

test("reviewer no longer caps its verdict on a correctness sub-pass", async () => {
  const reviewer = (await packFiles()).find((f) => f.rel === "agents/reviewer.md")!;
  expect(reviewer.source).not.toMatch(/cap `VERDICT`/);
});
