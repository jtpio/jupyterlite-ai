/**
 * Extra bundler configuration: pi-ai requires `node:fs` in a Bun-only code
 * path, which the browser build replaces with an empty stand-in.
 */
const path = require('path');
const { NormalModuleReplacementPlugin } = require('@rspack/core');

module.exports = {
  plugins: [
    new NormalModuleReplacementPlugin(/^node:fs$/, resource => {
      resource.request = path.resolve(__dirname, 'shims', 'fs.js');
    })
  ]
};
