import { CommandRegistry } from '@lumino/commands';
import { StructuredToolInterface } from '@langchain/core/tools';

// Import notebook operations
import {
  createNewNotebook,
  renameNotebook,
  addMarkdownCell,
  addCodeCell,
  getNumberOfCells,
  getCellTypeAndSource,
  getCellOutput,
  setCellTypeAndSource,
  deleteCell,
  insertCell,
  runCell,
  saveNotebook
} from './notebook-ops';

// Import file operations
import {
  createNewPythonFile,
  getFileContent,
  setFileContent,
  createNewFile,
  deleteFile,
  renameFile,
  copyFile,
  listFiles
} from './file-ops';

/**
 * Create all high-level tools for JupyterLab operations
 */
export function createHighLevelTools(
  commands: CommandRegistry
): StructuredToolInterface[] {
  return [
    // Notebook operations
    createNewNotebook(commands),
    renameNotebook(commands),
    addMarkdownCell(commands),
    addCodeCell(commands),
    getNumberOfCells(),
    getCellTypeAndSource(),
    getCellOutput(),
    setCellTypeAndSource(commands),
    deleteCell(commands),
    insertCell(commands),
    runCell(commands),
    saveNotebook(commands),

    // File operations
    createNewPythonFile(commands),
    getFileContent(commands),
    setFileContent(commands),
    createNewFile(commands),
    deleteFile(commands),
    renameFile(commands),
    copyFile(commands),
    listFiles(commands)
  ];
}

/**
 * Export individual tool creators for selective use
 */
export {
  // Notebook operations
  createNewNotebook,
  renameNotebook,
  addMarkdownCell,
  addCodeCell,
  getNumberOfCells,
  getCellTypeAndSource,
  getCellOutput,
  setCellTypeAndSource,
  deleteCell,
  insertCell,
  runCell,
  saveNotebook,

  // File operations
  createNewPythonFile,
  getFileContent,
  setFileContent,
  createNewFile,
  deleteFile,
  renameFile,
  copyFile,
  listFiles
};
