/**
 * Minimal TTY prompts. Dependency-free on purpose: the bootstrap installs this kit with
 * one `bun install`, and a wizard is not worth dragging a prompt library in for.
 */

const ESC = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
};

export const color = ESC;

export class NotInteractiveError extends Error {}

let buffered = "";
const decoder = new TextDecoder();
/**
 * One reader for the whole process, so input typed ahead of a later question isn't lost
 * between prompts — but created on first use, not at import: every CLI command imports
 * this module, and a reader grabbed eagerly locks stdin for commands that read it
 * themselves (`run` from a pipe, `verify-report`).
 */
const openStdin = () => Bun.stdin.stream().getReader();
let stdinReader: ReturnType<typeof openStdin> | undefined;
let stdinEnded = false;

async function readLine(): Promise<string> {
  if (!process.stdin.isTTY) throw new NotInteractiveError("stdin is not a terminal");
  for (;;) {
    const nl = buffered.indexOf("\n");
    if (nl !== -1) {
      const line = buffered.slice(0, nl);
      buffered = buffered.slice(nl + 1);
      return line.trim();
    }
    if (stdinEnded) {
      buffered += decoder.decode();
      if (buffered) {
        const line = buffered;
        buffered = "";
        return line.trim();
      }
      throw new NotInteractiveError("stdin is closed");
    }

    stdinReader ??= openStdin();
    const { value, done } = await stdinReader.read();
    if (done) stdinEnded = true;
    else buffered += decoder.decode(value, { stream: true });
  }
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Free-text answer. Enter accepts `fallback`; required fields re-ask instead of accepting "". */
export async function ask(
  question: string,
  fallback?: string,
  opts: { required?: boolean } = {},
): Promise<string> {
  for (;;) {
    process.stdout.write(
      `${ESC.bold(question)}${fallback ? ` ${ESC.dim(`[${fallback}]`)}` : ""}\n${ESC.cyan("› ")}`,
    );
    const answer = (await readLine()) || fallback || "";
    if (answer || !opts.required) return answer;
    process.stdout.write(ESC.dim("  (required)\n"));
  }
}

export async function confirm(question: string, fallback = true): Promise<boolean> {
  for (;;) {
    process.stdout.write(`${ESC.bold(question)} ${ESC.dim(fallback ? "[Y/n]" : "[y/N]")} ${ESC.cyan("› ")}`);
    const answer = (await readLine()).toLowerCase();
    if (!answer) return fallback;
    if (["y", "yes", "o", "oui"].includes(answer)) return true;
    if (["n", "no", "non"].includes(answer)) return false;
  }
}

export type Choice<T> = { label: string; value: T; hint?: string };

export async function select<T>(question: string, choices: Choice<T>[], fallbackIndex = 0): Promise<T> {
  process.stdout.write(`${ESC.bold(question)}\n`);
  choices.forEach((choice, i) => {
    process.stdout.write(
      `  ${ESC.cyan(String(i + 1))}. ${choice.label}${choice.hint ? ` ${ESC.dim(choice.hint)}` : ""}\n`,
    );
  });
  for (;;) {
    process.stdout.write(`${ESC.dim(`[${fallbackIndex + 1}]`)} ${ESC.cyan("› ")}`);
    const answer = await readLine();
    const index = answer ? Number(answer) - 1 : fallbackIndex;
    const choice = choices[index];
    if (choice) return choice.value;
  }
}

/** Comma-separated numbers, or Enter for everything pre-selected. */
export async function multiSelect<T>(
  question: string,
  choices: (Choice<T> & { selected?: boolean })[],
): Promise<T[]> {
  process.stdout.write(`${ESC.bold(question)} ${ESC.dim("(comma-separated numbers, Enter for the defaults)")}\n`);
  choices.forEach((choice, i) => {
    const mark = choice.selected ? ESC.green("●") : ESC.dim("○");
    process.stdout.write(
      `  ${mark} ${ESC.cyan(String(i + 1))}. ${choice.label}${choice.hint ? ` ${ESC.dim(choice.hint)}` : ""}\n`,
    );
  });
  for (;;) {
    process.stdout.write(`${ESC.cyan("› ")}`);
    const answer = await readLine();
    if (!answer) return choices.filter((c) => c.selected).map((c) => c.value);
    const picked = answer
      .split(",")
      .map((s) => choices[Number(s.trim()) - 1])
      .filter((c): c is Choice<T> => Boolean(c));
    if (picked.length > 0) return picked.map((c) => c.value);
  }
}

/** Repeated free-text entry, one item per line, blank line to stop. */
export async function askList(question: string, hint: string): Promise<string[]> {
  process.stdout.write(`${ESC.bold(question)}\n${ESC.dim(`  ${hint}. Blank line when done.`)}\n`);
  const items: string[] = [];
  for (;;) {
    process.stdout.write(`${ESC.cyan("› ")}`);
    const line = await readLine();
    if (!line) return items;
    items.push(line);
  }
}

export function heading(text: string): void {
  process.stdout.write(`\n${ESC.bold(text)}\n${ESC.dim("─".repeat(text.length))}\n`);
}

export function note(text: string): void {
  process.stdout.write(`${ESC.dim(text)}\n`);
}
