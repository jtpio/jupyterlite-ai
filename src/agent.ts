import { ISignal, Signal } from '@lumino/signaling';
import { ToolLoopAgent } from 'ai';
import type { CoreMessage } from 'ai';
import { ISecretsManager } from 'jupyter-secrets-manager';

import { BrowserMCPServerStreamableHttp } from './mcp/browser';
import { AISettingsModel } from './models/settings-model';
import { createModel } from './providers/models';
import type { IProviderRegistry } from './tokens';
import { ITool, IToolRegistry, ITokenUsage, SECRETS_NAMESPACE } from './tokens';

export namespace AgentManagerFactory {
  export interface IOptions {
    /**
     * The settings model.
     */
    settingsModel: AISettingsModel;
    /**
     * The secrets manager.
     */
    secretsManager?: ISecretsManager;
    /**
     * The token used to request the secrets manager.
     */
    token: symbol;
  }
}
export class AgentManagerFactory {
  constructor(options: AgentManagerFactory.IOptions) {
    Private.setToken(options.token);
    this._settingsModel = options.settingsModel;
    this._secretsManager = options.secretsManager;
    this._mcpServers = [];
    this._mcpConnectionChanged = new Signal<this, boolean>(this);

    // Initialize agent on construction
    this._initializeAgents().catch(error =>
      console.warn('Failed to initialize agent in constructor:', error)
    );

    // Listen for settings changes
    this._settingsModel.stateChanged.connect(this._onSettingsChanged, this);
  }

  createAgent(options: IAgentManagerOptions): AgentManager {
    const agentManager = new AgentManager({
      ...options,
      secretsManager: this._secretsManager
    });
    this._agentManagers.push(agentManager);
    return agentManager;
  }

  /**
   * Signal emitted when MCP connection status changes
   */
  get mcpConnectionChanged(): ISignal<this, boolean> {
    return this._mcpConnectionChanged;
  }

  /**
   * Checks if a specific MCP server is connected by server name.
   * @param serverName The name of the MCP server to check
   * @returns True if the server is connected, false otherwise
   */
  isMCPServerConnected(serverName: string): boolean {
    return this._mcpServers.some(server => server.name === serverName);
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
   * Initializes MCP (Model Context Protocol) servers based on current settings.
   * Closes existing servers and connects to enabled servers from configuration.
   */
  private async _initializeMCPServers(): Promise<void> {
    const config = this._settingsModel.config;
    const enabledServers = config.mcpServers.filter(server => server.enabled);
    let connectionChanged = false;

    // Close existing servers
    for (const server of this._mcpServers) {
      try {
        await server.close();
        connectionChanged = true;
      } catch (error) {
        console.warn('Error closing MCP server:', error);
      }
    }
    this._mcpServers = [];

    // Initialize new servers
    for (const serverConfig of enabledServers) {
      try {
        const mcpServer = new BrowserMCPServerStreamableHttp({
          url: serverConfig.url,
          name: serverConfig.name
        });
        await mcpServer.connect();
        this._mcpServers.push(mcpServer);
        connectionChanged = true;
      } catch (error) {
        console.warn(
          `Failed to connect to MCP server "${serverConfig.name}" at ${serverConfig.url}:`,
          error
        );
      }
    }

    // Emit connection change signal if there were any changes
    if (connectionChanged) {
      this._mcpConnectionChanged.emit(this._mcpServers.length > 0);
    }
  }

  /**
   * Initializes the AI agent with current settings and tools.
   * Sets up the agent with model configuration, tools, and MCP servers.
   */
  private async _initializeAgents(): Promise<void> {
    if (this._isInitializing) {
      return;
    }
    this._isInitializing = true;

    try {
      await this._initializeMCPServers();
      const mcpServers = this._mcpServers.filter(server => server !== null);

      this._agentManagers.forEach(manager => {
        manager.initializeAgent(mcpServers);
      });
    } catch (error) {
      console.warn('Failed to initialize agents:', error);
    } finally {
      this._isInitializing = false;
    }
  }

  private _agentManagers: AgentManager[] = [];
  private _settingsModel: AISettingsModel;
  private _secretsManager?: ISecretsManager;
  private _mcpServers: BrowserMCPServerStreamableHttp[];
  private _mcpConnectionChanged: Signal<this, boolean>;
  private _isInitializing: boolean = false;
}

/**
 * Default parameter values for agent configuration
 */
const DEFAULT_TEMPERATURE = 0.7;

/**
 * Event type mapping for type safety with inlined interface definitions
 */
export interface IAgentEventTypeMap {
  message_start: {
    messageId: string;
  };
  message_chunk: {
    messageId: string;
    chunk: string;
    fullContent: string;
  };
  message_complete: {
    messageId: string;
    content: string;
  };
  tool_call_start: {
    callId: string;
    toolName: string;
    input: string;
  };
  tool_call_complete: {
    callId: string;
    toolName: string;
    output: string;
    isError: boolean;
  };
  tool_approval_required: {
    interruptionId: string;
    toolName: string;
    toolInput: string;
    callId?: string;
  };
  tool_approval_complete: {
    interruptionId: string;
    approved: boolean;
  };
  grouped_approval_required: {
    groupId: string;
    approvals: Array<{
      interruptionId: string;
      toolName: string;
      toolInput: string;
    }>;
  };
  tool_approval_group_complete: {
    groupId: string;
    approved: boolean;
    interruptionIds: string[];
  };
  error: {
    error: Error;
  };
}

/**
 * Events emitted by the AgentManager
 */
export type IAgentEvent<
  T extends keyof IAgentEventTypeMap = keyof IAgentEventTypeMap
> = T extends keyof IAgentEventTypeMap
  ? {
      type: T;
      data: IAgentEventTypeMap[T];
    }
  : never;

/**
 * Configuration options for the AgentManager
 */
export interface IAgentManagerOptions {
  /**
   * AI settings model for configuration
   */
  settingsModel: AISettingsModel;

