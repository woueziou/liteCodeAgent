import type { Config } from "../config.ts";
import type { AgentCatalog } from "./catalog.ts";
import { ProviderError } from "./providers.ts";
import { agentToolDefinition, LocalTools } from "./tools.ts";
import type {
  AssistantMessage,
  Provider,
  RunReport,
  RunFailureReport,
  RunReportBase,
  RunUsage,
  RunnerMessage,
  TokenUsage,
  ToolCall,
  ToolMessage,
  ToolResult,
  TraceEvent,
} from "./types.ts";

export type RuntimeOptions = {
  projectRoot: string;
  config: Config & { runner: NonNullable<Config["runner"]> };
  provider: Provider;
  catalog: AgentCatalog;
  trace?: (event: TraceEvent) => void;
  signal?: AbortSignal;
};

type MutableUsage = {
  agent: string;
  model: string;
  requests: number;
  input: number;
  output: number;
  total: number;
  costUsd: number | null;
};

type Session = {
  agentCalls: number;
  requests: number;
  input: number;
  output: number;
  total: number;
  costUsd: number | null;
  usage: Map<string, MutableUsage>;
  retries: number;
  requestIds: string[];
};

export class CostBudgetExceededError extends Error {
  override name = "CostBudgetExceededError";
}

export class RunTimeoutError extends Error {
  override name = "RunTimeoutError";
}

export class RunCancelledError extends Error {
  override name = "RunCancelledError";
}

export class RunnerExecutionError extends Error {
  override name = "RunnerExecutionError";

  constructor(readonly report: RunFailureReport, cause: Error) {
    super(cause.message, { cause });
  }
}

function inputRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Agent input must be an object");
  }
  return input as Record<string, unknown>;
}

export class AgentRuntime {
  private readonly tools: LocalTools;

  constructor(private readonly options: RuntimeOptions) {
    this.tools = new LocalTools(
      options.projectRoot,
      options.config.project.worktreeRoot,
      options.catalog,
      options.config.runner.toolOutputLimit,
      options.config.runner.bashTimeoutMs,
    );
  }

  run(agent: string, prompt: string): Promise<string> {
    return this.runDetailed(agent, prompt).then((report) => report.output);
  }

  async runDetailed(agent: string, prompt: string): Promise<RunReport> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const session: Session = {
      agentCalls: 0,
      requests: 0,
      input: 0,
      output: 0,
      total: 0,
      costUsd: 0,
      usage: new Map(),
      retries: 0,
      requestIds: [],
    };
    const controller = new AbortController();
    const timeout = new RunTimeoutError(`Run timed out after ${this.options.config.runner.runTimeoutMs}ms`);
    const timer = setTimeout(() => controller.abort(timeout), this.options.config.runner.runTimeoutMs);
    const cancel = () => {
      const reason = this.options.signal?.reason;
      controller.abort(reason instanceof Error ? reason : new RunCancelledError("Run cancelled"));
    };
    if (this.options.signal?.aborted) cancel();
    else this.options.signal?.addEventListener("abort", cancel, { once: true });

