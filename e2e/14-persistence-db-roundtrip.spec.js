const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');
const { navTo, globalSearch } = require('./helpers');

/**
 * Persistence round-trip — SAVE side (the real one).
 *
 * This is the test the localStorage suite (13-persistence-roundtrip) structurally
 * cannot do: the app is DB-as-truth, so the only way to prove an edit truly
 * persisted is to write it, drop the browser's local copy, reload, and confirm it
 * comes back FROM THE DATABASE. That needs a real Supabase endpoint.
 *
 * GATED: runs only when E2E_SUPABASE_URL + E2E_SUPABASE_ANON_KEY are set (a
 * throwaway test DB — branch or project — never production). Unset → the whole
 * suite skips, so CI and local runs are unaffected until a test DB is wired up.
 * playwright.config.js maps those vars onto REACT_APP_* so the app under test
 * talks to the same DB this spec seeds/verifies through.
 *
 * NOTE: authored against the known schema (sales_orders / so_items / customers)
 * but NOT yet executed against a live DB — the first run on the penny test branch
 * is the validation pass; selectors/columns may need a touch-up then.
 */

const URL = process.env.E2E_SUPABASE_URL;
const ANON = process.env.E2E_SUPABASE_ANON_KEY;
const ENABLED = Boolean(URL && ANON);

// Unique per-run ids so parallel/repeat runs never collide, and cleanup is exact.
const STAMP = Date.now();
const CUST = { id: `cust-e2e-${STAMP}`, name: `E2E DB Cust ${STAMP}`, alpha_tag: 'E2E' };
const SO_ID = `SO-E2E-${STAMP}`;

test.describe('Persistence round-trip (save → DB → reload)', () => {
  test.skip(!ENABLED, 'Set E2E_SUPABASE_URL + E2E_SUPABASE_ANON_KEY (a throwaway test DB) to enable.');

  let sb;

  test.beforeAll(async () => {
    sb = createClient(URL, ANON);
    // Seed a sentinel customer + order directly in the DB so the UI has something
    // real to load. Tagged with the run stamp so afterAll deletes exactly these.
    const { error: cErr } = await sb.from('customers').upsert(CUST, { onConflict: 'id' });
    if (cErr) throw new Error(`seed customer failed: ${cErr.message}`);
    const { error: sErr } = await sb.from('sales_orders').upsert({
      id: SO_ID, customer_id: CUST.id, status: 'in_production',
      memo: 'db-roundtrip seed', updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (sErr) throw new Error(`seed SO failed: ${sErr.message}`);
  });

  test.afterAll(async () => {
    if (!sb) return;
    await sb.from('so_items').delete().eq('so_id', SO_ID);
    await sb.from('sales_orders').delete().eq('id', SO_ID);
    await sb.from('customers').delete().eq('id', CUST.id);
  });

  test('seeded order loads FROM the database (not localStorage)', async ({ page }) => {
    await page.goto('/');
    // Real login via the rep-picker.
    await page.locator("text=Who's logging in?").waitFor({ state: 'visible', timeout: 15000 });
    await page.getByRole('button', { name: /Steve Peterson/ }).first().click();
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 20000 });

    // Wipe the local cache so any hit must come from the DB load.
    await page.evaluate(() => {
      Object.keys(localStorage).filter((k) => k.startsWith('nsa_')).forEach((k) => localStorage.removeItem(k));
    });
    await page.reload();
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 20000 });

    await globalSearch(page, SO_ID);
    await expect(page.getByText(SO_ID, { exact: false }).first()).toBeVisible({ timeout: 10000 });
  });

  test('an edit persists: change memo → reload from DB → still there', async ({ page }) => {
    const NEW_MEMO = `edited-${STAMP}`;

    await page.goto('/');
    await page.getByRole('button', { name: /Steve Peterson/ }).first().click();
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 20000 });

    await navTo(page, 'Sales Orders');
    await page.locator(`text=${SO_ID}`).first().click();
    await page.waitForTimeout(800);

    // Edit the order memo (a simple, always-present field) and let the save fire.
    const memo = page.locator('textarea, input[type="text"]').filter({ hasText: '' }).first();
    await memo.fill(NEW_MEMO);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(2500); // _diffSave is debounced/background

    // Verify the write reached the DB directly.
    const { data } = await sb.from('sales_orders').select('memo').eq('id', SO_ID).single();
    expect(data && data.memo).toContain(NEW_MEMO);

    // And that a fresh load (no local cache) re-hydrates the edited value from DB.
    await page.evaluate(() => {
      Object.keys(localStorage).filter((k) => k.startsWith('nsa_')).forEach((k) => localStorage.removeItem(k));
    });
    await page.reload();
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 20000 });
    await navTo(page, 'Sales Orders');
    await page.locator(`text=${SO_ID}`).first().click();
    await page.waitForTimeout(800);
    await expect(page.getByText(NEW_MEMO, { exact: false }).first()).toBeVisible({ timeout: 8000 });
  });
});
