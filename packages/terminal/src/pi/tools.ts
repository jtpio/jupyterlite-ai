import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ITool } from '@jupyternaut/agent';
import { asSchema } from 'ai';

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' && value !== null && Symbol.asyncIterator in value
  );
}

/**
 * The title of an AI SDK tool, for display.
 */
export function toolLabel(name: string, tool: ITool): string {
  const title = tool.metadata?.title;
  return typeof title === 'string' ? title : (tool.title ?? name);
}

/**
 * Whether the tool asks for a confirmation before running with these arguments.
 */
export async function toolNeedsApproval(
  tool: ITool,
  input: unknown,
  toolCallId: string
): Promise<boolean> {
  const { needsApproval } = tool;
  if (typeof needsApproval === 'function') {
    return needsApproval(input, {
      toolCallId,
      messages: [],
      context: undefined
    });
  }
  return needsApproval === true;
}

/**
 * Wrap an AI SDK tool as a pi agent tool. The JSON schema of the tool serves
 * both the pi argument validation and the model.
 */
export async function toAgentTool(
  name: string,
  tool: ITool
): Promise<AgentTool> {
  const parameters = (await asSchema(tool.inputSchema)
    .jsonSchema) as AgentTool['parameters'];
  const description =
    typeof tool.description === 'function'
      ? tool.description({ context: undefined })
      : (tool.description ?? name);
  return {
    name,
    label: toolLabel(name, tool),
    description,
    parameters,
    execute: async (toolCallId, params, signal) => {
      if (!tool.execute) {
        throw new Error(`The tool ${name} cannot run here`);
      }
      let output: unknown = await tool.execute(params, {
        toolCallId,
        messages: [],
        abortSignal: signal,
        context: undefined
      });
      if (isAsyncIterable(output)) {
        // Streaming tools: keep the final value.
        let last: unknown;
        for await (const value of output) {
          last = value;
        }
        output = last;
      }
      return toToolResult(output);
    }
  };
}

/**
 * The pi tool result of an AI SDK tool output: the JSON goes to the model and
 * the raw output is kept for the UI.
 */
export function toToolResult(output: unknown): AgentToolResult<unknown> {
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  return { content: [{ type: 'text', text: text ?? '' }], details: output };
}
