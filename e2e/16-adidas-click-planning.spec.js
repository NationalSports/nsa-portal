const { test, expect } = require('@playwright/test');
const { seedData, navTo } = require('./helpers');

const CUSTOMER = { id: 'cust-adidas-click', name: 'CLICK Test School', alpha_tag: 'CLICK' };
const ORDER = {
  id: 'SO-9608',
  customer_id: CUSTOMER.id,
  status: 'need_order',
  created_by: '00000000-0000-0000-0000-000000000001',
  created_at: '10/17/2026, 9:00:00 AM',
  updated_at: '10/17/2026, 9:00:00 AM',
  memo: 'adidas CLICK planning test',
  items: [{
    product_id: 'p-is1111',
    sku: 'IS1111',
    name: 'adidas shorts',
    color: 'Black',
    sizes: { S: 5, M: 4 },
    // Reproduces catalog rows that temporarily mix a partial plain run with
    // exact inseam labels. The planner resolves the PO quantities, not this list.
    available_sizes: ['S', 'M', 'S 5"', 'S 7"', 'M 5"', 'M 7"'],
    nsa_cost: 20,
    unit_sell: 35,
    retail_price: 35,
    pick_lines: [],
    decorations: [],
    po_lines: [{
      po_id: 'PO-60852',
      vendor: 'adidas',
      status: 'open',
      created_at: '10/17/2026',
      unit_cost: 20,
      S: 5,
      M: 4,
      drop_ship: true,
      ship_to: {
        name: 'Test Gym',
        line1: '123 Main St',
        city: 'Fresno',
        state: 'CA',
        zip: '93721',
      },
    }],
  }],
};

test('adidas PO opens the single-choice CLICK planning flow', async ({ page }) => {
  await seedData(page, { sos: [ORDER], cust: [CUSTOMER] });
  await page.goto(process.env.ADIDAS_E2E_BASE_URL || '/');
  await page.getByPlaceholder('you@example.com').fill('playwright@example.com');
  await page.getByPlaceholder('Enter password').fill('clicktest');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByText('Steve Peterson').click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 20000 });
  await navTo(page, 'Sales Orders');
  await page.getByText('SO-9608').first().click();
  await page.waitForTimeout(500);

  await page.locator('span', { hasText: 'PO-60852' }).first().click();
  await expect(page.locator('.modal h2', { hasText: 'PO — PO-60852' })).toBeVisible();
  await page.getByRole('button', { name: 'Assign TODO' }).click();

  await expect(page.locator('.modal h2', { hasText: 'Assign Task' })).toBeVisible();
  await expect(page.getByText('adidas CLICK import plan')).toBeVisible();
  await expect(page.getByText('No inventory sync data')).toBeVisible();
  await expect(page.getByLabel('Customer PO')).toHaveValue('PO 60852');

  const defaultChoice = page.getByLabel('Order-level default');
  await expect(defaultChoice.locator('option')).toHaveText([
    'Available now only',
    'Complete SKU',
    'Each size when ready',
    'Hold & re-check',
  ]);
  await defaultChoice.selectOption('hold_recheck');

  await page.getByLabel('Shipping method').selectOption({ label: 'FedEx 2 Day' });
  await expect(page.getByLabel('Delivery location')).toHaveValue('one_time');
  await expect(page.getByLabel('One-time street address')).toHaveValue('123 Main St');
  await expect(page.getByText(/has no matching CLICK size/)).toBeVisible();
});
