/* eslint-disable */
const {
  safe, safeArr, safeObj, safeNum, safeStr, safeSizes, safePicks, safePOs, safeDecos, safeItems, safeArt, safeJobs,
  rQ, spP, emP, npP, dP, DTF,
  poCommitted, calcSOStatus, buildJobs, isJobReady, calcTotals, createInvoice,
  buildQBSalesOrder, buildQBInvoice,
  checkInventoryConflicts,
} = require('./businessLogic');

// ═══════════════════════════════════════════════
// TEST DATA FACTORIES
// ═══════════════════════════════════════════════
const makeProduct = (overrides = {}) => ({
  id: 'p1', sku: 'ADI-T1000', name: 'Adidas Tee', brand: 'Adidas', color: 'Black',
  nsa_cost: 12, retail_price: 30, vendor_id: 'v1',
  available_sizes: ['S', 'M', 'L', 'XL', '2XL'],
  _inv: { S: 10, M: 15, L: 20, XL: 10, '2XL': 5 },
  _alerts: { S: 5, M: 5, L: 5, XL: 3, '2XL': 2 },
  ...overrides,
});

const makeSOItem = (overrides = {}) => ({
  product_id: 'p1', sku: 'ADI-T1000', name: 'Adidas Tee', brand: 'Adidas', color: 'Black',
  nsa_cost: 12, unit_sell: 25, retail_price: 30,
  available_sizes: ['S', 'M', 'L', 'XL'],
  sizes: { S: 5, M: 10, L: 8, XL: 3 },
  decorations: [],
  pick_lines: [],
  po_lines: [],
  ...overrides,
});

const makeArtFile = (overrides = {}) => ({
  id: 'af1', name: 'Team Logo', deco_type: 'screen_print',
  ink_colors: 'PMS 123\nPMS 456', stitches: null,
  status: 'approved', files: ['logo.ai'], mockup_files: [], prod_files: ['logo_sep.ai'],
  ...overrides,
});

const makeSO = (overrides = {}) => ({
  id: 'SO-9001', customer_id: 'c1', memo: 'Test Order',
  status: 'need_order', created_by: 'r1',
  created_at: '02/15/26', updated_at: '02/15/26',
  default_markup: 1.65, expected_date: '2026-04-01',
  shipping_type: 'flat', shipping_value: 25,
  items: [makeSOItem()],
  art_files: [],
  jobs: [],
  ...overrides,
});

const makeInvoice = (overrides = {}) => ({
  id: 'INV-9001', type: 'invoice', customer_id: 'c1', so_id: 'SO-9001',
  date: '02/15/26', due_date: '03/17/26', total: 1000, paid: 0,
  memo: 'Test Invoice', status: 'open', payments: [], cc_fee: 0,
  ...overrides,
});

const makeCustomer = (overrides = {}) => ({
  id: 'c1', name: 'Test School', alpha_tag: 'TS',
  payment_terms: 'net30', tax_rate: 0.0775,
  catalog_markup: 1.65, adidas_ua_tier: 'B',
  ...overrides,
});

