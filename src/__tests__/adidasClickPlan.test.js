import * as XLSX from 'xlsx';
import {
  ADIDAS_CLICK_CHOICES,
  buildClickImportWorkbook,
  clickImportAoa,
  planAdidasClickOrder,
  resolvePortalSize,
  sanitizeClickCustomerPo,
} from '../lib/adidasClickPlan';

const inventory = [
  { sku: 'IS1111', size: 'S 5"', stock_qty: 9, future_delivery_date: null, future_delivery_qty: null, last_synced: '2026-10-17T12:00:00Z' },
  { sku: 'IS1111', size: 'S 7"', stock_qty: 3, future_delivery_date: '2026-10-24', future_delivery_qty: 8, last_synced: '2026-10-17T12:00:00Z' },
  { sku: 'IS1111', size: 'M 5"', stock_qty: 9, future_delivery_date: null, future_delivery_qty: null, last_synced: '2026-10-17T12:00:00Z' },
  { sku: 'IS1111', size: 'M 7"', stock_qty: 10, future_delivery_date: null, future_delivery_qty: null, last_synced: '2026-10-17T12:00:00Z' },
  { sku: 'TOP1', size: 'S', stock_qty: 4, future_delivery_date: '2026-10-20', future_delivery_qty: 6, last_synced: '2026-10-17T12:00:00Z' },
  { sku: 'TOP1', size: 'M', stock_qty: 10, future_delivery_date: null, future_delivery_qty: null, last_synced: '2026-10-17T12:00:00Z' },
];

const headers = {
  customerPo: 'PO-60852',
  shipMethod: 'FedEx Ground',
  deliveryLocation: { type: 'saved', number: '6017364001' },
  generatedAt: '2026-10-17T13:00:00Z',
  today: '2026-10-17',
};

describe('adidas CLICK size resolution', () => {
  test('requires a preference when a plain portal size has multiple inseams', () => {
    const unresolved = resolvePortalSize('S', ['S 5"', 'S 7"', 'S 9"']);
    expect(unresolved.status).toBe('ambiguous');
    expect(unresolved.candidates).toEqual(['S 5"', 'S 7"', 'S 9"']);

    expect(resolvePortalSize('S', ['S 5"', 'S 7"', 'S 9"'], '7"')).toMatchObject({
      status: 'resolved',
      click_size: 'S 7"',
    });
  });

  test('handles CLICK labels whose larger sizes omit spaces and quotes', () => {
    expect(resolvePortalSize('XL', ['XL5"', 'XL7"'], '7')).toMatchObject({ click_size: 'XL7"' });
    expect(resolvePortalSize('2XL', ['2XL5', '2XL7'], '7"')).toMatchObject({ click_size: '2XL7' });
    expect(resolvePortalSize('LT2', ['LT', 'LT2'], '7')).toMatchObject({ click_size: 'LT2' });
    expect(resolvePortalSize('M', ['M 5"'], '7')).toMatchObject({ status: 'missing', click_size: null });
  });

  test('matches aliases, waist inches, and tall-2 without changing the CLICK import label', () => {
    expect(resolvePortalSize('XXS', ['2XS'])).toMatchObject({ click_size: '2XS' });
    expect(resolvePortalSize('2XL', ['XXL'])).toMatchObject({ click_size: 'XXL' });
    expect(resolvePortalSize('28', ['28"'])).toMatchObject({ click_size: '28"' });
    expect(resolvePortalSize('LT2', ['LT', 'LT2'])).toMatchObject({ click_size: 'LT2' });
  });
});

