import { StructuredToolInterface, tool } from '@langchain/core/tools';
import { CommandRegistry } from '@lumino/commands';
import { z } from 'zod';

/**
 * Create a new notebook
 */
export const createNewNotebook = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async ({ kernelName = 'python3', cwd }) => {
      const args: any = { kernelId: kernelName };
      if (cwd) {
        args.cwd = cwd;
      }

      await commands.execute('notebook:create-new', args);
      return JSON.stringify(
        {
          command: 'createNewNotebook',
          args: { kernelName, cwd },
          result: 'Notebook created successfully'
        },
        undefined,
        2
      );
    },
    {
      name: 'createNewNotebook',
      description: 'Create a new Jupyter notebook with the specified kernel',
      schema: z.object({
        kernelName: z
          .string()
          .optional()
          .default('python3')
          .describe('The kernel to use for the notebook'),
        cwd: z
          .string()
          .optional()
          .describe('Current working directory for the notebook')
      })
    }
  );
};

/**
 * Rename a notebook (uses file rename command)
 */
export const renameNotebook = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async ({ oldName, newName }) => {
      // This would typically use docmanager:rename command
      await commands.execute('docmanager:rename', {
        path: oldName,
        newPath: newName
      });
      return JSON.stringify(
        {
          command: 'renameNotebook',
          args: { oldName, newName },
          result: 'Notebook renamed successfully'
        },
        undefined,
        2
      );
    },
    {
      name: 'renameNotebook',
      description: 'Rename a notebook file',
      schema: z.object({
        oldName: z.string().describe('Current name/path of the notebook'),
        newName: z.string().describe('New name/path for the notebook')
      })
    }
  );
};

/**
 * Add a markdown cell to the current notebook
 */
export const addMarkdownCell = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async ({ content, position = 'below' }) => {
      try {
        // Insert cell and change to markdown
        const insertCommand =
          position === 'above'
            ? 'notebook:insert-cell-above'
            : 'notebook:insert-cell-below';

        // Execute insert command and wait for completion
        await commands.execute(insertCommand);

        // Small delay to ensure cell widget is fully created
        await new Promise(resolve => setTimeout(resolve, 100));

        // Change to markdown
        await commands.execute('notebook:change-cell-to-markdown');

        // If content is provided, replace the cell content
        if (content) {
          await commands.execute('notebook:enter-edit-mode');

          // Additional delay to ensure edit mode is fully active
          await new Promise(resolve => setTimeout(resolve, 50));

          // Select all existing content before replacing
          await commands.execute('notebook:select-all');

          // Replace selection with new content
          await commands.execute('notebook:replace-selection', {
            text: content
          });

          // Exit edit mode and run the cell to render the markdown
          await commands.execute('notebook:run-cell');
        }

        return JSON.stringify(
          {
            command: 'addMarkdownCell',
            args: { content, position },
            result: 'Markdown cell added successfully'
          },
          undefined,
          2
        );
      } catch (error) {
        return JSON.stringify(
          {
            command: 'addMarkdownCell',
            args: { content, position },
            result: 'Failed to add markdown cell',
            error: error instanceof Error ? error.message : String(error)
          },
          undefined,
          2
        );
      }
    },
    {
      name: 'addMarkdownCell',
      description: 'Add a markdown cell to the current notebook',
      schema: z.object({
        content: z
          .string()
          .optional()
          .describe('Content to add to the markdown cell'),
        position: z
          .enum(['above', 'below'])
          .optional()
          .default('below')
          .describe('Position relative to current cell')
      })
    }
  );
};

/**
 * Add a code cell to the current notebook
 */
