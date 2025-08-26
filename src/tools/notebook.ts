import { StructuredToolInterface, tool } from '@langchain/core/tools';
import { CommandRegistry } from '@lumino/commands';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { z } from 'zod';

/**
 * Static metadata for notebook commands, inspired by CommandRegistry.ICommandOptions
 * from @lumino/commands but simplified for documentation and tool usage purposes.
 */
interface INotebookCommandMetadata {
  /** The unique command identifier */
  command: string;
  /** Human-readable description of what the command does */
  description: string;
  /** Optional argument specifications for the command */
  args?: Record<string, string>;
}

const NOTEBOOK_COMMANDS: INotebookCommandMetadata[] = [
  {
    command: 'notebook:create-new',
    description: 'Create a new notebook',
    args: {
      cwd: 'Current working directory (string)',
      kernelId: 'Kernel ID (string)',
      kernelName: 'Kernel name (string)',
      isLauncher: 'Whether created from launcher (boolean)',
      isPalette: 'Whether created from palette (boolean)',
      isContextMenu: 'Whether created from context menu (boolean)'
    }
  },
  {
    command: 'notebook:replace-selection',
    description: 'Replace the current selection in the notebook'
  },
  {
    command: 'notebook:change-cell-to-code',
    description: 'Change the current cell to a code cell'
  },
  {
    command: 'notebook:change-cell-to-markdown',
    description: 'Change the current cell to a markdown cell'
  },
  {
    command: 'notebook:change-cell-to-raw',
    description: 'Change the current cell to a raw cell'
  },
  {
    command: 'notebook:insert-cell-above',
    description: 'Insert a new cell above the current cell'
  },
  {
    command: 'notebook:insert-cell-below',
    description: 'Insert a new cell below the current cell'
  },
  {
    command: 'notebook:run-cell',
    description: 'Run the current cell',
    args: {
      activate: 'Whether to activate notebook after execution (boolean)'
    }
  },
  {
    command: 'notebook:run-cell-and-select-next',
    description: 'Run the current cell and select the next cell',
    args: {
      toolbar: 'Whether executed from toolbar (boolean)',
      activate: 'Whether to activate notebook after execution (boolean)'
    }
  },
  {
    command: 'notebook:enter-edit-mode',
    description: 'Enter edit mode for the current cell'
  },
  {
    command: 'notebook:enter-command-mode',
    description: 'Enter command mode for the current cell'
  },
  {
    command: 'notebook:access-next-history-entry',
    description: 'Access next kernel history entry'
  },
  {
    command: 'notebook:access-previous-history-entry',
    description: 'Access previous kernel history entry'
  },
  {
    command: 'notebook:clear-all-cell-outputs',
    description: 'Clear outputs of all cells'
  },
  {
    command: 'notebook:clear-cell-output',
    description: 'Clear output of the current cell'
  },
  {
    command: 'notebook:close-and-shutdown',
    description: 'Close and shut down the notebook'
  },
  {
    command: 'notebook:change-kernel',
    description: 'Change the notebook kernel'
  },
  {
    command: 'notebook:restart-kernel',
    description: 'Restart the notebook kernel',
    args: {
      toolbar: 'Whether executed from toolbar (boolean)'
    }
  },
  {
    command: 'notebook:trust',
    description: 'Trust the notebook'
  }
];

const DEFAULT_ARGS: { [command: string]: any } = {
  'notebook:create-new': {
    kernelId: 'python3'
  }
};

export const notebook = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async ({ command, args }) => {
      // Set default args if not provided.
      if (DEFAULT_ARGS[command] !== undefined) {
        Object.entries(DEFAULT_ARGS[command]).forEach(([key, value]) => {
          if (!args[key]) {
            args[key] = value;
          }
        });
      }
      const result = await commands.execute(
        command,
        args as ReadonlyPartialJSONObject
      );
      const output: any = {
        command,
        args
      };
      if (result !== undefined) {
        try {
          JSON.stringify(result, undefined, 2);
          output.result = result;
        } catch {
          output.result = 'Output is not serializable';
        }
      }
      return JSON.stringify(output, undefined, 2);
    },
    {
      name: 'notebook',
      description: `
Run jupyterlab command to work on notebook, using relevant args if necessary.
The commands available are:

${NOTEBOOK_COMMANDS.map(cmd => {
  let desc = `- ${cmd.command}: ${cmd.description}`;
  if (cmd.args) {
    const argsList = Object.entries(cmd.args)
      .map(([key, value]) => `    ${key}: ${value}`)
      .join('\n');
    desc += '\n  Arguments:\n' + argsList;
  }
  return desc;
}).join('\n\n')}
`,
      schema: z.object({
        command: z.string().describe('The Jupyterlab command id to execute'),
        args: z
          .object({})
          .passthrough()
          .describe('The arguments for the command')
      })
    }
  );
};
