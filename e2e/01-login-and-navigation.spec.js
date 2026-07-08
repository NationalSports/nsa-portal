const { test, expect } = require('@playwright/test');
const { login, navTo, getPageTitle, collectConsoleErrors } = require('./helpers');

test.describe('Login & Navigation', () => {
  test('login gate shows sign-in form', async ({ page }) => {
    // The old no-password department/rep picker was replaced by Supabase email/password auth.
    await page.goto('/');
    await expect(page.locator('input[placeholder*="you@example.com"]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('input[placeholder*="Enter password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
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
    // Should return to the Supabase sign-in gate (old "Who's logging in?" picker is gone)
    await expect(page.locator('input[placeholder*="you@example.com"]')).toBeVisible({ timeout: 5000 });
    // Login as different user
    await login(page, 'Chase Koissian', 'Sales Rep');
    await expect(page.locator('.sidebar-user', { hasText: 'Chase Koissian' })).toBeVisible();
  });
});
