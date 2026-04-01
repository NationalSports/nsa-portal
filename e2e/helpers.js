/**
 * Shared helpers for NSA Portal E2E tests.
 * Login is a simple rep-picker (no password) — click department, then user name.
 */

/** Log in as a specific user by clicking their name on the login gate */
async function login(page, name = 'Steve Peterson', dept = 'Admin') {
  await page.goto('/');
  // Wait for login gate
  await page.locator('text=Who\'s logging in?').waitFor({ state: 'visible', timeout: 10000 });
  // Click department pill to filter (use getByRole to avoid strict mode issues)
  const deptBtn = page.getByRole('button', { name: new RegExp(dept + ' \\d') });
  if (await deptBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await deptBtn.click();
    await page.waitForTimeout(200);
  }
  // Click user name button
  await page.getByRole('button', { name: new RegExp(name) }).first().click();
  // Wait for dashboard to load (sidebar appears)
  await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 10000 });
}

/** Navigate to a page via sidebar */
async function navTo(page, label) {
  // Use exact text matching to avoid "Sales Orders" also matching "Sales Tools"
  const link = page.locator('.sidebar-link').filter({ hasText: label }).first();
  await link.click();
  await page.waitForTimeout(500); // let page render
}

/** Get current page title from the topbar h1 */
async function getPageTitle(page) {
  return page.locator('.main .topbar h1').innerText();
}

/** Click a button by its text content */
async function clickBtn(page, text) {
  await page.locator('button', { hasText: text }).first().click();
}

/** Fill an input by placeholder */
async function fillByPlaceholder(page, placeholder, value) {
  await page.locator(`input[placeholder*="${placeholder}"]`).first().fill(value);
}

/** Check no console errors (attaches listener, returns error collector) */
function collectConsoleErrors(page) {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

/** Wait for any toast/notification to appear and return its text */
async function waitForToast(page, timeout = 3000) {
  try {
    const toast = page.locator('[class*="toast"], [class*="notification"], [style*="position: fixed"]').first();
    await toast.waitFor({ state: 'visible', timeout });
    return toast.innerText();
  } catch {
    return null;
  }
}

/** Use the global search bar */
async function globalSearch(page, query) {
  await page.locator('input[placeholder*="Search everything"]').fill(query);
  await page.waitForTimeout(500);
}

module.exports = { login, navTo, getPageTitle, clickBtn, fillByPlaceholder, collectConsoleErrors, waitForToast, globalSearch };
