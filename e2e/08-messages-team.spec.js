const { test, expect } = require('@playwright/test');
const { login, navTo, collectConsoleErrors } = require('./helpers');

test.describe('Messages & Team', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'Steve Peterson', 'Admin');
  });

  test('messages page loads', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Messages');
    await page.waitForTimeout(500);
    await expect(page.locator('.sidebar')).toBeVisible();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });

  test('team page loads with all reps', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await navTo(page, 'Team');
    await page.waitForTimeout(500);
    // Should show team members in main content area
    await expect(page.locator('.main').locator('text=Steve Peterson').first()).toBeVisible();
    await expect(page.locator('.sidebar')).toBeVisible();

    const realErrors = errors.filter(e => !e.includes('Supabase') && !e.includes('net::'));
    expect(realErrors).toHaveLength(0);
  });
});
