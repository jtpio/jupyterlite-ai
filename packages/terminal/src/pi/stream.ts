import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Message,
  type Model,
  type Tool,
  type ToolCall,
  type ToolResultMessage,
  type Usage
} from '@earendil-works/pi-ai';
import {
  jsonSchema,
  streamText,
  type AssistantContent,
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolResultPart,
  type ToolSet
} from 'ai';

type JsonSchema = Exclude<Parameters<typeof jsonSchema>[0], () => unknown>;
type AssistantPart = Exclude<AssistantContent, string>[number];

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}

function toUsage(usage: LanguageModelUsage): Usage {
  const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  const input =
    usage.inputTokenDetails?.noCacheTokens ??
    Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite);
  const output = usage.outputTokens ?? 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning: usage.outputTokenDetails?.reasoningTokens,
    totalTokens: usage.totalTokens ?? input + cacheRead + cacheWrite + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}

function toToolOutput(message: ToolResultMessage): ToolResultPart['output'] {
  // Images in tool results are not forwarded, none of the tools return any.
  const value = message.content
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n');
  return message.isError
    ? { type: 'error-text', value }
    : { type: 'text', value };
}

/**
 * Convert the pi transcript to AI SDK messages. Tool calls without a result
 * (interrupted turns) and thinking blocks are left out.
 */
export function toModelMessages(messages: Message[]): ModelMessage[] {
  const answered = new Set(
    messages
      .filter(message => message.role === 'toolResult')
      .map(message => message.toolCallId)
  );
  const out: ModelMessage[] = [];
  for (const message of messages) {
    switch (message.role) {
      case 'user':
        out.push({
          role: 'user',
          content:
            typeof message.content === 'string'
              ? message.content
              : message.content.map(part =>
                  part.type === 'text'
                    ? { type: 'text', text: part.text }
                    : {
                        type: 'image',
                        image: part.data,
                        mediaType: part.mimeType
                      }
                )
        });
        break;
      case 'assistant': {
        const content: AssistantPart[] = [];
        for (const block of message.content) {
          if (block.type === 'text' && block.text) {
            content.push({ type: 'text', text: block.text });
          } else if (block.type === 'toolCall' && answered.has(block.id)) {
            content.push({
              type: 'tool-call',
              toolCallId: block.id,
              toolName: block.name,
              input: block.arguments
            });
          }
        }
        if (content.length > 0) {
          out.push({ role: 'assistant', content });
        }
        break;
      }
      case 'toolResult': {
        const part: ToolResultPart = {
          type: 'tool-result',
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          output: toToolOutput(message)
        };
        const last = out[out.length - 1];
        if (last?.role === 'tool') {
          last.content.push(part);
        } else {
          out.push({ role: 'tool', content: [part] });
        }
        break;
      }
    }
  }
  return out;
}

