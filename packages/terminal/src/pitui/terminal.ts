import type { Terminal } from '@earendil-works/pi-tui/dist/terminal.js';

import type { Tty } from '../tty';

const RESIZE_POLL_MS = 500;
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/**
 * Split raw input into key sequences: the pi components expect one key,
 * escape sequence or bracketed paste per input event.
 */
export function splitSequences(input: string): string[] {
  const out: string[] = [];
  const n = input.length;
  let i = 0;
  while (i < n) {
    if (input[i] === '\x1b') {
      if (input.startsWith(PASTE_START, i)) {
        const end = input.indexOf(PASTE_END, i);
        const stop = end === -1 ? n : end + PASTE_END.length;
        out.push(input.slice(i, stop));
        i = stop;
        continue;
      }
      if (input[i + 1] === '[') {
        let j = i + 2;
        while (
          j < n &&
          (input.charCodeAt(j) < 0x40 || input.charCodeAt(j) > 0x7e)
        ) {
          j++;
        }
        out.push(input.slice(i, Math.min(n, j + 1)));
        i = j + 1;
        continue;
      }
      if (input[i + 1] === 'O' && i + 2 < n) {
        out.push(input.slice(i, i + 3));
        i += 3;
        continue;
      }
      // ESC followed by a key is the meta (alt) modifier.
      const length = i + 1 < n ? 2 : 1;
      out.push(input.slice(i, i + length));
      i += length;
      continue;
    }
    const char = String.fromCodePoint(input.codePointAt(i)!);
    out.push(char);
    i += char.length;
  }
  return out;
}

/**
 * The pi TUI terminal over the cockle command context.
 */
export class CockleTerminal implements Terminal {
  constructor(tty: Tty) {
    this._tty = tty;
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this._tty.enterRawMode();
    this._running = true;
    this._size = this._tty.size;
    void this._read(onInput);
    this._resizeTimer = setInterval(() => {
      const size = this._tty.size;
      if (
        size.rows !== this._size.rows ||
        size.columns !== this._size.columns
      ) {
        this._size = size;
        onResize();
      }
    }, RESIZE_POLL_MS);
  }

  /**
   * Stop reading before the current input is fully handled, so no read is
   * left pending on the shell input once the command returns.
   */
  halt(): void {
    this._running = false;
    clearInterval(this._resizeTimer);
  }

  stop(): void {
    this.halt();
    this._tty.restore();
  }

  async drainInput(): Promise<void> {
    // Input is read on demand, nothing is buffered.
  }

  write(data: string): void {
    this._tty.write(data);
  }

  get columns(): number {
    return this._tty.size.columns;
  }

  get rows(): number {
    return this._tty.size.rows;
  }

  get kittyProtocolActive(): boolean {
    return false;
  }

  moveBy(lines: number): void {
    if (lines > 0) {
      this.write(`\x1b[${lines}B`);
    } else if (lines < 0) {
      this.write(`\x1b[${-lines}A`);
    }
  }

  hideCursor(): void {
    this.write('\x1b[?25l');
  }

  showCursor(): void {
    this.write('\x1b[?25h');
  }

  clearLine(): void {
    this.write('\x1b[K');
  }

  clearFromCursor(): void {
    this.write('\x1b[J');
  }

  clearScreen(): void {
    this.write('\x1b[2J\x1b[H');
  }

  setTitle(): void {
    // The JupyterLab tab keeps its title.
  }

  setProgress(): void {
    // No progress indicator in xterm.js.
  }

  private async _read(onInput: (data: string) => void): Promise<void> {
    for await (const chunk of this._tty.chunks()) {
      for (const sequence of splitSequences(chunk)) {
        if (!this._running) {
          return;
        }
        onInput(sequence);
      }
      if (!this._running) {
        return;
      }
    }
  }

  private _tty: Tty;
  private _running = false;
  private _size = { rows: 0, columns: 0 };
  private _resizeTimer?: ReturnType<typeof setInterval>;
}
