import { cursor } from './ansi';

export interface ICaret {
  row: number;
  col: number;
}

/**
 * Renderer of the transcript: lines above the dynamic region are printed
 * once, the dynamic region (spinner, prompt, menus) is redrawn in place.
 */
export interface IScreen {
  /**
   * Lines the transcript is scrolled up by, 0 when following the output.
   */
  readonly scrollOffset: number;

  /**
   * Escape sequences that set the terminal up for this renderer.
   */
  enter(): void;

  /**
   * Restore the terminal.
   */
  exit(): void;

  /**
   * Print `staticLines` for good, redraw `dynamicLines` and place the caret.
   * All lines must already be wrapped to the terminal width.
   */
  render(staticLines: string[], dynamicLines: string[], caret?: ICaret): void;

  /**
   * Forget everything printed so far.
   */
  clear(): void;

  resize(rows: number, columns: number): void;

  /**
   * Scroll the transcript up by `lines` (down when negative).
   */
  scrollBy(lines: number): void;

  scrollToBottom(): void;
}

/**
 * Inline renderer: the transcript goes to the terminal scrollback and the
 * dynamic region is erased and redrawn at the bottom of it.
 */
export class Screen implements IScreen {
  constructor(write: (text: string) => void) {
    this._write = write;
  }

  get scrollOffset(): number {
    return 0;
  }

  enter(): void {
    // The terminal scrollback is used as is.
  }

  exit(): void {
    // Nothing to restore.
  }

  render(staticLines: string[], dynamicLines: string[], caret?: ICaret): void {
    let out = cursor.hide;
    if (this._dynamicRows > 0) {
      out += cursor.up(this._cursorRow);
    }
    out += '\r' + cursor.eraseDown;
    for (const line of staticLines) {
      out += line + '\n';
    }
    out += dynamicLines.join('\n');

    const rows = dynamicLines.length;
    let cursorRow = Math.max(0, rows - 1);
    if (caret && rows > 0) {
      const row = Math.min(Math.max(0, caret.row), rows - 1);
      out += cursor.up(rows - 1 - row) + cursor.column(caret.col) + cursor.show;
      cursorRow = row;
    }
    this._write(out);
    this._dynamicRows = rows;
    this._cursorRow = cursorRow;
  }

  clear(): void {
    this._write(cursor.clearScreen);
    this._dynamicRows = 0;
    this._cursorRow = 0;
  }

  resize(): void {
    // The terminal reflows its own scrollback.
  }

  scrollBy(): void {
    // The terminal scrolls its own scrollback.
  }

  scrollToBottom(): void {
    // Nothing to do, the output is always followed.
  }

  private _write: (text: string) => void;
  private _dynamicRows = 0;
  private _cursorRow = 0;
}

const MAX_HISTORY_LINES = 5000;
const ENTER_ALTERNATE_SCREEN = '\x1b[?1049h';
const LEAVE_ALTERNATE_SCREEN = '\x1b[?1049l';
const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1006h';
const DISABLE_MOUSE = '\x1b[?1006l\x1b[?1000l';

/**
 * Full screen renderer: the transcript lives in the alternate screen buffer
 * with its own scrolling, so the dynamic region stays at the bottom.
 */
export class FullScreen implements IScreen {
  constructor(write: (text: string) => void, rows: number) {
    this._write = write;
    this._rows = Math.max(1, rows);
  }

  get scrollOffset(): number {
    return this._scroll;
  }

  enter(): void {
    this._write(ENTER_ALTERNATE_SCREEN + ENABLE_MOUSE + cursor.clearScreen);
    this._previous = [];
  }

  exit(): void {
    this._write(cursor.show + DISABLE_MOUSE + LEAVE_ALTERNATE_SCREEN);
  }

  render(staticLines: string[], dynamicLines: string[], caret?: ICaret): void {
    if (staticLines.length > 0) {
      this._history.push(...staticLines);
      if (this._scroll > 0) {
        // Keep the same lines in view while the transcript grows.
        this._scroll += staticLines.length;
      }
      const overflow = this._history.length - MAX_HISTORY_LINES;
      if (overflow > 0) {
        this._history.splice(0, overflow);
      }
    }
    this._dynamic = dynamicLines;
    this._caret = caret;
    this._clampScroll();
    this._paint();
  }

  clear(): void {
    this._history = [];
    this._previous = [];
    this._dynamic = [];
    this._scroll = 0;
    this._write(cursor.clearScreen);
  }

  resize(rows: number): void {
    this._rows = Math.max(1, rows);
    this._previous = [];
    this._clampScroll();
  }

  scrollBy(lines: number): void {
    this._scroll += lines;
    this._clampScroll();
    this._paint();
  }

  scrollToBottom(): void {
    this._scroll = 0;
    this._paint();
  }

  /**
   * Number of rows available for the transcript above the dynamic region.
   */
  private get _transcriptRows(): number {
    return Math.max(0, this._rows - Math.min(this._dynamic.length, this._rows));
  }

  private _clampScroll(): void {
    const max = Math.max(0, this._history.length - this._transcriptRows);
    this._scroll = Math.min(Math.max(0, this._scroll), max);
  }

  /**
   * Redraw the rows that changed since the last paint.
   */
  private _paint(): void {
    const rows = this._rows;
    const bottom = this._dynamic.slice(-rows);
    const topCount = rows - bottom.length;
    const end = this._history.length - this._scroll;
    const top = this._history.slice(Math.max(0, end - topCount), end);
    const frame = [
      ...new Array<string>(Math.max(0, topCount - top.length)).fill(''),
      ...top,
      ...bottom
    ];

    let out = cursor.hide;
    for (let row = 0; row < rows; row++) {
      const line = frame[row] ?? '';
      if (this._previous[row] !== line) {
        out += cursor.to(row, 0) + line + cursor.eraseEndLine;
      }
    }
    this._previous = frame;

    const caret = this._caret;
    if (caret && bottom.length > 0) {
      const row =
        topCount + Math.min(Math.max(0, caret.row), bottom.length - 1);
      out += cursor.to(row, caret.col) + cursor.show;
    }
    this._write(out);
  }

  private _write: (text: string) => void;
  private _rows: number;
  private _history: string[] = [];
  private _dynamic: string[] = [];
  private _previous: string[] = [];
  private _caret?: ICaret;
  private _scroll = 0;
}
