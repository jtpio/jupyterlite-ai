import {
  ActiveCellManager,
  buildChatSidebar,
  buildErrorWidget,
  ChatCommandRegistry,
  IActiveCellManager,
  IChatCommandRegistry
} from '@jupyter/chat';
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { Notification, ReactWidget, IThemeManager } from '@jupyterlab/apputils';
import { ICompletionProviderManager } from '@jupyterlab/completer';
import { INotebookTracker } from '@jupyterlab/notebook';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import {
  ISettingConnector,
  ISettingRegistry
} from '@jupyterlab/settingregistry';
import { IFormRendererRegistry } from '@jupyterlab/ui-components';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { ISecretsManager } from 'jupyter-secrets-manager';

import { ChatHandler } from './chat-handler';
import { CompletionProvider } from './completion-provider';
import { defaultProviderPlugins } from './default-providers';
import { AIProviderRegistry } from './provider';
import { aiSettingsRenderer, SettingConnector } from './settings';
import { IAIProviderRegistry } from './tokens';
import { ChatWebLLM } from '@langchain/community/chat_models/webllm';

const chatCommandRegistryPlugin: JupyterFrontEndPlugin<IChatCommandRegistry> = {
  id: '@jupyterlite/ai:autocompletion-registry',
  description: 'Autocompletion registry',
  autoStart: true,
  provides: IChatCommandRegistry,
  activate: () => {
    const registry = new ChatCommandRegistry();
    registry.addProvider(new ChatHandler.ClearCommandProvider());
    return registry;
  }
};

const chatPlugin: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlite/ai:chat',
  description: 'LLM chat extension',
  autoStart: true,
  requires: [IAIProviderRegistry, IRenderMimeRegistry, IChatCommandRegistry],
  optional: [INotebookTracker, ISettingRegistry, IThemeManager],
  activate: async (
    app: JupyterFrontEnd,
    providerRegistry: IAIProviderRegistry,
    rmRegistry: IRenderMimeRegistry,
    chatCommandRegistry: IChatCommandRegistry,
    notebookTracker: INotebookTracker | null,
    settingsRegistry: ISettingRegistry | null,
    themeManager: IThemeManager | null
  ) => {
    let activeCellManager: IActiveCellManager | null = null;
    if (notebookTracker) {
      activeCellManager = new ActiveCellManager({
        tracker: notebookTracker,
        shell: app.shell
      });
    }

    const chatHandler = new ChatHandler({
      providerRegistry,
      activeCellManager
    });

    let sendWithShiftEnter = false;
    let enableCodeToolbar = true;
    let personaName = 'AI';

    function loadSetting(setting: ISettingRegistry.ISettings): void {
      sendWithShiftEnter = setting.get('sendWithShiftEnter')
        .composite as boolean;
      enableCodeToolbar = setting.get('enableCodeToolbar').composite as boolean;
      personaName = setting.get('personaName').composite as string;

      // set the properties
      chatHandler.config = { sendWithShiftEnter, enableCodeToolbar };
      chatHandler.personaName = personaName;
    }

    Promise.all([app.restored, settingsRegistry?.load(chatPlugin.id)])
      .then(([, settings]) => {
        if (!settings) {
          console.warn(
            'The SettingsRegistry is not loaded for the chat extension'
          );
          return;
        }
        loadSetting(settings);
        settings.changed.connect(loadSetting);
      })
      .catch(reason => {
        console.error(
          `Something went wrong when reading the settings.\n${reason}`
        );
      });

    let chatWidget: ReactWidget | null = null;
    try {
      chatWidget = buildChatSidebar({
        model: chatHandler,
        themeManager,
        rmRegistry,
        chatCommandRegistry
      });
      chatWidget.title.caption = 'Jupyterlite AI Chat';
    } catch (e) {
      chatWidget = buildErrorWidget(themeManager);
    }

    app.shell.add(chatWidget as ReactWidget, 'left', { rank: 2000 });

    console.log('Chat extension initialized');
  }
};

