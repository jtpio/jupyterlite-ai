import type {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import type { IExternalRunContext } from '@jupyterlite/cockle';
import { ILiteTerminalAPIClient } from '@jupyterlite/terminal';
import {
  IAgentManagerFactory,
  IAISettingsModel,
  IProviderRegistry,
  IToolRegistry
} from '@jupyternaut/agent';

import { TerminalSessionManager } from './session';

const COMMAND_NAME = 'jupyternaut';
const COMMAND_ALIAS = 'ai';
const TERMINAL_SETTINGS = '@jupyterlab/terminal-extension:plugin';
const PLUGIN_ID = '@jupyternaut/terminal:plugin';

/**
 * Whether the terminal renders on a dark background, from the terminal theme
 * setting and, when it inherits, the JupyterLab theme.
 */
function createDarkModeDetector(
  settingRegistry: ISettingRegistry | null
): () => boolean {
  let terminalTheme = 'inherit';
  settingRegistry
    ?.load(TERMINAL_SETTINGS)
    .then(settings => {
      terminalTheme = String(settings.composite.theme ?? 'inherit');
      settings.changed.connect(() => {
        terminalTheme = String(settings.composite.theme ?? 'inherit');
      });
    })
    .catch(() => undefined);
  return () => {
    if (terminalTheme === 'dark' || terminalTheme === 'light') {
      return terminalTheme === 'dark';
    }
    return document.body.dataset.jpThemeLight === 'false';
  };
}

/**
 * Whether the command runs in full screen mode, from this plugin's settings.
 */
function createFullScreenDetector(
  settingRegistry: ISettingRegistry | null
): () => boolean {
  let fullScreen = true;
  settingRegistry
    ?.load(PLUGIN_ID)
    .then(settings => {
      fullScreen = settings.composite.fullScreen !== false;
      settings.changed.connect(() => {
        fullScreen = settings.composite.fullScreen !== false;
      });
    })
    .catch(() => undefined);
  return () => fullScreen;
}

/**
 * Register the `jupyternaut` command in JupyterLite terminals.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  description:
    'Jupyternaut coding agent as a command in the JupyterLite terminal',
  autoStart: true,
  requires: [ILiteTerminalAPIClient, IAgentManagerFactory, IAISettingsModel],
  optional: [IProviderRegistry, IToolRegistry, ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    client: ILiteTerminalAPIClient,
    agentFactory: IAgentManagerFactory,
    settingsModel: IAISettingsModel,
    providerRegistry: IProviderRegistry | null,
    toolRegistry: IToolRegistry | null,
    settingRegistry: ISettingRegistry | null
  ): void => {
    const sessions = new TerminalSessionManager({
      app,
      agentFactory,
      settingsModel,
      providerRegistry: providerRegistry ?? undefined,
      toolRegistry: toolRegistry ?? undefined,
      isDarkMode: createDarkModeDetector(settingRegistry),
      isFullScreen: createFullScreenDetector(settingRegistry)
    });
    client.registerExternalCommand({
      name: COMMAND_NAME,
      command: (context: IExternalRunContext) => sessions.run(context)
    });
    client.registerAlias(COMMAND_ALIAS, COMMAND_NAME);
    client.terminalDisposed.connect((sender, shellId) =>
      sessions.dispose(shellId)
    );
  }
};

export default plugin;
