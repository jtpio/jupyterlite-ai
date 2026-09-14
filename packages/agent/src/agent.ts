import {
  Agent,
  type AgentEvent,
  type AgentToolResult,
  type BeforeToolCallContext,
  type BeforeToolCallResult
} from '@earendil-works/pi-agent-core';
import type { Api, Message, Model, Usage } from '@earendil-works/pi-ai';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { PromiseDelegate } from '@lumino/coreutils';
import { ISignal, Signal } from '@lumino/signaling';
import { IMcpManager } from 'jupyter-mcp-manager';
import { ISecretsManager } from 'jupyter-secrets-manager';

import { createMcpTools, McpClient } from './mcp';
import { getEffectiveContextWindow } from './providers/model-info';
import type { ISkillSummary } from './skills';
import { createExecuteCommandApprovalPolicy } from './tools/commands';
import {
  type IAgentManager,
  type IAgentManagerFactory,
  type IAISettingsModel,
  type IHistoryMessage,
  type IProviderRegistry,
  type ISkillRegistry,
  type ITokenUsage,
  type IToolRegistry,
  type ITool,
  type ToolMap,
  type UserContent,
  SECRETS_NAMESPACE
} from './tokens';

/**
 * A connected MCP server and its tools.
 */
interface IMcpConnection {
  name: string;
  client: McpClient;
  tools: ITool[];
}

/**
 * The agent manager factory namespace.
 */
export namespace AgentManagerFactory {
  export interface IOptions {
    /**
     * The settings model.
     */
    settingsModel: IAISettingsModel;
    /**
     * The provider registry, for the models.
     */
    providerRegistry: IProviderRegistry;
    /**
     * The skill registry for discovering skills.
     */
    skillRegistry?: ISkillRegistry;
    /**
     * The MCP servers manager.
     */
    mcpManager?: IMcpManager;
    /**
     * The secrets manager.
     */
    secretsManager?: ISecretsManager;
    /**
     * The token used to request the secrets manager.
     */
    token: symbol | null;
  }
}

/**
 * The agent manager factory.
 */
export class AgentManagerFactory implements IAgentManagerFactory {
  constructor(options: AgentManagerFactory.IOptions) {
    Private.setToken(options.token);
    this._settingsModel = options.settingsModel;
    this._providerRegistry = options.providerRegistry;
    this._skillRegistry = options.skillRegistry;
    this._mcpManager = options.mcpManager;
    this._secretsManager = options.secretsManager;
    this._mcpConnectionChanged = new Signal<this, boolean>(this);

    if (this._skillRegistry) {
      this._skillRegistry.skillsChanged.connect(() => {
        this.refreshSkillSnapshots();
      });
    }

    // Initialize agent on construction
    this._initializeAgents().catch(error =>
      console.warn('Failed to initialize agent in constructor:', error)
    );

    // Listen for settings changes
    this._settingsModel.stateChanged.connect(this._onSettingsChanged, this);

    // Listen for MCP servers changes
    this._mcpManager?.serversChanged.connect(this._onSettingsChanged, this);

    // Disable the secrets manager if the token is empty.
    if (!options.token) {
      this._secretsManager = undefined;
    }
  }

  /**
   * Create a new agent.
   */
  createAgent(options: IAgentManager.IOptions): IAgentManager {
    const agentManager = new AgentManager({
      ...options,
      providerRegistry: options.providerRegistry ?? this._providerRegistry,
      skillRegistry: this._skillRegistry,
      secretsManager: this._secretsManager
    });
    this._agentManagers.push(agentManager);

    // New chats can be created before MCP setup finishes.
    // Reinitialize them with connected MCP tools once it does.
    this._initQueue
      .then(() => this.getMCPTools())
      .then(mcpTools => {
        if (Object.keys(mcpTools).length > 0) {
          agentManager.initializeAgent(mcpTools);
        }
      })
      .catch(error =>
        console.warn('Failed to pass MCP tools to new agent:', error)
      );

    return agentManager;
  }

