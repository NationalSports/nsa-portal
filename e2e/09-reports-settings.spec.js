const { test, expect } = require('@playwright/test');
const { login, navTo, collectConsoleErrors } = require('./helpers');

test.describe('Reports & Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'Steve Peterson', 'Admin');
  });

  test('reports page loads', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Reports');
    await page.waitForTimeout(500);
    await expect(page.locator('.sidebar')).toBeVisible();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });

  test('settings page loads', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Settings');
    await page.waitForTimeout(500);
    await expect(page.locator('.sidebar')).toBeVisible();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });

  test('issues page loads', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Issues');
    await page.waitForTimeout(500);
    await expect(page.locator('.sidebar')).toBeVisible();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });

  test('backup page loads', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Backup');
    await page.waitForTimeout(500);
    await expect(page.locator('.sidebar')).toBeVisible();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });

  test('quickbooks page loads', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'QuickBooks');
    await page.waitForTimeout(500);
    await expect(page.locator('.sidebar')).toBeVisible();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });
});