    try {
      const output = await this.runAgent(agent, prompt, 0, session, controller.signal);
      return {
        ...this.reportBase(agent, startedAt, started, session),
        status: "completed",
        output,
        error: null,
      };
    } catch (error) {
      const thrown = error instanceof Error ? error : new Error(String(error));
      const cause = controller.signal.aborted && controller.signal.reason instanceof Error
        ? controller.signal.reason
        : thrown;
      if (cause instanceof ProviderError && cause.requestId) session.requestIds.push(cause.requestId);
      const report: RunFailureReport = {
        ...this.reportBase(agent, startedAt, started, session),
        status: cause instanceof RunTimeoutError
          ? "timed_out"
          : cause instanceof RunCancelledError || controller.signal.aborted
            ? "cancelled"
            : "failed",
        output: null,
        error: {
          name: cause.name,
          message: cause.message,
          ...(cause instanceof ProviderError
            ? {
                code: cause.code,
                ...(cause.status === undefined ? {} : { statusCode: cause.status }),
                ...(cause.requestId === undefined ? {} : { requestId: cause.requestId }),
                attempts: cause.attempts,
              }
            : {}),
        },
      };
      throw new RunnerExecutionError(report, cause);
    } finally {
      clearTimeout(timer);
      this.options.signal?.removeEventListener("abort", cancel);
    }
  }

  private emit(event: TraceEvent): void {
    this.options.trace?.(event);
  }

  private reportBase(agent: string, startedAt: string, started: number, session: Session): RunReportBase {
    return {
      provider: this.options.provider.name,
      agent,
      agentCalls: session.agentCalls,
      startedAt,
      durationMs: Date.now() - started,
      retries: session.retries,
      requestIds: [...session.requestIds],
      usage: this.usageReport(session),
    };
  }

  private usageReport(session: Session): RunUsage {
    return {
      requests: session.requests,
      input: session.input,
      output: session.output,
      total: session.total,
      costUsd: session.costUsd,
      byAgent: [...session.usage.values()].sort(
        (left, right) => left.agent.localeCompare(right.agent) || left.model.localeCompare(right.model),
      ),
    };
  }

  private recordUsage(agent: string, model: string, usage: TokenUsage | undefined, session: Session): void {
    const pricing = this.options.config.runner.pricing?.[model];
    const key = `${agent}\u0000${model}`;
    let entry = session.usage.get(key);
    if (!entry) {
      entry = { agent, model, requests: 0, input: 0, output: 0, total: 0, costUsd: pricing ? 0 : null };
      session.usage.set(key, entry);
    }
    entry.requests++;
    session.requests++;

    if (!usage) {
      entry.costUsd = null;
      session.costUsd = null;
    } else {
      entry.input += usage.input;
      entry.output += usage.output;
      entry.total += usage.total;
      session.input += usage.input;
      session.output += usage.output;
      session.total += usage.total;
      if (pricing && entry.costUsd !== null && session.costUsd !== null) {
        const cost = (usage.input * pricing.inputPerMillion + usage.output * pricing.outputPerMillion) / 1_000_000;
        entry.costUsd += cost;
        session.costUsd += cost;
      } else {
        entry.costUsd = null;
        session.costUsd = null;
      }
    }

    this.emit({
      type: "usage",
      agent,
      model,
      usage: usage ?? null,
      costUsd: entry.costUsd,
      totalCostUsd: session.costUsd,
    });

    const limit = this.options.config.runner.maxCostUsd;
    if (limit !== undefined) {
      if (session.costUsd === null) {
        throw new CostBudgetExceededError(
          `Provider '${this.options.provider.name}' omitted usage; cannot enforce maxCostUsd`,
        );
      }
      if (session.costUsd > limit) {
        throw new CostBudgetExceededError(
          `Run cost $${session.costUsd.toFixed(6)} exceeded maxCostUsd $${limit.toFixed(6)}`,
        );
      }
    }
  }

  private assertBudgetAvailable(session: Session): void {
    const limit = this.options.config.runner.maxCostUsd;
    if (limit !== undefined && session.costUsd !== null && session.costUsd >= limit) {
      throw new CostBudgetExceededError(`Run reached maxCostUsd $${limit.toFixed(6)}`);
    }
  }

  private async runAgent(
    agentName: string,
    prompt: string,
    depth: number,
    session: Session,
    signal: AbortSignal,
  ): Promise<string> {
    const { config, catalog, provider, projectRoot } = this.options;
    if (depth > config.runner.maxDepth) {
      throw new Error(`Agent depth limit exceeded (${config.runner.maxDepth})`);
    }
    if (session.agentCalls >= config.runner.maxAgentCalls) {
      throw new Error(`Agent call budget exhausted (${config.runner.maxAgentCalls})`);
    }
    session.agentCalls++;

    const agent = catalog.agent(agentName);
    const model = config.runner.models[agent.tier];
    const system = await catalog.systemPrompt(agent, projectRoot);
    if (signal.aborted) throw signal.reason;
    const definitions = this.tools.definitions(agent.tools);
    if (agent.tools.includes("Agent")) definitions.push(agentToolDefinition(catalog.agentNames()));
    const messages: RunnerMessage[] = [{ role: "user", content: prompt }];
    this.emit({ type: "agent-start", agent: agentName, depth, model });

    for (let turn = 1; turn <= config.runner.maxTurns; turn++) {
      if (signal.aborted) throw signal.reason;
      this.assertBudgetAvailable(session);
      const completion = await provider.complete({
        system,
        model,
        messages,
        tools: definitions,
        maxOutputTokens: config.runner.maxOutputTokens,
        signal,
        onRetry: (event) => {
          session.retries++;
          if (event.requestId) session.requestIds.push(event.requestId);
          this.emit({ type: "retry", agent: agentName, model, ...event });
        },
      });
      if (signal.aborted) throw signal.reason;
      if (completion.requestId) session.requestIds.push(completion.requestId);
      const assistant = completion.message;
      messages.push(assistant);
      this.recordUsage(agentName, model, completion.usage, session);

      if (assistant.toolCalls.length === 0) {
        if (!assistant.content.trim()) throw new Error(`Agent '${agentName}' returned an empty final response`);
        this.emit({ type: "agent-end", agent: agentName, depth, turns: turn });
        return assistant.content;
      }

      const execute = (call: ToolCall) => this.executeTool(agentName, agent.tools, call, depth, session, signal);
      const results: ToolMessage[] = [];
      if (assistant.toolCalls.every((call) => call.name === "Agent")) {
        results.push(...(await Promise.all(assistant.toolCalls.map(execute))));
      } else {
        for (const call of assistant.toolCalls) results.push(await execute(call));
      }
      messages.push(...results);
    }
    throw new Error(`Agent '${agentName}' exceeded ${config.runner.maxTurns} model turns`);
  }

  private async executeTool(
    agentName: string,
    allowedTools: string[],
    call: ToolCall,
    depth: number,
    session: Session,
    signal: AbortSignal,
  ): Promise<ToolMessage> {
    this.emit({ type: "tool-start", agent: agentName, tool: call.name, callId: call.id });
    let result: ToolResult;
    if (call.parseError) {
      result = { content: call.parseError, isError: true };
    } else if (!allowedTools.includes(call.name)) {
      result = { content: `Tool '${call.name}' is not available to agent '${agentName}'`, isError: true };
    } else if (call.name === "Agent") {
      try {
        const input = inputRecord(call.input);
        const subagent = input.subagent_type;
        const prompt = input.prompt;
        if (typeof subagent !== "string" || typeof prompt !== "string" || !prompt) {
          throw new Error("Agent requires non-empty 'subagent_type' and 'prompt' strings");
        }
        result = { content: await this.runAgent(subagent, prompt, depth + 1, session, signal) };
      } catch (error) {
        if (
          error instanceof CostBudgetExceededError ||
          error instanceof RunTimeoutError ||
          error instanceof RunCancelledError ||
          signal.aborted
        ) throw error;
        if (error instanceof ProviderError && error.requestId) session.requestIds.push(error.requestId);
        result = { content: (error as Error).message, isError: true };
      }
    } else {
      result = await this.tools.execute(call.name, call.input, this.options.projectRoot, signal);
    }
    this.emit({
      type: "tool-end",
      agent: agentName,
      tool: call.name,
      callId: call.id,
      isError: Boolean(result.isError),
    });
    return {
      role: "tool",
      toolCallId: call.id,
      name: call.name,
      content: result.content,
      isError: Boolean(result.isError),
    };
  }
}
