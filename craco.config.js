// Fix production TDZ crash — disable minification entirely to eliminate Terser as cause.
module.exports = {
  webpack: {
    configure: (config) => {
      config.optimization.concatenateModules = false;
      config.optimization.minimize = false;
      return config;
    }
  }
};
