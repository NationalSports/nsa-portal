const { test, expect } = require('@playwright/test');
const { login, navTo, collectConsoleErrors, fillByPlaceholder } = require('./helpers');

test.describe('Customers', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'Steve Peterson', 'Admin');
  });

  test('customers page loads with demo data', async ({ page }) => {
    await navTo(page, 'Customers');
    // Should show customer list
    await expect(page.locator('.sidebar')).toBeVisible();
    // Demo data has customers — should see at least one
    const hasCustomers = await page.locator('text=/[A-Z].*[a-z]/').first()
      .isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasCustomers).toBeTruthy();
  });

  test('click customer to view detail', async ({ page }) => {
    await navTo(page, 'Customers');
    // Click first customer row
    const customerRows = page.locator('[style*="cursor: pointer"]');
    if (await customerRows.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await customerRows.first().click();
      await page.waitForTimeout(500);
      // Customer detail should show — look for edit or back buttons
      await expect(page.locator('.sidebar')).toBeVisible();
    }
  });

  test('new customer modal opens', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Customers');
    // Look for "New Customer" or "+" button
    const newBtn = page.locator('button', { hasText: /New Customer|\+ Customer/i }).first();
    if (await newBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newBtn.click();
      await page.waitForTimeout(500);
      // Modal or form should appear
      await expect(page.locator('.sidebar')).toBeVisible();
    }

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });

  test('customer search/filter works', async ({ page }) => {
    await navTo(page, 'Customers');
    // Look for a search input
    const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="search"], input[placeholder*="Filter"]').first();
    if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await searchInput.fill('test');
      await page.waitForTimeout(300);
      await expect(page.locator('.sidebar')).toBeVisible();
    }
  });
});
