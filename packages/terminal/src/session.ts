import type { JupyterFrontEnd } from '@jupyterlab/application';
import type { IExternalRunContext } from '@jupyterlite/cockle';
import {
  type IAgentManagerFactory,
  type IAISettingsModel,
  type IProviderRegistry,
  type ISkillRegistry,
  type IToolRegistry,
  ToolRegistry
} from '@jupyternaut/agent';

import { TerminalApp } from './app';
import { PiAgent } from './pi/agent';
import { PiTuiApp } from './pitui/app';
import {
  type AgentEngine,
  type ITerminalAgent,
  type TerminalUi,
  isAgentEngine,
  isTerminalUi
} from './runtime';
import { createTerminalTools, DRIVE_MOUNTPOINT, ShellRunner } from './tools';
import { Tty } from './tty';

const OPEN_SETTINGS_COMMAND = '@jupyternaut/persona:open-settings';

export interface ISessionOptions {
  app: JupyterFrontEnd;
  agentFactory: IAgentManagerFactory;
  settingsModel: IAISettingsModel;
  providerRegistry?: IProviderRegistry;
  toolRegistry?: IToolRegistry;
  skillRegistry?: ISkillRegistry;
  isDarkMode: () => boolean;
  isFullScreen: () => boolean;
  /**
   * The agent runtime configured in the settings.
   */
  engine: () => AgentEngine;
  /**
   * The user interface configured in the settings.
   */
  ui: () => TerminalUi;
}

function terminalInstructions(cwd: string): string {
  return `TERMINAL SESSION:
You are running as the \`jupyternaut\` command inside a terminal of JupyterLite, an in-browser shell called cockle. Everything runs in the browser: there is no server, no Python or Node in the shell, and no network access except through the tools that provide it.
- The working directory is ${cwd}. The JupyterLite files are mounted at ${DRIVE_MOUNTPOINT}; paths outside it are internal to the shell.
- Use the terminal tools first: \`shell\` to run commands, \`list_files\`, \`read_file\`, \`write_file\` and \`edit_file\` for files. Use absolute paths under ${DRIVE_MOUNTPOINT} or paths relative to the working directory.
- The JupyterLab commands (\`discover_commands\` then \`execute_command\`) are still available, for example to open a file in the editor or to run code in a kernel.
- Your answers are rendered as markdown in the terminal: keep them concise, use fenced code blocks for code, and do not rely on rich (MIME) outputs, images or notebook rendering.`;
}

/**
 * State kept for one terminal across invocations of the command: the agent
 * (and its history), the headless shell and the approved tools.
 */
export class TerminalSession {
  constructor(
    shellId: string,
    cwd: string,
    engine: AgentEngine,
    options: ISessionOptions
  ) {
    this.shellId = shellId;
    this.initialCwd = cwd;
    this.engine = engine;
    this._cwd = cwd;
    this._options = options;
    this.shell = new ShellRunner(options.app.commands, cwd);
    this.tools = new ToolRegistry();
    this.syncTools();
    const instructions = terminalInstructions(cwd);
    this.agent =
      engine === 'pi'
        ? new PiAgent({
            settingsModel: options.settingsModel,
            providerRegistry: options.providerRegistry,
            skillRegistry: options.skillRegistry,
            toolRegistry: this.tools,
            createModel: providerId =>
              options.agentFactory.createModel(providerId),
            additionalInstructions: instructions
          })
        : options.agentFactory.createAgent({
            settingsModel: options.settingsModel,
            providerRegistry: options.providerRegistry,
            toolRegistry: this.tools,
            additionalInstructions: instructions
          });
  }

  readonly shellId: string;
  readonly initialCwd: string;
  readonly engine: AgentEngine;
  readonly agent: ITerminalAgent;
  readonly shell: ShellRunner;
  readonly tools: ToolRegistry;
  /**
   * Tools the user allowed for the rest of the session.
   */
  readonly allowedTools = new Set<string>();