const completerPlugin: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlite/ai:completer',
  autoStart: true,
  requires: [IAIProviderRegistry, ICompletionProviderManager],
  activate: (
    app: JupyterFrontEnd,
    providerRegistry: IAIProviderRegistry,
    manager: ICompletionProviderManager
  ): void => {
    const completer = new CompletionProvider({
      providerRegistry,
      requestCompletion: () => app.commands.execute('inline-completer:invoke')
    });
    manager.registerInlineProvider(completer);
  }
};

const providerRegistryPlugin: JupyterFrontEndPlugin<IAIProviderRegistry> = {
  id: '@jupyterlite/ai:provider-registry',
  autoStart: true,
  requires: [IFormRendererRegistry, ISettingRegistry],
  optional: [IRenderMimeRegistry, ISecretsManager, ISettingConnector],
  provides: IAIProviderRegistry,
  activate: (
    app: JupyterFrontEnd,
    editorRegistry: IFormRendererRegistry,
    settingRegistry: ISettingRegistry,
    rmRegistry?: IRenderMimeRegistry,
    secretsManager?: ISecretsManager,
    settingConnector?: ISettingConnector
  ): IAIProviderRegistry => {
    const providerRegistry = new AIProviderRegistry({ secretsManager });

    editorRegistry.addRenderer(
      '@jupyterlite/ai:provider-registry.AIprovider',
      aiSettingsRenderer({
        providerRegistry,
        rmRegistry,
        secretsManager,
        settingConnector
      })
    );

    settingRegistry
      .load(providerRegistryPlugin.id)
      .then(settings => {
        const updateProvider = () => {
          // Update the settings to the AI providers.
          const providerSettings = (settings.get('AIprovider').composite ?? {
            provider: 'None'
          }) as ReadonlyPartialJSONObject;
          providerRegistry.setProvider({
            name: providerSettings.provider as string,
            settings: providerSettings
          });

          const provider = providerRegistry.currentName;
          const chatModel = providerRegistry.currentChatModel;

          // TODO: implement a proper way to handle models that may need to be initialized before being used.
          // Mostly applies to WebLLM and ChromeAI as they may need to download the model in the browser first.
          if (provider === 'WebLLM') {
            const model = chatModel as ChatWebLLM;
            if (model === null || !model.model) {
              return;
            }
            // create a notification
            const notification = Notification.emit(
              'Loading model...',
              'in-progress',
              {
                autoClose: false,
                progress: 0
              }
            );
            try {
              void model.initialize(report => {
                const { progress, text } = report;
                if (progress === 1) {
                  Notification.update({
                    id: notification,
                    progress: 1,
                    message: `Model ${model.model} loaded successfully`,
                    type: 'success',
                    autoClose: 2000
                  });
                  return;
                }
                Notification.update({
                  id: notification,
                  progress: progress / 1,
                  message: text,
                  type: 'in-progress'
                });
              });
            } catch (err) {
              Notification.update({
                id: notification,
                progress: 1,
                message: `Error loading model ${model.model}`,
                type: 'error',
                autoClose: 2000
              });
            }
          }
        };

        settings.changed.connect(() => updateProvider());
        updateProvider();
      })
      .catch(reason => {
        console.error(
          `Failed to load settings for ${providerRegistryPlugin.id}`,
          reason
        );
      });

    return providerRegistry;
  }
};

/**
 * Provides the settings connector as a separate plugin to allow for alternative
 * implementations that may want to fetch settings from a different source or
 * endpoint.
 */
const settingsConnector: JupyterFrontEndPlugin<ISettingConnector> = {
  id: '@jupyterlite/ai:settings-connector',
  description: 'Provides a settings connector which does not save passwords.',
  autoStart: true,
  provides: ISettingConnector,
  activate: (app: JupyterFrontEnd) =>
    new SettingConnector(app.serviceManager.settings)
};

export default [
  providerRegistryPlugin,
  chatCommandRegistryPlugin,
  chatPlugin,
  completerPlugin,
  settingsConnector,
  ...defaultProviderPlugins
];