export const addCodeCell = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async ({ content, position = 'below' }) => {
      try {
        // Insert cell (defaults to code cell)
        const insertCommand =
          position === 'above'
            ? 'notebook:insert-cell-above'
            : 'notebook:insert-cell-below';

        // Execute insert command and wait for completion
        await commands.execute(insertCommand);

        // Small delay to ensure cell widget is fully created
        await new Promise(resolve => setTimeout(resolve, 100));

        // Change to code (though this should be default)
        await commands.execute('notebook:change-cell-to-code');

        // If content is provided, replace the cell content
        if (content) {
          await commands.execute('notebook:enter-edit-mode');
          await commands.execute('notebook:replace-selection', {
            text: content
          });
        }

        return JSON.stringify(
          {
            command: 'addCodeCell',
            args: { content, position },
            result: 'Code cell added successfully'
          },
          undefined,
          2
        );
      } catch (error) {
        return JSON.stringify(
          {
            command: 'addCodeCell',
            args: { content, position },
            result: 'Failed to add code cell',
            error: error instanceof Error ? error.message : String(error)
          },
          undefined,
          2
        );
      }
    },
    {
      name: 'addCodeCell',
      description: 'Add a code cell to the current notebook',
      schema: z.object({
        content: z.string().optional().describe('Code to add to the cell'),
        position: z
          .enum(['above', 'below'])
          .optional()
          .default('below')
          .describe('Position relative to current cell')
      })
    }
  );
};

/**
 * Get the number of cells in the current notebook
 */
export const getNumberOfCells = (): StructuredToolInterface => {
  return tool(
    async () => {
      // This would need to access the notebook model to get cell count
      // For now, we'll return a placeholder indicating this needs notebook tracker access
      return JSON.stringify(
        {
          command: 'getNumberOfCells',
          result:
            'This command requires access to the notebook tracker to count cells'
        },
        undefined,
        2
      );
    },
    {
      name: 'getNumberOfCells',
      description: 'Get the number of cells in the current notebook',
      schema: z.object({})
    }
  );
};

/**
 * Get cell type and source for a specific cell
 */
export const getCellTypeAndSource = (): StructuredToolInterface => {
  return tool(
    async ({ cellIndex }) => {
      // This would need notebook tracker access to get cell info
      return JSON.stringify(
        {
          command: 'getCellTypeAndSource',
          args: { cellIndex },
          result:
            'This command requires access to the notebook tracker to get cell information'
        },
        undefined,
        2
      );
    },
    {
      name: 'getCellTypeAndSource',
      description: 'Get the type and source content of a specific cell',
      schema: z.object({
        cellIndex: z
          .number()
          .describe('Index of the cell to get information for')
      })
    }
  );
};

/**
 * Get cell output for a specific cell
 */
export const getCellOutput = (): StructuredToolInterface => {
  return tool(
    async ({ cellIndex }) => {
      // This would need notebook tracker access to get cell output
      return JSON.stringify(
        {
          command: 'getCellOutput',
          args: { cellIndex },
          result:
            'This command requires access to the notebook tracker to get cell output'
        },
        undefined,
        2
      );
    },
    {
      name: 'getCellOutput',
      description: 'Get the output of a specific cell',
      schema: z.object({
        cellIndex: z.number().describe('Index of the cell to get output for')
      })
    }
  );
};

/**
 * Set cell type and source for a specific cell
 */
export const setCellTypeAndSource = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async ({ cellIndex, cellType, source }) => {
      // This would need notebook tracker to navigate to cell and modify it
      const typeCommand =
        cellType === 'markdown'
          ? 'notebook:change-cell-to-markdown'
          : cellType === 'code'
            ? 'notebook:change-cell-to-code'
            : 'notebook:change-cell-to-raw';

      // Navigate to cell (would need cell selection logic)
      await commands.execute(typeCommand);

      if (source) {
        await commands.execute('notebook:enter-edit-mode');
        await commands.execute('notebook:replace-selection', { text: source });
      }

      return JSON.stringify(
        {
          command: 'setCellTypeAndSource',
          args: { cellIndex, cellType, source },
          result: 'Cell type and source updated successfully'
        },
        undefined,
        2
      );
    },
    {
      name: 'setCellTypeAndSource',
      description: 'Set the type and source content of a specific cell',
      schema: z.object({
        cellIndex: z.number().describe('Index of the cell to modify'),
        cellType: z
          .enum(['code', 'markdown', 'raw'])
          .describe('Type of cell to set'),
        source: z
          .string()
          .optional()
          .describe('Source content to set in the cell')
      })
    }
  );
};