  get cwd(): string {
    return this._cwd;
  }

  async setCwd(cwd: string): Promise<void> {
    this._cwd = cwd;
    await this.shell.setCwd(cwd);
  }

  /**
   * Refresh the agent tools from the shared registry plus the terminal tools.
   */
  syncTools(): void {
    for (const name of Object.keys(this.tools.tools)) {
      this.tools.remove(name);
    }
    const shared = this._options.toolRegistry?.tools ?? {};
    for (const [name, tool] of Object.entries(shared)) {
      this.tools.add(name, tool);
    }
    const terminalTools = createTerminalTools({
      contents: this._options.app.serviceManager.contents,
      shell: this.shell,
      cwd: () => this._cwd,
      needsApproval: name => !this.allowedTools.has(name)
    });
    for (const [name, tool] of Object.entries(terminalTools)) {
      this.tools.add(name, tool);
    }
  }

  dispose(): void {
    if (this.agent instanceof PiAgent) {
      this.agent.dispose();
    } else {
      this.agent.stopStreaming();
    }
    void this.shell.dispose();
  }

  private _cwd: string;
  private _options: ISessionOptions;
}

/**
 * The value of a `--flag <value>` or `--flag=<value>` argument.
 */
function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0
    ? args[index + 1]
    : args.find(arg => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);
}

/**
 * The engine requested on the command line: `--engine <name>` or `--pi`.
 */
function parseEngine(args: string[]): AgentEngine | undefined {
  if (args.includes('--pi')) {
    return 'pi';
  }
  const value = flagValue(args, '--engine');
  return isAgentEngine(value) ? value : undefined;
}

/**
 * The user interface requested on the command line: `--ui <name>`.
 */
function parseUi(args: string[]): TerminalUi | undefined {
  const value = flagValue(args, '--ui');
  return isTerminalUi(value) ? value : undefined;
}

/**
 * Maps terminals (cockle shell ids) to their sessions and runs the command.
 */
export class TerminalSessionManager {
  constructor(options: ISessionOptions) {
    this._options = options;
  }

  async run(context: IExternalRunContext): Promise<number> {
    const cwd = context.environment.get('PWD') ?? DRIVE_MOUNTPOINT;
    const engine = parseEngine(context.args) ?? this._options.engine();
    let session = this._sessions.get(context.shellId);
    if (session && session.engine !== engine) {
      // A different runtime starts a new conversation.
      this.dispose(context.shellId);
      session = undefined;
    }
    if (session) {
      await session.setCwd(cwd);
      session.syncTools();
      session.agent.setSelectedTools(Object.keys(session.tools.tools));
    } else {
      session = new TerminalSession(
        context.shellId,
        cwd,
        engine,
        this._options
      );
      this._sessions.set(context.shellId, session);
    }
    try {
      await session.shell.start();
    } catch (error) {
      console.warn('Jupyternaut: cannot start the headless shell', error);
    }
    const { app, settingsModel, providerRegistry, isDarkMode, isFullScreen } =
      this._options;
    const options = {
      tty: new Tty(context),
      session,
      settingsModel,
      providerRegistry,
      isDarkMode,
      openSettings: () => app.commands.execute(OPEN_SETTINGS_COMMAND)
    };
    const ui = parseUi(context.args) ?? this._options.ui();
    if (ui === 'pi') {
      return new PiTuiApp(options).run();
    }
    const terminalApp = new TerminalApp({
      ...options,
      fullScreen: context.args.includes('--inline')
        ? false
        : context.args.includes('--fullscreen') || isFullScreen()
    });
    return terminalApp.run();
  }

  dispose(shellId: string): void {
    const session = this._sessions.get(shellId);
    if (session) {
      this._sessions.delete(shellId);
      session.dispose();
    }
  }

  private _options: ISessionOptions;
  private _sessions = new Map<string, TerminalSession>();
}
