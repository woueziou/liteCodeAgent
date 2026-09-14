import type { Config } from "../config.ts";
import type { AgentCatalog } from "./catalog.ts";
import { agentToolDefinition, LocalTools } from "./tools.ts";
import type {
  AssistantMessage,
  Provider,
  RunnerMessage,
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
};

type Session = { agentCalls: number };

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
    return this.runAgent(agent, prompt, 0, { agentCalls: 0 });
  }

  private emit(event: TraceEvent): void {
    this.options.trace?.(event);
  }

  private async runAgent(agentName: string, prompt: string, depth: number, session: Session): Promise<string> {
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
    const definitions = this.tools.definitions(agent.tools);
    if (agent.tools.includes("Agent")) definitions.push(agentToolDefinition(catalog.agentNames()));
    const messages: RunnerMessage[] = [{ role: "user", content: prompt }];
    this.emit({ type: "agent-start", agent: agentName, depth, model });

    for (let turn = 1; turn <= config.runner.maxTurns; turn++) {
      const completion = await provider.complete({
        system,
        model,
        messages,
        tools: definitions,
        maxOutputTokens: config.runner.maxOutputTokens,
      });
      const assistant = completion.message;
      messages.push(assistant);
      if (completion.usage) this.emit({ type: "usage", agent: agentName, usage: completion.usage });

      if (assistant.toolCalls.length === 0) {
        if (!assistant.content.trim()) throw new Error(`Agent '${agentName}' returned an empty final response`);
        this.emit({ type: "agent-end", agent: agentName, depth, turns: turn });
        return assistant.content;
      }

      const execute = (call: ToolCall) => this.executeTool(agentName, agent.tools, call, depth, session);
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
        result = { content: await this.runAgent(subagent, prompt, depth + 1, session) };
      } catch (error) {
        result = { content: (error as Error).message, isError: true };
      }
    } else {
      result = await this.tools.execute(call.name, call.input, this.options.projectRoot);
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
