import { expect, test } from "bun:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detect, extractConventions } from "../src/detect.ts";
import { init } from "../src/init.ts";
import { ConfigSchema } from "../src/config.ts";
import { buildPlan } from "../src/install.ts";

const PACKS = join(import.meta.dir, "..", "packs");

/** A monorepo shaped like a real target: root manifest, a web app, an ORM package. */
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litecode-init-"));
  await Bun.write(
    join(root, "package.json"),
    JSON.stringify({ name: "demo-service", scripts: { check: "oxlint", "check-types": "tsc" } }),
  );
  await Bun.write(join(root, "bun.lock"), "");
  await Bun.write(join(root, "tsconfig.json"), "{}");
  await Bun.write(
    join(root, "apps/web/package.json"),
    JSON.stringify({ dependencies: { react: "19", "@tanstack/react-start": "1", tailwindcss: "4" } }),
  );
  await Bun.write(
    join(root, "packages/api/package.json"),
    JSON.stringify({ dependencies: { "drizzle-orm": "1", "@orpc/server": "1", "better-auth": "1" } }),
  );
  await mkdir(join(root, "docs/decisions"), { recursive: true });
  await Bun.write(join(root, ".claude/skills/orpc-expert/SKILL.md"), "---\nname: orpc-expert\n---\n");
  return root;
}

test("detects the stack across a monorepo, not just the root manifest", async () => {
  const d = await detect(await fixture());
  expect(d.packageManager).toBe("bun");
  expect(d.checkCommand).toBe("bun run check");
  expect(d.typecheckCommands).toEqual(["bun run check-types"]);
  expect(d.adrDir).toBe("docs/decisions");
  expect(d.localSkills).toEqual(["orpc-expert"]);
  expect(d.stack).toMatchObject({
    typescript: true,
    react: true,
    framework: "TanStack Start / React",
    webAppDir: "apps/web",
    styling: "Tailwind",
    orm: "Drizzle",
    api: "oRPC",
    hasAuth: true,
  });
});

test("extracts convention bullets from an existing CLAUDE.md", async () => {
  const root = await fixture();
  await Bun.write(
    join(root, "CLAUDE.md"),
    "# Demo\n\n## Conventions\n\n- Handlers stay thin and delegate to a service class per domain\n- short\n\n## Layout\n\n- This bullet is long enough but lives under the wrong heading entirely\n",
  );
  const found = await extractConventions(root, "CLAUDE.md");
  expect(found).toEqual(["Handlers stay thin and delegate to a service class per domain"]);
});

test("non-interactive init produces a config that validates and renders", async () => {
  const root = await fixture();
  await init(root, { yes: true, packsRoot: PACKS });

  const raw = await Bun.file(join(root, "litecode.config.json")).json();
  const config = ConfigSchema.parse(raw);

  expect(config.packs).toEqual(["core", "web"]);
  expect(config.project.repo).toBe("TODO-owner/TODO-repo");
  expect(config.project.angles.map((a) => a.name)).toEqual([
    "correctness", "schema", "contract", "auth", "operability",
  ]);

  // The local overlay skill is wired in automatically wherever the stack calls for it.
  expect(config.project.angles.find((a) => a.name === "contract")!.skills).toContain("orpc-expert");
  expect(config.project.agentSkills.implementer).toContain("orpc-expert");

  // Every derived skill reference resolves — that is what buildPlan enforces.
  config.project.repo = "demo/demo";
  config.project.web!.apiClient = "generated client";
  config.project.web!.typeSourceOfTruth = "the Drizzle schema";
  await expect(buildPlan(root, PACKS, config)).resolves.toBeDefined();
});

test("init refuses to clobber an existing config", async () => {
  const root = await fixture();
  await init(root, { yes: true, packsRoot: PACKS });
  await expect(init(root, { yes: true, packsRoot: PACKS })).rejects.toThrow(/already exists/);
});

test("a project with no web framework gets core only and no web block", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-init-"));
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "cli-tool", scripts: { test: "bun test" } }));
  await init(root, { yes: true, packsRoot: PACKS });

  const config = ConfigSchema.parse(await Bun.file(join(root, "litecode.config.json")).json());
  expect(config.packs).toEqual(["core"]);
  expect(config.project.web).toBeUndefined();
  expect(config.project.checkCommand).toBe("npm run test");
  expect(config.project.repo).toMatch(/^TODO/);
  // No TypeScript and no API framework detected, so `contract` is not proposed by default —
  // the interactive wizard still offers it.
  expect(config.project.angles.map((a) => a.name)).toEqual(["correctness", "operability"]);
  // `security-expert` ships in core, so its domain applies to any project.
  expect(config.project.domains.map((d) => d.skills)).toEqual([["security-expert"]]);
});
