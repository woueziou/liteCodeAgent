import type { Config } from "../config.ts";
import { AgentCatalog } from "./catalog.ts";
import { createProvider } from "./providers.ts";
import { AgentRuntime } from "./runtime.ts";
import type { TraceEvent } from "./types.ts";

const DEFAULT_KEY_ENV = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
} as const;

export async function runConfiguredAgent(options: {
  projectRoot: string;
  packsRoot: string;
  config: Config;
  agent: string;
  prompt: string;
  trace?: (event: TraceEvent) => void;
}): Promise<string> {
  const runner = options.config.runner;
  if (!runner) {
    throw new Error(
      "litecode.config.json has no runner block. Configure runner.provider and runner.models before using `litecode run`.",
    );
  }
  const keyEnv = runner.apiKeyEnv ?? DEFAULT_KEY_ENV[runner.provider];
  const apiKey = process.env[keyEnv];
  if (!apiKey) throw new Error(`Missing API key: set ${keyEnv} for runner provider '${runner.provider}'`);

  const config = { ...options.config, runner };
  const catalog = await AgentCatalog.load(options.projectRoot, options.packsRoot, config);
  const provider = createProvider({ provider: runner.provider, apiKey, baseUrl: runner.baseUrl });
  return new AgentRuntime({
    projectRoot: options.projectRoot,
    config,
    provider,
    catalog,
    trace: options.trace,
  }).run(options.agent, options.prompt);
}

export { AgentCatalog } from "./catalog.ts";
export { AgentRuntime } from "./runtime.ts";
export { AnthropicProvider, DeepSeekProvider, OpenAIProvider, createProvider } from "./providers.ts";
export type * from "./types.ts";
