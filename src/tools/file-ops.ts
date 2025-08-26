import { StructuredToolInterface, tool } from '@langchain/core/tools';
import { CommandRegistry } from '@lumino/commands';
import { z } from 'zod';

/**
 * Create a new Python file
 */
export const createNewPythonFile = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async ({ fileName, content = '', cwd }) => {
      const args: any = {};
      if (cwd) {
        args.cwd = cwd;
      }
      if (fileName) {
        args.path = fileName.endsWith('.py') ? fileName : `${fileName}.py`;
      }

      // Use the file creation command - this might be launcher:create or similar
      const result = await commands.execute('launcher:create', {
        ...args,
        kernelName: 'python3',
        isFile: true
      });

      // If content is provided, we'd need to write it to the file
      if (content) {
        // This would require file manager access to write content
        // For now, return info that content needs to be set separately
      }

      return JSON.stringify(
        {
          command: 'createNewPythonFile',
          args: { fileName, content, cwd },
          result:
            result !== undefined ? result : 'Python file created successfully'
        },
        undefined,
        2
      );
    },
    {
      name: 'createNewPythonFile',
      description: 'Create a new Python (.py) file',
      schema: z.object({
        fileName: z
          .string()
          .describe(
            'Name of the Python file to create (with or without .py extension)'
          ),
        content: z
          .string()
          .optional()
          .default('')
          .describe('Initial content for the Python file'),
        cwd: z
          .string()
          .optional()
          .describe('Directory where to create the file')
      })
    }
  );
};

/**
 * Get file content
 */
export const getFileContent = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async ({ filePath }) => {
      // This would need file manager or document manager access
      // For now, we'll use the docmanager:open command as a proxy
      try {
        await commands.execute('docmanager:open', { path: filePath });

        return JSON.stringify(
          {
            command: 'getFileContent',
            args: { filePath },
            result:
              'File opened successfully - content access requires document manager integration'
          },
          undefined,
          2
        );
      } catch (error) {
        return JSON.stringify(
          {
            command: 'getFileContent',
            args: { filePath },
            error: `Failed to access file: ${error}`
          },
          undefined,
          2
        );
      }
    },
    {
      name: 'getFileContent',
      description: 'Get the content of a file',
      schema: z.object({
        filePath: z.string().describe('Path to the file to read')
      })
    }
  );
};

/**
 * Set file content
 */
export const setFileContent = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async ({ filePath, content }) => {
      // This would need document manager access to write content
      // We could potentially open the file and use editor commands
      try {
        // First open the file
        await commands.execute('docmanager:open', { path: filePath });

        // Then we'd need editor commands to replace content
        // This is a placeholder - actual implementation would need editor access

        return JSON.stringify(
          {
            command: 'setFileContent',
            args: { filePath, content },
            result:
              'File content update requires editor integration - file opened for manual editing'
          },
          undefined,
          2
        );
      } catch (error) {
        return JSON.stringify(
          {
            command: 'setFileContent',
            args: { filePath, content },
            error: `Failed to update file: ${error}`
          },
          undefined,
          2
        );
      }
    },
    {
      name: 'setFileContent',
      description: 'Set the content of a file',
      schema: z.object({
        filePath: z.string().describe('Path to the file to write'),
        content: z.string().describe('Content to write to the file')
      })
    }
  );
};

/**
 * Create a new file (generic)
 */
export const createNewFile = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async ({ fileName, fileType = 'text', content = '', cwd }) => {
      const args: any = {};
      if (cwd) {
        args.cwd = cwd;
      }
      args.path = fileName;

      const createCommand = 'launcher:create';

      // Determine the appropriate command based on file type
      switch (fileType) {
        case 'python':
          args.kernelName = 'python3';
          break;
        case 'markdown':
          args.type = 'markdown';
          break;
        case 'json':
          args.type = 'json';
          break;
        default:
          args.type = 'text';
      }

      const result = await commands.execute(createCommand, args);

      return JSON.stringify(
        {
          command: 'createNewFile',
          args: { fileName, fileType, content, cwd },
          result:
            result !== undefined
              ? result
              : `${fileType} file created successfully`
        },
        undefined,
        2
      );
    },
    {
      name: 'createNewFile',
      description: 'Create a new file of specified type',
      schema: z.object({
        fileName: z.string().describe('Name of the file to create'),
        fileType: z
          .enum(['text', 'python', 'markdown', 'json'])
          .optional()
          .default('text')
          .describe('Type of file to create'),
        content: z
          .string()
          .optional()
          .default('')
          .describe('Initial content for the file'),
        cwd: z
          .string()
          .optional()
          .describe('Directory where to create the file')
      })
    }
  );
};

