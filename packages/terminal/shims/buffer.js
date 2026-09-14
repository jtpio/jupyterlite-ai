/**
 * The pi TUI checks whether input chunks are Node buffers; in the browser
 * they never are.
 */
export const Buffer = {
  isBuffer() {
    return false;
  }
};
