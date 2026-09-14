/**
 * Extra bundler configuration for the pi TUI: its renderer imports a few Node
 * modules for debug logs and terminal detection, which the browser build
 * replaces with empty stand-ins. The builder already provides a browser
 * `process`.
 */
const path = require('path');
const { NormalModuleReplacementPlugin } = require('@rspack/core');

const SHIMS = {
  'node:perf_hooks': 'perf-hooks.js',
  'node:fs': 'fs.js',
  'node:os': 'os.js',
  'node:path': 'path.js',
  'node:url': 'url.js',
  'node:child_process': 'child-process.js'
};

module.exports = {
  plugins: [
    new NormalModuleReplacementPlugin(/^node:/, resource => {
      const shim = SHIMS[resource.request];
      if (shim) {
        resource.request = path.resolve(__dirname, 'shims', shim);
      }
    })
  ]
};