  /**
   * Signal emitted when MCP connection status changes
   */
  get mcpConnectionChanged(): ISignal<this, boolean> {
    return this._mcpConnectionChanged;
  }

  /**
   * Checks whether a specific MCP server is connected.
   * @param serverName The name of the MCP server to check
   * @returns True if the server is connected, false otherwise
   */
  isMCPServerConnected(serverName: string): boolean {
    return this._mcpConnections.some(
      connection => connection.name === serverName
    );
  }

  /**
   * Gets the MCP tools from connected servers
   */
  async getMCPTools(): Promise<ToolMap> {
    const mcpTools: ToolMap = {};
    for (const connection of this._mcpConnections) {
      for (const tool of connection.tools) {
        mcpTools[tool.name] = tool;
      }
    }
    return mcpTools;
  }

  /**
   * Handles settings changes and reinitializes the agent.
   */
  private _onSettingsChanged(): void {
    this._initializeAgents().catch(error =>
      console.warn('Failed to initialize agent on settings change:', error)
    );
  }

  /**
   * Connect the enabled MCP servers of the configuration.
   */
  private async _initializeMCPClients(): Promise<void> {
    const servers = this._mcpManager?.getMCPServers() ?? [];
    let connectionChanged = false;

    for (const connection of this._mcpConnections) {
      await connection.client.close();
      connectionChanged = true;
    }
    this._mcpConnections = [];

    for (const server of servers) {
      if (server.type !== 'http') {
        continue;
      }
      const headers = Object.fromEntries(
        (server.headers ?? []).map(header => [header.name, header.value])
      );
      try {
        const client = new McpClient(server.url, headers);
        await client.connect();
        const tools = await createMcpTools(client);
        this._mcpConnections.push({ name: server.name, client, tools });
        connectionChanged = true;
      } catch (error) {
        console.warn(
          `Failed to connect to MCP server "${server.name}" at ${server.url}:`,
          error
        );
      }
    }

    // Emit connection change signal if there were any changes
    if (connectionChanged) {
      this._mcpConnectionChanged.emit(this._mcpConnections.length > 0);
    }
  }

  /**
   * Initializes the AI agent with current settings and tools.
   * Sets up the agent with model configuration, tools, and MCP servers.
   */
  private async _initializeAgents(): Promise<void> {
    this._initQueue = this._initQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          await this._initializeMCPClients();
          const mcpTools = await this.getMCPTools();
          this._agentManagers.forEach(manager => {
            manager.initializeAgent(mcpTools);
          });
        } catch (error) {
          console.warn('Failed to initialize agents:', error);
        }
      });
    return this._initQueue;
  }

  /**
   * Refresh skill snapshots across all agents.
   */
  refreshSkillSnapshots(): void {
    this._agentManagers.forEach(manager => {
      manager.refreshSkills();
    });
  }

  private _agentManagers: IAgentManager[] = [];
  private _settingsModel: IAISettingsModel;
  private _providerRegistry: IProviderRegistry;
  private _skillRegistry?: ISkillRegistry;
  private _secretsManager?: ISecretsManager;
  private _mcpManager?: IMcpManager;
  private _mcpConnections: IMcpConnection[] = [];
  private _mcpConnectionChanged: Signal<this, boolean>;
  private _initQueue: Promise<void> = Promise.resolve();
}

/**
 * Default parameter values for agent configuration
 */
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TURNS = 25;

/**
 * The model of an agent without a configured provider.
 */
const NO_MODEL: Model<Api> = {
  id: '',
  name: '',
  api: 'openai-completions',
  provider: 'none',
  baseUrl: '',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 16384
};

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

function contentText(content: UserContent): string {
  return typeof content === 'string'
    ? content
    : content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n');
}

export namespace AgentManager {
  /**
   * The options of an agent manager: the provider registry is required.
   */
  export interface IOptions extends IAgentManager.IOptions {
    providerRegistry: IProviderRegistry;
  }
}

