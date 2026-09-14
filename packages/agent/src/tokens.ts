import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { VDomRenderer } from '@jupyterlab/apputils';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type {
  Api,
  ImageContent,
  Model,
  Models,
  Provider,
  TextContent
} from '@earendil-works/pi-ai';
import type { TSchema } from '@earendil-works/pi-ai';
import { Token } from '@lumino/coreutils';
import type { IDisposable } from '@lumino/disposable';
import { ISignal } from '@lumino/signaling';
import { ISecretsManager } from 'jupyter-secrets-manager';

import type { IModelOptions } from './providers/models';
import type {
  ISkillDefinition,
  ISkillRegistration,
  ISkillResourceResult,
  ISkillSummary
} from './skills';

/* THE TOOL REGISTRY */
/**
 * The content of a user message: text, or text and images.
 */
export type UserContent = string | (TextContent | ImageContent)[];

/**
 * A tool of the agent: a pi tool, plus whether it asks for a confirmation
 * before it runs.
 */
export interface ITool<T extends TSchema = TSchema> extends AgentTool<T> {
  needsApproval?: boolean | ((args: unknown) => boolean | Promise<boolean>);
}

/**
 * A map containing tools.
 */
export type ToolMap = Record<string, ITool>;

/**
 * Interface for a named tool (tool with a name identifier)
 */
export interface INamedTool {
  /**
   * The unique name of the tool
   */
  name: string;
  /**
   * The tool instance
   */
  tool: ITool;
}

/**
 * The tool registry interface for managing AI tools
 */
export interface IToolRegistry {
  /**
   * The registered tools as a record (name -> tool mapping).
   */
  readonly tools: Record<string, ITool>;

  /**
   * The registered named tools array.
   */
  readonly namedTools: INamedTool[];

  /**
   * A signal triggered when the tools have changed.
   */
  readonly toolsChanged: ISignal<IToolRegistry, void>;

  /**
   * Add a new tool to the registry.
   */
  add(name: string, tool: ITool): void;

  /**
   * Get a tool for a given name.
   * Return null if the name is not provided or if there is no registered tool with the
   * given name.
   */
  get(name: string | null): ITool | null;

  /**
   * Remove a tool from the registry by name.
   */
  remove(name: string): boolean;
}

/**
 * The tool registry token.
 */
export const IToolRegistry = new Token<IToolRegistry>(
  '@jupyternaut/agent:IToolRegistry',
  'Tool registry for AI agent functionality'
);

/* THE SKILL REGISTRY */

/**
 * Registry for skills available to the AI agent.
 */
export interface ISkillRegistry {
  /**
   * Signal emitted when skills change.
   */
  readonly skillsChanged: ISignal<ISkillRegistry, void>;

  /**
   * Register a single skill.
   */
  registerSkill(skill: ISkillRegistration): IDisposable;

  /**
   * List all skills with summary info, optionally filtered by a search query.
   */
  listSkills(query?: string): ISkillSummary[];

  /**
   * Get a full skill definition by name.
   */
  getSkill(name: string): ISkillDefinition | null;

  /**
   * Load a resource for a skill.
   */
  getSkillResource(
    name: string,
    resource: string
  ): Promise<ISkillResourceResult>;
}

/**
 * The skill registry token.
 */
export const ISkillRegistry = new Token<ISkillRegistry>(
  '@jupyternaut/agent:ISkillRegistry',
  'Skill registry for AI agent functionality'
);

/* THE LLM PROVIDER REGISTRY */

/**
 * Provider information
 */
export interface IProviderModelInfo {
  /**
   * Default context window for the model in tokens.
   */
  contextWindow?: number;
  /**
   * Whether the model supports image inputs.
   */
  supportsImages?: boolean;
  /**
   * Whether the model supports PDF inputs.
   */
  supportsPdf?: boolean;
  /**
   * Whether the model supports audio inputs.
   */
  supportsAudio?: boolean;
}

export interface IProviderInfo {
  /**
   * Unique identifier for the provider
   */
  id: string;

  /**
   * Display name for the provider
   */
  name: string;

