import {
  CompletionHandler,
  IInlineCompletionContext,
  IInlineCompletionProvider
} from '@jupyterlab/completer';

import { IBaseCompleter } from './base-completer';
import { IAIProviderRegistry } from './tokens';

/**
 * The generic completion provider to register to the completion provider manager.
 */
export class CompletionProvider implements IInlineCompletionProvider {
  readonly identifier = '@jupyterlite/ai';

  constructor(options: CompletionProvider.IOptions) {
    this._providerRegistry = options.providerRegistry;
    this._requestCompletion = options.requestCompletion;

    this._providerRegistry.providerChanged.connect(() => {
      if (this.completer) {
        this.completer.requestCompletion = this._requestCompletion;
      }
    });
  }

  /**
   * Get the current completer name.
   */
  get name(): string {
    return this._providerRegistry.currentName;
  }

  /**
   * Get the current completer.
   */
  get completer(): IBaseCompleter | null {
    return this._providerRegistry.currentCompleter;
  }

  async fetch(
    request: CompletionHandler.IRequest,
    context: IInlineCompletionContext
  ) {
    return this.completer?.fetch(request, context);
  }

  private _providerRegistry: IAIProviderRegistry;
  private _requestCompletion: () => void;
}

export namespace CompletionProvider {
  export interface IOptions {
    providerRegistry: IAIProviderRegistry;
    requestCompletion: () => void;
  }
}
