const { test, expect } = require('@playwright/test');
const { navTo, seedData, login } = require('./helpers');

/**
 * Persistence round-trip — LOAD/HYDRATION side.
 *
 * This app is DB-as-truth: entity edits persist via _diffSave to Supabase, never
 * back to localStorage, and _diffSave early-returns when the DB never loaded. So
 * the *edit→save* round-trip cannot be exercised without a real DB (that's the
 * follow-up loop, gated on a dedicated test project). What CAN be guarded here,
 * safely and for free, is the load path: a rich nested order must hydrate from
 * storage losslessly and survive a full page reload (React state dropped, so the
 * re-render proves re-hydration, not memory). This is its own documented
 * data-loss surface — the _itemsHydrated/_decosHydrated guards exist because
 * half-loaded state has dropped nested child rows before.
 */

const TEST_CUST = { id: 'cust-rt-1', name: 'Roundtrip School', alpha_tag: 'RTS' };
const TEST_SO = {
  id: 'SO-9100',
  customer_id: 'cust-rt-1',
  status: 'in_production',
  created_by: '00000000-0000-0000-0000-000000000001',
  created_at: '1/1/2026, 9:00:00 AM',
  updated_at: '1/1/2026, 9:00:00 AM',
  memo: 'Hydration round-trip order',
  items: [
    {
      product_id: 'p-rt-1', sku: 'RT123', name: 'Roundtrip Tee', color: 'Crimson',
      sizes: { S: 12, M: 18, L: 6 }, available_sizes: ['S', 'M', 'L', 'XL'],
      nsa_cost: 5, unit_sell: 14, retail_price: 14,
      pick_lines: [],
      decorations: [{ id: 'deco-rt-1', type: 'Screen Print', location: 'Full Front', colors: 2 }],
      po_lines: [
        { po_id: 'PO 9100 RTS', vendor: 'SanMar', status: 'waiting', created_at: '1/1/2026', memo: '', received: {}, shipments: [], unit_cost: 5, S: 12, M: 18, L: 6 },
      ],
    },
  ],
};

// The nested fields a lossless hydration must still surface after a reload.
const EXPECT_VISIBLE = ['Roundtrip Tee', 'Crimson', 'PO 9100 RTS'];

async function openOrderAndAssert(page) {
  await navTo(page, 'Sales Orders');
  await page.locator('text=SO-9100').first().click();
  await page.waitForTimeout(600);
  // Item, color, and the PO chip are all nested children of the SO — if hydration
  // dropped items or po_lines, these would be missing.
  for (const text of EXPECT_VISIBLE) {
    await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout: 6000 });
  }
}

test.describe('Persistence round-trip (load/hydration)', () => {
  test.beforeEach(async ({ page }) => {
    // seedData (not a plain localStorage write): dbEngine purges the legacy entity
    // caches (nsa_sos, nsa_cust, ...) at module load, so a plain seed is wiped before
    // App reads it — seedData's removeItem shim carries the fixtures through the boot
    // purge, same as every other data-dependent spec. Fixed 2026-07-31; the old
    // hand-rolled seed() predated the purge and left these tests permanently red.
    await seedData(page, { sos: [TEST_SO], cust: [TEST_CUST] });
    await login(page); // seeds nsa_user via addInitScript, goes to '/', waits for sidebar
  });

  test('rich nested order hydrates from storage and survives a reload', async ({ page }) => {
    // First load — nested data must render.
    await openOrderAndAssert(page);

    // Full reload drops all React state; the order must re-hydrate from storage
    // with the same nested children intact (no silent child-row loss).
    await page.reload();
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 30000 });
    await openOrderAndAssert(page);
  });

  test('seeded storage is not mutated by a read-only view', async ({ page }) => {
    // Opening and reading an order must not rewrite or shrink the stored record —
    // a regression where merely viewing re-persists stale/partial state would
    // corrupt data. The stored SO and its child counts stay identical.
    await openOrderAndAssert(page);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nsa_sos') || '[]'));
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('SO-9100');
    expect(stored[0].items).toHaveLength(1);
    expect(stored[0].items[0].po_lines).toHaveLength(1);
    expect(stored[0].items[0].decorations).toHaveLength(1);
    expect(stored[0].items[0].sizes).toEqual({ S: 12, M: 18, L: 6 });
  });
});
