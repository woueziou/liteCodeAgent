import { expect, test, afterEach } from "bun:test";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { graphql, RateLimitError, onGhRetry } from "../src/board/gh.ts";

const realBin = process.env.LITECODE_GH_BIN;

/**
 * Stands in for the `gh` binary. `script` is bash, and receives a counter file so a stub
 * can behave differently on each call — which is the only way to exercise "fails, then
 * succeeds" retry behaviour.
 */
async function stubGh(script: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-gh-"));
  const counter = join(dir, "calls");
  await writeFile(counter, "0");
  const bin = join(dir, "gh");
  await writeFile(bin, `#!/usr/bin/env bash\nCOUNTER=${counter}\n${script}\n`);
  await chmod(bin, 0o755);
  process.env.LITECODE_GH_BIN = bin;
  return counter;
}

afterEach(() => {
  if (realBin) process.env.LITECODE_GH_BIN = realBin;
  else delete process.env.LITECODE_GH_BIN;
  delete process.env.LITECODE_GH_BACKOFF_MS;
  delete process.env.LITECODE_GH_RETRIES;
  onGhRetry(undefined);
});

const OK = `{"data":{"ok":true}}`;

test("a secondary rate limit is retried until it clears", async () => {
  process.env.LITECODE_GH_BACKOFF_MS = "5";
  const counter = await stubGh(`
n=$(cat "$COUNTER"); n=$((n+1)); echo "$n" > "$COUNTER"
# rate_limit probes report a healthy quota: that is what marks this as a secondary limit.
if [ "$1 $2" = "api rate_limit" ]; then
  echo '{"resources":{"graphql":{"remaining":5000,"reset":9999999999}}}'; exit 0
fi
if [ "$n" -le 4 ]; then echo "gh: API rate limit already exceeded for user ID 1" >&2; exit 1; fi
echo '${OK}'
`);

  const retries: number[] = [];
  onGhRetry((attempt) => retries.push(attempt));

  const data = await graphql<{ ok: boolean }>("query { ok }", {});
  expect(data.ok).toBe(true);
  expect(retries.length).toBeGreaterThan(0);
  expect(Number(await Bun.file(counter).text())).toBeGreaterThan(1);
});

test("an exhausted hourly quota fails immediately with the reset time", async () => {
  process.env.LITECODE_GH_BACKOFF_MS = "5";
  const reset = Math.floor(Date.now() / 1000) + 3600;
  await stubGh(`
if [ "$1 $2" = "api rate_limit" ]; then
  echo '{"resources":{"graphql":{"remaining":0,"reset":${reset}}}}'; exit 0
fi
echo "gh: API rate limit already exceeded for user ID 1" >&2; exit 1
`);

  const err = await graphql("query { ok }", {}).catch((e) => e);
  expect(err).toBeInstanceOf(RateLimitError);
  expect((err as RateLimitError).message).toContain("hourly quota is exhausted");
  expect((err as RateLimitError).resetAt?.getTime()).toBe(reset * 1000);
});

test("retries give up rather than loop forever", async () => {
  process.env.LITECODE_GH_BACKOFF_MS = "5";
  process.env.LITECODE_GH_RETRIES = "2";
  await stubGh(`
if [ "$1 $2" = "api rate_limit" ]; then
  echo '{"resources":{"graphql":{"remaining":5000,"reset":9999999999}}}'; exit 0
fi
echo "gh: You have exceeded a secondary rate limit" >&2; exit 1
`);

  const err = await graphql("query { ok }", {}).catch((e) => e);
  expect(err).toBeInstanceOf(RateLimitError);
  expect((err as RateLimitError).message).toContain("secondary rate limit");
});

test("a non-rate-limit failure is not retried, and hides the query body", async () => {
  const counter = await stubGh(`
n=$(cat "$COUNTER"); n=$((n+1)); echo "$n" > "$COUNTER"
echo "gh: Could not resolve to a User with the login of 'nope'" >&2; exit 1
`);

  const err = await graphql("query { averyLongQueryDocument }", {}).catch((e) => e);
  expect((err as Error).message).toContain("Could not resolve");
  expect((err as Error).message).not.toContain("averyLongQueryDocument");
  expect(await Bun.file(counter).text()).toBe("1\n");
});
