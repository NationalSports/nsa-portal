// Keep scope hoisting off as a safety measure for this large single-file app.
module.exports = {
  webpack: {
    configure: (config) => {
      config.optimization.concatenateModules = false;
      return config;
    }
  }
};
