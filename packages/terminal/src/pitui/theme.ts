import type { EditorTheme } from '@earendil-works/pi-tui/dist/components/editor.js';
import type { MarkdownTheme } from '@earendil-works/pi-tui/dist/components/markdown.js';
import type { SelectListTheme } from '@earendil-works/pi-tui/dist/components/select-list.js';

import { style, theme } from '../render/ansi';

/**
 * A style function for the pi components, from SGR codes.
 */
export function paint(code: string): (text: string) => string {
  return text => code + text + style.reset;
}

export const selectListTheme: SelectListTheme = {
  selectedPrefix: paint(theme.accent),
  selectedText: paint(style.bold),
  description: paint(style.dim),
  scrollInfo: paint(style.dim),
  noMatch: paint(style.dim)
};

export const editorTheme: EditorTheme = {
  borderColor: paint(style.dim),
  selectList: selectListTheme
};

/**
 * The markdown theme, built on demand because the code background follows
 * the dark mode.
 */
export function markdownTheme(): MarkdownTheme {
  return {
    heading: paint(theme.heading + style.bold),
    link: paint(theme.link + style.underline),
    linkUrl: paint(style.dim),
    code: paint(theme.inlineCode),
    codeBlock: paint(theme.codeBackground),
    codeBlockBorder: paint(style.dim),
    quote: paint(theme.quote),
    quoteBorder: paint(style.dim),
    hr: paint(style.dim),
    listBullet: paint(theme.accent),
    bold: paint(style.bold),
    italic: paint(style.italic),
    strikethrough: paint(style.strike),
    underline: paint(style.underline)
  };
}
