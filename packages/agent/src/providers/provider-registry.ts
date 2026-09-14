import {
  type Api,
  createModels,
  type Model,
  type Models,
  type MutableModels
} from '@earendil-works/pi-ai';
import { ISignal, Signal } from '@lumino/signaling';

import type { IModelOptions } from './models';
import type { IProviderInfo, IProviderRegistry } from '../tokens';

const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 16384;

/**
 * Implementation of the provider registry
 */
export class ProviderRegistry implements IProviderRegistry {
  /**
   * Get a copy of all registered providers
   */
  get providers(): Record<string, IProviderInfo> {
    return { ...this._providers };
  }

  /**
   * Signal emitted when providers are added or removed
   */
  get providersChanged(): ISignal<IProviderRegistry, void> {
    return this._providersChanged;
  }

  get models(): Models {
    return this._models;
  }

  /**
   * Register a new provider
   * @param info Provider information with the pi-ai provider
   */
  registerProvider(info: IProviderInfo): void {
    if (info.id in this._providers) {
      throw new Error(`Provider with id "${info.id}" is already registered`);
    }
    this._providers[info.id] = { ...info };
    this._models.setProvider(info.provider);
    this._providersChanged.emit();
  }

  /**
   * Get provider information by ID
   * @param id Provider ID
   * @returns Provider info or null if not found
   */
  getProviderInfo(id: string): IProviderInfo | null {
    return this._providers[id] || null;
  }

  /**
   * The pi-ai model of a configuration: the catalog entry of the provider
   * when there is one, a plain description otherwise.
   */
  createModel(options: IModelOptions): Model<Api> | null {
    const info = this._providers[options.provider];
    if (!info) {
      return null;
    }
    const id = options.model || info.defaultModels[0] || '';
    const known = info.provider.getModels().find(model => model.id === id);
    const model: Model<Api> = known
      ? { ...known }
      : {
          id,
          name: id,
          api: info.api,
          provider: info.id,
          baseUrl: info.provider.baseUrl ?? '',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow:
            info.modelInfo?.[id]?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
          maxTokens: DEFAULT_MAX_TOKENS
        };
    if (options.baseURL) {
      model.baseUrl = options.baseURL;
    }
    if (options.headers) {
      model.headers = { ...model.headers, ...options.headers };
    }
    return model;
  }

  /**
   * Get list of all available provider IDs
   * @returns Array of provider IDs
   */
  getAvailableProviders(): string[] {
    return Object.keys(this._providers);
  }

  private _providers: Record<string, IProviderInfo> = {};
  private _providersChanged = new Signal<IProviderRegistry, void>(this);
  private _models: MutableModels = createModels();
}