// ═══════════════════════════════════════════════
// 1. SAFE ACCESSOR TESTS
// ═══════════════════════════════════════════════
describe('Safe Accessors', () => {
  test('safeArr handles null/undefined/non-array', () => {
    expect(safeArr(null)).toEqual([]);
    expect(safeArr(undefined)).toEqual([]);
    expect(safeArr('string')).toEqual([]);
    expect(safeArr(42)).toEqual([]);
    expect(safeArr([1, 2])).toEqual([1, 2]);
  });

  test('safeObj handles null/undefined/arrays', () => {
    expect(safeObj(null)).toEqual({});
    expect(safeObj(undefined)).toEqual({});
    expect(safeObj([1, 2])).toEqual({});
    expect(safeObj({ a: 1 })).toEqual({ a: 1 });
  });

  test('safeNum handles non-numeric values', () => {
    expect(safeNum(null)).toBe(0);
    expect(safeNum(undefined)).toBe(0);
    expect(safeNum('hello')).toBe(0);
    expect(safeNum(NaN)).toBe(0);
    expect(safeNum(42)).toBe(42);
    expect(safeNum(3.14)).toBe(3.14);
  });

  test('safeSizes returns empty obj for missing sizes', () => {
    expect(safeSizes(null)).toEqual({});
    expect(safeSizes({})).toEqual({});
    expect(safeSizes({ sizes: { S: 5 } })).toEqual({ S: 5 });
  });

  test('safePicks/safePOs/safeDecos return empty arrays for missing data', () => {
    expect(safePicks(null)).toEqual([]);
    expect(safePicks({})).toEqual([]);
    expect(safePOs(null)).toEqual([]);
    expect(safeDecos(null)).toEqual([]);
    expect(safeItems(null)).toEqual([]);
    expect(safeJobs(null)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════
// 2. PRICING FUNCTION TESTS
// ═══════════════════════════════════════════════
describe('Pricing Functions', () => {
  test('rQ rounds to nearest quarter', () => {
    expect(rQ(1.1)).toBe(1);
    expect(rQ(1.13)).toBe(1.25);
    expect(rQ(1.37)).toBe(1.25);
    expect(rQ(1.38)).toBe(1.5);
    expect(rQ(1.63)).toBe(1.75);
    expect(rQ(1.87)).toBe(1.75);
    expect(rQ(1.88)).toBe(2);
  });

  describe('Screen Print Pricing (spP)', () => {
    test('1 color, 1-11 qty = $50 sell', () => {
      expect(spP(1, 1, true)).toBe(50);
    });

    test('1 color, 48-71 qty = $2.95 sell', () => {
      expect(spP(50, 1, true)).toBe(2.95);
    });

    test('2 colors, 24-35 qty sell price', () => {
      expect(spP(30, 2, true)).toBe(4.5);
    });

    test('cost = sell / markup (1.5)', () => {
      const sell = spP(50, 2, true);
      const cost = spP(50, 2, false);
      expect(cost).toBe(rQ(sell / 1.5));
    });

    test('returns 0 for invalid color count', () => {
      expect(spP(50, 0, true)).toBe(0);
      expect(spP(50, 6, true)).toBe(0);
    });

    test('returns 0 for qty out of range', () => {
      expect(spP(0, 1, true)).toBe(0);
    });
  });

  describe('Embroidery Pricing (emP)', () => {
    test('8000 stitches, 6 qty = $8 sell', () => {
      expect(emP(8000, 6, true)).toBe(8);
    });

    test('15000 stitches, 24 qty = $8.5 sell', () => {
      expect(emP(15000, 24, true)).toBe(8.5);
    });

    test('cost = sell / markup (1.6)', () => {
      const sell = emP(10000, 24, true);
      const cost = emP(10000, 24, false);
      expect(cost).toBe(rQ(sell / 1.6));
    });
  });

  describe('Number Press Pricing (npP)', () => {
    test('10 qty, single color = $7 sell', () => {
      expect(npP(10, false, true)).toBe(7);
    });

    test('50 qty, single color = $6 sell', () => {
      expect(npP(50, false, true)).toBe(6);
    });

    test('two-color adds surcharge', () => {
      const single = npP(10, false, true);
      const twoColor = npP(10, true, true);
      expect(twoColor).toBeGreaterThan(single);
    });

    test('cost version is lower', () => {
      const sell = npP(10, false, true);
      const cost = npP(10, false, false);
      expect(cost).toBeLessThan(sell);
    });
  });

  describe('Decoration Pricing (dP)', () => {
    test('art-based screen print with 2 ink colors', () => {
      const artFiles = [makeArtFile({ ink_colors: 'PMS 123\nPMS 456' })];
      const d = { kind: 'art', art_file_id: 'af1', position: 'Front' };
      const result = dP(d, 24, artFiles, 24);
      expect(result.sell).toBeGreaterThan(0);
      expect(result.cost).toBeGreaterThan(0);
      expect(result.sell).toBeGreaterThan(result.cost);
    });

    test('art-based embroidery', () => {
      const artFiles = [makeArtFile({ deco_type: 'embroidery', stitches: 10000, ink_colors: '' })];
      const d = { kind: 'art', art_file_id: 'af1', position: 'Left Chest' };
      const result = dP(d, 24, artFiles, 24);
      expect(result.sell).toBe(emP(10000, 24, true));
      expect(result.cost).toBe(emP(10000, 24, false));
    });

    test('art TBD screen print defaults to 1 color', () => {
      const d = { kind: 'art', art_file_id: '__tbd', art_tbd_type: 'screen_print', tbd_colors: 1 };
      const result = dP(d, 48, [], 48);
      // dP applies rQ() rounding: rQ(spP(48,1,true)*1) = rQ(2.95) = 3
      expect(result.sell).toBe(rQ(spP(48, 1, true)));
    });

    test('art TBD with sell_override uses override', () => {
      const d = { kind: 'art', art_file_id: '__tbd', art_tbd_type: 'screen_print', sell_override: 15 };
      const result = dP(d, 48, [], 48);
      expect(result.sell).toBe(15);
    });

    test('numbers decoration pricing with no roster', () => {
      const d = { kind: 'numbers', two_color: false };
      const result = dP(d, 24, [], 24);
      expect(result.sell).toBe(npP(1, false, true));
      expect(result.cost).toBe(npP(1, false, false));
      expect(result._nq).toBe(0);
    });

    test('numbers decoration pricing uses only assigned count', () => {
      const d = { kind: 'numbers', two_color: false, roster: { S: ['12', '5', ''], M: ['3', '', ''], L: ['7', '', ''] } };
      const result = dP(d, 15, [], 15);
      // 4 numbers assigned out of 15
      expect(result._nq).toBe(4);
      expect(result.sell).toBe(npP(4, false, true));
      expect(result.cost).toBe(npP(4, false, false));
    });

    test('names decoration pricing', () => {
      const d = { kind: 'names', sell_each: 6, cost_each: 3, names: {} };
      const result = dP(d, 24, [], 24);
      expect(result.sell).toBe(6);
      expect(result.cost).toBe(3);
    });

    test('names with actual names calculates per-unit', () => {
      const d = { kind: 'names', sell_each: 6, cost_each: 3, names: { S: ['Smith', 'Jones'], M: ['Brown'] } };
      const result = dP(d, 24, [], 24);
      // 3 names * $6 / 24 units = $0.75
      expect(result.sell).toBe(rQ(3 * 6 / 24));
    });

    test('outside_deco uses sell_each and cost_each', () => {
      const d = { kind: 'outside_deco', sell_each: 8, cost_each: 4 };
      const result = dP(d, 24, [], 24);
      expect(result.sell).toBe(8);
      expect(result.cost).toBe(4);
    });

    test('outside_deco with sell_override', () => {
      const d = { kind: 'outside_deco', sell_each: 8, cost_each: 4, sell_override: 12 };
      const result = dP(d, 24, [], 24);
      expect(result.sell).toBe(12);
      expect(result.cost).toBe(4);
    });

    test('unknown decoration kind returns zeros', () => {
      const d = { kind: 'unknown' };
      const result = dP(d, 24, [], 24);
      expect(result.sell).toBe(0);
      expect(result.cost).toBe(0);
    });

    test('underbase adds 15% surcharge to screen print', () => {
      const artFiles = [makeArtFile({ ink_colors: 'PMS 123' })];
      const withUB = dP({ kind: 'art', art_file_id: 'af1', underbase: true }, 24, artFiles, 24);
      const withoutUB = dP({ kind: 'art', art_file_id: 'af1', underbase: false }, 24, artFiles, 24);
      expect(withUB.sell).toBeGreaterThan(withoutUB.sell);
      // Should be approximately 15% more
      expect(withUB.sell / withoutUB.sell).toBeCloseTo(1.15, 1);
    });
  });
});

// ═══════════════════════════════════════════════
// 3. PO COMMITTED CALCULATION
// ═══════════════════════════════════════════════
describe('PO Committed', () => {
  test('returns 0 for empty po_lines', () => {
    expect(poCommitted([], 'M')).toBe(0);
    expect(poCommitted(null, 'M')).toBe(0);
  });

  test('sums ordered quantities for a size', () => {
    const poLines = [
      { S: 5, M: 10, po_id: 'PO-1' },
      { S: 3, M: 7, po_id: 'PO-2' },
    ];
    expect(poCommitted(poLines, 'M')).toBe(17);
    expect(poCommitted(poLines, 'S')).toBe(8);
  });

  test('subtracts cancelled quantities', () => {
    const poLines = [
      { S: 10, M: 20, po_id: 'PO-1', cancelled: { S: 3, M: 5 } },
    ];
    expect(poCommitted(poLines, 'S')).toBe(7);
    expect(poCommitted(poLines, 'M')).toBe(15);
  });

  test('handles missing size in PO', () => {
    const poLines = [{ S: 5, po_id: 'PO-1' }];
    expect(poCommitted(poLines, 'XL')).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// 4. SO STATUS CALCULATION
// ═══════════════════════════════════════════════
describe('SO Status Calculation (calcSOStatus)', () => {
  test('empty order returns need_order', () => {
    const so = makeSO({ items: [makeSOItem({ sizes: {} })] });
    expect(calcSOStatus(so)).toBe('need_order');
  });

  test('items with sizes but no picks/POs = need_order', () => {
    const so = makeSO();
    expect(calcSOStatus(so)).toBe('need_order');
  });

  test('all items covered by picks = waiting_receive', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 5, M: 10 },
        pick_lines: [{ status: 'pick', pick_id: 'IF-1', S: 5, M: 10 }],
      })],
    });
    expect(calcSOStatus(so)).toBe('waiting_receive');
  });

  test('all items covered by POs = waiting_receive', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 5, M: 10 },
        po_lines: [{ po_id: 'PO-1', S: 5, M: 10 }],
      })],
    });
    expect(calcSOStatus(so)).toBe('waiting_receive');
  });

  test('all items fulfilled (pulled picks) no deco = ready_to_invoice', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 5, M: 10 },
        decorations: [],
        pick_lines: [{ status: 'pulled', pick_id: 'IF-1', S: 5, M: 10 }],
      })],
      jobs: [],
    });
    expect(calcSOStatus(so)).toBe('ready_to_invoice');
  });

  test('all items fulfilled via PO received no deco = ready_to_invoice', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 5, M: 10 },
        decorations: [],
        po_lines: [{ po_id: 'PO-1', S: 5, M: 10, received: { S: 5, M: 10 } }],
      })],
      jobs: [],
    });
    expect(calcSOStatus(so)).toBe('ready_to_invoice');
  });

  test('with deco, items fulfilled, jobs in staging = in_production', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 5, M: 10 },
        decorations: [{ kind: 'art', art_file_id: 'af1', position: 'Front' }],
        pick_lines: [{ status: 'pulled', pick_id: 'IF-1', S: 5, M: 10 }],
      })],
      jobs: [{ prod_status: 'staging', art_status: 'art_complete' }],
    });
    expect(calcSOStatus(so)).toBe('in_production');
  });

  test('with deco, jobs in_process = in_production', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 5 },
        decorations: [{ kind: 'art', art_file_id: 'af1' }],
        pick_lines: [{ status: 'pulled', pick_id: 'IF-1', S: 5 }],
      })],
      jobs: [{ prod_status: 'in_process' }],
    });
    expect(calcSOStatus(so)).toBe('in_production');
  });

  test('all jobs completed = ready_to_invoice', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 5 },
        decorations: [{ kind: 'art', art_file_id: 'af1' }],
        pick_lines: [{ status: 'pulled', pick_id: 'IF-1', S: 5 }],
      })],
      jobs: [{ prod_status: 'completed' }],
    });
    expect(calcSOStatus(so)).toBe('ready_to_invoice');
  });

  test('all jobs shipped = complete', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 5 },
        decorations: [{ kind: 'art', art_file_id: 'af1' }],
        pick_lines: [{ status: 'pulled', pick_id: 'IF-1', S: 5 }],
      })],
      jobs: [{ prod_status: 'shipped' }],
    });
    expect(calcSOStatus(so)).toBe('complete');
  });

  test('partial picks = need_order (not enough coverage)', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 10, M: 10 },
        pick_lines: [{ status: 'pick', pick_id: 'IF-1', S: 5 }], // only partial
      })],
    });
    expect(calcSOStatus(so)).toBe('need_order');
  });

  test('mix of picks and POs covers all = waiting_receive', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 10, M: 10 },
        pick_lines: [{ status: 'pick', pick_id: 'IF-1', S: 10 }],
        po_lines: [{ po_id: 'PO-1', M: 10 }],
      })],
    });
    expect(calcSOStatus(so)).toBe('waiting_receive');
  });

  test('items_received when fulfilled but has deco and no active jobs', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 5 },
        decorations: [{ kind: 'art', art_file_id: 'af1' }],
        pick_lines: [{ status: 'pulled', pick_id: 'IF-1', S: 5 }],
      })],
      jobs: [], // no jobs created yet
    });
    expect(calcSOStatus(so)).toBe('items_received');
  });

  test('mixed job statuses — one staging, one completed = in_production', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 5 },
        decorations: [{ kind: 'art', art_file_id: 'af1' }],
        pick_lines: [{ status: 'pulled', pick_id: 'IF-1', S: 5 }],
      })],
      jobs: [{ prod_status: 'completed' }, { prod_status: 'staging' }],
    });
    expect(calcSOStatus(so)).toBe('in_production');
  });
});

