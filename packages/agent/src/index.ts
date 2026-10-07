// Agent package public API

export { AgentManagerFactory } from './agent';
export { AI_AVATAR, jupyternautIcon } from './icons';
export {
  IAgentManager,
  IAgentManagerFactory,
  IAISettingsModel,
  IDiffManager,
  IProviderRegistry,
  ISkillRegistry,
  IToolRegistry,
  SECRETS_NAMESPACE,
  SECRETS_REPLACEMENT
} from './tokens';
export type {
  IAIConfig,
  IAISecretsAccess,
  IConnectAccountOptions,
  INamedTool,
  IProviderConfig,
  IProviderFactory,
  IProviderInfo,
  IProviderModelInfo,
  IProviderParameters,
  IProviderToolCapabilities,
  IShowCellDiffParams,
  IShowFileDiffParams,
  ITokenUsage,
  ITool,
  ToolMap
} from './tokens';
export { getAppAttribution } from './providers/app-attribution';
export { ProviderRegistry } from './providers/provider-registry';
export {
  anthropicProvider,
  genericProvider,
  googleProvider,
  mistralProvider,
  openaiProvider,
  openrouterProvider
} from './providers/built-in-providers';
export {
  getEffectiveContextWindow,
  getProviderModelInfo,
  modelSupportsAudio,
  modelSupportsImages,
  modelSupportsPdf
} from './providers/model-info';
export { createCompletionModel, type IModelOptions } from './providers/models';
export { createProviderTools } from './providers/provider-tools';
export { ToolRegistry } from './tools/tool-registry';
export {
  createDiscoverCommandsTool,
  createExecuteCommandTool
} from './tools/commands';
export { createDiscoverSkillsTool, createLoadSkillTool } from './tools/skills';
export { createBrowserFetchTool } from './tools/web';
export {
  loadSkillsFromPaths,
  SkillRegistry,
  type ISkillDefinition,
  type ISkillRegistration,
  type ISkillResourceResult,
  type ISkillSummary
} from './skills';
