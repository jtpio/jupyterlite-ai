import { ChatAnthropic } from '@langchain/anthropic';
import { ChatWebLLM } from '@langchain/community/chat_models/webllm';
import { ChromeAI } from '@langchain/community/experimental/llms/chrome_ai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatMistralAI } from '@langchain/mistralai';
import { ChatOpenAI } from '@langchain/openai';

import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { AnthropicCompleter } from './anthropic-completer';
import { IBaseCompleter } from './base-completer';
import { ChromeCompleter } from './chrome-completer';
import { OpenAICompleter } from './openai-completer';
import { CodestralCompleter } from './codestral-completer';
// import { WebLLMCompleter } from './webllm-completer';

import anthropic from '../_provider-settings/anthropic.json';
import chromeAI from '../_provider-settings/chromeAI.json';
import mistralAI from '../_provider-settings/mistralAI.json';
import openAI from '../_provider-settings/openAI.json';
import webLLM from '../_provider-settings/webLLM.json';

/**
 * Get an LLM completer from the name.
 */
export function getCompleter(
  name: string,
  settings: ReadonlyPartialJSONObject
): IBaseCompleter | null {
  if (name === 'MistralAI') {
    return new CodestralCompleter({ settings });
  } else if (name === 'Anthropic') {
    return new AnthropicCompleter({ settings });
  } else if (name === 'ChromeAI') {
    return new ChromeCompleter({ settings });
  } else if (name === 'OpenAI') {
    return new OpenAICompleter({ settings });
  }
  // } else if (name === 'WebLLM') {
  //   return new WebLLMCompleter({ settings });
  // }
  return null;
}

/**
 * Get an LLM chat model from the name.
 */
export function getChatModel(
  name: string,
  settings: ReadonlyPartialJSONObject
): BaseChatModel | null {
  if (name === 'MistralAI') {
    return new ChatMistralAI({ ...settings });
  } else if (name === 'Anthropic') {
    return new ChatAnthropic({ ...settings });
  } else if (name === 'ChromeAI') {
    // TODO: fix
    // @ts-expect-error: missing properties
    return new ChromeAI({ ...settings });
  } else if (name === 'OpenAI') {
    return new ChatOpenAI({ ...settings });
  } else if (name === 'WebLLM') {
    // @ts-expect-error: missing properties
    return new ChatWebLLM({ ...settings });
  }
  return null;
}

/**
 * Get the error message from provider.
 */
export function getErrorMessage(name: string, error: any): string {
  if (name === 'MistralAI') {
    return error.message;
  } else if (name === 'Anthropic') {
    return error.error.error.message;
  } else if (name === 'ChromeAI') {
    return error.message;
  } else if (name === 'OpenAI') {
    return error.message;
  } else if (name === 'WebLLM') {
    return error.message;
  }
  return 'Unknown provider';
}

/*
 * Get an LLM completer from the name.
 */
export function getSettings(name: string): any {
  if (name === 'MistralAI') {
    return mistralAI.properties;
  } else if (name === 'Anthropic') {
    return anthropic.properties;
  } else if (name === 'ChromeAI') {
    return chromeAI.properties;
  } else if (name === 'OpenAI') {
    return openAI.properties;
  } else if (name === 'WebLLM') {
    return webLLM.properties;
  }

  return null;
}
