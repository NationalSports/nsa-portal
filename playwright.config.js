const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 1,
  workers: 1, // sequential — tests share state via localStorage
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-reports/e2e-report', open: 'never' }],
    ['json', { outputFile: 'test-reports/e2e-results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    browserName: 'firefox',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'npm start',
    port: 3000,
    timeout: 120000,
    reuseExistingServer: true,
  },
});