  /**
   * API key requirement policy for this provider
   * - 'required': API key is mandatory
   * - 'optional': API key is optional
   * - 'none': API key is not needed and field will be hidden
   */
  apiKeyRequirement: 'required' | 'optional' | 'none';

  /**
   * Default model names for this provider
   */
  defaultModels: string[];

  /**
   * Optional per-model metadata keyed by model ID.
   */
  modelInfo?: Record<string, IProviderModelInfo>;

  /**
   * Whether this provider supports custom base URLs
   */
  supportsBaseURL?: boolean;

  /**
   * Whether this provider supports custom headers
   */
  supportsHeaders?: boolean;

  /**
   * Whether this provider supports tool calling
   */
  supportsToolCalling?: boolean;

  /**
   * Optional description shown in the UI
   */
  description?: string;

  /**
   * Optional URL suggestions
   */
  baseUrls?: { url: string; description?: string }[];

  /**
   * The pi-ai provider: its API adapters, model catalog and auth.
   */
  provider: Provider;

  /**
   * The API of the models that are not in the catalog of the provider.
   */
  api: Api;
}

/**
 * Registry for AI providers
 */
export interface IProviderRegistry {
  /**
   * The registered providers as a record (id -> info mapping).
   */
  readonly providers: Record<string, IProviderInfo>;

  /**
   * A signal triggered when providers have changed.
   */
  readonly providersChanged: ISignal<IProviderRegistry, void>;

  /**
   * The pi-ai models collection with every registered provider.
   */
  readonly models: Models;

  /**
   * Register a new provider.
   */
  registerProvider(info: IProviderInfo): void;

  /**
   * Get provider info by id.
   */
  getProviderInfo(id: string): IProviderInfo | null;

  /**
   * The pi-ai model of a provider configuration, or null when the provider
   * is unknown.
   */
  createModel(options: IModelOptions): Model<Api> | null;

  /**
   * Get all available provider IDs.
   */
  getAvailableProviders(): string[];
}

/**
 * Token for the provider registry.
 */
export const IProviderRegistry = new Token<IProviderRegistry>(
  '@jupyternaut/agent:IProviderRegistry',
  'Registry for AI providers'
);

/* THE SETTINGS MODEL */

export interface IProviderParameters {
  temperature?: number;
  maxOutputTokens?: number;
  maxTurns?: number;
  contextWindow?: number;
  supportsFillInMiddle?: boolean;
  useFilterText?: boolean;
}

export interface IProviderConfig {
  id: string;
  name: string;
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  parameters?: IProviderParameters;
  [key: string]: any; // Index signature for settings compatibility
}

export interface IAIConfig {
  // Whether to use the secrets manager
  useSecretsManager: boolean;
  // List of configured providers
  providers: IProviderConfig[];
  // Active provider IDs for different use cases
  defaultProvider: string; // Default provider for chat
  activeCompleterProvider?: string; // Provider for completions (if different)
  // When true, use the same provider for chat and completions
  useSameProviderForChatAndCompleter: boolean;
  // Global settings
  contextAwareness: boolean;
  codeExecution: boolean;
  systemPrompt: string;
  completionSystemPrompt: string;
  toolsEnabled: boolean;
  // Commands that require approval before execution
  commandsRequiringApproval: string[];
  // Commands whose execute_command outputs may auto-render MIME bundles in chat
  commandsAutoRenderMimeBundles: string[];
  // MIME types that are trusted when auto-rendering execute_command outputs
  trustedMimeTypesForAutoRender: string[];
  // Diff display settings
  showCellDiff: boolean;
  showFileDiff: boolean;
  diffDisplayMode: 'split' | 'unified';
  // Paths to directories containing agent skills
  skillsPaths: string[];
}

/**
 * Interface for the AI settings model.
 * Extends VDomRenderer.IModel to support state change notifications.
 */
export interface IAISettingsModel extends VDomRenderer.IModel {
  readonly config: IAIConfig;
  updateConfig(updates: Partial<IAIConfig>): Promise<void>;
  readonly providers: IProviderConfig[];
  getProvider(id: string): IProviderConfig | undefined;
  getDefaultProvider(): IProviderConfig | undefined;
  getCompleterProvider(): IProviderConfig | undefined;
  addProvider(providerConfig: Omit<IProviderConfig, 'id'>): Promise<string>;
  removeProvider(id: string): Promise<void>;
  updateProvider(id: string, updates: Partial<IProviderConfig>): Promise<void>;
  setActiveProvider(id: string): Promise<void>;
  setActiveCompleterProvider(id: string | undefined): Promise<void>;
  /**
   * Get the API key saved in the settings file for a given provider.
   *
   * @param id - the id of the provider.
   */
  getApiKey(id: string): string;
}

