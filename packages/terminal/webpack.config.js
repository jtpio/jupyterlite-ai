/**
 * Extra bundler configuration for the pi TUI: it imports Node modules for its
 * process terminal, debug logs and native helpers, which the browser build
 * never uses, so they are replaced with small stand-ins.
 */
const path = require('path');
const {
  NormalModuleReplacementPlugin,
  ProvidePlugin
} = require('@rspack/core');

const shim = name => path.resolve(__dirname, 'shims', name);

const SHIMS = {
  child_process: shim('child-process.js'),
  events: shim('events.js'),
  fs: shim('fs.js'),
  module: shim('module.js'),
  os: shim('os.js'),
  path: require.resolve('path-browserify'),
  perf_hooks: shim('perf-hooks.js'),
  url: shim('url.js')
};

module.exports = {
  resolve: {
    fallback: {
      child_process: SHIMS.child_process,
      events: SHIMS.events,
      fs: SHIMS.fs,
      os: SHIMS.os
    }
  },
  plugins: [
    new ProvidePlugin({ Buffer: [shim('buffer.js'), 'Buffer'] }),
    new NormalModuleReplacementPlugin(/^node:/, resource => {
      const target = SHIMS[resource.request.slice('node:'.length)];
      if (target) {
        resource.request = target;
      }
    })
  ]
};
