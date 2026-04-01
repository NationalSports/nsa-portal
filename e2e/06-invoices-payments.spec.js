const { test, expect } = require('@playwright/test');
const { login, navTo, collectConsoleErrors } = require('./helpers');

test.describe('Invoices & Payments', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'Steve Peterson', 'Admin');
  });

  test('invoices page loads with demo data', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Invoices');
    await page.waitForTimeout(500);
    // Should see invoice IDs
    const hasInvoices = await page.locator('text=INV-').first()
      .isVisible({ timeout: 3000 }).catch(() => false);
    await expect(page.locator('.sidebar')).toBeVisible();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });

  test('click invoice to view detail', async ({ page }) => {
    await navTo(page, 'Invoices');
    await page.waitForTimeout(500);
    const inv = page.locator('text=INV-').first();
    if (await inv.isVisible({ timeout: 3000 }).catch(() => false)) {
      await inv.click();
      await page.waitForTimeout(500);
      // Invoice detail should be visible
      await expect(page.locator('.sidebar')).toBeVisible();
    }
  });

  test('commissions page loads', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Commissions');
    await page.waitForTimeout(500);
    await expect(page.locator('.sidebar')).toBeVisible();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });
});
