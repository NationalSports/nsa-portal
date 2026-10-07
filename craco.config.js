// Keep scope hoisting off as a safety measure for this large single-file app.
module.exports = {
  babel: {
    // Shared browser/function helpers use CommonJS. Inject require() helpers in
    // those files, rather than ESM imports that make webpack reject module.exports.
    loaderOptions: { sourceType: 'unambiguous' },
  },
  webpack: {
    configure: (config) => {
      config.optimization.concatenateModules = false;
      // CRA allowlists Babel's ESM helper directory only. CommonJS helpers are
      // its sibling and are injected as absolute paths by the same Babel preset.
      const scope = config.resolve.plugins.find(p => p.constructor.name === 'ModuleScopePlugin');
      if (scope) scope.allowedPaths.push(require('path').dirname(require.resolve('@babel/runtime/helpers/objectSpread2')));
      return config;
    }
  }
};
