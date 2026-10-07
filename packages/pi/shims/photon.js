/**
 * pi's image library (photon), loaded on first use. Its Node build reads the
 * WebAssembly file with `fs.readFileSync` when it loads.
 */
import fs from 'fs';
import path from 'path';
import wasmUrl from '@silvia-odwyer/photon-node/photon_rs_bg.wasm';

let photon;

async function load() {
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const file = path.join(__dirname, 'photon_rs_bg.wasm');
  fs.writeFileSync(file, new Uint8Array(await response.arrayBuffer()));
  try {
    return await import('@silvia-odwyer/photon-node');
  } finally {
    fs.unlinkSync(file);
  }
}

export function loadPhoton() {
  photon ??= load().catch(error => {
    console.warn('pi: cannot load the image library', error);
    return null;
  });
  return photon;
}