describe('adidas CLICK planning', () => {
  test('splits against projected future ATP without adding it to current stock', () => {
    const plan = planAdidasClickOrder({
      lines: [{ sku: 'TOP1', sizes: { S: 8, M: 2, unit_cost: 10 } }],
      inventoryRows: inventory,
      defaultChoice: ADIDAS_CLICK_CHOICES.EACH_SIZE,
      ...headers,
    });

    expect(plan.issues).toEqual([]);
    expect(plan.customer_po).toBe('PO 60852');
    expect(plan.import_rows).toEqual([
      { article: 'TOP1', rdd: '2026-10-17', click_size: 'S', qty: 4 },
      { article: 'TOP1', rdd: '2026-10-20', click_size: 'S', qty: 2 },
      { article: 'TOP1', rdd: '2026-10-17', click_size: 'M', qty: 2 },
    ]);
    expect(plan.sku_plans[0]).toMatchObject({
      status: 'partial',
      unfilled: [{ click_size: 'S', qty: 2 }],
    });
  });

  test('puts every size of a complete SKU on its latest required date', () => {
    const plan = planAdidasClickOrder({
      lines: [{ sku: 'TOP1', sizes: { S: 6, M: 2 } }],
      inventoryRows: inventory,
      defaultChoice: ADIDAS_CLICK_CHOICES.COMPLETE_SKU,
      ...headers,
    });

    expect(plan.import_rows).toEqual([
      { article: 'TOP1', rdd: '2026-10-20', click_size: 'S', qty: 6 },
      { article: 'TOP1', rdd: '2026-10-20', click_size: 'M', qty: 2 },
    ]);
  });

  test('does not add current stock to projected ATP for a complete SKU', () => {
    const plan = planAdidasClickOrder({
      lines: [{ sku: 'TOP1', sizes: { S: 8 } }],
      inventoryRows: inventory,
      defaultChoice: ADIDAS_CLICK_CHOICES.COMPLETE_SKU,
      ...headers,
    });
    expect(plan.import_rows).toEqual([]);
    expect(plan.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'insufficient_inventory', sku: 'TOP1' }),
    ]));
    expect(plan.sku_plans[0].unfilled).toEqual([
      expect.objectContaining({ click_size: 'S', qty: 8, available: 6 }),
    ]);
  });

  test('plans zero-current future ATP as restock, never as stock now', () => {
    const plan = planAdidasClickOrder({
      lines: [{ sku: 'FUTURE1', sizes: { S: 5 } }],
      inventoryRows: [{
        sku: 'FUTURE1',
        size: 'S',
        stock_qty: 0,
        future_delivery_date: '2026-11-15',
        future_delivery_qty: 20,
        last_synced: '2026-10-17T12:00:00Z',
      }],
      defaultChoice: ADIDAS_CLICK_CHOICES.EACH_SIZE,
      ...headers,
    });
    expect(plan.import_rows).toEqual([
      { article: 'FUTURE1', rdd: '2026-11-15', click_size: 'S', qty: 5 },
    ]);
  });

  test('uses successful-run freshness in the resolved task plan', () => {
    const plan = planAdidasClickOrder({
      lines: [{ sku: 'TOP1', sizes: { M: 2 } }],
      inventoryRows: inventory,
      inventoryFreshness: '2026-10-17T15:00:00Z',
      ...headers,
    });
    expect(plan.inventory_as_of).toBe('2026-10-17T15:00:00Z');
  });

  test('resolves saved variants and schedules a deterministic held import', () => {
    const plan = planAdidasClickOrder({
      lines: [{ sku: 'IS1111', sizes: { S: 5, M: 4, notes: 'ignore' } }],
      inventoryRows: inventory,
      preferences: { IS1111: '7' },
      defaultChoice: ADIDAS_CLICK_CHOICES.HOLD,
      ...headers,
    });

    expect(plan.issues).toEqual([]);
    expect(plan.import_rows).toEqual([
      { article: 'IS1111', rdd: '2026-10-24', click_size: 'S 7"', qty: 5 },
      { article: 'IS1111', rdd: '2026-10-24', click_size: 'M 7"', qty: 4 },
    ]);
    expect(plan.sku_plans[0]).toMatchObject({
      status: 'scheduled',
      ready_date: '2026-10-24',
      requested: [
        { portal_size: 'S', click_size: 'S 7"', qty: 5 },
        { portal_size: 'M', click_size: 'M 7"', qty: 4 },
      ],
    });
    expect(plan.scheduled_for).toBe('2026-10-24T12:00:00.000Z');
  });

  test('combines mixed plain and inseam PO labels after variant resolution', () => {
    const plan = planAdidasClickOrder({
      lines: [{ sku: 'IS1111', sizes: { S: 2, 'S 7"': 3 } }],
      inventoryRows: inventory,
      preferences: { IS1111: '7' },
      defaultChoice: ADIDAS_CLICK_CHOICES.EACH_SIZE,
      ...headers,
    });

    expect(plan.sku_plans[0].requested).toEqual([
      expect.objectContaining({ portal_size: 'S + S 7"', click_size: 'S 7"', qty: 5 }),
    ]);
    expect(plan.import_rows).toEqual([
      { article: 'IS1111', rdd: '2026-10-17', click_size: 'S 7"', qty: 3 },
      { article: 'IS1111', rdd: '2026-10-24', click_size: 'S 7"', qty: 2 },
    ]);
  });

  test('aggregates duplicate article lines before spending inventory', () => {
    const plan = planAdidasClickOrder({
      lines: [
        { sku: 'DUP', sizes: { S: 4 } },
        { sku: 'DUP', sizes: { S: 4 } },
      ],
      inventoryRows: [{ sku: 'DUP', size: 'S', stock_qty: 5, last_synced: '2026-10-17T12:00:00Z' }],
      defaultChoice: ADIDAS_CLICK_CHOICES.AVAILABLE_NOW,
      ...headers,
    });

    expect(plan.sku_plans).toHaveLength(1);
    expect(plan.sku_plans[0].requested).toEqual([
      expect.objectContaining({ portal_size: 'S', click_size: 'S', qty: 8 }),
    ]);
    expect(plan.import_rows).toEqual([
      { article: 'DUP', rdd: '2026-10-17', click_size: 'S', qty: 5 },
    ]);
    expect(plan.sku_plans[0].unfilled).toEqual([
      expect.objectContaining({ click_size: 'S', qty: 3 }),
    ]);
  });

  test('blocks fractional, negative, and malformed quantities', () => {
    const plan = planAdidasClickOrder({
      lines: [{ sku: 'TOP1', sizes: { S: 1.5, M: -2, L: 'oops', XL: 0 } }],
      inventoryRows: inventory,
      defaultChoice: ADIDAS_CLICK_CHOICES.HOLD,
      ...headers,
    });

    expect(plan.issues.filter((issue) => issue.code === 'invalid_quantity')).toEqual([
      expect.objectContaining({ sku: 'TOP1', portal_size: 'S', value: 1.5 }),
      expect.objectContaining({ sku: 'TOP1', portal_size: 'M', value: -2 }),
      expect.objectContaining({ sku: 'TOP1', portal_size: 'L', value: 'oops' }),
    ]);
    expect(plan.import_rows).toEqual([]);
  });

  test('reports ambiguous variants before a task can be queued', () => {
    const plan = planAdidasClickOrder({
      lines: [{ sku: 'IS1111', sizes: { S: 5 } }],
      inventoryRows: inventory,
      ...headers,
    });
    expect(plan.issues).toEqual([
      expect.objectContaining({ code: 'size_variant_required', sku: 'IS1111', portal_size: 'S' }),
    ]);
    expect(plan.import_rows).toEqual([]);
  });
});

