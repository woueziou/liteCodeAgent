import { resolve, join, basename } from "node:path";
import { readdir, stat } from "node:fs/promises";

/**
 * Reads what the repo can tell us about itself, so the init wizard proposes real answers
 * instead of blank fields. Everything here is a suggestion the human can override.
 */

export type Detected = {
  name: string;
  repo?: string;
  owner?: string;
  defaultBranch: string;
  packageManager: "bun" | "pnpm" | "yarn" | "npm";
  checkCommand?: string;
  typecheckCommands: string[];
  adrDir?: string;
  /** Existing skills the project already owns under a supported harness's skill directory. */
  localSkills: string[];
  /** Rough stack signals, used to propose debate angles and expert packs. */
  stack: {
    typescript: boolean;
    react: boolean;
    framework?: string;
    webAppDir?: string;
    styling?: string;
    orm?: string;
    api?: string;
    hasAuth: boolean;
  };
  conventionsFile?: string;
};

async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

/** `Bun.file().exists()` is false for directories, so directory checks need stat. */
async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Dependencies across the whole workspace, not just the root manifest — in a monorepo the
 * ORM and API framework live in a package, so a root-only read detects almost nothing.
 */
async function workspaceDeps(root: string): Promise<Set<string>> {
  const deps = new Set<string>();
  const collect = (pkg: Record<string, unknown> | null) => {
    for (const d of Object.keys({ ...(pkg?.dependencies as object), ...(pkg?.devDependencies as object) })) {
      deps.add(d);
    }
  };
  collect(await json(join(root, "package.json")));
  for (const dir of ["apps", "packages"]) {
    if (!(await dirExists(join(root, dir)))) continue;
    for (const entry of await readdir(join(root, dir))) {
      collect(await json(join(root, dir, entry, "package.json")));
    }
  }
  return deps;
}

async function json(path: string): Promise<Record<string, unknown> | null> {
  try {
    return (await Bun.file(path).json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function sh(cmd: string[], cwd: string): Promise<string | undefined> {
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    return (await proc.exited) === 0 ? out.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Picks the script most likely to be "the command that must pass", in priority order. */
function pickCheckScript(scripts: Record<string, string>, runner: string): string | undefined {
  for (const name of ["check", "ci", "verify", "lint", "test"]) {
    if (scripts[name]) return `${runner} ${name}`;
  }
  return undefined;
}

function pickTypecheckScripts(scripts: Record<string, string>, runner: string): string[] {
  return Object.keys(scripts)
    .filter((n) => /^(check-)?types?$|typecheck|check-types/.test(n))
    .map((n) => `${runner} ${n}`);
}

async function findWorkspaceApp(root: string, deps: Set<string>): Promise<string | undefined> {
  // Monorepo convention: a web app under apps/*. Cheaper and more reliable than globbing
  // the whole tree for a framework import.
  for (const dir of ["apps", "packages"]) {
    if (!(await dirExists(join(root, dir)))) continue;
    for (const entry of await readdir(join(root, dir))) {
      const pkg = await json(join(root, dir, entry, "package.json"));
      if (!pkg) continue;
      const local = Object.keys({ ...(pkg.dependencies as object), ...(pkg.devDependencies as object) });
      if (local.some((d) => /^(react|next|@tanstack\/react-start|vue|svelte)$/.test(d))) {
        for (const d of local) deps.add(d);
        return `${dir}/${entry}`;
      }
    }
  }
  return undefined;
}

export async function detect(root: string): Promise<Detected> {
  const pkg = await json(join(root, "package.json"));
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  const deps = await workspaceDeps(root);

  const packageManager: Detected["packageManager"] = (await exists(join(root, "bun.lock")))
    || (await exists(join(root, "bun.lockb")))
    ? "bun"
    : (await exists(join(root, "pnpm-lock.yaml")))
      ? "pnpm"
      : (await exists(join(root, "yarn.lock")))
        ? "yarn"
        : "npm";
  const runner = packageManager === "npm" ? "npm run" : `${packageManager} run`;

  const remote = await sh(["git", "remote", "get-url", "origin"], root);
  const match = remote?.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  const repo = match ? `${match[1]}/${match[2]}` : undefined;

  const headRef = await sh(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root);
  const defaultBranch =
    headRef?.replace(/^origin\//, "") ?? (await sh(["git", "branch", "--show-current"], root)) ?? "main";

  const rootDeps = Object.keys({
    ...(pkg?.dependencies as object),
    ...(pkg?.devDependencies as object),
  });
  const webAppDir = rootDeps.includes("react") || rootDeps.includes("next")
    ? "."
    : await findWorkspaceApp(root, deps);

  const framework = deps.has("@tanstack/react-start")
    ? "TanStack Start / React"
    : deps.has("next")
      ? "Next.js"
      : deps.has("react")
        ? "React"
        : undefined;

  const localSkills = new Set<string>();
  const skillsDirs = [".claude/skills", ".agents/skills", ".pi/skills", ".opencode/skills", ".kilo/skills"];
  for (const relativeDir of skillsDirs) {
    const skillsDir = join(root, relativeDir);
    if (await dirExists(skillsDir)) {
      for (const entry of await readdir(skillsDir)) {
        if (await exists(join(skillsDir, entry, "SKILL.md"))) localSkills.add(entry);
      }
    }
  }

  const conventionsFile = (await exists(join(root, "CLAUDE.md")))
    ? "CLAUDE.md"
    : (await exists(join(root, "AGENTS.md")))
      ? "AGENTS.md"
      : undefined;

  return {
    name: (pkg?.name as string) ?? basename(resolve(root)),
    repo,
    owner: match?.[1],
    defaultBranch,
    packageManager,
    checkCommand: pickCheckScript(scripts, runner),
    typecheckCommands: pickTypecheckScripts(scripts, runner),
    adrDir: (await dirExists(join(root, "docs/decisions"))) ? "docs/decisions" : undefined,
    localSkills: [...localSkills],
    stack: {
      typescript: (await exists(join(root, "tsconfig.json"))) || deps.has("typescript"),
      react: deps.has("react"),
      framework,
      webAppDir,
      styling: deps.has("tailwindcss") ? "Tailwind" : undefined,
      orm: deps.has("drizzle-orm") ? "Drizzle" : deps.has("@prisma/client") ? "Prisma" : undefined,
      api: deps.has("@orpc/server") ? "oRPC" : deps.has("@trpc/server") ? "tRPC" : undefined,
      hasAuth: [...deps].some((d) => /auth|clerk|lucia|next-auth/.test(d)),
    },
    conventionsFile,
  };
}

/**
 * Pulls candidate convention bullets out of a CLAUDE.md/AGENTS.md, so a project that
 * already wrote its rules down doesn't have to retype them.
 */
export async function extractConventions(root: string, file: string): Promise<string[]> {
  const text = await Bun.file(join(root, file)).text();
  const out: string[] = [];
  let inSection = false;
  for (const line of text.split("\n")) {
    if (/^#{2,3}\s/.test(line)) {
      inSection = /convention|rule|guideline/i.test(line);
      continue;
    }
    if (!inSection) continue;
    const bullet = line.match(/^\s*[-*]\s+(.*\S)/);
    if (bullet?.[1] && bullet[1].length > 30) out.push(bullet[1].replace(/\s+/g, " "));
  }
  return out;
}
