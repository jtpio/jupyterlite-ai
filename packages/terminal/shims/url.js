export function pathToFileURL(value) {
  return new URL(`file://${value}`);
}