/**
 * Token for the AI settings model.
 */
export const IAISettingsModel = new Token<IAISettingsModel>(
  '@jupyternaut/agent:IAISettingsModel'
);

/* THE AGENT MANAGER */

/**
 * A message of a restored conversation.
 */
export interface IHistoryMessage {
  role: 'user' | 'assistant';
  content: UserContent;
}

/**
 * A namespace for agent manager.
 */
export namespace IAgentManager {
  /**
   * Configuration options for the AgentManager
   */
  export interface IOptions {
    /**
     * AI settings model for configuration
     */
    settingsModel: IAISettingsModel;

    /**
     * Optional tool registry for managing available tools
     */
    toolRegistry?: IToolRegistry;

    /**
     * The provider registry, for the models; the factory fills it in.
     */
    providerRegistry?: IProviderRegistry;

    /**
     * The skill registry for discovering skills.
     */
    skillRegistry?: ISkillRegistry;

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

    /**
     * Optional render mime registry for discovering supported MIME types.
     */
    renderMimeRegistry?: IRenderMimeRegistry;

    /**
     * Extra instructions appended to the system prompt of this agent.
     */
    additionalInstructions?: string;
  }

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
      title?: string;
      input: string;
    };
    tool_call_complete: {
      callId: string;
      toolName: string;
      outputData: unknown;
      isError: boolean;
    };
    tool_approval_request: {
      toolCallId: string;
      toolName: string;
      args: unknown;
    };
    tool_approval_resolved: {
      toolCallId: string;
      approved: boolean;
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
}

export interface IAgentManager {
  /**
   * The active provider for this agent.
   */
  activeProvider: string;
  /**
   * Signal emitted when agent events occur
   */
  readonly agentEvent: ISignal<IAgentManager, IAgentManager.IAgentEvent>;
  /**
   * Signal emitted when the active provider has changed.
   */
  readonly activeProviderChanged: ISignal<IAgentManager, string | undefined>;
  /**
   * Gets the current token usage statistics.
   */
  readonly tokenUsage: ITokenUsage;
  /**
   * Signal emitted when token usage statistics change.
   */
  readonly tokenUsageChanged: ISignal<IAgentManager, ITokenUsage>;
  /**
   * Refresh the skills snapshot and rebuild the agent if resources are ready.
   */
  refreshSkills(): void;
  /**
   * Sets the selected tools by name and reinitializes the agent.
   * @param toolNames Array of tool names to select
   */
  setSelectedTools(toolNames: string[]): void;
  /**
   * Gets the currently selected tools as a record.
   * @returns Record of selected tools
   */
  readonly selectedAgentTools: ToolMap;
  /**
   * Checks if the current configuration is valid for agent operations.
   * Uses the provider registry to determine if an API key is required.
   * @returns True if the configuration is valid, false otherwise
   */
  hasValidConfig(): boolean;
  /**
   * Clears conversation history and resets agent state.
   */
  clearHistory(): Promise<void>;
  /**
   * Replace the conversation history.
   */
  setHistory(messages: IHistoryMessage[]): void;
  /**
   * Stops the current streaming response by aborting the request.
   */
  stopStreaming(): void;
  /**
   * Approves a pending tool call.
   * @param toolCallId The tool call ID to approve
   * @param reason Optional reason for approval
   */
  approveToolCall(toolCallId: string, reason?: string): void;
  /**
   * Rejects a pending tool call.
   * @param toolCallId The tool call ID to reject
   * @param reason Optional reason for rejection
   */
  rejectToolCall(toolCallId: string, reason?: string): void;
  /**
   * Generates AI response to user message using the agent.
   * Handles the complete execution cycle including tool calls.
   * @param message The user message to respond to (may include processed attachment content)
   */
  generateResponse(message: UserContent): Promise<void>;
  /**
   * Request a one-off text response, which won't be added to history.
   */
  textResponse(prompt: string, systemPrompt?: string): Promise<string>;
  /**
   * Initializes the AI agent with current settings and tools.
   * Sets up the agent with model configuration, tools, and MCP tools.
   */
  initializeAgent(mcpTools?: ToolMap): Promise<void>;
}

