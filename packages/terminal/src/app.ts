import {
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
  type Component,
  Container,
  Editor,
  isViewportTUI,
  Loader,
  Markdown,
  matchesKey,
  ScrollView,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
  type TUI,
  TuiAltScreen,
  type TuiInputListenerResult,
  TuiMainScreen,
  truncateToWidth,
  visibleWidth,
  VStack
} from '@earendil-works/pi-tui';
import type {
  IAgentManager,
  IAISettingsModel,
  IProviderRegistry
} from '@jupyternaut/agent';
import { PromiseDelegate } from '@lumino/coreutils';

import type { TerminalSession } from './session';
import { CockleTerminal } from './terminal';
import {
  accent,
  bold,
  dim,
  editorTheme,
  error,
  frame,
  markdownTheme,
  prompt,
  selectListTheme,
  setDarkMode,
  warning
} from './theme';
import {
  approvalPreview,
  approvalScope,
  describeToolCall,
  formatTokens,
  summarizeResult
} from './transcript';
import type { Tty } from './tty';

const SPINNER_FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const SPINNER_INTERVAL_MS = 100;
const CTRL_C_EXIT_WINDOW_MS = 2000;
const MAX_BANNER_WIDTH = 64;
const MAX_DIALOG_WIDTH = 100;

const SLASH_COMMANDS: AutocompleteItem[] = [
  { value: '/help', label: '/help', description: 'Show this help' },
  { value: '/model', label: '/model', description: 'Switch the model' },
  { value: '/tools', label: '/tools', description: 'List the tools' },
  { value: '/clear', label: '/clear', description: 'Clear the conversation' },
  { value: '/settings', label: '/settings', description: 'Open the settings' },
  { value: '/exit', label: '/exit', description: 'Leave the agent' }
];

const APPROVAL_CHOICES = ['yes', 'session', 'no'];
const APPROVAL_KEYS: Record<string, number> = {
  y: 0,
  '1': 0,
  a: 1,
  '2': 1,
  n: 2,
  '3': 2
};

type Mode = 'idle' | 'busy' | 'approval' | 'select' | 'done';

const HINTS: Record<Mode, string> = {
  idle: '/help for commands · ctrl+c twice to exit',
  busy: 'esc to interrupt',
  approval: '↑↓ select · enter confirm · esc deny',
  select: '↑↓ select · enter confirm · esc cancel',
  done: ''
};

/**
 * Completion of the slash commands at the start of the prompt.
 */
class SlashCommandProvider implements AutocompleteProvider {
  triggerCharacters = ['/'];

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number
  ): Promise<AutocompleteSuggestions | null> {
    const prefix = lines[0].slice(0, cursorCol);
    if (cursorLine !== 0 || !prefix.startsWith('/') || prefix.includes(' ')) {
      return null;
    }
    const items = SLASH_COMMANDS.filter(item => item.value.startsWith(prefix));
    return items.length > 0 ? { items, prefix } : null;
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    const completed = item.value + ' ';
    const next = [...lines];
    next[cursorLine] = completed + lines[cursorLine].slice(cursorCol);
    return { lines: next, cursorLine, cursorCol: completed.length };
  }
}

/**
 * A component drawn with a marker in front of its first line, the other
 * lines indented under it.
 */
class Marked implements Component {
  constructor(marker: string, inner: Component) {
    this._marker = marker;
    this._inner = inner;
  }

  render(width: number): string[] {
    return this._inner
      .render(Math.max(1, width - 2))
      .map((line, index) => (index === 0 ? this._marker : '  ') + line);
  }

  invalidate(): void {
    this._inner.invalidate();
  }

  private _marker: string;
  private _inner: Component;
}

/**
 * A text block without the default padding of the pi component.
 */
