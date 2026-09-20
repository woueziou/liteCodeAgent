import { afterEach, expect, test } from "bun:test";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/init.ts";
import { ConfigSchema } from "../src/config.ts";

const realBin = process.env.LITECODE_GH_BIN;

/** Stands in for `gh issue list`, returning a fixed JSON array of open issues. */
async function stubGhIssueList(issues: { number: number; title: string }[]): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-gh-stub-"));
  const bin = join(dir, "gh");
  await writeFile(bin, `#!/usr/bin/env bash\necho '${JSON.stringify(issues)}'\n`);
  await chmod(bin, 0o755);
  process.env.LITECODE_GH_BIN = bin;
}

/**
 * Stands in for the handful of `gh` subcommands a `ticket sync` run makes: `auth status`
 * (always ok), `api graphql` (the whole-board fetch, returns one fixed item with a Status
 * that maps to a known role and nothing else set — enough for hydration, per
 * `planTicketHydration`'s Priority/Size medium fallback), and anything else fails loudly
 * so an unexpected mutating call (e.g. a stray `item-edit`) is caught rather than silently
 * stubbed away.
 */
async function stubGhForHydration(issue: number, title: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-gh-stub-"));
  const bin = join(dir, "gh");
  const graphqlBody = JSON.stringify({
    data: {
      node: {
        items: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: `ITEM_${issue}`,
              content: {
                number: issue,
                state: "OPEN",
                title,
                body: "Body from the board.",
                labels: { nodes: [{ name: "feature" }] },
              },
              fieldValues: { nodes: [{ name: "Planned", field: { name: "Status" } }] },
            },
          ],
        },
      },
    },
  });
  await writeFile(
    bin,
    `#!/usr/bin/env bash
if [ "$1" = "auth" ]; then exit 0; fi
if [ "$1 $2" = "api graphql" ]; then echo ${JSON.stringify(graphqlBody)}; exit 0; fi
echo "unexpected gh call: $*" >&2; exit 1
`,
  );
  await chmod(bin, 0o755);
  process.env.LITECODE_GH_BIN = bin;
}

/**
 * Like `stubGhForHydration`, but the board fetch comes back with zero items — simulating a
 * ticket's board item being gone (or this run's fetch racing ahead of it) — and also
 * handles `issue edit`/`issue comment`, for a dirty *existing* ticket's push rather than a
 * hydration scenario.
 */
async function stubGhEmptyBoard(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-gh-stub-"));
  const bin = join(dir, "gh");
  const graphqlBody = JSON.stringify({
    data: { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } },
  });
  await writeFile(
    bin,
    `#!/usr/bin/env bash
if [ "$1" = "auth" ]; then exit 0; fi
if [ "$1 $2" = "api graphql" ]; then echo ${JSON.stringify(graphqlBody)}; exit 0; fi
if [ "$1 $2" = "issue edit" ]; then exit 0; fi
if [ "$1 $2" = "issue comment" ]; then exit 0; fi
echo "unexpected gh call: $*" >&2; exit 1
`,
  );
  await chmod(bin, 0o755);
  process.env.LITECODE_GH_BIN = bin;
}

afterEach(() => {
  if (realBin) process.env.LITECODE_GH_BIN = realBin;
  else delete process.env.LITECODE_GH_BIN;
});

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const PACKS = join(import.meta.dir, "..", "packs");

function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

async function runCli(cwd: string, args: string[]): Promise<string> {
  const { output } = await runCliWithExit(cwd, args);
  return output;
}

async function runCliWithExit(cwd: string, args: string[]): Promise<{ output: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], { cwd, env: process.env, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { output: plain(out + err), exitCode };
}

async function project(opts?: { boardNumber?: number }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litecode-ticket-cli-"));
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "bun test" } }));
  const path = await init(root, { yes: true, packsRoot: PACKS, targets: ["claude-code"] });
  const raw = ConfigSchema.parse(await Bun.file(path).json());
  raw.project.repo = "demo/demo";
  raw.project.checkCommand = "bun test";
  raw.project.board.owner = "demo";
  if (opts?.boardNumber !== undefined) raw.project.board.number = opts.boardNumber;
  await Bun.write(path, `${JSON.stringify(raw, null, 2)}\n`);
  return root;
}