/**
 * Token for the agent manager.
 */
export const IAgentManager = new Token<IAgentManager>(
  '@jupyternaut/agent:IAgentManager'
);

/* The AGENT MANAGER FACTORY */
/**
 * The interface for a agent manager factory.
 */
export interface IAgentManagerFactory {
  /**
   * Create a new agent.
   */
  createAgent(options: IAgentManager.IOptions): IAgentManager;
  /**
   * Signal emitted when MCP connection status changes
   */
  readonly mcpConnectionChanged: ISignal<IAgentManagerFactory, boolean>;
  /**
   * Checks whether a specific MCP server is connected.
   * @param serverName The name of the MCP server to check
   * @returns True if the server is connected, false otherwise
   */
  isMCPServerConnected(serverName: string): boolean;
  /**
   * Gets the MCP tools from connected servers
   */
  getMCPTools(): Promise<ToolMap>;
}

/*
 * Token for the agent manager factory.
 */
export const IAgentManagerFactory = new Token<IAgentManagerFactory>(
  '@jupyternaut/agent:IAgentManagerFactory'
);

/* THE DIFF MANAGER */

/**
 * Parameters for showing cell diff
 */
export interface IShowCellDiffParams {
  /**
   * Original cell content
   */
  original: string;
  /**
   * Modified cell content
   */
  modified: string;
  /**
   * Optional cell ID
   */
  cellId?: string;
  /**
   * Whether to show action buttons in the diff view
   */
  showActionButtons?: boolean;
  /**
   * Whether to open the diff view
   */
  openDiff?: boolean;
  /**
   * Optional path to the notebook
   */
  notebookPath?: string;
}

/**
 * Parameters for showing file diff
 */
export interface IShowFileDiffParams {
  /**
   * Original file content
   */
  original: string;
  /**
   * Modified file content
   */
  modified: string;
  /**
   * Optional file path
   */
  filePath?: string;
  /**
   * Whether to show action buttons in the diff view
   */
  showActionButtons?: boolean;
}

/**
 * Interface for managing diff operations
 */
export interface IDiffManager {
  /**
   * Show diff between original and modified cell content
   */
  showCellDiff(params: IShowCellDiffParams): Promise<void>;
  /**
   * Show diff between original and modified file content
   */
  showFileDiff(params: IShowFileDiffParams): Promise<void>;
}

/**
 * Token for the diff manager.
 */
export const IDiffManager = new Token<IDiffManager>(
  '@jupyternaut/agent:IDiffManager'
);

/**
 * Interface for token usage statistics from AI model interactions
 */
export interface ITokenUsage {
  /**
   * Number of input tokens consumed (prompt tokens)
   */
  inputTokens: number;

  /**
   * Number of output tokens generated (completion tokens)
   */
  outputTokens: number;

  /**
   * Estimated prompt tokens used by the most recent model request.
   * This is based on the final step of the latest request.
   */
  lastRequestInputTokens?: number;

  /**
   * Configured context window size for the active provider/model.
   */
  contextWindow?: number;
}

/**
 * The string that replaces a secret key in settings.
 */
export const SECRETS_NAMESPACE = '@jupyternaut/agent:providers';
export const SECRETS_REPLACEMENT = '***';

/**
 * Internal interface for AI provider secret access within the shared namespace.
 */
export interface IAISecretsAccess {
  /**
   * Whether secrets access is currently available.
   */
  readonly isAvailable: boolean;

  /**
   * Get a secret value by ID.
   */
  get(id: string): Promise<string | undefined>;

  /**
   * Set a secret value by ID.
   */
  set(id: string, value: string): Promise<void>;

  /**
   * Attach an input field to a secret ID.
   */
  attach(
    id: string,
    input: HTMLInputElement,
    callback?: (value: string) => void
  ): Promise<void>;
}
