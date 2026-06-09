const { test, expect } = require('@playwright/test');
const { navTo } = require('./helpers');

/**
 * PO full-edit regression: the "➕ Edit Items & Quantities" section in the SO PO modal
 * must apply size changes to the PO line and reflect them in the modal + item PO chips.
 * Seeds a minimal SO with one PO directly into localStorage (no Supabase in test env).
 */
const TEST_CUST = { id: 'cust-test-1', name: 'Test School', alpha_tag: 'TST' };
const TEST_SO = {
  id: 'SO-9001',
  customer_id: 'cust-test-1',
  status: 'in_production',
  created_by: '00000000-0000-0000-0000-000000000001',
  created_at: '1/1/2026, 9:00:00 AM',
  updated_at: '1/1/2026, 9:00:00 AM',
  memo: 'PO edit test order',
  items: [
    {
      product_id: 'p-test-1', sku: 'TEST123', name: 'Test Tee', color: 'Navy',
      sizes: { S: 30, M: 30 }, available_sizes: ['S', 'M', 'L', 'XL'],
      nsa_cost: 5, unit_sell: 12, retail_price: 12,
      pick_lines: [], decorations: [],
      po_lines: [
        { po_id: 'PO 9001 TST', vendor: 'SanMar', status: 'waiting', created_at: '1/1/2026', memo: '', received: {}, shipments: [], unit_cost: 5, S: 30, M: 30 },
      ],
    },
    {
      product_id: 'p-test-2', sku: 'OTHER55', name: 'Other Hoodie', color: 'Black',
      sizes: { L: 10 }, available_sizes: ['S', 'M', 'L', 'XL'],
      nsa_cost: 12, unit_sell: 25, retail_price: 25,
      pick_lines: [], decorations: [], po_lines: [],
    },
  ],
};

