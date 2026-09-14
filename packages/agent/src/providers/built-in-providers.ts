import { createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { anthropicProvider as piAnthropic } from '@earendil-works/pi-ai/providers/anthropic';
import { googleProvider as piGoogle } from '@earendil-works/pi-ai/providers/google';
import { mistralProvider as piMistral } from '@earendil-works/pi-ai/providers/mistral';
import { openaiProvider as piOpenai } from '@earendil-works/pi-ai/providers/openai';

import { BUILT_IN_PROVIDER_MODEL_INFO } from './generated-model-info';
import type { IProviderInfo } from '../tokens';

/**
 * Auth of providers whose key comes with every request, or that need none.
 */
const keylessAuth = (name: string) => ({
  apiKey: { name, resolve: async () => ({ auth: {} }) }
});

/**
 * Anthropic provider
 */
export const anthropicProvider: IProviderInfo = {
  id: 'anthropic',
  name: 'Anthropic Claude',
  apiKeyRequirement: 'required',
  defaultModels: [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-opus-4-5',
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-5',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-1',
    'claude-opus-4-1-20250805',
    'claude-opus-4-0',
    'claude-opus-4-20250514',
    'claude-sonnet-4-0',
    'claude-sonnet-4-20250514'
  ],
  modelInfo: BUILT_IN_PROVIDER_MODEL_INFO.anthropic,
  supportsBaseURL: true,
  supportsHeaders: true,
  provider: piAnthropic(),
  api: 'anthropic-messages'
};

/**
 * Google Generative AI provider
 */
export const googleProvider: IProviderInfo = {
  id: 'google',
  name: 'Google Generative AI',
  apiKeyRequirement: 'required',
  defaultModels: [
    'gemini-3.1-pro-preview',
    'gemini-3.1-pro-preview-customtools',
    'gemini-3.1-flash-image-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-3-pro-image-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-image',
    'gemini-2.5-flash-lite',
    'gemini-2.5-computer-use-preview-10-2025',
    'deep-research-pro-preview-12-2025',
    'gemini-pro-latest',
    'gemini-flash-latest',
    'gemini-flash-lite-latest'
  ],
  modelInfo: BUILT_IN_PROVIDER_MODEL_INFO.google,
  supportsBaseURL: true,
  provider: piGoogle(),
  api: 'google-generative-ai'
};

/**
 * Mistral provider
 */
export const mistralProvider: IProviderInfo = {
  id: 'mistral',
  name: 'Mistral AI',
  apiKeyRequirement: 'required',
  defaultModels: [
    'mistral-large-latest',
    'mistral-medium-latest',
    'mistral-medium-2508',
    'mistral-small-latest',
    'mistral-small-2506',
    'ministral-3b-latest',
    'ministral-8b-latest',
    'ministral-14b-latest',
    'magistral-small-latest',
    'magistral-medium-latest',
    'pixtral-large-latest',
    'codestral-latest',
    'devstral-latest'
  ],
  modelInfo: BUILT_IN_PROVIDER_MODEL_INFO.mistral,
  supportsBaseURL: true,
  provider: piMistral(),
  api: 'mistral-conversations'
};

/**
 * OpenAI provider
 */
export const openaiProvider: IProviderInfo = {
  id: 'openai',
  name: 'OpenAI',
  apiKeyRequirement: 'required',
  defaultModels: [
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5.2',
    'gpt-5.2-2025-12-11',
    'gpt-5.2-chat-latest',
    'gpt-5.2-pro',
    'gpt-5.2-pro-2025-12-11',
    'gpt-5.2-codex',
    'gpt-5.1',
    'gpt-5.1-2025-11-13',
    'gpt-5.1-chat-latest',
    'gpt-5',
    'gpt-5-2025-08-07',
    'gpt-5-chat-latest',
    'gpt-5-mini',
    'gpt-5-mini-2025-08-07',
    'gpt-5-nano',
    'gpt-5-nano-2025-08-07',
    'o4-mini',
    'o4-mini-2025-04-16',
    'o3-pro',
    'o3',
    'o3-2025-04-16',
    'o3-mini',
    'o3-mini-2025-01-31',
    'o1',
    'o1-2024-12-17',
    'gpt-4.1',
    'gpt-4.1-2025-04-14',
    'gpt-4.1-mini',
    'gpt-4.1-mini-2025-04-14',
    'gpt-4.1-nano',
    'gpt-4.1-nano-2025-04-14',
    'gpt-4o',
    'gpt-4o-2024-05-13',
    'gpt-4o-2024-08-06',
    'gpt-4o-2024-11-20',
    'gpt-4o-mini',
    'gpt-4o-mini-2024-07-18',
    'gpt-4o-search-preview',
    'gpt-4o-search-preview-2025-03-11',
    'gpt-4o-mini-search-preview',
    'gpt-4o-mini-search-preview-2025-03-11',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-0125'
  ],
  modelInfo: BUILT_IN_PROVIDER_MODEL_INFO.openai,
  supportsBaseURL: true,
  supportsHeaders: true,
  provider: piOpenai(),
  api: 'openai-responses'
};

/**
 * Generic OpenAI-compatible provider
 */
export const genericProvider: IProviderInfo = {
  id: 'generic',
  name: 'Generic (OpenAI-compatible)',
  apiKeyRequirement: 'optional',
  defaultModels: [],
  supportsBaseURL: true,
  supportsHeaders: true,
  supportsToolCalling: true,
  description: 'Uses /chat/completions endpoint',
  baseUrls: [
    {
      url: 'http://localhost:4000',
      description: 'Default for local LiteLLM server'
    },
    {
      url: 'http://localhost:11434/v1',
      description: 'Default for local Ollama server'
    }
  ],
  provider: createProvider({
    id: 'generic',
    name: 'Generic (OpenAI-compatible)',
    auth: keylessAuth('API key'),
    models: [],
    api: openAICompletionsApi()
  }),
  api: 'openai-completions'
};
