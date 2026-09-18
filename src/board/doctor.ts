import { resolve } from "node:path";
import type { Config } from "../config.ts";
import { fetchProject, fetchItems, fetchOptionUsage } from "./query.ts";
import { buildBoardData, planBoard } from "./init.ts";
import type { BoardData } from "./spec.ts";

export type Finding = { severity: "error" | "warn"; message: string };

/**
 * Checks that the committed board.json still matches the live board, and that no item
 * has lost its Status. This is the check that would have caught the drift between a
 * hand-written option id and the real one.
 */
export async function doctor(projectRoot: string, config: Config): Promise<Finding[]> {
  const findings: Finding[] = [];
  const path = resolve(projectRoot, config.project.board.dataFile);
  const file = Bun.file(path);

  if (!(await file.exists())) {
    return [{ severity: "error", message: `${config.project.board.dataFile} does not exist — run \`litecode board init --apply\`` }];
  }
  const committed = (await file.json()) as BoardData;

  if (!config.project.board.number) {
    return [{ severity: "error", message: "config.project.board.number is unset" }];
  }
  const remote = await fetchProject(config.project.board.owner, config.project.board.number);

  const plan = planBoard(remote, config, await fetchOptionUsage(remote.id));
  for (const b of plan.blockers) {
    findings.push({ severity: "error", message: `field '${b.field}': ${b.problem} — ${b.fix}` });
  }
  for (const a of plan.actions) {
    if (a.kind === "create-field") {
      findings.push({ severity: "error", message: `field '${a.field}' is missing from the live board` });
    } else if (a.kind === "add-options" || a.kind === "remove-options") {
      // Not drift between board.json and the board — drift between the board and the spec.
      findings.push({ severity: "error", message: `field '${a.field}': ${a.detail} — run \`board init --apply\`` });
    }
  }
  if (findings.length > 0) return findings;

  const live = buildBoardData(remote, config);

  if (committed.projectId !== live.projectId) {
    findings.push({
      severity: "error",
      message: `projectId drift: board.json has ${committed.projectId}, live is ${live.projectId}`,
    });
  }
  for (const [name, liveField] of Object.entries(live.fields)) {
    const c = committed.fields[name];
    if (!c) {
      findings.push({ severity: "error", message: `board.json is missing field '${name}'` });
      continue;
    }
    if (c.id !== liveField.id) {
      findings.push({ severity: "error", message: `field '${name}' id drift: ${c.id} != ${liveField.id}` });
    }
    for (const [opt, id] of Object.entries(liveField.options ?? {})) {
      const committedId = c.options?.[opt];
      if (committedId && committedId !== id) {
        findings.push({
          severity: "error",
          message: `field '${name}' option '${opt}' id drift: board.json has ${committedId}, live is ${id}`,
        });
      }
      if (!committedId) {
        findings.push({ severity: "warn", message: `field '${name}' option '${opt}' absent from board.json` });
      }
    }
  }

  const items = await fetchItems(remote.id);
  const nulled = items.filter((i) => i.status === null);
  if (nulled.length > 0) {
    findings.push({
      severity: "error",
      message: `${nulled.length} board item(s) have no Status (issues: ${nulled.map((i) => i.issue ?? "?").join(", ")}) — this is the signature of a regenerated Status option list`,
    });
  }

  return findings;
}