// ═══════════════════════════════════════════════
// 5. TOTALS CALCULATION
// ═══════════════════════════════════════════════
describe('Totals Calculation', () => {
  test('basic item revenue and cost', () => {
    const so = makeSO({
      items: [makeSOItem({ sizes: { S: 5, M: 10 }, nsa_cost: 12, unit_sell: 25 })],
      shipping_type: 'flat', shipping_value: 0,
    });
    const totals = calcTotals(so, {});
    expect(totals.rev).toBe(15 * 25); // 375
    expect(totals.cost).toBe(15 * 12); // 180
    expect(totals.margin).toBe(375 - 180); // 195
  });

  test('flat shipping added to grand total', () => {
    const so = makeSO({
      items: [makeSOItem({ sizes: { M: 10 }, nsa_cost: 10, unit_sell: 20 })],
      shipping_type: 'flat', shipping_value: 25,
    });
    const totals = calcTotals(so, {});
    expect(totals.rev).toBe(200);
    expect(totals.ship).toBe(25);
    expect(totals.grand).toBe(225);
  });

  test('percentage shipping based on revenue', () => {
    const so = makeSO({
      items: [makeSOItem({ sizes: { M: 10 }, nsa_cost: 10, unit_sell: 20 })],
      shipping_type: 'pct', shipping_value: 5,
    });
    const totals = calcTotals(so, {});
    expect(totals.ship).toBe(200 * 5 / 100); // $10
    expect(totals.grand).toBe(210);
  });

  test('tax from customer tax_rate', () => {
    const so = makeSO({
      items: [makeSOItem({ sizes: { M: 10 }, unit_sell: 20 })],
      shipping_type: 'flat', shipping_value: 0,
    });
    const cust = makeCustomer({ tax_rate: 0.0775 });
    const totals = calcTotals(so, cust);
    expect(totals.tax).toBe(200 * 0.0775);
    expect(totals.grand).toBe(200 + 200 * 0.0775);
  });

  test('deco revenue and cost included', () => {
    const artFile = makeArtFile({ deco_type: 'screen_print', ink_colors: 'PMS 123\nPMS 456' });
    const so = makeSO({
      items: [makeSOItem({
        sizes: { M: 24 }, nsa_cost: 10, unit_sell: 20,
        decorations: [{ kind: 'art', art_file_id: 'af1', position: 'Front' }],
      })],
      art_files: [artFile],
      shipping_type: 'flat', shipping_value: 0,
    });
    const totals = calcTotals(so, {});
    const decoP = dP({ kind: 'art', art_file_id: 'af1', position: 'Front' }, 24, [artFile], 24);
    expect(totals.rev).toBe(24 * 20 + 24 * decoP.sell);
    expect(totals.cost).toBe(24 * 10 + 24 * decoP.cost);
  });

  test('multiple items totaled correctly', () => {
    const so = makeSO({
      items: [
        makeSOItem({ sizes: { S: 5 }, nsa_cost: 10, unit_sell: 20 }),
        makeSOItem({ sizes: { M: 10 }, nsa_cost: 15, unit_sell: 30 }),
      ],
      shipping_type: 'flat', shipping_value: 0,
    });
    const totals = calcTotals(so, {});
    expect(totals.rev).toBe(5 * 20 + 10 * 30); // 100 + 300 = 400
    expect(totals.cost).toBe(5 * 10 + 10 * 15); // 50 + 150 = 200
  });

  test('empty sizes produce zero revenue but shipping still applies', () => {
    const so = makeSO({ items: [makeSOItem({ sizes: {} })], shipping_type: 'flat', shipping_value: 25 });
    const totals = calcTotals(so, {});
    expect(totals.rev).toBe(0);
    expect(totals.cost).toBe(0);
    expect(totals.ship).toBe(25); // flat shipping always applies
    expect(totals.grand).toBe(25);
  });

  test('margin percentage calculated correctly', () => {
    const so = makeSO({
      items: [makeSOItem({ sizes: { M: 10 }, nsa_cost: 10, unit_sell: 20 })],
      shipping_type: 'flat', shipping_value: 0,
    });
    const totals = calcTotals(so, {});
    // rev=200, cost=100, margin=100, pct=50%
    expect(totals.pct).toBeCloseTo(50, 1);
  });

  test('outside deco PO cost included in cost', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { M: 10 }, nsa_cost: 10, unit_sell: 20,
        po_lines: [{ po_type: 'outside_deco', unit_cost: 5, M: 10 }],
      })],
      shipping_type: 'flat', shipping_value: 0,
    });
    const totals = calcTotals(so, {});
    // cost = 10*10 (item) + 10*5 (outside deco PO) = 150
    expect(totals.cost).toBe(150);
  });
});

