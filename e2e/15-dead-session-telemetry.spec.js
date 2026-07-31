const { test, expect } = require('@playwright/test');

/**
 * Dead-session auth-failure telemetry — the asAnon path (2026-07-31).
 *
 * Verifies the fix from migration client_events_anon_auth_failure_telemetry +
 * dbEngine._logClientEvent({asAnon:true}): when a staff tab's session is dead,
 * auth-failure telemetry must go out under the ANON key — not the expired JWT
 * (which PostgREST 401s before RLS ever sees it, the pre-fix blind spot).
 *
 * All Supabase traffic is intercepted in-browser via page.route — no real
 * backend is touched. The scenario mirrors the real incident (a stale Mac tab
 * replaying a save for hours with zero telemetry landing):
 *   1. Staff user seeded (nsa_user) + an EXPIRED Supabase session in storage.
 *   2. Every REST read returns 401 "permission denied" (dead session → anon).
 *   3. Token refresh returns invalid_grant (fatal) — the session can't revive.
 * Expected: _probeDeniedSession → _verifyPermDenialHasSession → _recoverSession
 * declares the session dead and fires forced_reauth telemetry with
 * Authorization/apikey = the anon key.
 *
 * NOT part of the default suite: needs the dev server started with mock env
 * (the localStorage-only suites run with NO Supabase env, where this path is
 * unreachable by design). Run it via:
 *   REACT_APP_SUPABASE_URL=https://e2e-mock.test REACT_APP_SUPABASE_ANON_KEY=e2e-anon-key \
 *     BROWSER=none npm start   # dedicated server
 *   E2E_MOCK=1 npx playwright test --config=playwright.chromium.config.js e2e/15-dead-session-telemetry.spec.js
 */

const MOCK_URL = 'https://e2e-mock.test';
const ANON_KEY = 'e2e-anon-key';
const EXPIRED_JWT = 'expired-access-token-e2e';

test.describe('Dead-session telemetry goes out as anon', () => {
  test.skip(process.env.E2E_MOCK !== '1', 'needs E2E_MOCK=1 and a dev server started with the e2e-mock Supabase env');

  test('forced_reauth is sent with the anon key, never the expired JWT', async ({ page }) => {
    const telemetryPosts = [];

    // e2e-mock.test is cross-origin from localhost:3000 and Playwright-fulfilled
    // responses still pass through the browser's CORS checks — every response
    // needs ACAO headers and preflights must be answered.
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
    };

    await page.route(`${MOCK_URL}/**`, async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();

      if (method === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: cors });
      }
      if (url.includes('/auth/v1/token')) {
        // Fatal refresh: the one case that must declare the session dead.
        return route.fulfill({
          status: 400,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid Refresh Token: Already Used' }),
        });
      }
      if (url.includes('/auth/v1/')) {
        return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ message: 'invalid JWT' }) });
      }
      if (url.includes('/rest/v1/client_events') && method === 'POST') {
        telemetryPosts.push({
          authorization: req.headers()['authorization'] || '',
          apikey: req.headers()['apikey'] || '',
          body: req.postDataJSON(),
        });
        return route.fulfill({ status: 201, headers: cors, contentType: 'application/json', body: '[]' });
      }
      if (url.includes('/rest/v1/') && method === 'GET') {
        // Dead session ⇒ requests run as anon ⇒ staff-only reads are denied.
        // (In production some tables allow anon SELECT — the denial here just
        // guarantees the zombie probe trips on the first poll, deterministically.)
        return route.fulfill({
          status: 401,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'permission denied for table messages', code: '42501', details: null, hint: null }),
        });
      }
      if (url.includes('/rest/v1/')) {
        // Writes: same RLS rejection the real incident produced.
        return route.fulfill({
          status: 401,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'new row violates row-level security policy for table "sales_orders"', code: '42501', details: null, hint: null }),
        });
      }
      return route.abort(); // realtime websockets etc.
    });

    // Staff login marker + an EXPIRED session under supabase-js v2's storage key
    // for the e2e-mock host ('sb-<first hostname label>-auth-token').
    await page.addInitScript(([jwt]) => {
      localStorage.setItem('nsa_user', JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', name: 'Steve Peterson', role: 'admin' }));
      const dead = {
        access_token: jwt,
        refresh_token: 'dead-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) - 7200, // expired 2h ago
        user: { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'e2e@test.local' },
      };
      localStorage.setItem('sb-e2e-mock-auth-token', JSON.stringify(dead));
    }, [EXPIRED_JWT]);

    await page.goto('/');

    // The boot load's denied reads must trip the probe → recovery → forced_reauth.
    await expect.poll(
      () => telemetryPosts.filter((t) => t.body && t.body.event === 'forced_reauth').length,
      { timeout: 60000, message: 'forced_reauth telemetry POST never fired' },
    ).toBeGreaterThan(0);

    const evt = telemetryPosts.find((t) => t.body && t.body.event === 'forced_reauth');
    // The whole point of the fix: anon key on the wire, not the expired JWT.
    expect(evt.authorization).toBe(`Bearer ${ANON_KEY}`);
    expect(evt.apikey).toBe(ANON_KEY);
    expect(evt.authorization).not.toContain(EXPIRED_JWT);
    // Payload shape matches what the RLS whitelist policy accepts.
    expect(evt.body.event).toBe('forced_reauth');
    expect(evt.body.user_email == null || typeof evt.body.user_email === 'string').toBe(true);
  });
});
