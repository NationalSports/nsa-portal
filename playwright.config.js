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
    // When E2E_SUPABASE_URL/ANON_KEY are set (the DB-backed persistence suite,
    // see 14-persistence-db-roundtrip.spec.js), point the app at the test DB by
    // mapping them onto the REACT_APP_* vars CRA reads. Unset → unchanged, so the
    // localStorage-only suites keep running exactly as before.
    env: {
      ...(process.env.E2E_SUPABASE_URL ? { REACT_APP_SUPABASE_URL: process.env.E2E_SUPABASE_URL } : {}),
      ...(process.env.E2E_SUPABASE_ANON_KEY ? { REACT_APP_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY } : {}),
    },
  },
});
