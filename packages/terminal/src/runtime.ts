import type { IAgentManager, ITokenUsage, ToolMap } from '@jupyternaut/agent';
import type { ISignal } from '@lumino/signaling';
import type { UserContent } from 'ai';

/**
 * The agent runtimes the terminal can drive.
 */
export type AgentEngine = 'ai-sdk' | 'pi';

export const DEFAULT_ENGINE: AgentEngine = 'ai-sdk';

export function isAgentEngine(value: unknown): value is AgentEngine {
  return value === 'ai-sdk' || value === 'pi';
}

export const ENGINE_LABELS: Record<AgentEngine, string> = {
  'ai-sdk': 'ai-sdk (Jupyternaut agent, Vercel AI SDK)',
  pi: 'pi (pi-agent-core with the Jupyternaut providers)'
};

/**
 * The terminal user interfaces: the built-in renderer or the pi TUI.
 */
export type TerminalUi = 'builtin' | 'pi';

export const DEFAULT_UI: TerminalUi = 'builtin';

export function isTerminalUi(value: unknown): value is TerminalUi {
  return value === 'builtin' || value === 'pi';
}

/**
 * The part of an agent manager the terminal UI needs. The AI SDK agent of
 * `@jupyternaut/agent` and the pi agent both provide it.
 */
export interface ITerminalAgent {
  activeProvider: string;
  readonly agentEvent: ISignal<unknown, IAgentManager.IAgentEvent>;
  readonly tokenUsage: ITokenUsage;
  readonly tokenUsageChanged: ISignal<unknown, ITokenUsage>;
  readonly selectedAgentTools: ToolMap;
  setSelectedTools(toolNames: string[]): void;
  hasValidConfig(): boolean;
  clearHistory(): Promise<void>;
  stopStreaming(): void;
  approveToolCall(toolCallId: string, reason?: string): void;
  rejectToolCall(toolCallId: string, reason?: string): void;
  generateResponse(message: UserContent): Promise<void>;
}
