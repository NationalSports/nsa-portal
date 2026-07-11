/**
 * Shared helpers for NSA Portal E2E tests.
 *
 * The old no-password "rep picker" login gate ("Who's logging in?") was replaced by
 * Supabase email/password auth long ago. In NO-DB e2e mode (no Supabase env vars) we
 * bypass auth entirely by seeding `nsa_user` in localStorage before the app boots — the
 * same approach used by 13-outbox-durability.spec.js and src/__tests__/appSmoke.test.js.
 */

/** Map a legacy department name to the role string the app expects on nsa_user. */
const DEPT_ROLE_MAP = {
  Admin: 'admin',
  Sales: 'rep',
  Warehouse: 'warehouse',
  Art: 'artist',
  Production: 'production',
  CSR: 'csr',
  Accounting: 'accounting',
  'Sales Rep': 'rep', // legacy dept label used by older specs
};

/** Log in as a specific user by seeding the nsa_user localStorage bypass. */
async function login(page, name = 'Steve Peterson', dept = 'Admin') {
  const role = DEPT_ROLE_MAP[dept] || 'admin';
  const user = { id: '00000000-0000-0000-0000-000000000001', name, role };
  await page.addInitScript(u => localStorage.setItem('nsa_user', JSON.stringify(u)), user);
  await page.goto('/');
  // Wait for dashboard to load (sidebar appears)
  await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 20000 });
}

/**
 * Seed entity data into localStorage before boot (no-DB mode).
 * Keys map to nsa_<key>: e.g. seedData(page, { sos: [...], cust: [...] }).
 *
 * The built-in demo seeds were removed (src/constants.js: D_C/D_P/D_SO are empty), so
 * data-dependent specs must seed their own entities. dbEngine.js purges the legacy entity
 * caches (nsa_sos, nsa_cust, ...) at module load — a plain localStorage seed would be wiped
 * before App reads it — so we shim Storage.removeItem to preserve exactly the seeded keys
 * through that one-time boot purge. Call BEFORE login().
 */
async function seedData(page, data) {
  await page.addInitScript(d => {
    const keys = [];
    for (const [k, v] of Object.entries(d)) {
      const key = 'nsa_' + k;
      localStorage.setItem(key, JSON.stringify(v));
      keys.push(key);
    }
    const orig = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      if (keys.includes(key)) return; // keep seeded data through the boot purge
      return orig.apply(this, arguments);
    };
  }, data);
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

module.exports = { login, seedData, navTo, getPageTitle, clickBtn, fillByPlaceholder, collectConsoleErrors, waitForToast, globalSearch };
