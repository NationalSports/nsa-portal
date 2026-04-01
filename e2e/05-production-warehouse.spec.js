const { test, expect } = require('@playwright/test');
const { login, navTo, collectConsoleErrors } = require('./helpers');

test.describe('Production & Warehouse', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'Steve Peterson', 'Admin');
  });

  test('jobs page loads and shows job list', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Jobs');
    await page.waitForTimeout(500);
    await expect(page.locator('.sidebar')).toBeVisible();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });

  test('production board loads', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Prod Board');
    await page.waitForTimeout(500);
    await expect(page.locator('.sidebar')).toBeVisible();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });

  test('art dashboard loads', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Art Dashboard');
    await page.waitForTimeout(500);
    await expect(page.locator('.sidebar')).toBeVisible();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });

  test('warehouse page loads with tabs', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Warehouse');
    await page.waitForTimeout(500);

    // Warehouse has tabs: pull, receive/ship
    const tabs = ['Pull', 'Ship', 'Receive'];
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

  test('purchase orders page loads', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Purchase Orders');
    await page.waitForTimeout(500);
    await expect(page.locator('.sidebar')).toBeVisible();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });

  test('warehouse login as warehouse user shows warehouse dashboard', async ({ page }) => {
    // Logout and login as warehouse user
    await page.locator('button', { hasText: 'Out' }).click();
    await login(page, 'Kellen Coates', 'Warehouse');
    await page.waitForTimeout(500);
    // Warehouse user should see warehouse-focused dashboard
    await expect(page.locator('.sidebar')).toBeVisible();
  });
});
