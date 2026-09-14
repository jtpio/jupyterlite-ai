export function execSync() {
  throw new Error('No child processes in the browser');
}