test.describe('PO full editing (Edit Items & Quantities)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Seed the order + a logged-in admin session directly (no Supabase in the test env;
    // the app falls back to localStorage). The fake sb-* token keeps the stale-session
    // guard from kicking the seeded user back to the login gate mid-test.
    await page.evaluate(([so, cust]) => {
      const user = { id: '00000000-0000-0000-0000-000000000001', name: 'Steve Peterson', role: 'admin' };
      localStorage.setItem('nsa_sos', JSON.stringify([so]));
      localStorage.setItem('nsa_cust', JSON.stringify([cust]));
      localStorage.setItem('nsa_user', JSON.stringify(user));
      const sess = { access_token: 'e2e', refresh_token: 'e2e', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: user.id, aud: 'authenticated', role: 'authenticated', email: 'e2e@test.local' } };
      localStorage.setItem('sb-your-project-auth-token', JSON.stringify(sess));
    }, [TEST_SO, TEST_CUST]);
    await page.reload();
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 30000 });
  });

  test('change ordered sizes on an SO PO line and apply', async ({ page }) => {
    await navTo(page, 'Sales Orders');
    await page.locator('text=SO-9001').first().click();
    await page.waitForTimeout(600);

    // Open the PO modal from the item's PO chip
    await page.locator('span', { hasText: 'PO 9001 TST' }).first().click();
    await expect(page.locator('.modal h2', { hasText: 'PO — PO 9001 TST' })).toBeVisible({ timeout: 5000 });

    // Open the full editor
    await page.locator('text=Edit Items & Quantities').click();
    await expect(page.locator('#po-editq-0-S')).toBeVisible({ timeout: 3000 });

    // S 30 → 24, M 30 → 36
    await page.locator('#po-editq-0-S').fill('24');
    await page.locator('#po-editq-0-M').fill('36');
    await page.locator('button', { hasText: 'Apply Changes' }).click();
    await page.waitForTimeout(500);

    // The modal's Ordered row must reflect the new quantities
    const orderedRow = page.locator('.modal tr', { hasText: 'Ordered' }).first();
    await expect(orderedRow).toContainText('24');
    await expect(orderedRow).toContainText('36');
    await expect(orderedRow).toContainText('60');

    // In-memory order state must hold the edited PO line
    // (the items-tab PO chip row re-renders from the live items array)
    await page.locator('.modal-close').click();
    await page.waitForTimeout(300);
    const chipRow = page.locator('div').filter({ has: page.locator('span', { hasText: 'PO 9001 TST:' }) }).last();
    await expect(chipRow).toContainText('24', { timeout: 3000 });
    await expect(chipRow).toContainText('36');
  });

  test('deep-link entry (?po=) — full page → Edit PO → editor targets real lines', async ({ page }) => {
    // The ?po= deep link builds allLines with lineIdx only (no poIdx). Without normalization the
    // editor renders no rows and Apply silently no-ops — this guards that regression.
    await page.goto('/?po=' + encodeURIComponent('PO 9001 TST'));
    await expect(page.locator('h1', { hasText: 'PO 9001 TST' })).toBeVisible({ timeout: 20000 });
    await page.locator('button', { hasText: 'Edit PO' }).first().click();
    await expect(page.locator('.modal h2', { hasText: 'PO — PO 9001 TST' })).toBeVisible({ timeout: 5000 });

    await page.locator('text=Edit Items & Quantities').click();
    await expect(page.locator('#po-editq-0-S')).toBeVisible({ timeout: 3000 });

    await page.locator('#po-editq-0-S').fill('24');
    await page.locator('button', { hasText: 'Apply Changes' }).click();
    await page.waitForTimeout(500);
    const orderedRow = page.locator('.modal tr', { hasText: 'Ordered' }).first();
    await expect(orderedRow).toContainText('24');
  });

  test('items-grid size rebalance offers to sync the PO (S 30→24, M 30→36)', async ({ page }) => {
    // Reducing a size below PO-committed used to hard-block; raising left the PO behind.
    // Now both prompt to update the still-open PO line along with the item.
    page.on('dialog', d => d.accept());
    await navTo(page, 'Sales Orders');
    await page.locator('text=SO-9001').first().click();
    await page.waitForTimeout(600);

    // First item card (TEST123): the size inputs sit under their size-letter headers
    const sInput = page.locator('div:has(> div:text-is("S")) > input').first();
    const mInput = page.locator('div:has(> div:text-is("M")) > input').first();
    await expect(sInput).toHaveValue('30');

    await sInput.fill('24');
    await sInput.blur(); // commit fires uSz → confirm dialog → accepted
    await page.waitForTimeout(600);
    await mInput.fill('36');
    await mInput.blur();
    await page.waitForTimeout(600);

    // Item sizes took the change…
    await expect(sInput).toHaveValue('24');
    await expect(mInput).toHaveValue('36');
    // …and the PO chip row followed (PO line synced down to 24 and up to 36)
    const chipRow = page.locator('div').filter({ has: page.locator('span', { hasText: 'PO 9001 TST:' }) }).last();
    await expect(chipRow).toContainText('24', { timeout: 3000 });
    await expect(chipRow).toContainText('36');
  });

  test('add another order item (different vendor) onto the PO', async ({ page }) => {
    await navTo(page, 'Sales Orders');
    await page.locator('text=SO-9001').first().click();
    await page.waitForTimeout(600);
    await page.locator('span', { hasText: 'PO 9001 TST' }).first().click();
    await expect(page.locator('.modal h2', { hasText: 'PO — PO 9001 TST' })).toBeVisible({ timeout: 5000 });

    await page.locator('text=Edit Items & Quantities').click();
    await expect(page.locator('#po-editq-0-S')).toBeVisible({ timeout: 3000 });

    // Pull the second order item (OTHER55) onto this PO — open L qty (10) prefills
    await page.locator('div', { hasText: /^\+OTHER55/ }).last().click();
    await page.waitForTimeout(300);
    await page.locator('button', { hasText: 'Apply Changes' }).click();
    await page.waitForTimeout(500);

    // PO now spans 2 items
    await expect(page.locator('.modal', { hasText: 'Items on this PO (2)' })).toBeVisible({ timeout: 3000 });
  });
});