/**
 * Cached configuration used to (re)build the agent.
 */
interface IAgentConfig {
  model: Model<Api>;
  /**
   * The function tools by name: the selected registry tools and the MCP tools.
   */
  tools: ToolMap;
  temperature: number;
  maxOutputTokens?: number;
  maxTurns: number;
  baseSystemPrompt: string;
  shouldUseTools: boolean;
}

/**
 * Manages the AI agent lifecycle and execution loop.
 * The loop is the pi agent (`@earendil-works/pi-agent-core`) and the requests
 * go through the pi-ai models of the provider registry. Emits events for UI
 * updates instead of directly manipulating the chat interface.
 */
export class AgentManager implements IAgentManager {
  /**
   * Creates a new AgentManager instance.
   * @param options Configuration options for the agent manager
   */
  constructor(options: AgentManager.IOptions) {
    this._settingsModel = options.settingsModel;
    this._toolRegistry = options.toolRegistry;
    this._providerRegistry = options.providerRegistry;
    this._skillRegistry = options.skillRegistry;
    this._secretsManager = options.secretsManager;
    this._selectedToolNames = [];
    this._mcpTools = {};
    this._agentEvent = new Signal<this, IAgentManager.IAgentEvent>(this);
    this._tokenUsage = options.tokenUsage ?? {
      inputTokens: 0,
      outputTokens: 0
    };
    this._tokenUsageChanged = new Signal<this, ITokenUsage>(this);
    this._skills = [];
    this._agentConfig = null;
    this._renderMimeRegistry = options.renderMimeRegistry;
    this._additionalInstructions = options.additionalInstructions;
    this._streaming.resolve();

    this._agent = new Agent({
      initialState: {
        systemPrompt: '',
        model: NO_MODEL,
        thinkingLevel: 'off',
        tools: []
      },
      streamFn: (model, context, streamOptions) =>
        this._providerRegistry.models.streamSimple(model, context, {
          ...streamOptions,
          temperature: this._agentConfig?.temperature,
          maxTokens: this._agentConfig?.maxOutputTokens
        }),
      getApiKey: () => this._apiKey(),
      beforeToolCall: (context, signal) =>
        this._beforeToolCall(context, signal),
      shouldStopAfterTurn: () =>
        ++this._turns >= (this._agentConfig?.maxTurns ?? DEFAULT_MAX_TURNS)
    });
    this._agent.subscribe(event => this._onEvent(event));

    this.activeProvider =
      options.activeProvider ?? this._settingsModel.config.defaultProvider;

    // Initialize selected tools to all available tools by default
    if (this._toolRegistry) {
      this._selectedToolNames = Object.keys(this._toolRegistry.tools);
    }
  }

  /**
   * Signal emitted when agent events occur
   */
  get agentEvent(): ISignal<this, IAgentManager.IAgentEvent> {
    return this._agentEvent;
  }

  /**
   * Signal emitted when the active provider has changed.
   */
  get activeProviderChanged(): ISignal<this, string | undefined> {
    return this._activeProviderChanged;
  }

  /**
   * Gets the current token usage statistics.
   */
  get tokenUsage(): ITokenUsage {
    return this._tokenUsage;
  }

  /**
   * Signal emitted when token usage statistics change.
   */
  get tokenUsageChanged(): ISignal<this, ITokenUsage> {
    return this._tokenUsageChanged;
  }

  /**
   * The pi agent, for its transcript and queues.
   */
  get agent(): Agent {
    return this._agent;
  }

  /**
   * Refresh the skills snapshot and rebuild the agent if resources are ready.
   */
  refreshSkills(): void {
    this._initQueue = this._initQueue
      .catch(() => undefined)
      .then(async () => {
        this._refreshSkills();
        if (!this._agentConfig) {
          return;
        }
        this._applyAgentConfig();
      });
  }

