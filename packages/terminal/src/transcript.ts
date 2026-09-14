import { wrapTextWithAnsi } from '@earendil-works/pi-tui';

import { dim, error, success, warning } from './theme';

const MAX_RESULT_LINES = 6;

export function formatTokens(count: number): string {
  if (count < 1000) {
    return `${count}`;
  }
  if (count < 1000000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `${(count / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
}

function compactJson(value: unknown, max = 100): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  text = (text ?? '').replace(/\s+/g, ' ');
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/**
 * Short description of a tool call shown next to its name.
 */
export function describeToolCall(name: string, args: unknown): string {
  const input = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'shell':
      return String(input.command ?? '');
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return String(input.path ?? '');
    case 'list_files':
      return String(input.path ?? '.');
    case 'execute_command':
      return String(input.commandId ?? '');
    case 'browser_fetch':
      return String(input.url ?? '');
    case 'discover_commands':
    case 'discover_skills':
      return String(input.query ?? '');
    case 'load_skill':
      return String(input.name ?? '');
    default:
      return compactJson(input, 80);
  }
}

/**
 * What a "don't ask again" answer covers: the JupyterLab command for
 * `execute_command`, the whole tool otherwise.
 */
export function approvalScope(name: string, args: unknown): string {
  const input = (args ?? {}) as Record<string, unknown>;
  if (name === 'execute_command' && typeof input.commandId === 'string') {
    return `${name}:${input.commandId}`;
  }
  return name;
}

function clipLines(text: string, max: number): string[] {
  const lines = text.split('\n');
  if (lines.length <= max) {
    return lines;
  }
  return [...lines.slice(0, max), dim(`… +${lines.length - max} lines`)];
}

/**
 * Lines shown under a tool call once its result is known.
 */
export function summarizeResult(
  name: string,
  args: unknown,
  output: unknown,
  isError: boolean
): string[] {
  const record = (output && typeof output === 'object' ? output : {}) as Record<
    string,
    unknown
  >;
  if (isError) {
    const text =
      typeof output === 'string'
        ? output
        : String(record.error ?? record.message ?? compactJson(output, 400));
    return clipLines(text, MAX_RESULT_LINES).map(error);
  }
  switch (name) {
    case 'shell': {
      const text = String(record.output ?? '').replace(/\s+$/, '');
      const lines = text
        ? clipLines(text, MAX_RESULT_LINES)
        : [dim('(no output)')];
      if (record.exitCode !== 0 && record.exitCode !== undefined) {
        lines.push(warning(`exit code ${record.exitCode}`));
      }
      return lines;
    }
    case 'read_file':
      return [
        dim(
          `Read ${record.lines} line${record.lines === 1 ? '' : 's'}` +
            (record.truncated ? ` of ${record.totalLines}` : '')
        )
      ];
    case 'write_file':
      return [dim(`Wrote ${record.bytes} bytes`)];
    case 'edit_file': {
      const input = (args ?? {}) as Record<string, unknown>;
      const count = record.replacements;
      const removed = String(input.old_string ?? '')
        .split('\n')
        .slice(0, 3);
      const added = String(input.new_string ?? '')
        .split('\n')
        .slice(0, 3);
      return [
        dim(`Replaced ${count} occurrence${count === 1 ? '' : 's'}`),
        ...removed.map(line => error('- ' + line)),
        ...added.map(line => success('+ ' + line))
      ];
    }
    case 'list_files': {
      const entries =
        (record.entries as { name: string; type: string }[] | undefined) ?? [];
      const names = entries.map(entry =>
        entry.type === 'directory' ? entry.name + '/' : entry.name
      );
      return clipLines(
        names.length ? names.join('  ') : String(record.output ?? '(empty)'),
        MAX_RESULT_LINES
      );
    }
    default:
      return clipLines(
        typeof output === 'string'
          ? output
          : (JSON.stringify(output, null, 1) ?? ''),
        MAX_RESULT_LINES
      );
  }
}

/**
 * Lines describing what a tool call is about to do.
 */
export function approvalPreview(
  toolName: string,
  args: unknown,
  width: number
): string[] {
  const input = (args ?? {}) as Record<string, unknown>;
  const clip = (text: string, max: number) =>
    clipLines(text.replace(/\n$/, ''), max);
  switch (toolName) {
    case 'write_file':
      return [
        String(input.path ?? ''),
        '',
        ...clip(String(input.content ?? ''), 12).map(
          line => success('+ ') + line
        )
      ];
    case 'edit_file':
      return [
        String(input.path ?? ''),
        '',
        ...clip(String(input.old_string ?? ''), 8).map(
          line => error('- ') + line
        ),
        ...clip(String(input.new_string ?? ''), 8).map(
          line => success('+ ') + line
        )
      ];
    default: {
      const detail = describeToolCall(toolName, args) || compactJson(args, 300);
      return wrapTextWithAnsi(detail, width - 4).slice(0, 8);
    }
  }
}
