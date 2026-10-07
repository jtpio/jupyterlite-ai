/**
 * No photon wasm in the browser build: images pass through unconverted.
 */
export async function loadPhoton() {
  return null;
}
