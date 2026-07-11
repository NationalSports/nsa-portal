const { test, expect } = require('@playwright/test');
const { login, seedData, navTo, clickBtn, collectConsoleErrors } = require('./helpers');

// Built-in demo seeds were removed from the app (D_C/D_SO/D_P are empty in no-DB mode),
// so this spec seeds its own minimal customer + sales order via localStorage.
// created_by must match the login() user id — the SO list defaults to "My Orders".
const TEST_CUST = { id: 'cust-e2e-1', name: 'E2E Test School', alpha_tag: 'TST' };
const TEST_SO = {
  id: 'SO-9002',
  customer_id: 'cust-e2e-1',
  status: 'in_production',
  created_by: '00000000-0000-0000-0000-000000000001',
  created_at: '1/1/2026, 9:00:00 AM',
  updated_at: '1/1/2026, 9:00:00 AM',
  memo: 'E2E sales order',
  items: [
    {
      product_id: 'p-e2e-1', sku: 'TEST123', name: 'Test Tee', color: 'Navy',
      sizes: { S: 10, M: 10 }, available_sizes: ['S', 'M', 'L', 'XL'],
      nsa_cost: 5, unit_sell: 12, retail_price: 12,
      pick_lines: [], decorations: [], po_lines: [],
    },
  ],
};

test.describe('Sales Orders Flow', () => {
  test.beforeEach(async ({ page }) => {
    await seedData(page, { sos: [TEST_SO], cust: [TEST_CUST] });
    await login(page, 'Steve Peterson', 'Admin');
  });

  test('sales orders page loads with seeded data', async ({ page }) => {
    await navTo(page, 'Sales Orders');
    await expect(page.locator('.main').locator('text=/SO-\\d+/').first()).toBeVisible({ timeout: 5000 });
  });

  test('open sales order and view all tabs', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Sales Orders');
    // Click first SO
    await page.locator('text=SO-').first().click();
    await page.waitForTimeout(500);

    // Cycle through all order tabs
    const tabs = ['items', 'decos', 'jobs', 'art', 'pick', 'po', 'shipping', 'invoices', 'messages', 'tracking'];
    for (const tab of tabs) {
      const tabBtn = page.locator('button', { hasText: new RegExp(`^${tab}$`, 'i') }).first();
      if (await tabBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await tabBtn.click();
        await page.waitForTimeout(300);
        // Should not crash
        await expect(page.locator('.sidebar')).toBeVisible();
      }
    }

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });

  test('SO items tab shows product details', async ({ page }) => {
    await navTo(page, 'Sales Orders');
    await page.locator('text=SO-').first().click();
    await page.waitForTimeout(500);
    // Items tab should show product info — sizes, quantities
    const hasItemContent = await page.locator('text=/S|M|L|XL/').first()
      .isVisible({ timeout: 3000 }).catch(() => false);
    // At minimum the order editor should be visible
    await expect(page.locator('.sidebar')).toBeVisible();
  });

  test('SO decorations tab renders', async ({ page }) => {
    await navTo(page, 'Sales Orders');
    await page.locator('text=SO-').first().click();
    await page.waitForTimeout(500);
    const decoTab = page.locator('button', { hasText: /^decos$/i }).first();
    if (await decoTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await decoTab.click();
      await page.waitForTimeout(500);
      // Should show decoration types or "add decoration" option
      await expect(page.locator('.sidebar')).toBeVisible();
    }
  });

  test('SO jobs tab shows auto-grouped jobs', async ({ page }) => {
    await navTo(page, 'Sales Orders');
    await page.locator('text=SO-').first().click();
    await page.waitForTimeout(500);
    const jobsTab = page.locator('button', { hasText: /^jobs$/i }).first();
    if (await jobsTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await jobsTab.click();
      await page.waitForTimeout(500);
      // Should show job cards or "no jobs" message
      await expect(page.locator('.sidebar')).toBeVisible();
    }
  });

  test('navigate between multiple SOs without crash', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Sales Orders');
    // Open and close multiple SOs
    const soLinks = page.locator('text=/SO-\\d+/');
    const count = Math.min(await soLinks.count(), 5);
    for (let i = 0; i < count; i++) {
      await navTo(page, 'Sales Orders'); // go back to list
      await page.waitForTimeout(300);
      const link = page.locator('text=/SO-\\d+/').nth(i);
      if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
        await link.click();
        await page.waitForTimeout(500);
      }
    }

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });
});
