/**
 * Durable edit outbox (Tier 2A) — browser-level durability checks.
 *
 * These cover the pieces only a real browser exercises: localStorage lifecycle across
 * boot/reload and the beforeunload guard. The version-gate/conflict-card logic is covered by
 * unit tests (src/__tests__/outbox*.test.js); full network-failure round-trips need a live
 * Supabase backend and stay manual.
 *
 * NOTE: unlike the older specs, this one does not use helpers.login() — that helper targets
 * the pre-Supabase rep-picker gate, which no longer exists. We seed nsa_user directly (the
 * same bypass src/__tests__/appSmoke.test.js uses); the outbox machinery is backend-independent.
 */
const { test, expect } = require('@playwright/test');

const TEST_USER = { id: '00000000-0000-0000-0000-000000000001', name: 'E2E Admin', role: 'admin' };

async function bootApp(page) {
  await page.goto('/');
  await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 20000 });
}

test.describe('Durable edit outbox', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(user => localStorage.setItem('nsa_user', JSON.stringify(user)), TEST_USER);
  });

  test('legacy entity caches are purged at boot (stale prev-cache can no longer win the merge)', async ({ page }) => {
    await page.addInitScript(() => {
      // simulate the ancient one-time-migration caches that used to feed the boot merge
      localStorage.setItem('nsa_sos', JSON.stringify([{ id: 'SO-1', memo: 'ancient copy' }]));
      localStorage.setItem('nsa_ests', JSON.stringify([{ id: 'EST-1', memo: 'ancient copy' }]));
      ['nsa_invs', 'nsa_msgs', 'nsa_cust', 'nsa_prod', 'nsa_vend'].forEach(k => localStorage.setItem(k, '[]'));
    });
    await bootApp(page);
    const leftovers = await page.evaluate(() =>
      ['nsa_sos', 'nsa_ests', 'nsa_invs', 'nsa_msgs', 'nsa_cust', 'nsa_prod', 'nsa_vend']
        .filter(k => localStorage.getItem(k) !== null));
    expect(leftovers).toEqual([]);
  });

  test('outbox entries survive boot and reload untouched', async ({ page }) => {
    const box = {
      'sales_orders:SO-777': {
        table: 'sales_orders', id: 'SO-777',
        payload: { id: 'SO-777', memo: 'unsaved edit' },
        baseVersion: 5, ts: 1700000000000, attempts: 1,
      },
    };
    await page.addInitScript(b => localStorage.setItem('nsa_outbox', JSON.stringify(b)), box);
    await bootApp(page);
    await page.reload();
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 20000 });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nsa_outbox') || '{}'));
    expect(stored['sales_orders:SO-777']).toBeTruthy();
    expect(stored['sales_orders:SO-777'].payload.memo).toBe('unsaved edit');
    expect(stored['sales_orders:SO-777'].baseVersion).toBe(5);
  });

  test('beforeunload warns while the outbox is non-empty', async ({ page }) => {
    const box = {
      'estimates:EST-42': {
        table: 'estimates', id: 'EST-42',
        payload: { id: 'EST-42', memo: 'unsaved' },
        baseVersion: null, ts: 1700000000000, attempts: 1,
      },
    };
    await page.addInitScript(b => localStorage.setItem('nsa_outbox', JSON.stringify(b)), box);
    await bootApp(page);
    // beforeunload prompts require a user gesture on the page first
    await page.locator('.sidebar').click();
    let sawBeforeUnload = false;
    page.on('dialog', async d => {
      if (d.type() === 'beforeunload') sawBeforeUnload = true;
      await d.accept().catch(() => {});
    });
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => sawBeforeUnload, { timeout: 5000 }).toBe(true);
  });
});