describe('CLICK workbook output', () => {
  test('matches the proven Apparel import layout', () => {
    const plan = planAdidasClickOrder({
      lines: [{ sku: 'TOP1', sizes: { S: 2 } }],
      inventoryRows: inventory,
      defaultChoice: ADIDAS_CLICK_CHOICES.AVAILABLE_NOW,
      ...headers,
    });
    const rows = clickImportAoa(plan, { cartName: 'TEST_GROK' });
    expect(rows[0]).toEqual([null, null, null, null, 'Cart Name', 'TEST_GROK']);
    expect(rows[3]).toEqual([null, null, null, null, 'Ship To Location Number', '6017364001']);
    expect(rows[4]).toEqual(['Sold To', 'Article Number', 'RDD', 'Size', 'Comments', 'Qty']);
    expect(rows[5]).toEqual(['6017364000', 'TOP1', '2026-10-17', 'S', null, 2]);

    const workbook = buildClickImportWorkbook(plan, { cartName: 'TEST_GROK' }, XLSX);
    expect(workbook.SheetNames).toEqual(['Apparel']);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Apparel, { header: 1, defval: null })[5]).toEqual(rows[5]);
  });

  test('sanitizes only characters CLICK rejects', () => {
    expect(sanitizeClickCustomerPo('PO-60#852 / A_B.?&')).toBe('PO 60 852 / A_B.?&');
  });
});
