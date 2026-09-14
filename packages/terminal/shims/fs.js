/**
 * Debug logs and file completion of the pi TUI have no file system in the
 * browser.
 */
export function mkdirSync() {}
export function appendFileSync() {}
export function writeFileSync() {}
export function existsSync() {
  return false;
}
export function readdirSync() {
  return [];
}
export function statSync() {
  throw new Error('No file system in the browser');
}
