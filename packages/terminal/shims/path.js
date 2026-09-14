export function join(...parts) {
  return parts.filter(Boolean).join('/');
}
export function dirname(value) {
  const index = value.lastIndexOf('/');
  return index > 0 ? value.slice(0, index) : '/';
}
export function isAbsolute(value) {
  return value.startsWith('/');
}