  /**
   * The active provider for this agent.
   */
  get activeProvider(): string {
    return this._activeProvider;
  }
  set activeProvider(value: string) {
    if (this._activeProvider === value) {
      return;
    }
    const previousProvider = this._activeProvider;
    this._activeProvider = value;

    // Reset request-level context estimate only when switching between providers.
    if (previousProvider && previousProvider !== value) {
      this._tokenUsage.lastRequestInputTokens = undefined;
    }

    this._tokenUsage.contextWindow = this._getActiveContextWindow();

    this._tokenUsageChanged.emit(this._tokenUsage);
    this.initializeAgent();
    this._activeProviderChanged.emit(this._activeProvider);
  }

  /**
   * Sets the selected tools by name and reinitializes the agent.
   * @param toolNames Array of tool names to select
   */
  setSelectedTools(toolNames: string[]): void {
    this._selectedToolNames = [...toolNames];
    this.initializeAgent().catch(error =>
      console.warn('Failed to initialize agent on tools change:', error)
    );
  }

  /**
   * Gets the currently selected tools as a record.
   * @returns Record of selected tools
   */
  get selectedAgentTools(): ToolMap {
    if (!this._toolRegistry) {
      return {};
    }

    const result: ToolMap = {};
    for (const name of this._selectedToolNames) {
      const tool = this._toolRegistry.get(name);
      if (tool) {
        result[name] = tool;
      }
    }

    return result;
  }

  /**
   * Checks if the current configuration is valid for agent operations.
   * Uses the provider registry to determine if an API key is required.
   * @returns True if the configuration is valid, false otherwise
   */
  hasValidConfig(): boolean {
    const activeProviderConfig = this._settingsModel.getProvider(
      this._activeProvider
    );
    if (!activeProviderConfig) {
      return false;
    }

    if (!activeProviderConfig.model) {
      return false;
    }

    const providerInfo = this._providerRegistry.getProviderInfo(
      activeProviderConfig.provider
    );
    if (providerInfo?.apiKeyRequirement === 'required') {
      return !!activeProviderConfig.apiKey;
    }

    return true;
  }

