import {
  Agent,
  type AgentEvent,
  type AgentToolResult,
  type BeforeToolCallResult
} from '@earendil-works/pi-agent-core';
import type { Model, Usage } from '@earendil-works/pi-ai';
import {
  createExecuteCommandApprovalPolicy,
  getEffectiveContextWindow,
  type IAgentManager,
  type IAISettingsModel,
  type IProviderRegistry,
  type ISkillRegistry,
  type IToolRegistry,
  type ITokenUsage,
  type ToolMap
} from '@jupyternaut/agent';
import { Signal, type ISignal } from '@lumino/signaling';
import type { LanguageModel, UserContent } from 'ai';

import type { ITerminalAgent } from '../runtime';
import { createModelStream } from './stream';
import { toAgentTool, toolLabel, toolNeedsApproval } from './tools';

/**
 * The pi api id of models served through the AI SDK.
 */
const AI_SDK_API = 'ai-sdk';
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 16384;

export interface IPiAgentOptions {
  settingsModel: IAISettingsModel;
  /**
   * The tools of the agent; every change of the registry is picked up.
   */
  toolRegistry: IToolRegistry;
  /**
   * Create the AI SDK model of a provider config.
   */
  createModel: (providerId: string) => Promise<LanguageModel>;
  providerRegistry?: IProviderRegistry;
  skillRegistry?: ISkillRegistry;
  activeProvider?: string;
  /**
   * Extra instructions appended to the system prompt.
   */
  additionalInstructions?: string;
}

/**
 * The pi agent loop (`@earendil-works/pi-agent-core`) driven with the model
 * providers and tools of Jupyternaut, exposed with the events of the agent
 * manager so the terminal UI needs no change.
 */
