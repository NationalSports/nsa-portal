// Temporary Chromium override for running the e2e suite in the Claude Code remote
// environment: the base config pins Firefox, but only Chromium is preinstalled here
// (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers) and browser downloads are disabled.
// Everything else — testDir, webServer, reporters, sequential workers — is inherited.
const base = require('./playwright.config.js');

module.exports = {
  ...base,
  use: {
    ...base.use,
    browserName: 'chromium',
    // The repo's @playwright/test expects a newer Chromium revision than the one
    // preinstalled here; point at the preinstalled binary instead of downloading.
    launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
  },
};