function block(text: string): Text {
  return new Text(text, 0, 0);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

interface IToolItem {
  name: string;
  args: unknown;
  head: string;
  text: Text;
}

interface IApproval {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ITerminalAppOptions {
  tty: Tty;
  session: TerminalSession;
  settingsModel: IAISettingsModel;
  providerRegistry?: IProviderRegistry;
  isDarkMode: () => boolean;
  openSettings: () => Promise<unknown>;
  /**
   * Use the alternate screen buffer, with the transcript scrolling above a
   * prompt pinned at the bottom.
   */
  fullScreen: boolean;
}

/**
 * Interactive terminal UI for one invocation of the command, drawn with the
 * pi TUI components.
 */
export class TerminalApp {
  constructor(options: ITerminalAppOptions) {
    this._session = options.session;
    this._agent = options.session.agent;
    this._settingsModel = options.settingsModel;
    this._providerRegistry = options.providerRegistry;
    this._isDarkMode = options.isDarkMode;
    this._openSettings = options.openSettings;
    this._terminal = new CockleTerminal(options.tty);
    this._tui = options.fullScreen
      ? new TuiAltScreen(this._terminal, false, undefined, {
          mouse: true,
          copySelection: copyToClipboard,
          openUrl: url => void window.open(url, '_blank', 'noopener')
        })
      : new TuiMainScreen(this._terminal);
    this._editor = new Editor(this._tui, editorTheme, { paddingX: 1 });
    this._editor.setAutocompleteProvider(new SlashCommandProvider());
    this._status = new Text('', 1, 0);
  }

  async run(): Promise<number> {
    setDarkMode(this._isDarkMode());
    const tui = this._tui;
    const bottom = new Container();
    for (const component of [
      this._dynamic,
      new Spacer(1),
      this._editor,
      this._status
    ]) {
      bottom.addChild(component);
    }
    if (isViewportTUI(tui)) {
      tui.setLayoutRoot(
        new VStack([
          {
            component: new ScrollView(this._transcript, {
              follow: 'end',
              primary: true
            }),
            basis: 'auto',
            grow: 1,
            shrink: 1,
            minSize: 1
          },
          { component: bottom, basis: 'auto', shrink: 0, minSize: 1 }
        ])
      );
    } else {
      tui.addChild(this._transcript);
      tui.addChild(bottom);
    }
    tui.setClearOnShrink(true);
    tui.setFocus(this._editor);
    tui.addInputListener(data => this._onInput(data));
    this._editor.onSubmit = text => void this._submit(text);
    this._agent.agentEvent.connect(this._onAgentEvent, this);
    this._agent.tokenUsageChanged.connect(this._updateStatus, this);

    this._printBanner();
    if (!this._agent.hasValidConfig()) {
      this._notice(
        warning(
          'No AI provider is configured. Run /settings to open the AI settings, then come back here.'
        )
      );
    }
    this._updateStatus();
    tui.start();
    try {
      await this._done.promise;
    } finally {
      this._stopSpinner();
      this._agent.agentEvent.disconnect(this._onAgentEvent, this);
      this._agent.tokenUsageChanged.disconnect(this._updateStatus, this);
      // Leave only the transcript on screen.
      bottom.clear();
      tui.renderNow();
      tui.stop();
      this._terminal.write('\n');
    }
    return 0;
  }

  // ---------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------

  private _onInput(data: string): TuiInputListenerResult {
    this._hint = undefined;
    if (this._mode === 'approval') {
      const choice = APPROVAL_KEYS[data];
      if (choice !== undefined) {
        this._resolveApproval(choice);
        return { consume: true };
      }
      if (matchesKey(data, 'ctrl+c')) {
        this._interrupt();
        return { consume: true };
      }
      return undefined;
    }
    if (this._mode === 'select') {
      const index = /^[1-9]$/.test(data) ? Number(data) - 1 : -1;
      if (this._menu && index >= 0 && index < this._menuItems.length) {
        this._menu.onSelect?.(this._menuItems[index]);
        return { consume: true };
      }
      return undefined;
    }
    if (matchesKey(data, 'ctrl+c')) {
      this._onCtrlC();
      this._updateStatus();
      return { consume: true };
    }
    if (matchesKey(data, 'ctrl+d')) {
      if (this._editor.getText() === '') {
        this._exit();
      }
      return { consume: true };
    }
    if (matchesKey(data, 'ctrl+l')) {
      this._tui.requestRender(true);
      return { consume: true };
    }
    if (
      matchesKey(data, 'escape') &&
      this._mode === 'busy' &&
      !this._editor.isShowingAutocomplete()
    ) {
      this._interrupt();
      return { consume: true };
    }
    return undefined;
  }

  private _onCtrlC(): void {
    if (this._mode === 'busy') {
      this._interrupt();
      return;
    }
    if (this._editor.getText() !== '') {
      this._editor.setText('');
      return;
    }
    const now = Date.now();
    if (now - this._lastCtrlC < CTRL_C_EXIT_WINDOW_MS) {
      this._exit();
      return;
    }
    this._lastCtrlC = now;
    this._hint = 'Press ctrl+c again to exit';
  }

  private _interrupt(): void {
    this._interrupted = true;
    this._agent.stopStreaming();
  }

  private _exit(): void {
    if (this._mode === 'done') {
      return;
    }
    if (this._mode === 'busy' || this._mode === 'approval') {
      this._agent.stopStreaming();
    }
    this._mode = 'done';
    this._terminal.halt();
    this._done.resolve();
  }

  // ---------------------------------------------------------------------
  // Messages and slash commands
  // ---------------------------------------------------------------------

  private async _submit(text: string): Promise<void> {
    if (!text || this._mode === 'done') {
      return;
    }
    this._editor.addToHistory(text);
    if (text.startsWith('/')) {
      await this._runSlashCommand(text);
      this._updateStatus();
      return;
    }
    if (this._mode === 'busy') {
      this._queue.push(text);
      this._hint = `Queued: ${truncateToWidth(text, 40, '…')}`;
      this._updateStatus();
      return;
    }
    this._send(text);
  }

  private _send(text: string): void {
    this._addItem(block(prompt('❯ ') + text));
    this._hint = undefined;
    this._mode = 'busy';
    this._startedAt = Date.now();
    this._interrupted = false;
    this._activeTool = undefined;
    this._startSpinner();
    this._updateStatus();

    const { cwd, initialCwd } = this._session;
    const content =
      cwd !== initialCwd
        ? `(Current working directory: ${cwd})\n\n${text}`
        : text;
    this._agent
      .generateResponse(content)
      .catch(reason => this._error(String(reason)))
      .then(() => this._onResponseDone());
  }

  private _onResponseDone(): void {
    if (this._mode === 'done') {
      return;
    }
    this._current = undefined;
    this._stopSpinner();
    this._hint = undefined;
    this._mode = 'idle';
    if (this._interrupted) {
      this._interrupted = false;
      this._notice(dim('  ⎿  Interrupted'));
    }
    const next = this._queue.shift();
    if (next !== undefined) {
      this._send(next);
    }
    this._updateStatus();
  }

  private async _runSlashCommand(line: string): Promise<void> {
    const [command, ...rest] = line.slice(1).split(/\s+/);
    const argument = rest.join(' ');
    this._notice(prompt('❯ ') + line);
    switch (command) {
      case 'help':
        this._notice(
          [
            bold('Commands'),
            ...SLASH_COMMANDS.map(
              item => `  ${item.value.padEnd(10)} ${item.description}`
            ),
            '',
            bold('Shortcuts'),
            '  enter          Send the message (shift+enter or \\ + enter for a newline)',
            '  esc            Interrupt the current response',
            '  ctrl+c         Clear the prompt, twice to exit',
            '  up / down      Browse the prompt history',
            '  ctrl+l         Redraw the screen'
          ].join('\n')
        );
        return;
      case 'exit':
      case 'quit':
        this._exit();
        return;
      case 'clear':
        await this._agent.clearHistory();
        this._transcript.clear();
        this._tui.requestRender(true);
        this._printBanner();
        return;
      case 'model':
        this._selectModel(argument);
        return;
      case 'tools':
        this._notice(
          [
            bold('Tools'),
            ...Object.keys(this._agent.selectedAgentTools)
              .sort()
              .map(name => `  ${name}`),
            ...(this._session.allowedTools.size > 0
              ? [
                  '',
                  bold('Allowed this session'),
                  ...[...this._session.allowedTools].map(scope => `  ${scope}`)
                ]
              : [])
          ].join('\n')
        );
        return;
      case 'settings':
        try {
          await this._openSettings();
          this._notice(dim('  Opened the AI settings panel.'));
        } catch (reason) {
          this._error(`Cannot open the settings: ${String(reason)}`);
        }
        return;
      default:
        this._notice(warning(`Unknown command /${command}, try /help`));
    }
  }

  private _selectModel(argument: string): void {
    const providers = this._settingsModel.providers;
    if (providers.length === 0) {
      this._notice(warning('No provider is configured, run /settings first.'));
      return;
    }
    const choose = (index: number) => {
      const config = providers[index];
      this._agent.activeProvider = config.id;
      this._notice(dim(`  Switched to ${config.provider} · ${config.model}`));
      this._updateStatus();
    };
    if (argument) {
      const needle = argument.toLowerCase();
      const index = providers.findIndex(
        config =>
          config.id === argument ||
          config.name.toLowerCase() === needle ||
          config.model.toLowerCase() === needle
      );
      if (index >= 0) {
        choose(index);
        return;
      }
      this._notice(warning(`No provider matches "${argument}"`));
    }
    const active = this._agent.activeProvider;
    const items: SelectItem[] = providers.map((config, index) => ({
      value: String(index),
      label: `${index + 1}. ${config.provider} · ${config.model}`,
      description:
        config.id === active
          ? 'active'
          : config.name !== config.model
            ? config.name
            : undefined
    }));
    this._showMenu('Select a model', items, index => choose(index));
  }

  // ---------------------------------------------------------------------
  // Agent events
  // ---------------------------------------------------------------------

  private _onAgentEvent(
    sender: IAgentManager,
    event: IAgentManager.IAgentEvent
  ): void {
    if (this._mode === 'done') {
      return;
    }
    switch (event.type) {
      case 'message_start': {
        const markdown = new Markdown('', 0, 0, markdownTheme);
        this._current = markdown;
        this._addItem(new Marked(accent('⏺ '), markdown));
        break;
      }
      case 'message_chunk':
        this._current?.setText(event.data.fullContent);
        break;
      case 'message_complete':
        this._current?.setText(event.data.content);
        this._current = undefined;
        break;
      case 'tool_call_start': {
        let args: unknown = event.data.input;
        try {
          args = JSON.parse(event.data.input);
        } catch {
          // Keep the raw input.
        }
        const name = event.data.toolName;
        const summary = describeToolCall(name, args);
        const head =
          accent('⏺ ') +
          bold(name) +
          (summary ? dim('(') + summary + dim(')') : '');
        const item: IToolItem = { name, args, head, text: block(head) };
        this._tools.set(event.data.callId, item);
        this._activeTool = name;
        this._addItem(item.text);
        break;
      }
      case 'tool_call_complete': {
        const item = this._tools.get(event.data.callId);
        this._activeTool = undefined;
        if (!item) {
          break;
        }
        const lines = summarizeResult(
          item.name,
          item.args,
          event.data.outputData,
          event.data.isError
        );
        item.text.setText(
          [
            item.head,
            ...lines.map(
              (line, index) => (index === 0 ? dim('  ⎿  ') : '     ') + line
            )
          ].join('\n')
        );
        break;
      }
      case 'tool_approval_request': {
        const scope = approvalScope(event.data.toolName, event.data.args);
        if (this._session.allowedTools.has(scope)) {
          this._agent.approveToolCall(event.data.toolCallId);
          break;
        }
        this._showApproval({
          toolCallId: event.data.toolCallId,
          toolName: event.data.toolName,
          args: event.data.args
        });
        break;
      }
      case 'error':
        this._current = undefined;
        this._error(event.data.error.message);
        break;
      default:
        break;
    }
    this._updateStatus();
  }

  // ---------------------------------------------------------------------
  // Approvals and menus
  // ---------------------------------------------------------------------

  private _showApproval(approval: IApproval): void {
    this._stopSpinner();
    this._approval = approval;
    this._mode = 'approval';
    const width = Math.min(this._columns(), MAX_DIALOG_WIDTH);
    const scope = approvalScope(approval.toolName, approval.args).replace(
      /^execute_command:/,
      ''
    );
    const list = new SelectList(
      [
        { value: 'yes', label: '1. Yes' },
        {
          value: 'session',
          label: `2. Yes, and don't ask again for ${scope} this session`
        },
        { value: 'no', label: '3. No' }
      ],
      3,
      selectListTheme
    );
    list.onSelect = item =>
      this._resolveApproval(APPROVAL_CHOICES.indexOf(item.value));
    list.onCancel = () => this._resolveApproval(2);
    this._setDynamic(
      [
        new Spacer(1),
        block(
          frame(
            approvalPreview(approval.toolName, approval.args, width),
            width,
            `Allow ${bold(approval.toolName)}?`
          ).join('\n')
        ),
        list
      ],
      list
    );
  }

  private _resolveApproval(choice: number): void {
    const approval = this._approval;
    if (!approval) {
      return;
    }
    this._approval = undefined;
    this._setDynamic([], this._editor);
    this._mode = 'busy';
    this._startSpinner();
    if (choice === 2) {
      this._agent.rejectToolCall(
        approval.toolCallId,
        'The user declined this tool call.'
      );
      this._notice(dim('  ⎿  Declined'));
    } else {
      if (choice === 1) {
        this._session.allowedTools.add(
          approvalScope(approval.toolName, approval.args)
        );
      }
      this._agent.approveToolCall(approval.toolCallId);
    }
    this._updateStatus();
  }

  private _showMenu(
    title: string,
    items: SelectItem[],
    onSelect: (index: number) => void
  ): void {
    const list = new SelectList(items, 8, selectListTheme);
    const close = () => {
      this._menu = undefined;
      this._mode = 'idle';
      this._setDynamic([], this._editor);
      this._updateStatus();
    };
    list.onSelect = item => {
      close();
      onSelect(Number(item.value));
    };
    list.onCancel = close;
    this._menu = list;
    this._menuItems = items;
    this._mode = 'select';
    this._setDynamic([new Spacer(1), block(bold(title)), list], list);
    this._updateStatus();
  }

  /**
   * Replace the region between the transcript and the prompt, and focus.
   */
  private _setDynamic(components: Component[], focus: Component): void {
    this._dynamic.clear();
    for (const component of components) {
      this._dynamic.addChild(component);
    }
    this._tui.setFocus(focus);
    this._tui.requestRender();
  }

  // ---------------------------------------------------------------------
  // Transcript
  // ---------------------------------------------------------------------

  private _addItem(component: Component): void {
    this._transcript.addChild(new Spacer(1));
    this._transcript.addChild(component);
    this._tui.requestRender();
  }

  private _notice(text: string): void {
    this._addItem(block(text));
  }

  private _error(text: string): void {
    this._addItem(block(error('⏺ Error: ') + text));
  }

  private _printBanner(): void {
    const width = Math.min(this._columns(), MAX_BANNER_WIDTH);
    const rows = [
      accent('✻ ') + bold('Welcome to Jupyternaut!'),
      '',
      dim('  model  ') + this._providerLabel(),
      dim('  cwd    ') + this._session.cwd,
      '',
      dim('  /help for commands · esc to interrupt · /exit to leave')
    ];
    this._addItem(block(frame(rows, width).join('\n')));
  }

  private _updateStatus(): void {
    if (this._mode === 'done') {
      return;
    }
    const width = this._columns() - 2;
    const hint = this._hint ?? HINTS[this._mode];
    const usage = this._agent.tokenUsage;
    const tokens = usage.inputTokens + usage.outputTokens;
    const right =
      this._providerLabel() +
      (tokens > 0 ? ` · ${formatTokens(tokens)} tokens` : '');
    const gap = width - visibleWidth(hint) - visibleWidth(right);
    this._status.setText(dim(gap < 1 ? hint : hint + ' '.repeat(gap) + right));
    this._tui.requestRender();
  }

  private _providerLabel(): string {
    const config = this._settingsModel.getProvider(this._agent.activeProvider);
    if (!config) {
      return 'no model';
    }
    const info = this._providerRegistry?.getProviderInfo(config.provider);
    return `${info?.name ?? config.provider} · ${config.model}`;
  }

  private _columns(): number {
    return Math.max(20, this._terminal.columns);
  }

  private _startSpinner(): void {
    if (this._loader) {
      return;
    }
    // The loader animates from its creation on, so it only exists while busy.
    this._loader = new Loader(this._tui, accent, dim, 'Thinking…', {
      frames: SPINNER_FRAMES,
      intervalMs: SPINNER_INTERVAL_MS
    });
    this._dynamic.addChild(this._loader);
    this._elapsedTimer = setInterval(() => {
      const elapsed = Math.round((Date.now() - this._startedAt) / 1000);
      const verb = this._activeTool
        ? `Running ${this._activeTool}`
        : 'Thinking';
      this._loader?.setMessage(
        `${verb}… ${dim(`(${elapsed}s · esc to interrupt)`)}`
      );
    }, 1000);
  }

  private _stopSpinner(): void {
    const loader = this._loader;
    if (!loader) {
      return;
    }
    this._loader = undefined;
    clearInterval(this._elapsedTimer);
    loader.stop();
    this._dynamic.removeChild(loader);
    this._tui.requestRender();
  }

  private _session: TerminalSession;
  private _agent: IAgentManager;
  private _settingsModel: IAISettingsModel;
  private _providerRegistry?: IProviderRegistry;
  private _isDarkMode: () => boolean;
  private _openSettings: () => Promise<unknown>;
  private _terminal: CockleTerminal;
  private _tui: TUI;
  private _transcript = new Container();
  private _dynamic = new Container();
  private _editor: Editor;
  private _loader?: Loader;
  private _status: Text;
  private _mode: Mode = 'idle';
  private _done = new PromiseDelegate<void>();
  private _current?: Markdown;
  private _tools = new Map<string, IToolItem>();
  private _activeTool?: string;
  private _approval?: IApproval;
  private _menu?: SelectList;
  private _menuItems: SelectItem[] = [];
  private _queue: string[] = [];
  private _hint?: string;
  private _interrupted = false;
  private _lastCtrlC = 0;
  private _startedAt = 0;
  private _elapsedTimer?: ReturnType<typeof setInterval>;
}