// ═══════════════════════════════════════════════
// 6. INVOICE CREATION
// ═══════════════════════════════════════════════
describe('Invoice Creation', () => {
  test('basic invoice from SO with all items selected', () => {
    const so = makeSO({
      items: [
        makeSOItem({ sizes: { S: 5, M: 10 }, unit_sell: 25 }),
      ],
      shipping_type: 'flat', shipping_value: 25,
    });
    const cust = makeCustomer({ tax_rate: 0.0775 });
    const result = createInvoice(so, [0], cust, {});
    expect(result.selTotals.items).toBe(1);
    expect(result.selTotals.units).toBe(15);
    expect(result.selTotals.subtotal).toBe(15 * 25);
    expect(result.ship).toBe(25);
    expect(result.tax).toBe(375 * 0.0775);
    expect(result.total).toBeCloseTo(375 + 25 + 375 * 0.0775, 2);
  });

  test('partial item selection excludes shipping and tax', () => {
    const so = makeSO({
      items: [
        makeSOItem({ sizes: { S: 5 }, unit_sell: 20 }),
        makeSOItem({ sizes: { M: 10 }, unit_sell: 30 }),
      ],
      shipping_type: 'flat', shipping_value: 25,
    });
    const cust = makeCustomer({ tax_rate: 0.0775 });
    // Only selecting first item
    const result = createInvoice(so, [0], cust, {});
    expect(result.selTotals.items).toBe(1);
    expect(result.selTotals.units).toBe(5);
    expect(result.selTotals.subtotal).toBe(100);
    expect(result.ship).toBe(0); // partial = no shipping
    expect(result.tax).toBe(0); // partial = no tax
    expect(result.total).toBe(100);
  });

  test('invoice includes art decoration revenue', () => {
    const artFile = makeArtFile({ deco_type: 'screen_print', ink_colors: 'PMS 123\nPMS 456' });
    const so = makeSO({
      items: [makeSOItem({
        sizes: { M: 24 }, unit_sell: 20,
        decorations: [{ kind: 'art', art_file_id: 'af1', position: 'Front' }],
      })],
      art_files: [artFile],
      shipping_type: 'flat', shipping_value: 0,
    });
    const result = createInvoice(so, [0], {}, {});
    const decoP = dP({ kind: 'art', art_file_id: 'af1', position: 'Front' }, 24, [artFile], 24);
    expect(result.selTotals.subtotal).toBe(24 * 20 + 24 * decoP.sell);
  });

  test('invoice includes numbers decoration revenue only for assigned numbers', () => {
    const numRoster = { M: Array.from({ length: 24 }, (_, i) => String(i + 1)) };
    const so = makeSO({
      items: [makeSOItem({
        sizes: { M: 24 }, unit_sell: 20,
        decorations: [{ kind: 'numbers', two_color: false, roster: numRoster }],
      })],
      shipping_type: 'flat', shipping_value: 0,
    });
    const result = createInvoice(so, [0], {}, {});
    const numP = dP({ kind: 'numbers', two_color: false, roster: numRoster }, 24, [], 24);
    expect(result.selTotals.subtotal).toBe(24 * 20 + numP._nq * numP.sell);
  });

  test('invoice numbers revenue is zero when no numbers assigned', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { M: 24 }, unit_sell: 20,
        decorations: [{ kind: 'numbers', two_color: false }],
      })],
      shipping_type: 'flat', shipping_value: 0,
    });
    const result = createInvoice(so, [0], {}, {});
    // No roster = no numbers assigned, so numbers should contribute $0
    expect(result.selTotals.subtotal).toBe(24 * 20);
  });

  test('invoice includes names decoration revenue (BUG FIX VERIFICATION)', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { M: 24 }, unit_sell: 20,
        decorations: [{ kind: 'names', sell_each: 6, cost_each: 3, names: {} }],
      })],
      shipping_type: 'flat', shipping_value: 0,
    });
    const result = createInvoice(so, [0], {}, {});
    const nameP = dP({ kind: 'names', sell_each: 6, cost_each: 3, names: {} }, 24, [], 24);
    expect(result.selTotals.subtotal).toBe(24 * 20 + 24 * nameP.sell);
    expect(result.selTotals.subtotal).toBeGreaterThan(24 * 20); // names should add revenue
  });

  test('invoice includes outside_deco decoration revenue (BUG FIX VERIFICATION)', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { M: 24 }, unit_sell: 20,
        decorations: [{ kind: 'outside_deco', sell_each: 8, cost_each: 4 }],
      })],
      shipping_type: 'flat', shipping_value: 0,
    });
    const result = createInvoice(so, [0], {}, {});
    // outside_deco: sell_each=8 per unit
    expect(result.selTotals.subtotal).toBe(24 * 20 + 24 * 8);
  });

  test('line items have correct structure', () => {
    const so = makeSO({
      items: [makeSOItem({
        sku: 'TEST-100', name: 'Test Shirt', color: 'Red',
        sizes: { M: 10 }, unit_sell: 25,
      })],
      shipping_type: 'flat', shipping_value: 0,
    });
    const result = createInvoice(so, [0], {}, {});
    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0].desc).toBe('TEST-100 Test Shirt — Red');
    expect(result.lineItems[0].qty).toBe(10);
    expect(result.lineItems[0].rate).toBe(25);
    expect(result.lineItems[0].amount).toBe(250);
  });
});

