import {
  type EditorTheme,
  type MarkdownTheme,
  type SelectListTheme,
  truncateToWidth,
  visibleWidth
} from '@earendil-works/pi-tui';

const CSI = '\x1b[';

/**
 * Wrap text in an SGR code and the code that undoes it, so styles nest.
 */
function sgr(open: string, close: string): (text: string) => string {
  return text => `${CSI}${open}m${text}${CSI}${close}m`;
}

function fg(index: number): (text: string) => string {
  return sgr(`38;5;${index}`, '39');
}

function bg(index: number): (text: string) => string {
  return sgr(`48;5;${index}`, '49');
}

export const bold = sgr('1', '22');
export const dim = sgr('2', '22');
export const italic = sgr('3', '23');
export const underline = sgr('4', '24');
export const strike = sgr('9', '29');

/**
 * 256-color palette entries that stay readable on light and dark terminals.
 */
export const accent = fg(68);
export const prompt = fg(75);
export const success = fg(71);
export const warning = fg(179);
export const error = fg(167);
const inlineCode = fg(173);
let quote = fg(245);
let codeBackground = bg(236);

/**
 * Pick the shades that depend on the terminal background.
 */
export function setDarkMode(dark: boolean): void {
  codeBackground = bg(dark ? 236 : 254);
  quote = fg(dark ? 245 : 243);
}

export const selectListTheme: SelectListTheme = {
  selectedPrefix: accent,
  selectedText: bold,
  description: dim,
  scrollInfo: dim,
  noMatch: dim
};

export const editorTheme: EditorTheme = {
  borderColor: dim,
  selectList: selectListTheme
};

export const markdownTheme: MarkdownTheme = {
  heading: text => bold(accent(text)),
  link: text => underline(accent(text)),
  linkUrl: dim,
  code: inlineCode,
  codeBlock: text => codeBackground(text),
  codeBlockBorder: dim,
  quote: text => quote(text),
  quoteBorder: dim,
  hr: dim,
  listBullet: accent,
  bold,
  italic,
  strikethrough: strike,
  underline
};

/**
 * Rows inside a rounded border, with an optional title.
 */
export function frame(rows: string[], width: number, title?: string): string[] {
  const inner = Math.max(0, width - 4);
  const top = title
    ? dim('╭─') +
      ` ${title} ` +
      dim('─'.repeat(Math.max(0, inner - 1 - visibleWidth(title))) + '╮')
    : dim('╭' + '─'.repeat(inner + 2) + '╮');
  return [
    top,
    ...rows.map(
      row => dim('│ ') + truncateToWidth(row, inner, '…', true) + dim(' │')
    ),
    dim('╰' + '─'.repeat(inner + 2) + '╯')
  ];
}