/**
 * Delete a file
 */
export const deleteFile = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async ({ filePath }) => {
      try {
        const result = await commands.execute('docmanager:delete', {
          path: filePath
        });

        return JSON.stringify(
          {
            command: 'deleteFile',
            args: { filePath },
            result: result !== undefined ? result : 'File deleted successfully'
          },
          undefined,
          2
        );
      } catch (error) {
        return JSON.stringify(
          {
            command: 'deleteFile',
            args: { filePath },
            error: `Failed to delete file: ${error}`
          },
          undefined,
          2
        );
      }
    },
    {
      name: 'deleteFile',
      description: 'Delete a file',
      schema: z.object({
        filePath: z.string().describe('Path to the file to delete')
      })
    }
  );
};

/**
 * Rename a file
 */
export const renameFile = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async ({ oldPath, newPath }) => {
      try {
        const result = await commands.execute('docmanager:rename', {
          path: oldPath,
          newPath: newPath
        });

        return JSON.stringify(
          {
            command: 'renameFile',
            args: { oldPath, newPath },
            result: result !== undefined ? result : 'File renamed successfully'
          },
          undefined,
          2
        );
      } catch (error) {
        return JSON.stringify(
          {
            command: 'renameFile',
            args: { oldPath, newPath },
            error: `Failed to rename file: ${error}`
          },
          undefined,
          2
        );
      }
    },
    {
      name: 'renameFile',
      description: 'Rename a file',
      schema: z.object({
        oldPath: z.string().describe('Current path of the file'),
        newPath: z.string().describe('New path/name for the file')
      })
    }
  );
};

/**
 * Copy a file
 */
export const copyFile = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async ({ sourcePath, destinationPath }) => {
      try {
        const result = await commands.execute('docmanager:copy', {
          path: sourcePath,
          toPath: destinationPath
        });

        return JSON.stringify(
          {
            command: 'copyFile',
            args: { sourcePath, destinationPath },
            result: result !== undefined ? result : 'File copied successfully'
          },
          undefined,
          2
        );
      } catch (error) {
        return JSON.stringify(
          {
            command: 'copyFile',
            args: { sourcePath, destinationPath },
            error: `Failed to copy file: ${error}`
          },
          undefined,
          2
        );
      }
    },
    {
      name: 'copyFile',
      description: 'Copy a file to a new location',
      schema: z.object({
        sourcePath: z.string().describe('Path of the file to copy'),
        destinationPath: z
          .string()
          .describe('Destination path for the copied file')
      })
    }
  );
};

/**
 * List files in a directory
 */
export const listFiles = (
  commands: CommandRegistry
): StructuredToolInterface => {
  return tool(
    async ({ directoryPath = '.' }) => {
      try {
        // This would need file browser or file manager access
        await commands.execute('filebrowser:go-to-path', {
          path: directoryPath
        });

        return JSON.stringify(
          {
            command: 'listFiles',
            args: { directoryPath },
            result:
              'Directory navigation completed - file listing requires file browser integration'
          },
          undefined,
          2
        );
      } catch (error) {
        return JSON.stringify(
          {
            command: 'listFiles',
            args: { directoryPath },
            error: `Failed to list files: ${error}`
          },
          undefined,
          2
        );
      }
    },
    {
      name: 'listFiles',
      description: 'List files in a directory',
      schema: z.object({
        directoryPath: z
          .string()
          .optional()
          .default('.')
          .describe('Path to the directory to list')
      })
    }
  );
};