// ═══════════════════════════════════════════════
// 7. JOB BUILDING
// ═══════════════════════════════════════════════
describe('Job Building', () => {
  test('returns existing jobs if present', () => {
    const existingJobs = [{ id: 'JOB-1', prod_status: 'staging' }];
    const so = makeSO({ jobs: existingJobs });
    expect(buildJobs(so)).toBe(existingJobs);
  });

  test('generates jobs from art decorations', () => {
    const artFile = makeArtFile();
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 5, M: 10 },
        decorations: [{ kind: 'art', art_file_id: 'af1', position: 'Front Center' }],
      })],
      art_files: [artFile],
      jobs: [],
    });
    const jobs = buildJobs(so);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].art_file_id).toBe('af1');
    expect(jobs[0].art_name).toBe('Team Logo');
    expect(jobs[0].total_units).toBe(15);
    expect(jobs[0].art_status).toBe('art_complete');
    expect(jobs[0]._auto).toBe(true);
  });

  test('groups same art across multiple items into one job', () => {
    const so = makeSO({
      items: [
        makeSOItem({ sku: 'ITEM-1', sizes: { S: 5 }, decorations: [{ kind: 'art', art_file_id: 'af1', position: 'Front' }] }),
        makeSOItem({ sku: 'ITEM-2', sizes: { M: 10 }, decorations: [{ kind: 'art', art_file_id: 'af1', position: 'Front' }] }),
      ],
      art_files: [makeArtFile()],
      jobs: [],
    });
    const jobs = buildJobs(so);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].total_units).toBe(15);
    expect(jobs[0].items).toHaveLength(2);
  });

  test('same item with multiple decos creates one job (same decoration signature)', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 10 },
        decorations: [
          { kind: 'art', art_file_id: 'af1', position: 'Front' },
          { kind: 'art', art_file_id: 'af1', position: 'Back' },
        ],
      })],
      art_files: [makeArtFile()],
      jobs: [],
    });
    const jobs = buildJobs(so);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].total_units).toBe(10);
  });

  test('items with different decoration sets create separate jobs', () => {
    const so = makeSO({
      items: [
        makeSOItem({ sku: 'ITEM-1', sizes: { S: 5 }, decorations: [
          { kind: 'art', art_file_id: 'af1', position: 'Front' },
          { kind: 'art', art_file_id: 'af1', position: 'Back' },
        ] }),
        makeSOItem({ sku: 'ITEM-2', sizes: { M: 10 }, decorations: [
          { kind: 'art', art_file_id: 'af1', position: 'Front' },
        ] }),
      ],
      art_files: [makeArtFile()],
      jobs: [],
    });
    const jobs = buildJobs(so);
    expect(jobs).toHaveLength(2);
  });

  test('no_deco items are skipped', () => {
    const so = makeSO({
      items: [makeSOItem({
        no_deco: true,
        sizes: { S: 10 },
        decorations: [{ kind: 'art', art_file_id: 'af1', position: 'Front' }],
      })],
      art_files: [makeArtFile()],
      jobs: [],
    });
    const jobs = buildJobs(so);
    expect(jobs).toHaveLength(0);
  });

  test('number decorations generate jobs, name decorations do not', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 10 },
        decorations: [
          { kind: 'numbers', position: 'Back' },
          { kind: 'names', position: 'Back' },
        ],
      })],
      jobs: [],
    });
    const jobs = buildJobs(so);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].art_name).toContain('Numbers');
  });

  test('art status from art file propagates to job', () => {
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 10 },
        decorations: [{ kind: 'art', art_file_id: 'af1', position: 'Front' }],
      })],
      art_files: [makeArtFile({ status: 'uploaded' })],
      jobs: [],
    });
    const jobs = buildJobs(so);
    expect(jobs[0].art_status).toBe('waiting_approval');
  });
});

// ═══════════════════════════════════════════════
// 8. JOB READINESS
// ═══════════════════════════════════════════════
describe('Job Readiness (isJobReady)', () => {
  test('not ready if art not approved', () => {
    const job = { art_status: 'waiting_approval', art_file_id: 'af1', items: [{ item_idx: 0 }] };
    const so = makeSO({
      items: [makeSOItem({ sizes: { S: 5 }, pick_lines: [{ status: 'pulled', S: 5 }] })],
      art_files: [makeArtFile({ status: 'approved', prod_files: ['sep.ai'] })],
    });
    expect(isJobReady(job, so)).toBe(false);
  });

  test('not ready if no prod files', () => {
    const job = { art_status: 'art_complete', art_file_id: 'af1', items: [{ item_idx: 0 }] };
    const so = makeSO({
      items: [makeSOItem({ sizes: { S: 5 }, pick_lines: [{ status: 'pulled', S: 5 }] })],
      art_files: [makeArtFile({ prod_files: [] })],
    });
    expect(isJobReady(job, so)).toBe(false);
  });

  test('not ready if items not received', () => {
    const job = { art_status: 'art_complete', art_file_id: 'af1', items: [{ item_idx: 0 }] };
    const so = makeSO({
      items: [makeSOItem({ sizes: { S: 5 }, pick_lines: [] })],
      art_files: [makeArtFile({ prod_files: ['sep.ai'] })],
    });
    expect(isJobReady(job, so)).toBe(false);
  });

  test('ready when art approved + prod files + items received', () => {
    const job = { art_status: 'art_complete', art_file_id: 'af1', items: [{ item_idx: 0 }] };
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 5, M: 10 },
        pick_lines: [{ status: 'pulled', pick_id: 'IF-1', S: 5, M: 10 }],
      })],
      art_files: [makeArtFile({ prod_files: ['sep.ai'] })],
    });
    expect(isJobReady(job, so)).toBe(true);
  });

  test('ready when items received via PO', () => {
    const job = { art_status: 'art_complete', art_file_id: 'af1', items: [{ item_idx: 0 }] };
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 5, M: 10 },
        po_lines: [{ po_id: 'PO-1', S: 5, M: 10, received: { S: 5, M: 10 } }],
      })],
      art_files: [makeArtFile({ prod_files: ['sep.ai'] })],
    });
    expect(isJobReady(job, so)).toBe(true);
  });

  test('not ready if partial items received', () => {
    const job = { art_status: 'art_complete', art_file_id: 'af1', items: [{ item_idx: 0 }] };
    const so = makeSO({
      items: [makeSOItem({
        sizes: { S: 5, M: 10 },
        pick_lines: [{ status: 'pulled', pick_id: 'IF-1', S: 5 }], // M not pulled
      })],
      art_files: [makeArtFile({ prod_files: ['sep.ai'] })],
    });
    expect(isJobReady(job, so)).toBe(false);
  });
});

