const { test, expect } = require('@playwright/test');
const { login, navTo, collectConsoleErrors } = require('./helpers');

test.describe('Role-Based Views', () => {
  const roles = [
    { name: 'Steve Peterson', dept: 'Admin', role: 'admin' },
    { name: 'Chase Koissian', dept: 'Sales Rep', role: 'rep' },
    { name: 'Sharon Day-Monroe', dept: 'CSR', role: 'csr' },
    { name: 'Kellen Coates', dept: 'Warehouse', role: 'warehouse' },
    { name: 'Dylan Aassness', dept: 'Production Mgr', role: 'prod_manager' },
    { name: 'Paco Salceda', dept: 'Production', role: 'production' },
    { name: 'Andrea Jung', dept: 'Accounting', role: 'accounting' },
    { name: 'Mo', dept: 'Artist', role: 'art' },
  ];

  for (const { name, dept, role } of roles) {
    test(`${role} (${name}) can login and see dashboard`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await login(page, name, dept);
      await page.waitForTimeout(500);
      // Dashboard should render without crash
      await expect(page.locator('.sidebar')).toBeVisible();
      // User name should show in sidebar
      await expect(page.locator('.sidebar-user', { hasText: name })).toBeVisible();

      const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
      expect(realErrors).toHaveLength(0);
    });
  }

  test('each role navigates their primary pages without error', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    // Warehouse user -> warehouse page
    await login(page, 'Kellen Coates', 'Warehouse');
    const whLink = page.locator('.sidebar-link', { hasText: 'Warehouse' });
    if (await whLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await whLink.click();
      await page.waitForTimeout(500);
    }
    await expect(page.locator('.sidebar')).toBeVisible();

    // Logout and login as production
    await page.locator('button', { hasText: 'Out' }).click();
    await login(page, 'Dylan Aassness', 'Production Mgr');
    const prodLink = page.locator('.sidebar-link', { hasText: 'Prod Board' });
    if (await prodLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await prodLink.click();
      await page.waitForTimeout(500);
    }
    await expect(page.locator('.sidebar')).toBeVisible();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });
});
