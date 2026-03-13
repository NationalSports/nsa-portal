// Customize Terser to prevent TDZ issues in production builds.
// CRA's default Terser config can create const chains where variables
// are referenced before initialization, causing runtime crashes.
module.exports = {
  webpack: {
    configure: (config) => {
      if (config.optimization && config.optimization.minimizer) {
        config.optimization.minimizer.forEach(plugin => {
          if (plugin.constructor.name === 'TerserPlugin' && plugin.options) {
            const opts = plugin.options.minimizer?.options || plugin.options.terserOptions;
            if (opts && opts.compress) {
              opts.compress.reduce_vars = false;
              opts.compress.collapse_vars = false;
            }
          }
        });
      }
      return config;
    }
  }
};
