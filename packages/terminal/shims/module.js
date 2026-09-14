/**
 * The pi TUI only requires optional native helpers, and skips them when the
 * call throws.
 */
export function createRequire() {
  const require = () => {
    throw new Error('No require in the browser');
  };
  require.resolve = require;
  return require;
}
