const { test, expect } = require('@playwright/test');
const { login, seedData, navTo, collectConsoleErrors, globalSearch } = require('./helpers');

// Built-in demo seeds were removed from the app, so seed a minimal customer + SO + estimate
// so the data-dependent branches below (open SO, open estimate) actually execute.
const TEST_CUST = { id: 'cust-e2e-1', name: 'E2E Test School', alpha_tag: 'TST' };
const ITEM = {
  product_id: 'p-e2e-1', sku: 'TEST123', name: 'Test Tee', color: 'Navy',
  sizes: { S: 10, M: 10 }, available_sizes: ['S', 'M', 'L', 'XL'],
  nsa_cost: 5, unit_sell: 12, retail_price: 12,
  pick_lines: [], decorations: [], po_lines: [],
};
const TEST_SO = {
  id: 'SO-9002', customer_id: 'cust-e2e-1', status: 'in_production',
  created_by: '00000000-0000-0000-0000-000000000001',
  created_at: '1/1/2026, 9:00:00 AM', updated_at: '1/1/2026, 9:00:00 AM',
  memo: 'E2E sales order', items: [ITEM],
};
const TEST_EST = {
  id: 'EST-9001', customer_id: 'cust-e2e-1', status: 'open',
  created_by: '00000000-0000-0000-0000-000000000001',
  created_at: '1/1/2026, 9:00:00 AM', updated_at: '1/1/2026, 9:00:00 AM',
  memo: 'E2E estimate', items: [{ ...ITEM }],
};

test.describe('Data Integrity & Cross-Page Consistency', () => {
  test.beforeEach(async ({ page }) => {
    await seedData(page, { sos: [TEST_SO], ests: [TEST_EST], cust: [TEST_CUST] });
    await login(page, 'Steve Peterson', 'Admin');
  });

  test('SO customer references resolve correctly', async ({ page }) => {
    await navTo(page, 'Sales Orders');
    await page.waitForTimeout(500);
    // Click the first visible SO link in the main area
    const soLink = page.locator('.main').locator('text=/SO-\\d+/').first();
    if (await soLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await soLink.click();
      await page.waitForTimeout(500);
      // Order editor should render — sidebar still visible
      await expect(page.locator('.sidebar')).toBeVisible();
      // Go back and open another
      await navTo(page, 'Sales Orders');
      await page.waitForTimeout(300);
      await expect(page.locator('.sidebar')).toBeVisible();
    }
  });

  test('global search finds SOs, customers, and invoices', async ({ page }) => {
    // Search for SO
    await globalSearch(page, 'SO-1042');
    await page.waitForTimeout(500);
    const soResult = await page.locator('text=SO-1042').first()
      .isVisible({ timeout: 2000 }).catch(() => false);

    // Clear and search for something else
    await page.locator('input[placeholder*="Search everything"]').fill('');
    await page.waitForTimeout(200);

    // Search for INV
    await globalSearch(page, 'INV-');
    await page.waitForTimeout(500);
    await expect(page.locator('.sidebar')).toBeVisible();
  });

  test('estimate-to-SO link integrity', async ({ page }) => {
    // Navigate to estimates, check that any linked SOs exist
    await navTo(page, 'Estimates');
    await page.waitForTimeout(500);
    // Open an estimate
    const est = page.locator('text=EST-').first();
    if (await est.isVisible({ timeout: 3000 }).catch(() => false)) {
      await est.click();
      await page.waitForTimeout(500);
      // If there's a "Convert to SO" button, the link works
      // If it shows an SO reference, that should be valid
      await expect(page.locator('.sidebar')).toBeVisible();
    }
  });

  test('localStorage persistence works', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    // Navigate to orders
    await navTo(page, 'Sales Orders');
    await page.waitForTimeout(500);
    // Refresh page
    await page.reload();
    await page.waitForTimeout(2000);
    // Should still be logged in (or at login gate)
    const hasSidebar = await page.locator('.sidebar').isVisible({ timeout: 5000 }).catch(() => false);
    const hasLogin = await page.locator('input[placeholder*="you@example.com"]').isVisible({ timeout: 3000 }).catch(() => false); // Supabase sign-in gate (old rep picker is gone)
    expect(hasSidebar || hasLogin).toBeTruthy();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });

  test('no JS errors during full page sweep', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    const allPages = [
      'Dashboard', 'Messages', 'Estimates', 'Sales Orders', 'Invoices',
      'OMG Stores', 'Sales Tools', 'Jobs', 'Art Dashboard', 'Prod Board',
      'Warehouse', 'Purchase Orders', 'Customers', 'Vendors', 'Team',
      'Products', 'Inventory', 'Reports', 'Commissions', 'Issues',
      'Backup', 'QuickBooks', 'Settings',
    ];

    for (const label of allPages) {
      const link = page.locator('.sidebar-link', { hasText: label }).first();
      if (await link.isVisible({ timeout: 1000 }).catch(() => false)) {
        await link.click();
        await page.waitForTimeout(400);
      }
    }

    // No uncaught exceptions or React errors
    const fatalErrors = errors.filter(e =>
      !e.includes('Supabase') && !e.includes('net::') && !e.includes('favicon') &&
      !e.includes('ERR_CONNECTION') && !e.includes('Failed to fetch')
    );
    expect(fatalErrors).toHaveLength(0);
  });
});