export class PiAgent implements ITerminalAgent {
  constructor(options: IPiAgentOptions) {
    this._settingsModel = options.settingsModel;
    this._toolRegistry = options.toolRegistry;
    this._createModel = options.createModel;
    this._providerRegistry = options.providerRegistry;
    this._skillRegistry = options.skillRegistry;
    this._additionalInstructions = options.additionalInstructions;
    this._activeProvider =
      options.activeProvider ?? options.settingsModel.config.defaultProvider;
    this._commandPolicy = createExecuteCommandApprovalPolicy(
      options.settingsModel
    );
    this._tokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      contextWindow: this._contextWindow()
    };
    this._agent = new Agent({
      initialState: {
        systemPrompt: this._systemPrompt(),
        model: this._piModel(),
        thinkingLevel: 'off',
        tools: []
      },
      streamFn: createModelStream(() => this._languageModel()),
      beforeToolCall: (context, signal) =>
        this._beforeToolCall(
          context.toolCall.name,
          context.toolCall.id,
          context.args,
          signal
        ),
      // One approval prompt at a time in the terminal.
      toolExecution: 'sequential'
    });
    this._agent.subscribe(event => this._onEvent(event));
    this.setSelectedTools(Object.keys(options.toolRegistry.tools));
    options.settingsModel.stateChanged.connect(this._onSettingsChanged, this);
  }

  get agentEvent(): ISignal<this, IAgentManager.IAgentEvent> {
    return this._agentEvent;
  }

  get tokenUsage(): ITokenUsage {
    return this._tokenUsage;
  }

  get tokenUsageChanged(): ISignal<this, ITokenUsage> {
    return this._tokenUsageChanged;
  }

  get activeProvider(): string {
    return this._activeProvider;
  }
  set activeProvider(value: string) {
    if (value === this._activeProvider) {
      return;
    }
    this._activeProvider = value;
    this._model = undefined;
    this._agent.state.model = this._piModel();
    this._tokenUsage.lastRequestInputTokens = undefined;
    this._tokenUsage.contextWindow = this._contextWindow();
    this._tokenUsageChanged.emit(this._tokenUsage);
  }

  /**
   * The pi agent, for the transcript and the queues.
   */
  get agent(): Agent {
    return this._agent;
  }

  get selectedAgentTools(): ToolMap {
    const result: ToolMap = {};
    for (const name of this._selectedToolNames) {
      const tool = this._toolRegistry.get(name);
      if (tool) {
        result[name] = tool;
      }
    }
    return result;
  }

  setSelectedTools(toolNames: string[]): void {
    this._selectedToolNames = [...toolNames];
    const version = ++this._toolsVersion;
    this._toolsReady = Promise.all(
      Object.entries(this.selectedAgentTools).map(([name, tool]) =>
        toAgentTool(name, tool)
      )
    )
      .then(tools => {
        if (version === this._toolsVersion) {
          this._agent.state.tools = tools;
        }
      })
      .catch(error =>
        console.warn('Jupyternaut: cannot convert the tools for pi', error)
      );
  }

  hasValidConfig(): boolean {
    const config = this._settingsModel.getProvider(this._activeProvider);
    if (!config?.model) {
      return false;
    }
    const info = this._providerRegistry?.getProviderInfo(config.provider);
    return info?.apiKeyRequirement === 'required' ? !!config.apiKey : true;
  }

  async clearHistory(): Promise<void> {
    this.stopStreaming();
    await this._agent.waitForIdle();
    this._agent.reset();
    this._tokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      contextWindow: this._contextWindow()
    };
    this._tokenUsageChanged.emit(this._tokenUsage);
  }

  stopStreaming(): void {
    for (const settle of [...this._pendingApprovals.values()]) {
      settle(false);
    }
    this._agent.abort();
  }

  approveToolCall(toolCallId: string): void {
    this._pendingApprovals.get(toolCallId)?.(true);
  }

  rejectToolCall(toolCallId: string): void {
    this._pendingApprovals.get(toolCallId)?.(false);
  }

  async generateResponse(message: UserContent): Promise<void> {
    await this._toolsReady;
    const text =
      typeof message === 'string'
        ? message
        : message
            .filter(part => part.type === 'text')
            .map(part => part.text)
            .join('\n');
    if (this._agent.state.isStreaming) {
      this._agent.followUp({
        role: 'user',
        content: text,
        timestamp: Date.now()
      });
      return;
    }
    try {
      await this._agent.prompt(text);
    } catch (error) {
      this._agentEvent.emit({
        type: 'error',
        data: {
          error: error instanceof Error ? error : new Error(String(error))
        }
      });
    }
  }

  dispose(): void {
    this._settingsModel.stateChanged.disconnect(this._onSettingsChanged, this);
    this.stopStreaming();
  }

  private _onSettingsChanged(): void {
    this._model = undefined;
    this._agent.state.systemPrompt = this._systemPrompt();
    this._agent.state.model = this._piModel();
    this._tokenUsage.contextWindow = this._contextWindow();
    this._tokenUsageChanged.emit(this._tokenUsage);
  }

  private _languageModel(): Promise<LanguageModel> {
    if (!this._model) {
      const model = this._createModel(this._activeProvider);
      model.catch(() => {
        if (this._model === model) {
          this._model = undefined;
        }
      });
      this._model = model;
    }
    return this._model;
  }

  private _contextWindow(): number | undefined {
    return getEffectiveContextWindow(
      this._settingsModel.getProvider(this._activeProvider),
      this._providerRegistry
    );
  }

  /**
   * The pi description of the active model; the requests go through the AI
   * SDK model, so only the identity and the limits matter.
   */
  private _piModel(): Model<string> {
    const config = this._settingsModel.getProvider(this._activeProvider);
    return {
      id: config?.model ?? '',
      name: config?.name ?? config?.model ?? '',
      api: AI_SDK_API,
      provider: config?.provider ?? 'none',
      baseUrl: config?.baseURL ?? '',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: this._contextWindow() ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: config?.parameters?.maxOutputTokens ?? DEFAULT_MAX_TOKENS
    };
  }

  private _systemPrompt(): string {
    const parts = [
      this._settingsModel.config.systemPrompt || 'You are a helpful assistant.'
    ];
    const skills = this._skillRegistry?.listSkills() ?? [];
    if (skills.length > 0) {
      parts.push(
        'AGENT SKILLS:\n' +
          'When a skill is relevant to the task, call load_skill with its name to get its instructions, then follow them. ' +
          'Load every resource listed by the skill before starting.\n\n' +
          'AVAILABLE SKILLS:\n' +
          skills
            .map(skill => `- ${skill.name}: ${skill.description}`)
            .join('\n')
      );
    }
    if (this._additionalInstructions) {
      parts.push(this._additionalInstructions);
    }
    return parts.join('\n\n');
  }

  private async _beforeToolCall(
    toolName: string,
    toolCallId: string,
    args: unknown,
    signal?: AbortSignal
  ): Promise<BeforeToolCallResult | undefined> {
    const tool = this._toolRegistry.get(toolName);
    let needsApproval = tool
      ? await toolNeedsApproval(tool, args, toolCallId)
      : false;
    if (!needsApproval && toolName === 'execute_command') {
      needsApproval =
        this._commandPolicy(args as { commandId: string }) === 'user-approval';
    }
    if (!needsApproval) {
      return undefined;
    }
    const approved = await this._requestApproval(
      toolCallId,
      toolName,
      args,
      signal
    );
    return approved
      ? undefined
      : { block: true, reason: 'The user declined this tool call.' };
  }

  /**
   * Ask the UI for a confirmation. The pending approval is registered before
   * the event so a listener can answer synchronously.
   */
  private _requestApproval(
    toolCallId: string,
    toolName: string,
    args: unknown,
    signal?: AbortSignal
  ): Promise<boolean> {
    return new Promise(resolve => {
      const settle = (approved: boolean) => {
        if (!this._pendingApprovals.delete(toolCallId)) {
          return;
        }
        resolve(approved);
        this._agentEvent.emit({
          type: 'tool_approval_resolved',
          data: { toolCallId, approved }
        });
      };
      this._pendingApprovals.set(toolCallId, settle);
      signal?.addEventListener('abort', () => settle(false), { once: true });
      this._agentEvent.emit({
        type: 'tool_approval_request',
        data: { toolCallId, toolName, args }
      });
    });
  }

  private _onEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'message_start':
        if (event.message.role === 'assistant') {
          this._messageId = undefined;
          this._text = '';
        }
        break;
      case 'message_update': {
        const inner = event.assistantMessageEvent;
        if (inner.type !== 'text_delta') {
          break;
        }
        if (!this._messageId) {
          this._messageId = `msg-${Date.now()}-${Math.random()}`;
          this._agentEvent.emit({
            type: 'message_start',
            data: { messageId: this._messageId }
          });
        }
        this._text += inner.delta;
        this._agentEvent.emit({
          type: 'message_chunk',
          data: {
            messageId: this._messageId,
            chunk: inner.delta,
            fullContent: this._text
          }
        });
        break;
      }
      case 'message_end': {
        const { message } = event;
        if (message.role !== 'assistant') {
          break;
        }
        if (this._messageId) {
          this._agentEvent.emit({
            type: 'message_complete',
            data: { messageId: this._messageId, content: this._text }
          });
          this._messageId = undefined;
          this._text = '';
        }
        this._addUsage(message.usage);
        if (message.stopReason === 'error') {
          this._agentEvent.emit({
            type: 'error',
            data: {
              error: new Error(message.errorMessage ?? 'The request failed')
            }
          });
        }
        break;
      }
      case 'tool_execution_start': {
        const tool = this._toolRegistry.get(event.toolName);
        this._agentEvent.emit({
          type: 'tool_call_start',
          data: {
            callId: event.toolCallId,
            toolName: event.toolName,
            title: tool ? toolLabel(event.toolName, tool) : undefined,
            input: JSON.stringify(event.args, null, 2)
          }
        });
        break;
      }
      case 'tool_execution_end': {
        const result = event.result as AgentToolResult<unknown> | undefined;
        const text = (result?.content ?? [])
          .filter(part => part.type === 'text')
          .map(part => part.text)
          .join('\n');
        const details = result?.details;
        const outputData = event.isError ? text || details : (details ?? text);
        const failed =
          typeof details === 'object' &&
          details !== null &&
          (details as { success?: unknown }).success === false;
        this._agentEvent.emit({
          type: 'tool_call_complete',
          data: {
            callId: event.toolCallId,
            toolName: event.toolName,
            outputData,
            isError: event.isError || failed
          }
        });
        break;
      }
      default:
        break;
    }
  }

  private _addUsage(usage: Usage): void {
    const input = usage.input + usage.cacheRead + usage.cacheWrite;
    if (input === 0 && usage.output === 0) {
      return;
    }
    this._tokenUsage.inputTokens += input;
    this._tokenUsage.outputTokens += usage.output;
    this._tokenUsage.lastRequestInputTokens = input;
    this._tokenUsage.contextWindow = this._contextWindow();
    this._tokenUsageChanged.emit(this._tokenUsage);
  }

  private _settingsModel: IAISettingsModel;
  private _toolRegistry: IToolRegistry;
  private _createModel: (providerId: string) => Promise<LanguageModel>;
  private _providerRegistry?: IProviderRegistry;
  private _skillRegistry?: ISkillRegistry;
  private _additionalInstructions?: string;
  private _activeProvider: string;
  private _commandPolicy: (input: { commandId: string }) => string | undefined;
  private _agent: Agent;
  private _model?: Promise<LanguageModel>;
  private _selectedToolNames: string[] = [];
  private _toolsVersion = 0;
  private _toolsReady: Promise<void> = Promise.resolve();
  private _agentEvent = new Signal<this, IAgentManager.IAgentEvent>(this);
  private _tokenUsage: ITokenUsage;
  private _tokenUsageChanged = new Signal<this, ITokenUsage>(this);
  private _pendingApprovals = new Map<string, (approved: boolean) => void>();
  private _messageId?: string;
  private _text = '';
}
