import { StdinBuffer, type Terminal } from '@earendil-works/pi-tui';

import type { Tty } from './tty';

const RESIZE_POLL_MS = 500;

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
    // The buffer splits batched input into single keys, escape sequences
    // and bracketed pastes, as the pi components expect.
    this._buffer = new StdinBuffer();
    this._buffer.on('data', sequence => {
      if (this._running) {
        onInput(sequence);
      }
    });
    this._buffer.on('paste', content => {
      if (this._running) {
        onInput(`\x1b[200~${content}\x1b[201~`);
      }
    });
    void this._read();
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
   * Stop reading while the current input is still being handled, so no read
   * is left pending on the shell input once the command returns.
   */
  halt(): void {
    this._running = false;
    clearInterval(this._resizeTimer);
    this._buffer?.destroy();
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
    // No progress indicator in the browser terminal.
  }

  private async _read(): Promise<void> {
    for await (const chunk of this._tty.chunks()) {
      if (!this._running) {
        return;
      }
      this._buffer?.process(chunk);
      if (!this._running) {
        return;
      }
    }
  }

  private _tty: Tty;
  private _buffer?: StdinBuffer;
  private _running = false;
  private _size = { rows: 0, columns: 0 };
  private _resizeTimer?: ReturnType<typeof setInterval>;
}