test("`ticket new` drafts a file locally, dirty by default, once the duplicate check clears", async () => {
  await stubGhIssueList([]);
  const root = await project();
  const output = await runCli(root, ["ticket", "new", "--title", "Fix the flaky thing", "--label", "bug"]);
  expect(output).toContain("created");
  expect(output).toContain("docs/tickets");

  const list = await runCli(root, ["ticket", "list"]);
  expect(list).toContain("dirty");
  expect(list).toContain("(no issue yet)");
});

test("`ticket new` blocks a title that overlaps an open issue (the #18/#19 -> #21/#22 incident)", async () => {
  await stubGhIssueList([{ number: 18, title: "fix(install): pre-flight validate agentSkills config paths" }]);
  const root = await project();
  const output = await runCli(root, [
    "ticket", "new",
    "--title", "pre-flight validate agentSkills config paths before install",
    "--label", "bug",
  ]);
  expect(output).toMatch(/duplicate/i);
  expect(output).toContain("#18");

  const list = await runCli(root, ["ticket", "list"]);
  expect(list).not.toContain("pre-flight-validate");
});

test("`ticket new --force` creates the ticket despite an overlapping open issue", async () => {
  await stubGhIssueList([{ number: 18, title: "fix(install): pre-flight validate agentSkills config paths" }]);
  const root = await project();
  const output = await runCli(root, [
    "ticket", "new",
    "--title", "pre-flight validate agentSkills config paths before install",
    "--label", "bug",
    "--force",
  ]);
  expect(output).toContain("created");
});

test("`ticket new` blocks a title that overlaps an existing local ticket, naming its id", async () => {
  await stubGhIssueList([]);
  const root = await project();
  await runCli(root, ["ticket", "new", "--title", "Improve error logging for the traveller agent", "--label", "bug"]);

  const output = await runCli(root, [
    "ticket", "new",
    "--title", "Improve error logging for the traveller agent",
    "--label", "bug",
  ]);
  expect(output).toMatch(/duplicate/i);
  expect(output).toContain("0001-improve-error-logging-for-the-traveller-agent");
});

test("`ticket new` rejects an unknown label or priority", async () => {
  const root = await project();
  const bad = await runCli(root, ["ticket", "new", "--title", "x", "--label", "nonsense"]);
  expect(bad).toMatch(/label/i);

  const badPriority = await runCli(root, [
    "ticket", "new", "--title", "x", "--label", "bug", "--priority", "urgent",
  ]);
  expect(badPriority).toMatch(/priority/i);
});

test("`ticket list` reports a malformed file as an error without losing the others", async () => {
  const root = await project();
  await runCli(root, ["ticket", "new", "--title", "Good ticket", "--label", "feature"]);
  await Bun.write(join(root, "docs/tickets", "0002-broken.md"), "not frontmatter at all");

  const list = await runCli(root, ["ticket", "list"]);
  expect(list).toContain("0001-good-ticket");
  expect(list).toContain("error");
  expect(list).toContain("0002-broken.md");
});

test("`ticket sync --auto` no-ops without touching `gh` when the last attempt is inside the cooldown", async () => {
  const root = await project();
  await runCli(root, ["ticket", "new", "--title", "Anything", "--label", "feature"]);

  await Bun.write(
    join(root, ".claude/data/ticket-sync-auto-state.json"),
    JSON.stringify({ lastAttemptAt: new Date().toISOString(), blockers: {} }, null, 2) + "\n",
  );

  // No `gh` stub installed at all: if the cooldown didn't short-circuit before `ensureAuth`,
  // this would fail trying to invoke a real `gh` binary instead of just no-op'ing.
  const output = await runCli(root, ["ticket", "sync", "--auto"]);
  expect(output).toMatch(/skipping auto-sync/i);
});

test("`ticket sync --auto` runs (and records the attempt) once the cooldown has passed", async () => {
  const root = await project();

  await Bun.write(
    join(root, ".claude/data/ticket-sync-auto-state.json"),
    JSON.stringify({ lastAttemptAt: new Date(0).toISOString(), blockers: {} }, null, 2) + "\n",
  );
  await stubGhIssueList([]);

  const output = await runCli(root, ["ticket", "sync", "--auto"]);
  expect(output).not.toMatch(/skipping auto-sync/i);

  const state = await Bun.file(join(root, ".claude/data/ticket-sync-auto-state.json")).json();
  expect(Date.now() - Date.parse(state.lastAttemptAt)).toBeLessThan(60_000);
});

