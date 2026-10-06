const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const webpack = require('webpack');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '..');
const { loaderOptions } = require('../craco.config').babel;

// Jest's CommonJS transform misses webpack's runtime rejection of ESM files
// that assign module.exports. Exercise CRA's production Babel output in webpack.
test('shared supplier guards load in the production browser bundle', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nsa-browser-module-'));
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const source = path.join(root, 'src/lib/vendorOrderGuards.shared.js');
    const { code } = babel.transformFileSync(source, {
      babelrc: false, configFile: false,
      caller: { name: 'babel-loader', supportsStaticESM: true, supportsDynamicImport: true },
      presets: [require.resolve('babel-preset-react-app')],
      ...loaderOptions,
    });
    const entry = path.join(temp, 'guard.js');
    fs.writeFileSync(entry, code);
    const compiler = webpack({
      mode: 'production', target: 'web', entry,
      resolve: { modules: [path.join(root, 'node_modules')] },
      optimization: { minimize: false },
      output: { path: temp, filename: 'bundle.js', library: { type: 'commonjs2' } },
    });
    await new Promise((resolve, reject) => compiler.run((error, stats) => {
      compiler.close(() => {});
      if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
      else resolve();
    }));
    const sandbox = { module: { exports: {} } };
    vm.runInNewContext(fs.readFileSync(path.join(temp, 'bundle.js'), 'utf8'), sandbox);
    const guards = sandbox.module.exports;
    assert.equal(guards.exactVendorLineQuantities([{ sku: 'ABC', quantity: 2 }], { lines: [{ sku: 'ABC', quantity: 2 }] }), true);
    assert.equal(guards.exactVendorLineQuantities([{ sku: 'ABC', quantity: 2 }], { lines: [{ sku: 'ABC', quantity: 1 }] }), false);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
