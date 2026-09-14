/**
 * Debug and crash logs of the pi TUI have nowhere to go in the browser.
 */
export function mkdirSync() {}
export function appendFileSync() {}
export function writeFileSync() {}
export function existsSync() {
  return false;
}
