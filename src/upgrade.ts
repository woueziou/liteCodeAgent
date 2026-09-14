/** Updates the kit clone in place. The CLI runs from that clone, so this is a self-update. */
export async function upgrade(kitRoot: string): Promise<string[]> {
  const log: string[] = [];

  const run = async (cmd: string[], cwd: string): Promise<string> => {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) throw new Error(`${cmd.join(" ")} failed:\n${err.trim() || out.trim()}`);
    return out.trim();
  };

  if (!(await Bun.file(`${kitRoot}/.git/HEAD`).exists())) {
    log.push("This copy is managed by Bun's package cache; there is no checkout to pull.");
    log.push("Use `bunx litecodeagent@latest <command>` when you need to force the latest release.");
    return log;
  }

  const before = await run(["git", "rev-parse", "--short", "HEAD"], kitRoot);
  const status = await run(["git", "status", "--porcelain"], kitRoot);
  if (status) {
    throw new Error(
      `${kitRoot} has uncommitted changes — refusing to pull over them:\n${status}\n\n` +
        `Commit or stash them first (if you edited a pack, that change belongs upstream).`,
    );
  }

  await run(["git", "pull", "--ff-only", "--quiet"], kitRoot);
  const after = await run(["git", "rev-parse", "--short", "HEAD"], kitRoot);

  if (before === after) {
    log.push(`already up to date (${after})`);
    return log;
  }

  await run(["bun", "install", "--silent"], kitRoot);
  log.push(`updated ${before} -> ${after}`);
  log.push(...(await run(["git", "log", "--oneline", `${before}..${after}`], kitRoot)).split("\n"));
  log.push("");
  log.push("Run `litecode install` in each project to see what changed there.");
  return log;
}