/**
 * Delete a specific cell
 */
export const deleteCell = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async ({ cellIndex }) => {
      // This would need notebook tracker to navigate to specific cell and delete it
      await commands.execute('notebook:delete-cell');

      return JSON.stringify(
        {
          command: 'deleteCell',
          args: { cellIndex },
          result: 'Cell deleted successfully'
        },
        undefined,
        2
      );
    },
    {
      name: 'deleteCell',
      description: 'Delete a specific cell from the notebook',
      schema: z.object({
        cellIndex: z.number().describe('Index of the cell to delete')
      })
    }
  );
};

/**
 * Insert a cell at a specific position
 */
export const insertCell = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async ({ cellIndex, cellType = 'code', content, position = 'below' }) => {
      try {
        // This would need notebook tracker to navigate to specific position
        const insertCommand =
          position === 'above'
            ? 'notebook:insert-cell-above'
            : 'notebook:insert-cell-below';

        // Execute insert command and wait for completion
        await commands.execute(insertCommand);

        // Small delay to ensure cell widget is fully created
        await new Promise(resolve => setTimeout(resolve, 100));

        const typeCommand =
          cellType === 'markdown'
            ? 'notebook:change-cell-to-markdown'
            : cellType === 'code'
              ? 'notebook:change-cell-to-code'
              : 'notebook:change-cell-to-raw';
        await commands.execute(typeCommand);

        if (content) {
          await commands.execute('notebook:enter-edit-mode');
          await commands.execute('notebook:replace-selection', {
            text: content
          });
        }

        return JSON.stringify(
          {
            command: 'insertCell',
            args: { cellIndex, cellType, content, position },
            result: 'Cell inserted successfully'
          },
          undefined,
          2
        );
      } catch (error) {
        return JSON.stringify(
          {
            command: 'insertCell',
            args: { cellIndex, cellType, content, position },
            result: 'Failed to insert cell',
            error: error instanceof Error ? error.message : String(error)
          },
          undefined,
          2
        );
      }
    },
    {
      name: 'insertCell',
      description: 'Insert a new cell at a specific position in the notebook',
      schema: z.object({
        cellIndex: z.number().describe('Index where to insert the cell'),
        cellType: z
          .enum(['code', 'markdown', 'raw'])
          .optional()
          .default('code')
          .describe('Type of cell to insert'),
        content: z
          .string()
          .optional()
          .describe('Content to add to the new cell'),
        position: z
          .enum(['above', 'below'])
          .optional()
          .default('below')
          .describe('Position relative to specified index')
      })
    }
  );
};

/**
 * Run a specific cell
 */
export const runCell = (commands: CommandRegistry): StructuredToolInterface => {
  return tool(
    async ({ cellIndex, activate = true }) => {
      // This would need notebook tracker to navigate to specific cell
      await commands.execute('notebook:run-cell', { activate });

      return JSON.stringify(
        {
          command: 'runCell',
          args: { cellIndex, activate },
          result: 'Cell executed successfully'
        },
        undefined,
        2
      );
    },
    {
      name: 'runCell',
      description: 'Run a specific cell in the notebook',
      schema: z.object({
        cellIndex: z.number().describe('Index of the cell to run'),
        activate: z
          .boolean()
          .optional()
          .default(true)
          .describe('Whether to activate notebook after execution')
      })
    }
  );
};

/**
 * Save the current notebook
 */
export const saveNotebook = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async () => {
      await commands.execute('docmanager:save');

      return JSON.stringify(
        {
          command: 'saveNotebook',
          result: 'Notebook saved successfully'
        },
        undefined,
        2
      );
    },
    {
      name: 'saveNotebook',
      description: 'Save the current notebook',
      schema: z.object({})
    }
  );
};
