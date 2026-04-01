const { test, expect } = require('@playwright/test');
const { login, navTo, getPageTitle, collectConsoleErrors } = require('./helpers');

test.describe('Login & Navigation', () => {
  test('login gate shows department picker', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Who\'s logging in?')).toBeVisible();
    // Department pills are buttons with role labels
    await expect(page.getByRole('button', { name: /Admin \d/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sales Rep \d/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Warehouse \d/ })).toBeVisible();
  });

  test('login as admin shows full sidebar', async ({ page }) => {
    await login(page, 'Steve Peterson', 'Admin');
    await expect(page.locator('.sidebar')).toBeVisible();
    // Admins see all nav items
    for (const label of ['Dashboard', 'Estimates', 'Sales Orders', 'Customers', 'Products', 'Settings']) {
      await expect(page.locator('.sidebar-link', { hasText: label }).first()).toBeVisible();
    }
  });

  test('login as different roles', async ({ page }) => {
    // Login as warehouse user
    await login(page, 'Kellen Coates', 'Warehouse');
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar-user', { hasText: 'Kellen Coates' })).toBeVisible();
  });

  test('navigate to every page without crash', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await login(page, 'Steve Peterson', 'Admin');

    const pages = [
      'Dashboard', 'Messages', 'Estimates', 'Sales Orders', 'Invoices',
      'Jobs', 'Art Dashboard', 'Prod Board', 'Warehouse', 'Purchase Orders',
      'Customers', 'Vendors', 'Team', 'Products', 'Inventory',
      'Reports', 'Commissions', 'Issues', 'Settings',
    ];

    for (const label of pages) {
      await navTo(page, label);
      await page.waitForTimeout(300);
      // Page should not crash — sidebar should remain visible
      await expect(page.locator('.sidebar')).toBeVisible();
    }

    // Filter out known benign errors (Supabase connection, etc.)
    const realErrors = errors.filter(e =>
      !e.includes('Supabase') && !e.includes('net::') && !e.includes('favicon')
    );
    expect(realErrors).toHaveLength(0);
  });

  test('global search works', async ({ page }) => {
    await login(page, 'Steve Peterson', 'Admin');
    const searchInput = page.locator('input[placeholder*="Search everything"]');
    await searchInput.fill('SO-10');
    await page.waitForTimeout(500);
    // Search results dropdown should appear
    await expect(page.locator('text=Sales Orders').first()).toBeVisible();
  });

  test('logout and re-login', async ({ page }) => {
    await login(page, 'Steve Peterson', 'Admin');
    await page.locator('button', { hasText: 'Out' }).click();
    // Should return to login gate
    await expect(page.locator('text=Who\'s logging in?')).toBeVisible({ timeout: 5000 });
    // Login as different user
    await login(page, 'Chase Koissian', 'Sales Rep');
    await expect(page.locator('.sidebar-user', { hasText: 'Chase Koissian' })).toBeVisible();
  });
});
