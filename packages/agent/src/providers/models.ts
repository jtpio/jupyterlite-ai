/**
 * Configuration options for creating language models.
 */
export interface IModelOptions {
  /**
   * The provider name (e.g., 'openai', 'anthropic', 'generic')
   */
  provider: string;

  /**
   * The specific model name. If not provided, uses provider's default model
   */
  model?: string;

  /**
   * Additional HTTP headers to send with requests
   */
  headers?: Record<string, string>;

  /**
   * Custom base URL for the provider's API endpoint
   */
  baseURL?: string;
}