// ═══════════════════════════════════════════════
// 9. QB SYNC BUILDERS
// ═══════════════════════════════════════════════
describe('QB Sync Builders', () => {
  const qbMapping = {
    income_account: 'Sales',
    cogs_account: 'Cost of Goods Sold',
    deco_account: 'Subcontractor - Decoration',
    ar_account: 'Accounts Receivable',
    ap_account: 'Accounts Payable',
  };

  describe('buildQBSalesOrder', () => {
    test('creates basic SO with item lines', () => {
      const so = makeSO({
        items: [makeSOItem({ sizes: { S: 5, M: 10 }, unit_sell: 25 })],
      });
      const cust = makeCustomer();
      const result = buildQBSalesOrder(so, cust, qbMapping);
      expect(result.docType).toBe('SalesOrder');
      expect(result.docNumber).toBe('SO-9001');
      expect(result.customerRef).toBe('Test School');
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].qty).toBe(15);
      expect(result.lines[0].rate).toBe(25);
      expect(result.total).toBe(375);
    });

    test('includes decoration lines using dP() (BUG FIX VERIFICATION)', () => {
      const artFile = makeArtFile({ deco_type: 'screen_print', ink_colors: 'PMS 123\nPMS 456' });
      const so = makeSO({
        items: [makeSOItem({
          sizes: { M: 24 }, unit_sell: 20,
          decorations: [{ kind: 'art', art_file_id: 'af1', position: 'Front Center' }],
        })],
        art_files: [artFile],
      });
      const result = buildQBSalesOrder(so, makeCustomer(), qbMapping);
      expect(result.lines).toHaveLength(2); // item + deco
      const decoP = dP({ kind: 'art', art_file_id: 'af1' }, 24, [artFile], 24);
      expect(result.lines[1].rate).toBe(decoP.sell);
      expect(result.lines[1].amount).toBe(24 * decoP.sell);
      expect(result.total).toBe(24 * 20 + 24 * decoP.sell);
    });

    test('skips items with zero quantities', () => {
      const so = makeSO({
        items: [
          makeSOItem({ sizes: { S: 5 }, unit_sell: 20 }),
          makeSOItem({ sizes: {}, unit_sell: 30 }),
        ],
      });
      const result = buildQBSalesOrder(so, makeCustomer(), qbMapping);
      expect(result.lines).toHaveLength(1);
    });

    test('numbers decoration included in QB sync', () => {
      const so = makeSO({
        items: [makeSOItem({
          sizes: { M: 24 }, unit_sell: 20,
          decorations: [{ kind: 'numbers', two_color: false }],
        })],
      });
      const result = buildQBSalesOrder(so, makeCustomer(), qbMapping);
      expect(result.lines).toHaveLength(2);
      expect(result.lines[1].desc).toContain('Decoration');
    });
  });

  describe('buildQBInvoice', () => {
    test('creates invoice with correct fields', () => {
      const inv = makeInvoice({ date: '02/15/26', total: 1000, paid: 500 });
      const cust = [makeCustomer()];
      const sos = [makeSO()];
      const result = buildQBInvoice(inv, sos, cust, qbMapping);
      expect(result.docType).toBe('Invoice');
      expect(result.docNumber).toBe('INV-9001');
      expect(result.date).toBe('02/15/26'); // BUG FIX: was using created_at
      expect(result.amount).toBe(1000);
      expect(result.paid).toBe(500);
      expect(result.balance).toBe(500);
      expect(result.account).toBe('Accounts Receivable');
    });

    test('handles missing SO gracefully', () => {
      const inv = makeInvoice({ so_id: null });
      const result = buildQBInvoice(inv, [], [makeCustomer()], qbMapping);
      expect(result.soRef).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════
// 10. INVENTORY CONFLICT DETECTION
// ═══════════════════════════════════════════════
describe('Inventory Conflict Detection', () => {
  test('no conflicts when no other SOs have open picks', () => {
    const currentSO = makeSO({ id: 'SO-1' });
    const item = makeSOItem({ sku: 'ADI-T1000' });
    const newInv = { S: 5, M: 10 };
    const allOrders = [makeSO({ id: 'SO-2', items: [makeSOItem({ sku: 'OTHER-SKU' })] })];
    const warnings = checkInventoryConflicts(currentSO, item, newInv, allOrders);
    expect(warnings).toHaveLength(0);
  });

  test('detects conflict when other SO has open pick exceeding inventory', () => {
    const currentSO = makeSO({ id: 'SO-1' });
    const item = makeSOItem({ sku: 'ADI-T1000', product_id: 'p1' });
    const newInv = { S: 3, M: 5 }; // reduced inventory
    const allOrders = [
      makeSO({
        id: 'SO-2',
        items: [makeSOItem({
          sku: 'ADI-T1000', product_id: 'p1',
          pick_lines: [{ status: 'pick', pick_id: 'IF-100', S: 5, M: 3 }], // S needs 5, only 3 available
        })],
      }),
    ];
    const warnings = checkInventoryConflicts(currentSO, item, newInv, allOrders);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].so).toBe('SO-2');
    expect(warnings[0].sizes).toHaveLength(1); // only S exceeds
  });

  test('skips pulled picks (already fulfilled)', () => {
    const currentSO = makeSO({ id: 'SO-1' });
    const item = makeSOItem({ sku: 'ADI-T1000', product_id: 'p1' });
    const newInv = { S: 0 };
    const allOrders = [
      makeSO({
        id: 'SO-2',
        items: [makeSOItem({
          sku: 'ADI-T1000', product_id: 'p1',
          pick_lines: [{ status: 'pulled', pick_id: 'IF-100', S: 5 }], // already pulled
        })],
      }),
    ];
    const warnings = checkInventoryConflicts(currentSO, item, newInv, allOrders);
    expect(warnings).toHaveLength(0);
  });

  test('skips current SO', () => {
    const currentSO = makeSO({ id: 'SO-1' });
    const item = makeSOItem({ sku: 'ADI-T1000', product_id: 'p1' });
    const newInv = { S: 0 };
    const allOrders = [
      makeSO({
        id: 'SO-1', // same as current
        items: [makeSOItem({
          sku: 'ADI-T1000', product_id: 'p1',
          pick_lines: [{ status: 'pick', pick_id: 'IF-100', S: 5 }],
        })],
      }),
    ];
    const warnings = checkInventoryConflicts(currentSO, item, newInv, allOrders);
    expect(warnings).toHaveLength(0);
  });

  test('multiple SOs with conflicts all reported', () => {
    const currentSO = makeSO({ id: 'SO-1' });
    const item = makeSOItem({ sku: 'ADI-T1000', product_id: 'p1' });
    const newInv = { S: 2 };
    const allOrders = [
      makeSO({
        id: 'SO-2',
        items: [makeSOItem({ sku: 'ADI-T1000', product_id: 'p1', pick_lines: [{ status: 'pick', pick_id: 'IF-100', S: 5 }] })],
      }),
      makeSO({
        id: 'SO-3',
        items: [makeSOItem({ sku: 'ADI-T1000', product_id: 'p1', pick_lines: [{ status: 'pick', pick_id: 'IF-200', S: 3 }] })],
      }),
    ];
    const warnings = checkInventoryConflicts(currentSO, item, newInv, allOrders);
    expect(warnings).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════
// 11. CROSS-MODULE INTEGRATION SCENARIOS
// ═══════════════════════════════════════════════
describe('Cross-Module Integration Scenarios', () => {
  describe('Scenario: Full order lifecycle (Estimate → SO → Pick → Invoice)', () => {
    test('estimate converted to SO preserves items and pricing', () => {
      const estimate = {
        id: 'EST-100', customer_id: 'c1', memo: 'Baseball Order',
        default_markup: 1.65, shipping_type: 'pct', shipping_value: 5,
        items: [makeSOItem({
          sizes: { S: 5, M: 10, L: 8 },
          unit_sell: 25, nsa_cost: 12,
          decorations: [{ kind: 'art', art_file_id: '__tbd', art_tbd_type: 'screen_print', tbd_colors: 2 }],
        })],
        art_files: [],
      };
      // Conversion preserves items
      const soItems = safeItems(estimate).map(it => ({
        ...it, decorations: safeDecos(it).map(d => ({ ...d })),
      }));
      expect(soItems).toHaveLength(1);
      expect(soItems[0].sizes).toEqual({ S: 5, M: 10, L: 8 });
      expect(soItems[0].unit_sell).toBe(25);
    });

    test('SO status progresses correctly through lifecycle', () => {
      // Step 1: Need order
      const so = makeSO({
        items: [makeSOItem({
          sizes: { S: 5, M: 10 }, unit_sell: 25,
          decorations: [{ kind: 'art', art_file_id: 'af1', position: 'Front' }],
        })],
        art_files: [makeArtFile()],
      });
      expect(calcSOStatus(so)).toBe('need_order');

      // Step 2: Create pick → waiting_receive
      so.items[0].pick_lines = [{ status: 'pick', pick_id: 'IF-1', S: 5, M: 10 }];
      expect(calcSOStatus(so)).toBe('waiting_receive');

      // Step 3: Pull pick → items_received (has deco but no jobs yet)
      so.items[0].pick_lines[0].status = 'pulled';
      expect(calcSOStatus(so)).toBe('items_received');

      // Step 4: Jobs in production
      so.jobs = [{ prod_status: 'in_process', art_status: 'art_complete' }];
      expect(calcSOStatus(so)).toBe('in_production');

      // Step 5: Jobs completed → ready_to_invoice
      so.jobs[0].prod_status = 'completed';
      expect(calcSOStatus(so)).toBe('ready_to_invoice');

      // Step 6: Jobs shipped → complete
      so.jobs[0].prod_status = 'shipped';
      expect(calcSOStatus(so)).toBe('complete');
    });

    test('invoice total matches SO total for full order', () => {
      const artFile = makeArtFile({ deco_type: 'screen_print', ink_colors: 'PMS 123\nPMS 456' });
      const so = makeSO({
        items: [makeSOItem({
          sizes: { M: 24 }, unit_sell: 20, nsa_cost: 10,
          decorations: [{ kind: 'art', art_file_id: 'af1', position: 'Front' }],
        })],
        art_files: [artFile],
        shipping_type: 'flat', shipping_value: 25,
      });
      const cust = makeCustomer({ tax_rate: 0.0775 });
      const soTotals = calcTotals(so, cust);
      const invResult = createInvoice(so, [0], cust, {});
      // When all items are selected, invoice total should match SO grand total
      expect(invResult.total).toBeCloseTo(soTotals.grand, 2);
    });
  });

  describe('Scenario: Inventory depletion across SOs', () => {
    test('pick from one SO detected as conflict for another SO', () => {
      const product = makeProduct({ _inv: { S: 10 } });
      // SO-1 pulls 8 units of S
      const so1 = makeSO({ id: 'SO-1', items: [makeSOItem({ sku: 'ADI-T1000', product_id: 'p1' })] });
      const newInv = { S: 2 }; // after pulling 8 from 10
      // SO-2 has an open pick for 5 units of S
      const so2 = makeSO({
        id: 'SO-2',
        items: [makeSOItem({
          sku: 'ADI-T1000', product_id: 'p1',
          pick_lines: [{ status: 'pick', pick_id: 'IF-200', S: 5 }],
        })],
      });
      const warnings = checkInventoryConflicts(so1, so1.items[0], newInv, [so2]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].so).toBe('SO-2');
    });
  });

  describe('Scenario: Multiple decoration types on one SO', () => {
    test('totals include all deco types', () => {
      const artFile = makeArtFile({ deco_type: 'screen_print', ink_colors: 'PMS 123' });
      const numRoster = { M: Array.from({ length: 24 }, (_, i) => String(i + 1)) };
      const so = makeSO({
        items: [makeSOItem({
          sizes: { M: 24 }, unit_sell: 20, nsa_cost: 10,
          decorations: [
            { kind: 'art', art_file_id: 'af1', position: 'Front' },
            { kind: 'numbers', two_color: false, position: 'Back', roster: numRoster },
            { kind: 'names', sell_each: 6, cost_each: 3, names: {}, position: 'Back' },
            { kind: 'outside_deco', sell_each: 5, cost_each: 2.5, position: 'Sleeve' },
          ],
        })],
        art_files: [artFile],
        shipping_type: 'flat', shipping_value: 0,
      });
      const totals = calcTotals(so, {});
      // Revenue should include: item + art + numbers (all 24 assigned) + names + outside_deco
      const artP = dP({ kind: 'art', art_file_id: 'af1' }, 24, [artFile], 24);
      const numP = dP({ kind: 'numbers', two_color: false, roster: numRoster }, 24, [], 24);
      const nameP = dP({ kind: 'names', sell_each: 6, cost_each: 3, names: {} }, 24, [], 24);
      const outsideP = dP({ kind: 'outside_deco', sell_each: 5, cost_each: 2.5 }, 24, [], 24);
      const expectedRev = 24 * (20 + artP.sell + nameP.sell + outsideP.sell) + numP._nq * numP.sell;
      expect(totals.rev).toBeCloseTo(expectedRev, 2);
    });

    test('invoice includes all deco types (integration verification)', () => {
      const artFile = makeArtFile({ deco_type: 'screen_print', ink_colors: 'PMS 123' });
      const numRoster = { M: Array.from({ length: 24 }, (_, i) => String(i + 1)) };
      const so = makeSO({
        items: [makeSOItem({
          sizes: { M: 24 }, unit_sell: 20,
          decorations: [
            { kind: 'art', art_file_id: 'af1', position: 'Front' },
            { kind: 'numbers', two_color: false, roster: numRoster },
            { kind: 'names', sell_each: 6, cost_each: 3, names: {} },
            { kind: 'outside_deco', sell_each: 5, cost_each: 2.5 },
          ],
        })],
        art_files: [artFile],
        shipping_type: 'flat', shipping_value: 0,
      });
      const invResult = createInvoice(so, [0], {}, {});
      const soTotals = calcTotals(so, {});
      // Invoice subtotal should match SO revenue (when all items selected and no shipping/tax)
      expect(invResult.selTotals.subtotal).toBeCloseTo(soTotals.rev, 2);
    });

    test('QB sync includes all deco types', () => {
      const artFile = makeArtFile({ deco_type: 'screen_print', ink_colors: 'PMS 123' });
      const so = makeSO({
        items: [makeSOItem({
          sizes: { M: 24 }, unit_sell: 20,
          decorations: [
            { kind: 'art', art_file_id: 'af1', position: 'Front' },
            { kind: 'numbers', two_color: false },
            { kind: 'outside_deco', sell_each: 5, cost_each: 2.5 },
          ],
        })],
        art_files: [artFile],
      });
      const qbMapping = { income_account: 'Sales' };
      const result = buildQBSalesOrder(so, makeCustomer(), qbMapping);
      // 1 item line + 3 deco lines
      expect(result.lines).toHaveLength(4);
    });
  });

  describe('Scenario: PO with cancellations', () => {
    test('cancelled PO quantities reduce committed count', () => {
      const so = makeSO({
        items: [makeSOItem({
          sizes: { S: 10, M: 10 },
          po_lines: [{
            po_id: 'PO-1', S: 10, M: 10,
            cancelled: { S: 5 }, // cancelled 5 of S
          }],
        })],
      });
      // S: 10 ordered - 5 cancelled = 5 committed (not enough for 10 needed)
      // M: 10 ordered - 0 cancelled = 10 committed (enough)
      expect(poCommitted(so.items[0].po_lines, 'S')).toBe(5);
      expect(poCommitted(so.items[0].po_lines, 'M')).toBe(10);
      // SO status should be need_order since S is not fully covered
      expect(calcSOStatus(so)).toBe('need_order');
    });
  });

  describe('Scenario: Jobs match SO decorations', () => {
    test('buildJobs creates correct job count for complex SO', () => {
      const so = makeSO({
        items: [
          makeSOItem({
            sku: 'SHIRT-1', sizes: { S: 10, M: 10 },
            decorations: [
              { kind: 'art', art_file_id: 'af1', position: 'Front' },
              { kind: 'art', art_file_id: 'af2', position: 'Back' },
            ],
          }),
          makeSOItem({
            sku: 'SHIRT-2', sizes: { L: 5 },
            decorations: [
              { kind: 'art', art_file_id: 'af1', position: 'Front' },
              { kind: 'numbers', position: 'Back', num_method: 'heat_transfer' },
            ],
          }),
        ],
        art_files: [
          makeArtFile({ id: 'af1', name: 'Front Logo' }),
          makeArtFile({ id: 'af2', name: 'Back Logo' }),
        ],
        jobs: [],
      });
      const jobs = buildJobs(so);
      // SHIRT-1: art_af1@Front + art_af2@Back → one decoration signature
      // SHIRT-2: art_af1@Front + numbers_ht@Back → different decoration signature
      // = 2 separate jobs (different decoration combos)
      expect(jobs).toHaveLength(2);
      const shirt1Job = jobs.find(j => j.items.some(it => it.sku === 'SHIRT-1'));
      const shirt2Job = jobs.find(j => j.items.some(it => it.sku === 'SHIRT-2'));
      expect(shirt1Job.items).toHaveLength(1);
      expect(shirt1Job.total_units).toBe(20);
      expect(shirt2Job.items).toHaveLength(1);
      expect(shirt2Job.total_units).toBe(5);
    });
  });
});

// ═══════════════════════════════════════════════
// 12. EDGE CASES & REGRESSION TESTS
// ═══════════════════════════════════════════════
describe('Edge Cases', () => {
  test('null/undefined order does not crash calcSOStatus', () => {
    expect(calcSOStatus(null)).toBe('need_order');
    expect(calcSOStatus(undefined)).toBe('need_order');
    expect(calcSOStatus({})).toBe('need_order');
  });

  test('null/undefined order does not crash buildJobs', () => {
    expect(buildJobs(null)).toEqual([]);
    expect(buildJobs(undefined)).toEqual([]);
  });

  test('calcTotals handles zero-quantity items gracefully', () => {
    const so = makeSO({
      items: [
        makeSOItem({ sizes: { S: 0, M: 0 } }),
        makeSOItem({ sizes: { L: 5 }, unit_sell: 20, nsa_cost: 10 }),
      ],
      shipping_type: 'flat', shipping_value: 10,
    });
    const totals = calcTotals(so, {});
    expect(totals.rev).toBe(100);
    expect(totals.cost).toBe(50);
  });

  test('createInvoice with empty selection', () => {
    const so = makeSO({ items: [makeSOItem()] });
    const result = createInvoice(so, [], {}, {});
    expect(result.selTotals.items).toBe(0);
    expect(result.selTotals.units).toBe(0);
    expect(result.total).toBe(0);
    expect(result.lineItems).toHaveLength(0);
  });

  test('very large quantities handled correctly', () => {
    const so = makeSO({
      items: [makeSOItem({ sizes: { M: 10000 }, unit_sell: 1.99, nsa_cost: 0.99 })],
      shipping_type: 'flat', shipping_value: 0,
    });
    const totals = calcTotals(so, {});
    expect(totals.rev).toBe(19900);
    expect(totals.cost).toBe(9900);
  });

  test('poCommitted with complex multi-PO scenario', () => {
    const poLines = [
      { po_id: 'PO-1', S: 20, M: 30, cancelled: { S: 5 } },
      { po_id: 'PO-2', S: 10, M: 15, cancelled: { M: 10 } },
      { po_id: 'PO-3', S: 5 },
    ];
    expect(poCommitted(poLines, 'S')).toBe(30); // 15+10+5
    expect(poCommitted(poLines, 'M')).toBe(35); // 30+5
  });
});