  /**
   * Clears conversation history and resets agent state.
   */
  async clearHistory(): Promise<void> {
    // Stop any ongoing streaming
    this.stopStreaming('Chat cleared');

    await this._streaming.promise;
    await this._agent.waitForIdle();
    this._agent.reset();

    // Clear token usage
    this._tokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      contextWindow: this._getActiveContextWindow()
    };
    this._tokenUsageChanged.emit(this._tokenUsage);
  }

  /**
   * Replace the conversation history.
   */
  setHistory(messages: IHistoryMessage[]): void {
    this.stopStreaming('Chat history changed');
    // The aborted run still appends its last message when it settles.
    this._historyQueue = this._historyQueue
      .then(() => this._agent.waitForIdle())
      .then(() => {
        this._agent.state.messages = messages.map(message =>
          this._toMessage(message)
        );
      });
  }

  /**
   * Stops the current streaming response by aborting the request.
   * Resolve any pending approval.
   */
  stopStreaming(reason?: string): void {
    this._controller?.abort();
    this._agent.abort();

    // Reject any pending approvals
    for (const settle of [...this._pendingApprovals.values()]) {
      settle(false, reason ?? 'Stream ended by user');
    }
  }

  /**
   * Approves a pending tool call.
   * @param toolCallId The tool call ID to approve
   * @param reason Optional reason for approval
   */
  approveToolCall(toolCallId: string, reason?: string): void {
    this._pendingApprovals.get(toolCallId)?.(true, reason);
  }

  /**
   * Rejects a pending tool call.
   * @param toolCallId The tool call ID to reject
   * @param reason Optional reason for rejection
   */
  rejectToolCall(toolCallId: string, reason?: string): void {
    this._pendingApprovals.get(toolCallId)?.(false, reason);
  }

  /**
   * Generates AI response to user message using the agent.
   * Handles the complete execution cycle including tool calls.
   * @param message The user message to respond to (text, or text and images)
   */
  async generateResponse(message: UserContent): Promise<void> {
    this._streaming = new PromiseDelegate();
    // A stop while the agent gets ready cancels the generation as well.
    const controller = new AbortController();
    this._controller = controller;
    try {
      if (!this._configured) {
        await this.initializeAgent();
      }
      if (!this._configured) {
        throw new Error(
          'Failed to initialize agent.\nPlease configure your AI settings first. Open the AI Settings to set your API key and model.'
        );
      }
      await this._historyQueue;
      await this._agent.waitForIdle();
      if (controller.signal.aborted) {
        return;
      }
      await this._agent.prompt({
        role: 'user',
        content: message,
        timestamp: Date.now()
      });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this._agentEvent.emit({
          type: 'error',
          data: {
            error: error instanceof Error ? error : new Error(String(error))
          }
        });
      }
    } finally {
      if (this._controller === controller) {
        this._controller = null;
      }
      this._streaming.resolve();
    }
  }

  /**
   * Request a one-off text response, which won't be added to history.
   */
  async textResponse(prompt: string, systemPrompt?: string): Promise<string> {
    try {
      const model = this._agentConfig?.model ?? this._createModel();
      const message = await this._providerRegistry.models.completeSimple(
        model,
        {
          systemPrompt,
          messages: [{ role: 'user', content: prompt, timestamp: Date.now() }]
        },
        {
          apiKey: await this._apiKey(),
          temperature: this._agentConfig?.temperature
        }
      );
      if (message.stopReason === 'error') {
        throw new Error(message.errorMessage ?? 'The request failed');
      }
      this._updateTokenUsage(message.usage);
      return message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');
    } catch (e) {
      throw `Error while getting the topic of the chat\n${e}`;
    }
  }

  /**
   * Initializes the AI agent with current settings and tools.
   * Sets up the agent with model configuration, tools, and MCP tools.
   */
  initializeAgent = async (mcpTools?: ToolMap): Promise<void> => {
    this._initQueue = this._initQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          this._refreshSkills();
          this._prepareAgentConfig(mcpTools);
          this._applyAgentConfig();
        } catch (error) {
          console.warn('Failed to initialize agent:', error);
          this._configured = false;
        }
      });
    return this._initQueue;
  };

  // ---------------------------------------------------------------------
  // Agent events
  // ---------------------------------------------------------------------

  private _onEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'agent_start':
        this._turns = 0;
        break;
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
        this._completeMessage();
        this._updateTokenUsage(message.usage);
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
        const tool = this._runtimeTools[event.toolName];
        this._agentEvent.emit({
          type: 'tool_call_start',
          data: {
            callId: event.toolCallId,
            toolName: event.toolName,
            title: tool?.label,
            input: this._formatToolInput(JSON.stringify(event.args))
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
        const failed =
          typeof details === 'object' &&
          details !== null &&
          (details as { success?: unknown }).success === false;
        this._agentEvent.emit({
          type: 'tool_call_complete',
          data: {
            callId: event.toolCallId,
            toolName: event.toolName,
            outputData: event.isError ? text || details : (details ?? text),
            isError: event.isError || failed
          }
        });
        break;
      }
      default:
        break;
    }
  }

  private _completeMessage(): void {
    if (!this._messageId) {
      return;
    }
    this._agentEvent.emit({
      type: 'message_complete',
      data: { messageId: this._messageId, content: this._text }
    });
    this._messageId = undefined;
    this._text = '';
  }

  // ---------------------------------------------------------------------
  // Tool approvals
  // ---------------------------------------------------------------------

  private async _beforeToolCall(
    context: BeforeToolCallContext,
    signal?: AbortSignal
  ): Promise<BeforeToolCallResult | undefined> {
    const { toolCall, args } = context;
    const tool = this._runtimeTools[toolCall.name];
    let needsApproval =
      typeof tool?.needsApproval === 'function'
        ? await tool.needsApproval(args)
        : tool?.needsApproval === true;
    if (!needsApproval && toolCall.name === 'execute_command') {
      const policy = createExecuteCommandApprovalPolicy(this._settingsModel);
      needsApproval = policy(args as { commandId: string }) === 'user-approval';
    }
    if (!needsApproval) {
      return undefined;
    }
    const approved = await this._requestApproval(
      toolCall.id,
      toolCall.name,
      args,
      signal
    );
    return approved
      ? undefined
      : { block: true, reason: 'Tool execution was denied by the user.' };
  }

  /**
   * Ask the UI for a confirmation. The pending approval is registered before
   * the event so that a listener can answer synchronously.
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

  // ---------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------

  /**
   * The API key of the active provider, from the secrets manager or the
   * settings. Providers that need no key get a placeholder.
   */
  private async _apiKey(): Promise<string | undefined> {
    const config = this._settingsModel.getProvider(this._activeProvider);
    if (!config) {
      return undefined;
    }
    let apiKey = '';
    if (this._secretsManager && this._settingsModel.config.useSecretsManager) {
      const token = Private.getToken();
      if (!token) {
        // This should never happen, the secrets manager should be disabled.
        console.error(
          '@jupyterlite/ai::AgentManager error: the settings manager token is not set.\nYou should disable the the secrets manager from the AI settings.'
        );
      } else {
        apiKey =
          (
            await this._secretsManager.get(
              token,
              SECRETS_NAMESPACE,
              `${config.provider}:apiKey`
            )
          )?.value ?? '';
      }
    } else {
      apiKey = this._settingsModel.getApiKey(config.id);
    }
    if (apiKey) {
      return apiKey;
    }
    const info = this._providerRegistry.getProviderInfo(config.provider);
    return info?.apiKeyRequirement === 'required' ? undefined : 'unused';
  }

  /**
   * Updates cumulative token usage statistics from a completed model request.
   */
  private _updateTokenUsage(usage: Usage): void {
    const input = usage.input + usage.cacheRead + usage.cacheWrite;
    if (input === 0 && usage.output === 0) {
      return;
    }
    this._tokenUsage.inputTokens += input;
    this._tokenUsage.outputTokens += usage.output;
    this._tokenUsage.lastRequestInputTokens = input;
    this._tokenUsage.contextWindow = this._getActiveContextWindow();
    this._tokenUsageChanged.emit(this._tokenUsage);
  }

  /**
   * Gets the configured context window for the active provider.
   */
  private _getActiveContextWindow(): number | undefined {
    const activeProviderConfig = this._settingsModel.getProvider(
      this._activeProvider
    );
    return getEffectiveContextWindow(
      activeProviderConfig,
      this._providerRegistry
    );
  }

  /**
   * Refresh the in-memory skills snapshot from the skill registry.
   */
  private _refreshSkills(): void {
    if (!this._skillRegistry) {
      this._skills = [];
      return;
    }
    this._skills = this._skillRegistry.listSkills();
  }

  /**
   * The pi-ai model of the active provider configuration.
   */
  private _createModel(): Model<Api> {
    const config = this._settingsModel.getProvider(this._activeProvider);
    if (!config) {
      throw new Error('No active provider configured');
    }
    const model = this._providerRegistry.createModel({
      provider: config.provider,
      model: config.model,
      baseURL: config.baseURL,
      headers: config.headers
    });
    if (!model) {
      throw new Error(`Provider ${config.provider} not found`);
    }
    return model;
  }

  /**
   * A pi message of the history.
   */
  private _toMessage(message: IHistoryMessage): Message {
    const timestamp = Date.now();
    if (message.role === 'user') {
      return { role: 'user', content: message.content, timestamp };
    }
    const model = this._agentConfig?.model ?? NO_MODEL;
    return {
      role: 'assistant',
      content: [{ type: 'text', text: contentText(message.content) }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: emptyUsage(),
      stopReason: 'stop',
      timestamp
    };
  }

  /**
   * Prepare model, tools, and settings needed to (re)build the agent.
   */
  private _prepareAgentConfig(mcpTools?: ToolMap): void {
    const config = this._settingsModel.config;
    if (mcpTools !== undefined) {
      this._mcpTools = mcpTools;
    }

    const model = this._createModel();
    const canUseTools = config.toolsEnabled && this._supportsToolCalling();
    const tools: ToolMap = canUseTools
      ? { ...this.selectedAgentTools, ...this._mcpTools }
      : {};

    const activeProviderConfig = this._settingsModel.getProvider(
      this._activeProvider
    );
    this._tokenUsage.contextWindow = this._getActiveContextWindow();
    this._tokenUsageChanged.emit(this._tokenUsage);

    this._agentConfig = {
      model,
      tools,
      temperature:
        activeProviderConfig?.parameters?.temperature ?? DEFAULT_TEMPERATURE,
      maxOutputTokens: activeProviderConfig?.parameters?.maxOutputTokens,
      maxTurns: activeProviderConfig?.parameters?.maxTurns ?? DEFAULT_MAX_TURNS,
      baseSystemPrompt: config.systemPrompt || '',
      shouldUseTools: canUseTools && Object.keys(tools).length > 0
    };
  }

  /**
   * Apply the cached configuration and the current skills snapshot to the agent.
   */
  private _applyAgentConfig(): void {
    if (!this._agentConfig) {
      this._configured = false;
      return;
    }

    const { model, tools, baseSystemPrompt, shouldUseTools } =
      this._agentConfig;

    const baseInstructions = shouldUseTools
      ? this._getEnhancedSystemPrompt(baseSystemPrompt, tools)
      : baseSystemPrompt || 'You are a helpful assistant.';
    const richOutputWorkflowInstruction = shouldUseTools
      ? '- When the user asks for visual or rich outputs, prefer running code/commands that produce those outputs and describe that they will be rendered in chat.'
      : '- When tools are unavailable, explain the limitation clearly and provide concrete steps the user can run to produce the desired rich outputs.';
    const supportedMimeTypesInstruction =
      this._getSupportedMimeTypesInstruction();
    const instructions = `${baseInstructions}

RICH OUTPUT RENDERING:
- The chat UI can render rich MIME outputs as separate assistant messages.
- ${supportedMimeTypesInstruction}
- Use only MIME types from the supported list when creating MIME bundles. Do not invent MIME keys.
- Do not claim that you cannot display maps, images, or rich outputs in chat.
${richOutputWorkflowInstruction}${this._additionalInstructions ? `\n\n${this._additionalInstructions}` : ''}`;

    this._runtimeTools = shouldUseTools ? tools : {};
    const state = this._agent.state;
    state.systemPrompt = instructions;
    state.model = model;
    state.tools = shouldUseTools ? Object.values(tools) : [];
    this._configured = true;
  }

  /**
   * Checks if the current provider supports tool calling.
   * @returns True if the provider supports tool calling, false otherwise
   */
  private _supportsToolCalling(): boolean {
    const activeProviderConfig = this._settingsModel.getProvider(
      this._activeProvider
    );
    if (!activeProviderConfig) {
      return false;
    }

    const providerInfo = this._providerRegistry.getProviderInfo(
      activeProviderConfig.provider
    );

    // Default to true if supportsToolCalling is not specified
    return providerInfo?.supportsToolCalling !== false;
  }

  /**
   * Formats tool input for display by pretty-printing JSON strings.
   * @param input The tool input string to format
   * @returns Pretty-printed JSON string
   */
  private _formatToolInput(input: string): string {
    try {
      const parsed = JSON.parse(input);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return input;
    }
  }

  /**
   * Enhances the base system prompt with dynamic context like skills.
   * @param baseSystemPrompt The base system prompt from settings
   * @returns The enhanced system prompt with dynamic additions
   */
  private _getEnhancedSystemPrompt(
    baseSystemPrompt: string,
    tools: ToolMap
  ): string {
    let prompt = baseSystemPrompt;

    if (this._skills.length > 0) {
      const lines = this._skills.map(
        skill => `- ${skill.name}: ${skill.description}`
      );
      const skillsPrompt = `

AGENT SKILLS:
Skills are provided via the skills registry and accessed through tools (not commands).
When a skill is relevant to the user's task, activate it by calling load_skill with the skill name to load its full instructions, then follow those instructions.
If the user explicitly asks for the latest list of skills, call discover_skills (optionally with a query).
Do NOT call discover_skills just to list skills; use the preloaded snapshot below instead unless you need to verify a skill not present in the snapshot.
If the load_skill result includes a non-empty "resources" array, those are bundled files (scripts, references, templates) you MUST load before proceeding. Only load the listed resource paths; never invent resource names. For each resource path, execute load_skill again with the resource argument, e.g.: load_skill({ name: "<skill>", resource: "<path>" }). Load all listed resources before starting the task.

AVAILABLE SKILLS (preloaded snapshot):
${lines.join('\n')}
`;
      prompt += skillsPrompt;
    }

    if ('browser_fetch' in tools) {
      prompt += `

WEB RETRIEVAL POLICY:
- If the user asks about a specific URL, call browser_fetch for that URL first.
- If browser_fetch fails due to CORS, network or access restrictions, say so and explain what the user can do instead.
`;
    }

    return prompt;
  }

  /**
   * Build an instruction line describing MIME types supported by this session.
   */
  private _getSupportedMimeTypesInstruction(): string {
    const mimeTypes = this._renderMimeRegistry?.mimeTypes ?? [];
    const safeMimeTypes = mimeTypes.filter(mimeType => {
      const factory = this._renderMimeRegistry?.getFactory(mimeType);
      return !!factory?.safe;
    });

    if (safeMimeTypes.length === 0) {
      return 'Supported MIME types are determined by the active JupyterLab renderers in this session.';
    }

    return `Supported MIME types in this session: ${safeMimeTypes.join(', ')}`;
  }

  // Private attributes
  private _settingsModel: IAISettingsModel;
  private _toolRegistry?: IToolRegistry;
  private _providerRegistry: IProviderRegistry;
  private _skillRegistry?: ISkillRegistry;
  private _secretsManager?: ISecretsManager;
  private _selectedToolNames: string[];
  private _agent: Agent;
  private _controller: AbortController | null = null;
  private _configured = false;
  private _runtimeTools: ToolMap = {};
  private _mcpTools: ToolMap;
  private _turns = 0;
  private _messageId?: string;
  private _text = '';
  private _agentEvent: Signal<this, IAgentManager.IAgentEvent>;
  private _tokenUsage: ITokenUsage;
  private _tokenUsageChanged: Signal<this, ITokenUsage>;
  private _activeProvider: string = '';
  private _activeProviderChanged = new Signal<this, string | undefined>(this);
  private _skills: ISkillSummary[];
  private _renderMimeRegistry?: IRenderMimeRegistry;
  private _additionalInstructions?: string;
  private _initQueue: Promise<void> = Promise.resolve();
  private _historyQueue: Promise<void> = Promise.resolve();
  private _agentConfig: IAgentConfig | null;
  private _pendingApprovals = new Map<
    string,
    (approved: boolean, reason?: string) => void
  >();
  private _streaming: PromiseDelegate<void> = new PromiseDelegate();
}

namespace Private {
  /**
   * The token to use with the secrets manager, setter and getter.
   */
  let secretsToken: symbol | null;
  export function setToken(value: symbol | null): void {
    secretsToken = value;
  }
  export function getToken(): symbol | null {
    return secretsToken;
  }
}