test("`ticket sync` no-ops gracefully on a fresh repo with no tickets and no board.json yet (regression: hydration must not require board setup just to say 'nothing to do')", async () => {
  const root = await project();
  // No `ticket new` ever ran, and `board init --apply` never ran either — genuinely fresh.
  await stubGhIssueList([]);

  const output = await runCli(root, ["ticket", "sync"]);
  expect(output).toMatch(/no tickets/i);
  expect(output).not.toMatch(/does not exist|Error/i);
});

async function writeBoardData(root: string, dataFile: string): Promise<void> {
  await Bun.write(
    join(root, dataFile),
    JSON.stringify(
      {
        $generatedBy: "test",
        owner: "demo",
        number: 1,
        url: "https://github.com/orgs/demo/projects/1",
        projectId: "PVT_1",
        repo: "demo/demo",
        fields: {
          Status: { id: "FIELD_STATUS", kind: "single-select", options: { Backlog: "OPT_BACKLOG", Planned: "OPT_PLANNED" } },
          Priority: { id: "FIELD_PRIORITY", kind: "single-select", options: { Low: "OPT_LOW", Medium: "OPT_MEDIUM", High: "OPT_HIGH" } },
          Size: { id: "FIELD_SIZE", kind: "single-select", options: { Trivial: "OPT_T", Small: "OPT_S", Medium: "OPT_M", Large: "OPT_L" } },
          "Assigned Agent": { id: "FIELD_AGENT", kind: "text" },
          "Due Date": { id: "FIELD_DUE", kind: "date" },
        },
        statusRoles: {
          backlog: { label: "Backlog", optionId: "OPT_BACKLOG" },
          planned: { label: "Planned", optionId: "OPT_PLANNED" },
          inProgress: { label: "In Progress", optionId: "OPT_IN_PROGRESS" },
          blocked: { label: "Blocked", optionId: "OPT_BLOCKED" },
          review: { label: "Review", optionId: "OPT_REVIEW" },
          readyToMerge: { label: "Ready to Merge", optionId: "OPT_RTM" },
          done: { label: "Done", optionId: "OPT_DONE" },
        },
      },
      null,
      2,
    ) + "\n",
  );
}

test("`ticket sync --auto` actually applies hydration, not just a dry-run log line (regression: --auto must imply --apply for hydration too)", async () => {
  const root = await project();
  await writeBoardData(root, ".claude/data/board.json");
  await Bun.write(
    join(root, ".claude/data/ticket-sync-auto-state.json"),
    JSON.stringify({ lastAttemptAt: new Date(0).toISOString(), blockers: {} }, null, 2) + "\n",
  );
  await stubGhForHydration(18, "Board-only ticket, no local file yet");

  const output = await runCli(root, ["ticket", "sync", "--auto"]);
  expect(output).toMatch(/hydrate/i);

  // The regression: this used to log "hydrate" but never call `applyTicketHydration`
  // because the gate only checked `--apply`, not `auto` — so nothing ever landed on disk
  // and the ticket stayed invisible to `dispatcher`'s local-first ranking forever.
  const list = await runCli(root, ["ticket", "list"]);
  expect(list).toContain("#18");
});

test("`ticket sync --apply` exits non-zero when a ticket's Status push is left unresolved (regression: exit code must reflect a 'blocked' outcome, not just plan-level blockers)", async () => {
  const root = await project({ boardNumber: 1 });
  await writeBoardData(root, ".claude/data/board.json");

  // A ticket already tied to an issue, explicitly dirtied the way `implementer` would
  // (Status moved, synced: false) — but the board fetch below returns zero items, so
  // `remote` has nothing to diff its Status against.
  await stubGhIssueList([]);
  await runCli(root, ["ticket", "new", "--title", "In-flight ticket", "--label", "feature"]);
  const before = await Bun.file(join(root, "docs/tickets/0001-in-flight-ticket.md")).text();
  await Bun.write(
    join(root, "docs/tickets/0001-in-flight-ticket.md"),
    before.replace("issue: \n", "issue: 99\n").replace("status: backlog\n", "status: inProgress\n"),
  );

  await stubGhEmptyBoard();
  const { output, exitCode } = await runCliWithExit(root, ["ticket", "sync", "--apply"]);
  expect(output).toContain("[blocked]");
  expect(exitCode).not.toBe(0);

  // The regression: this used to compute `nothingHappened` from `results.length` alone,
  // which is unaffected by a per-result "blocked" outcome — a sync leaving a Status push
  // unresolved silently reported exit 0, indistinguishable from a fully clean run.
});