function toToolSet(tools: Tool[] | undefined): ToolSet | undefined {
  if (!tools?.length) {
    return undefined;
  }
  return Object.fromEntries(
    tools.map(tool => [
      tool.name,
      {
        description: tool.description,
        inputSchema: jsonSchema(tool.parameters as JsonSchema)
      }
    ])
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A pi stream function backed by an AI SDK language model, so that the pi
 * agent loop talks to the providers configured in the AI settings.
 */
export function createModelStream(
  getModel: () => Promise<LanguageModel>
): StreamFn {
  return (model: Model<string>, context, options) => {
    const stream = createAssistantMessageEventStream();
    const message: AssistantMessage = {
      role: 'assistant',
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: emptyUsage(),
      stopReason: 'pending',
      timestamp: Date.now()
    };
    // AI SDK part ids to indexes in `message.content`.
    const blocks = new Map<string, number>();
    let finishReason: FinishReason | undefined;
    let aborted = false;

    const textBlock = (id: string) => {
      const key = `text:${id}`;
      let index = blocks.get(key);
      if (index === undefined) {
        index = message.content.push({ type: 'text', text: '' }) - 1;
        blocks.set(key, index);
        stream.push({
          type: 'text_start',
          contentIndex: index,
          partial: message
        });
      }
      return index;
    };
    const thinkingBlock = (id: string) => {
      const key = `thinking:${id}`;
      let index = blocks.get(key);
      if (index === undefined) {
        index = message.content.push({ type: 'thinking', thinking: '' }) - 1;
        blocks.set(key, index);
        stream.push({
          type: 'thinking_start',
          contentIndex: index,
          partial: message
        });
      }
      return index;
    };
    const toolBlock = (id: string, name: string) => {
      const key = `tool:${id}`;
      let index = blocks.get(key);
      if (index === undefined) {
        index =
          message.content.push({ type: 'toolCall', id, name, arguments: {} }) -
          1;
        blocks.set(key, index);
        stream.push({
          type: 'toolcall_start',
          contentIndex: index,
          partial: message
        });
      }
      return index;
    };

    const run = async () => {
      const languageModel = await getModel();
      const result = streamText({
        model: languageModel,
        system: context.systemPrompt || undefined,
        messages: toModelMessages(context.messages),
        tools: toToolSet(context.tools),
        toolChoice: options?.toolChoice,
        temperature: options?.temperature,
        maxOutputTokens: options?.maxTokens,
        abortSignal: options?.signal
      });
      stream.push({ type: 'start', partial: message });

      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-start':
            textBlock(part.id);
            break;
          case 'text-delta': {
            const index = textBlock(part.id);
            const block = message.content[index] as { text: string };
            block.text += part.text;
            stream.push({
              type: 'text_delta',
              contentIndex: index,
              delta: part.text,
              partial: message
            });
            break;
          }
          case 'text-end': {
            const index = textBlock(part.id);
            const block = message.content[index] as { text: string };
            stream.push({
              type: 'text_end',
              contentIndex: index,
              content: block.text,
              partial: message
            });
            break;
          }
          case 'reasoning-start':
            thinkingBlock(part.id);
            break;
          case 'reasoning-delta': {
            const index = thinkingBlock(part.id);
            const block = message.content[index] as { thinking: string };
            block.thinking += part.text;
            stream.push({
              type: 'thinking_delta',
              contentIndex: index,
              delta: part.text,
              partial: message
            });
            break;
          }
          case 'reasoning-end': {
            const index = thinkingBlock(part.id);
            const block = message.content[index] as { thinking: string };
            stream.push({
              type: 'thinking_end',
              contentIndex: index,
              content: block.thinking,
              partial: message
            });
            break;
          }
          case 'tool-input-start':
            toolBlock(part.id, part.toolName);
            break;
          case 'tool-input-delta': {
            const index = blocks.get(`tool:${part.id}`);
            if (index !== undefined) {
              stream.push({
                type: 'toolcall_delta',
                contentIndex: index,
                delta: part.delta,
                partial: message
              });
            }
            break;
          }
          case 'tool-call': {
            const index = toolBlock(part.toolCallId, part.toolName);
            const toolCall = message.content[index] as ToolCall;
            toolCall.name = part.toolName;
            toolCall.arguments = (part.input ?? {}) as Record<string, unknown>;
            stream.push({
              type: 'toolcall_end',
              contentIndex: index,
              toolCall,
              partial: message
            });
            break;
          }
          case 'finish-step':
            message.usage = toUsage(part.usage);
            finishReason = part.finishReason;
            break;
          case 'abort':
            aborted = true;
            break;
          case 'error':
            throw part.error;
          default:
            break;
        }
      }

      if (aborted) {
        throw new DOMException('The request was aborted', 'AbortError');
      }
      message.stopReason = message.content.some(
        block => block.type === 'toolCall'
      )
        ? 'toolUse'
        : finishReason === 'length'
          ? 'length'
          : 'stop';
      stream.push({ type: 'done', reason: message.stopReason, message });
    };

    run().catch(error => {
      const isAbort =
        options?.signal?.aborted || (error as Error)?.name === 'AbortError';
      message.stopReason = isAbort ? 'aborted' : 'error';
      message.errorMessage = isAbort
        ? 'The request was interrupted'
        : errorMessage(error);
      stream.push({
        type: 'error',
        reason: message.stopReason,
        error: message
      });
    });
    return stream;
  };
}