  /**
   * Optional tool registry for managing available tools
   */
  toolRegistry?: IToolRegistry;

  /**
   * Optional provider registry for model creation
   */
  providerRegistry?: IProviderRegistry;

  /**
   * The secrets manager.
   */
  secretsManager?: ISecretsManager;

  /**
   * The active provider to use with this agent.
   */
  activeProvider?: string;

  /**
   * Initial token usage.
   */
  tokenUsage?: ITokenUsage;
}

/**
 * Manages the AI agent lifecycle and execution loop.
 * Provides agent initialization, tool management, MCP server integration,
 * and handles the complete agent execution cycle including tool approvals.
 * Emits events for UI updates instead of directly manipulating the chat interface.
 */
export class AgentManager {
  /**
   * Creates a new AgentManager instance.
   * @param options Configuration options for the agent manager
   */
  constructor(options: IAgentManagerOptions) {
    this._settingsModel = options.settingsModel;
    this._toolRegistry = options.toolRegistry;
    this._providerRegistry = options.providerRegistry;
    this._secretsManager = options.secretsManager;
    this._selectedToolNames = [];
    this._agent = null;
    this._history = [];
    this._mcpServers = [];
    this._isInitializing = false;
    this._controller = null;
    this._pendingApprovals = new Map();
    this._interruptedState = null;
    this._agentEvent = new Signal<this, IAgentEvent>(this);
    this._tokenUsage = options.tokenUsage ?? {
      inputTokens: 0,
      outputTokens: 0
    };
    this._tokenUsageChanged = new Signal<this, ITokenUsage>(this);

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
  get agentEvent(): ISignal<this, IAgentEvent> {
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
   * The active provider for this agent.
   */
  get activeProvider(): string {
    return this._activeProvider;
  }
  set activeProvider(value: string) {
    this._activeProvider = value;
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
   * Gets the currently selected tools as OpenAI agents tools.
   * @returns Array of selected tools formatted for OpenAI agents
   */
  get selectedAgentTools(): ITool[] {
    if (!this._toolRegistry) {
      return [];
    }

    const result: ITool[] = [];
    for (const name of this._selectedToolNames) {
      const tool: ITool | null = this._toolRegistry.get(name);
      if (tool) {
        result.push(tool);
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

    if (this._providerRegistry) {
      const providerInfo = this._providerRegistry.getProviderInfo(
        activeProviderConfig.provider
      );
      if (providerInfo?.apiKeyRequirement === 'required') {
        return !!activeProviderConfig.apiKey;
      }
    }

    return true;
  }

  /**
   * Clears conversation history and resets agent state.
   * Removes all conversation history, pending approvals, and interrupted state.
   */
  clearHistory(): void {
    this._history = [];
    this._pendingApprovals.clear();
    this._interruptedState = null;
    // Reset token usage
    this._tokenUsage = { inputTokens: 0, outputTokens: 0 };
    this._tokenUsageChanged.emit(this._tokenUsage);
  }

  /**
   * Stops the current streaming response by aborting the request.
   */
  stopStreaming(): void {
    this._controller?.abort();
  }

  /**
   * Generates AI response to user message using the agent.
   * Handles the complete execution cycle including tool calls and approvals.
   * @param message The user message to respond to (may include processed attachment content)
   */
  async generateResponse(message: string): Promise<void> {
    this._controller = new AbortController();

    try {
      // Ensure we have an agent
      if (!this._agent) {
        await this.initializeAgent();
      }

      if (!this._agent) {
        throw new Error('Failed to initialize agent');
      }

      // Add user message to history
      this._history.push({
        role: 'user',
        content: message
      });

      // Stream the agent response
      const result = await this._agent.stream({
        messages: this._history,
        abortSignal: this._controller.signal
      });

      await this._processStreamResult(result);

      // Note: history is updated from the stream events
    } catch (error) {
      this._agentEvent.emit({
        type: 'error',
        data: { error: error as Error }
      });
    } finally {
      this._controller = null;
    }
  }

  /**
   * Approves a pending tool call and resumes agent execution.
   *
   * In AI SDK v6, when a tool without an execute function is called,
   * the agent loop stops. To approve and continue:
   * 1. Store the approval decision
   * 2. Emit an event to notify the system to continue execution
   *
   * The actual tool execution happens in the chat-model layer which
   * handles the message flow with addToolOutput and sendMessage.
   *
   * @param interruptionId The approval ID from when the tool was called
   */
  async approveToolCall(interruptionId: string): Promise<void> {
    const approval = this._pendingApprovals.get(interruptionId);
    if (!approval) {
      console.warn('No pending approval found for ID:', interruptionId);
      return;
    }

    // Mark as approved
    approval.approved = true;
    this._pendingApprovals.set(interruptionId, approval);

    // Emit event to notify that approval is complete
    // The chat model will handle continuing the conversation
    this._agentEvent.emit({
      type: 'tool_approval_complete',
      data: {
        interruptionId,
        approved: true
      }
    });
  }

  /**
   * Rejects a pending tool call.
   *
   * @param interruptionId The approval ID from when the tool was called
   */
  async rejectToolCall(interruptionId: string): Promise<void> {
    const approval = this._pendingApprovals.get(interruptionId);
    if (!approval) {
      console.warn('No pending approval found for ID:', interruptionId);
      return;
    }

    // Mark as rejected
    approval.approved = false;
    this._pendingApprovals.set(interruptionId, approval);

    // Emit event to notify that rejection is complete
    this._agentEvent.emit({
      type: 'tool_approval_complete',
      data: {
        interruptionId,
        approved: false
      }
    });
  }

  /**
   * Approves multiple tool calls in a group.
   *
   * @param groupId The group ID containing the tool calls
   * @param interruptionIds Array of approval IDs to approve
   */
  async approveGroupedToolCalls(
    groupId: string,
    interruptionIds: string[]
  ): Promise<void> {
    for (const id of interruptionIds) {
      await this.approveToolCall(id);
    }

    // Emit grouped completion event
    this._agentEvent.emit({
      type: 'tool_approval_group_complete',
      data: {
        groupId,
        approved: true,
        interruptionIds
      }
    });
  }

  /**
   * Rejects multiple tool calls in a group.
   *
   * @param groupId The group ID containing the tool calls
   * @param interruptionIds Array of approval IDs to reject
   */
  async rejectGroupedToolCalls(
    groupId: string,
    interruptionIds: string[]
  ): Promise<void> {
    for (const id of interruptionIds) {
      await this.rejectToolCall(id);
    }

    // Emit grouped completion event
    this._agentEvent.emit({
      type: 'tool_approval_group_complete',
      data: {
        groupId,
        approved: false,
        interruptionIds
      }
    });
  }

  /**
   * Initializes the AI agent with current settings and tools.
   * Sets up the agent with model configuration, tools, and MCP servers.
   */
  initializeAgent = async (
    mcpServers?: BrowserMCPServerStreamableHttp[]
  ): Promise<void> => {
    if (this._isInitializing) {
      return;
    }
    this._isInitializing = true;

    try {
      const config = this._settingsModel.config;
      if (mcpServers !== undefined) {
        this._mcpServers = mcpServers;
      }

      const model = await this._createModel();

      const shouldUseTools =
        config.toolsEnabled &&
        this._selectedToolNames.length > 0 &&
        this._toolRegistry &&
        Object.keys(this._toolRegistry.tools).length > 0 &&
        this._supportsToolCalling();

      const activeProviderConfig = this._settingsModel.getProvider(
        this._activeProvider
      );

      const temperature =
        activeProviderConfig?.parameters?.temperature ?? DEFAULT_TEMPERATURE;
      const maxTokens = activeProviderConfig?.parameters?.maxTokens;

      // Build tools record from selected tool names
      const toolsRecord: Record<string, ITool> = {};
      if (shouldUseTools && this._toolRegistry) {
        for (const name of this._selectedToolNames) {
          const tool = this._toolRegistry.get(name);
          if (tool) {
            toolsRecord[name] = tool;
          }
        }
      }

      // TODO: Integrate MCP servers with AI SDK v6's MCP client
      // For now, we'll just use the selected tools
      this._agent = new ToolLoopAgent({
        model: model,
        instructions: shouldUseTools
          ? this._getEnhancedSystemPrompt(config.systemPrompt || '')
          : config.systemPrompt || 'You are a helpful assistant.',
        tools: toolsRecord,
        temperature,
        maxOutputTokens: maxTokens
      });
    } catch (error) {
      console.warn('Failed to initialize agent:', error);
      this._agent = null;
    } finally {
      this._isInitializing = false;
    }
  };

  /**
   * Processes the result stream from agent execution using AI SDK v6.
   * Handles message streaming, tool calls, and emits appropriate events.
   * @param result The stream result from ToolLoopAgent.stream()
   */
  private async _processStreamResult(result: any): Promise<void> {
    let fullResponse = '';
    let currentMessageId: string | null = null;
    const activeToolCalls = new Map<
      string,
      { toolName: string; input: string }
    >();
    // Store tool invocations for conversation history
    interface IToolInvocation {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
    const toolCalls: IToolInvocation[] = [];

    try {
      // Iterate over the full stream which includes all events
      for await (const chunk of result.fullStream) {
        if (chunk.type === 'text-delta') {
          // Handle text streaming
          if (!currentMessageId) {
            currentMessageId = `msg-${Date.now()}-${Math.random()}`;
            fullResponse = '';
            this._agentEvent.emit({
              type: 'message_start',
              data: { messageId: currentMessageId }
            });
          }

          const textDelta = chunk.text || '';
          fullResponse += textDelta;
          this._agentEvent.emit({
            type: 'message_chunk',
            data: {
              messageId: currentMessageId,
              chunk: textDelta,
              fullContent: fullResponse
            }
          });
        } else if (chunk.type === 'tool-call') {
          // Handle tool call start
          const toolCallId = chunk.toolCallId;
          const toolName = chunk.toolName;
          const toolInput = JSON.stringify(chunk.input, null, 2);

          activeToolCalls.set(toolCallId, { toolName, input: toolInput });

          // Store tool call for history
          toolCalls.push({
            type: 'tool-call',
            toolCallId,
            toolName,
            args: chunk.input
          });

          this._agentEvent.emit({
            type: 'tool_call_start',
            data: {
              callId: toolCallId,
              toolName,
              input: toolInput
            }
          });
        } else if (chunk.type === 'tool-result') {
          // Handle tool call completion - AI SDK v6 uses 'output' property
          const toolCallId = chunk.toolCallId;
          const toolName = chunk.toolName;
          const output = chunk.output;
          const resultText =
            typeof output === 'string'
              ? output
              : JSON.stringify(output, null, 2);

          this._agentEvent.emit({
            type: 'tool_call_complete',
            data: {
              callId: toolCallId,
              toolName,
              output: resultText,
              isError: false
            }
          });

          activeToolCalls.delete(toolCallId);
        } else if (chunk.type === 'tool-error') {
          // Handle tool errors - AI SDK v6 has separate error type
          const toolCallId = chunk.toolCallId;
          const toolName = chunk.toolName;
          const error = chunk.error;
          const errorText =
            typeof error === 'string' ? error : JSON.stringify(error, null, 2);

          this._agentEvent.emit({
            type: 'tool_call_complete',
            data: {
              callId: toolCallId,
              toolName,
              output: errorText,
              isError: true
            }
          });

          activeToolCalls.delete(toolCallId);
        } else if (chunk.type === 'finish') {
          // Handle stream completion
          if (currentMessageId && fullResponse) {
            this._agentEvent.emit({
              type: 'message_complete',
              data: {
                messageId: currentMessageId,
                content: fullResponse
              }
            });
            currentMessageId = null;
          }

          // Update token usage - AI SDK v6 uses totalUsage
          if (chunk.totalUsage) {
            this._tokenUsage.inputTokens += chunk.totalUsage.promptTokens || 0;
            this._tokenUsage.outputTokens +=
              chunk.totalUsage.completionTokens || 0;
            this._tokenUsageChanged.emit(this._tokenUsage);
          }

          // Update history with assistant's response
          if (fullResponse || toolCalls.length > 0) {
            const assistantMessage: CoreMessage = {
              role: 'assistant',
              content: fullResponse || ''
            };

            // Add tool calls to the message if any
            if (toolCalls.length > 0) {
              (
                assistantMessage as { toolInvocations?: IToolInvocation[] }
              ).toolInvocations = toolCalls;
            }

            this._history.push(assistantMessage);
          }
        }
      }
    } catch (error) {
      // Complete current message if there's an error
      if (currentMessageId && fullResponse) {
        this._agentEvent.emit({
          type: 'message_complete',
          data: {
            messageId: currentMessageId,
            content: fullResponse
          }
        });
      }
      throw error;
    }
  }

  /**
   * Checks if the current provider supports tool calling.
   * @returns True if the provider supports tool calling, false otherwise
   */
  private _supportsToolCalling(): boolean {
    const activeProviderConfig = this._settingsModel.getProvider(
      this._activeProvider
    );
    if (!activeProviderConfig || !this._providerRegistry) {
      return false;
    }

    const providerInfo = this._providerRegistry.getProviderInfo(
      activeProviderConfig.provider
    );

    // Default to true if supportsToolCalling is not specified
    return providerInfo?.supportsToolCalling !== false;
  }

  /**
   * Creates a model instance based on current settings.
   * @returns The configured model instance for the agent
   */
  private async _createModel() {
    if (!this._activeProvider) {
      throw new Error('No active provider configured');
    }
    const activeProviderConfig = this._settingsModel.getProvider(
      this._activeProvider
    );
    if (!activeProviderConfig) {
      throw new Error('No active provider configured');
    }
    const provider = activeProviderConfig.provider;
    const model = activeProviderConfig.model;
    const baseURL = activeProviderConfig.baseURL;

    let apiKey: string;
    if (this._secretsManager && this._settingsModel.config.useSecretsManager) {
      apiKey =
        (
          await this._secretsManager.get(
            Private.getToken(),
            SECRETS_NAMESPACE,
            `${provider}:apiKey`
          )
        )?.value ?? '';
    } else {
      apiKey = this._settingsModel.getApiKey(activeProviderConfig.id);
    }

    return createModel(
      {
        provider,
        model,
        apiKey,
        baseURL
      },
      this._providerRegistry
    );
  }

  /**
   * Enhances the base system prompt with tool usage guidelines.
   * @param baseSystemPrompt The base system prompt from settings
   * @returns The enhanced system prompt with tool usage instructions
   */
  private _getEnhancedSystemPrompt(baseSystemPrompt: string): string {
    const progressReportingPrompt = `

IMPORTANT: Follow this message flow pattern for better user experience:

1. FIRST: Explain what you're going to do and your approach
2. THEN: Execute tools (these will show automatically with step numbers)
3. FINALLY: Provide a concise summary of what was accomplished

Example flow:
- "I'll help you create a notebook with example cells. Let me first create the file structure, then add Python and Markdown cells."
- [Tool executions happen with automatic step display]
- "Successfully created your notebook with 3 cells: a title, code example, and visualization cell."

Guidelines:
- Start responses with your plan/approach before tool execution
- Let the system handle tool execution display (don't duplicate details)
- End with a brief summary of accomplishments
- Use natural, conversational tone throughout

COMMAND DISCOVERY:
- When you want to execute JupyterLab commands, ALWAYS use the 'discover_commands' tool first to find available commands and their metadata, with the optional query parameter.
- The query should typically be a single word, e.g., 'terminal', 'notebook', 'cell', 'file', 'edit', 'view', 'run', etc, to find relevant commands.
- If searching with a query does not yield the desired command, try again with a different query or use an empty query to list all commands.
- This ensures you have complete information about command IDs, descriptions, and required arguments before attempting to execute them. Only after discovering the available commands should you use the 'execute_command' tool with the correct command ID and arguments.

TOOL SELECTION GUIDELINES:
- For file operations (create, read, write, modify files and directories): Use dedicated file manipulation tools
- For general JupyterLab UI interactions (opening panels, running commands, navigating interface): Use the general command tool (execute_command)
- Examples of file operations: Creating notebooks, editing code files, managing project structure
- Examples of UI interactions: Opening terminal, switching tabs, running notebook cells, accessing menus
`;

    return baseSystemPrompt + progressReportingPrompt;
  }

  // Private attributes
  private _settingsModel: AISettingsModel;
  private _toolRegistry?: IToolRegistry;
  private _providerRegistry?: IProviderRegistry;
  private _secretsManager?: ISecretsManager;
  private _selectedToolNames: string[];
  private _agent: ToolLoopAgent | null;
  private _history: CoreMessage[];
  // MCP servers are initialized but not yet used - reserved for future MCP integration
  // @ts-expect-error - placeholder for future MCP server integration
  private _mcpServers: BrowserMCPServerStreamableHttp[] = [];
  private _isInitializing: boolean;
  private _controller: AbortController | null;
  private _pendingApprovals: Map<
    string,
    { interruption: any; approved?: boolean; groupId?: string }
  >;
  // Interrupted state is initialized but not yet used - reserved for future approval system
  // @ts-expect-error - placeholder for future tool approval system
  private _interruptedState: any = null;
  private _agentEvent: Signal<this, IAgentEvent>;
  private _tokenUsage: ITokenUsage;
  private _tokenUsageChanged: Signal<this, ITokenUsage>;
  private _activeProvider: string = '';
  private _activeProviderChanged = new Signal<this, string | undefined>(this);
}

namespace Private {
  /**
   * The token to use with the secrets manager, setter and getter.
   */
  let secretsToken: symbol;
  export function setToken(value: symbol): void {
    secretsToken = value;
  }
  export function getToken(): symbol {
    return secretsToken;
  }
}
