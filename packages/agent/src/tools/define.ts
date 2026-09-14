import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { Static, TSchema } from '@earendil-works/pi-ai';

import type { ITool } from '../tokens';

/**
 * A tool result for the model: the JSON of the value, kept as details for
 * the UI.
 */
export function toolResult(value: unknown): AgentToolResult<unknown> {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return { content: [{ type: 'text', text: text ?? '' }], details: value };
}

export interface IJsonToolOptions<T extends TSchema> {
  name: string;
  label: string;
  description: string;
  parameters: T;
  needsApproval?: ITool['needsApproval'];
  /**
   * Compute the result; a JSON value returned to the model.
   */
  execute: (input: Static<T>) => Promise<unknown> | unknown;
}

/**
 * Define a tool whose result is a JSON value.
 */
export function jsonTool<T extends TSchema>(
  options: IJsonToolOptions<T>
): ITool {
  return {
    name: options.name,
    label: options.label,
    description: options.description,
    parameters: options.parameters,
    needsApproval: options.needsApproval,
    execute: async (toolCallId, params) =>
      toolResult(await options.execute(params as Static<T>))
  };
}
