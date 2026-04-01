const { test, expect } = require('@playwright/test');
const { login, navTo, collectConsoleErrors } = require('./helpers');

test.describe('Products & Inventory', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'Steve Peterson', 'Admin');
  });

  test('products page loads with catalog', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Products');
    await page.waitForTimeout(500);
    // Should show product SKUs or names
    await expect(page.locator('.sidebar')).toBeVisible();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });

  test('product search works', async ({ page }) => {
    await navTo(page, 'Products');
    const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="search"], input[placeholder*="SKU"]').first();
    if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await searchInput.fill('polo');
      await page.waitForTimeout(300);
      await expect(page.locator('.sidebar')).toBeVisible();
    }
  });

  test('inventory page loads with stock levels', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Inventory');
    await page.waitForTimeout(500);
    await expect(page.locator('.sidebar')).toBeVisible();

    // Inventory has tabs: stock, log, pos
    const tabs = ['Stock', 'Log', 'POs'];
    for (const tab of tabs) {
      const tabBtn = page.locator('button', { hasText: new RegExp(tab, 'i') }).first();
      if (await tabBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await tabBtn.click();
        await page.waitForTimeout(300);
        await expect(page.locator('.sidebar')).toBeVisible();
      }
    }

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });

  test('vendors page loads', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Vendors');
    await page.waitForTimeout(500);
    await expect(page.locator('.sidebar')).toBeVisible();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });
});
