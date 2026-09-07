/* eslint-disable */
// ═══════════════════════════════════════════════
// ADVERSARIAL / CHARACTERIZATION TESTS — src/safeHelpers.js
// invoice reconciliation helpers: buildInvoicedQtyMap, sumDepositInvoiced,
// rekeyGarmentMocks.
//
// Each behavior below was RE-VERIFIED by running the real function before
// being written here. Where current behavior is questionable but
// deliberately left unchanged, the test PINS it with a comment explaining
// the concern, so any future change is a visible, deliberate diff.
// ═══════════════════════════════════════════════
const { buildInvoicedQtyMap, staleInvoiceQtyConflicts, invoicedLineOrphans, sumDepositInvoiced, rekeyGarmentMocks, soLineKey } = require('../safeHelpers');

const makeSO = (overrides = {}) => ({
  id: 'SO-1',
  items: [
    { sku: 'A', color: 'Black', sizes: { S: 10 } },
    { sku: 'B', color: 'White', sizes: { S: 5 } },
  ],
  ...overrides,
});

// ─────────────────────────────────────────────
// 11. buildInvoicedQtyMap happy path
// ─────────────────────────────────────────────
describe('Gap 11: buildInvoicedQtyMap happy path sums qty across multiple invoices for the same line', () => {
  test('two invoices billing the same SO line key sum to their combined qty', () => {
    const so = makeSO();
    const key0 = soLineKey(so.items[0], 0);
    const invoices = [
      { inv_type: 'final', line_items: [{ _so_line_key: key0, qty: 3 }] },
      { inv_type: 'final', line_items: [{ _so_line_key: key0, qty: 4 }] },
    ];
    const map = buildInvoicedQtyMap(so, invoices);
    expect(map.get(key0)).toBe(7);
    // Line 1 (item B) was never invoiced — pre-seeded to 0.
    expect(map.get(soLineKey(so.items[1], 1))).toBe(0);
  });
});

// ─────────────────────────────────────────────
// 12. buildInvoicedQtyMap with a negative line qty
// ─────────────────────────────────────────────
describe('Gap 12 (regression): buildInvoicedQtyMap ignores negative line quantities', () => {
  test('a negative qty line item contributes nothing — no negative invoiced totals', () => {
    const so = makeSO();
    const key0 = soLineKey(so.items[0], 0);
    // Regression: a negative qty used to sum straight in, deflating the invoiced
    // total and inflating "remaining to invoice" (over-invoice risk). Negative
    // quantities are invalid data, not credit memos — they're skipped now.
    const invoices = [{ inv_type: 'final', line_items: [{ _so_line_key: key0, qty: -2 }] }];
    expect(buildInvoicedQtyMap(so, invoices).get(key0) || 0).toBe(0);
    // A mixed invoice still counts its valid lines.
    const mixed = [{ inv_type: 'final', line_items: [{ _so_line_key: key0, qty: -2 }, { _so_line_key: key0, qty: 3 }] }];
    expect(buildInvoicedQtyMap(so, mixed).get(key0)).toBe(3);
  });
});

describe('staleInvoiceQtyConflicts — blocks duplicate creation from a stale tab', () => {
  test('reports a selected line whose live invoiced quantity increased', () => {
    const so = makeSO();
    const key0 = soLineKey(so.items[0], 0);
    const live = [{ id: 'INV-2', inv_type: 'full', line_items: [{ _so_line_key: key0, qty: 1 }] }];
    expect(staleInvoiceQtyConflicts(so, [], live, [0])).toEqual([
      expect.objectContaining({ idx: 0, key: key0, localQty: 0, liveQty: 1, delta: 1 }),
    ]);
  });

  test('does not block when the live and local snapshots agree', () => {
    const so = makeSO();
    const key0 = soLineKey(so.items[0], 0);
    const known = [{ id: 'INV-1', inv_type: 'partial', line_items: [{ _so_line_key: key0, qty: 3 }] }];
    expect(staleInvoiceQtyConflicts(so, known, known, [0])).toEqual([]);
  });

  test('ignores a newly invoiced line that is not selected', () => {
    const so = makeSO();
    const key1 = soLineKey(so.items[1], 1);
    const live = [{ id: 'INV-2', inv_type: 'partial', line_items: [{ _so_line_key: key1, qty: 2 }] }];
    expect(staleInvoiceQtyConflicts(so, [], live, [0])).toEqual([]);
  });

  test('deposit invoices do not claim line quantities', () => {
    const so = makeSO();
    const key0 = soLineKey(so.items[0], 0);
    const live = [{ id: 'INV-D', inv_type: 'deposit', line_items: [{ _so_line_key: key0, qty: 10 }] }];
    expect(staleInvoiceQtyConflicts(so, [], live, [0])).toEqual([]);
  });
});

describe('SKU changes preserve already-invoiced quantity', () => {
  test('a durable prior-key alias keeps a fully invoiced line fully invoiced after its SKU changes', () => {
    const original = { sku: 'A1005', color: 'White', sizes: { XS: 3, S: 3 } };
    const oldKey = soLineKey(original, 1);
    const changed = {
      sku: 'LH0083', color: 'White', sizes: { XS: 3, S: 3 }, invoice_line_keys: [oldKey],
    };
    const so = { id: 'SO-2245', items: [
      { sku: 'AT203-65', color: 'Navy', sizes: { M: 1 } },
      changed,
    ] };
    const invoices = [{ id: 'INV-2245', inv_type: 'full', line_items: [
      { _so_line_key: oldKey, _sku: 'A1005', _color: 'White', qty: 6, amount: 360 },
    ] }];

    expect(buildInvoicedQtyMap(so, invoices).get(soLineKey(changed, 1))).toBe(6);
    expect(invoicedLineOrphans(so, invoices)).toEqual([]);
  });

  test('retains every prior identity across repeated SKU changes', () => {
    const changedTwice = {
      sku: 'THIRD', color: 'Blue', sizes: { M: 2 },
      invoice_line_keys: ['FIRST|Blue|0', 'SECOND|Blue|0'],
    };
    const so = { items: [changedTwice] };
    const invoices = [
      { id: 'INV-1', inv_type: 'partial', line_items: [{ _so_line_key: 'FIRST|Blue|0', _sku: 'FIRST', qty: 1 }] },
      { id: 'INV-2', inv_type: 'partial', line_items: [{ _so_line_key: 'SECOND|Blue|0', _sku: 'SECOND', qty: 1 }] },
    ];

    expect(buildInvoicedQtyMap(so, invoices).get(soLineKey(changedTwice, 0))).toBe(2);
  });
});

// ─────────────────────────────────────────────
// 13. sumDepositInvoiced
// ─────────────────────────────────────────────
describe('Gap 13: sumDepositInvoiced — non-numeric totals contribute 0, negative totals reduce the sum', () => {
  test('only deposit-type invoices are summed; final invoices are ignored', () => {
    const invoices = [
      { inv_type: 'deposit', total: 100 },
      { inv_type: 'final', total: 9999 },
    ];
    expect(sumDepositInvoiced(invoices)).toBe(100);
  });

  test('a non-numeric deposit total contributes 0 via safeNum, not NaN', () => {
    const invoices = [
      { inv_type: 'deposit', total: 100 },
      { inv_type: 'deposit', total: 'abc' },
    ];
    expect(sumDepositInvoiced(invoices)).toBe(100);
  });

  test('PINNED: a negative deposit total reduces the running sum below what the positive deposits alone would give', () => {
    const invoices = [
      { inv_type: 'deposit', total: 100 },
      { inv_type: 'deposit', total: -30 },
    ];
    // sumDepositInvoiced does a plain reduce with no floor/guard against a
    // negative deposit total (e.g. a refunded/reversed deposit entered as a
    // negative-total row) — it simply nets against the positive deposits
    // rather than being excluded or clamped at 0.
    expect(sumDepositInvoiced(invoices)).toBe(70);
  });
});

// ─────────────────────────────────────────────
// 14. rekeyGarmentMocks with blank fromSku/fromColor
// ─────────────────────────────────────────────
describe('Gap 14: rekeyGarmentMocks with a blank fromSku/fromColor identity', () => {
  test('blank-identity ("|") mock bucket DOES get rekeyed to the new sku|color', () => {
    // fromKey = mockLinkKeyOf('', '') === '|' — this is a real, matchable key,
    // not a no-op sentinel. VERIFIED: an art file carrying a bucket literally
    // keyed '|' (e.g. legacy data written before sku/color were always
    // populated) gets moved to the new garment's key exactly like any other
    // populated identity would.
    const artFiles = [{ id: 'a1', item_mockups: { '|': [{ url: 'u1' }] }, mock_links: {} }];
    const result = rekeyGarmentMocks(artFiles, '', '', 'NEWSKU', 'Blue');
    expect(result).not.toBe(artFiles); // new array reference — a change was made
    expect(result[0].item_mockups).toEqual({ 'NEWSKU|Blue': [{ url: 'u1' }] });
  });

  test('when fromSku/fromColor and toSku/toColor are BOTH blank (no-op identity), the function returns the same reference unchanged', () => {
    const artFiles = [{ id: 'a1', item_mockups: { '|': [{ url: 'u1' }] }, mock_links: {} }];
    // fromKey === toKey ('|' === '|') short-circuits immediately — this is the
    // genuine no-op case, distinct from the blank-to-populated rekey above.
    const result = rekeyGarmentMocks(artFiles, '', '', '', '');
    expect(result).toBe(artFiles);
  });
});

// ─────────────────────────────────────────────
// invoicedLineOrphans — billed lines the SO no longer carries
// ─────────────────────────────────────────────
describe('invoicedLineOrphans — an SO edited after it was invoiced', () => {
  // SO-1804: invoiced 8/4 for four lines, then edited 8/17 — KF5972 and KD3000 were
  // removed and AT315 added. The two removed lines were billed AND paid, but no longer
  // match anything on the SO, so buildInvoicedQtyMap drops their qty entirely.
  const so1804 = { items: [
    { sku: 'KE6407', color: 'None', sizes: { L: 1, XL: 1 } },
    { sku: 'KE6404', color: 'None', sizes: { L: 1, XL: 1 } },
    { sku: 'AT315', color: 'Black/ White', sizes: { L: 2 } },
  ] };
  const inv63414 = [{ id: 'INV-63414', so_id: 'SO-1804', inv_type: 'full', line_items: [
    { qty: 2, _sku: 'KF5972', _color: 'None', desc: 'KF5972 adidas Entrada 26 Shorts - Black — None', rate: 25, amount: 50 },
    { qty: 2, _sku: 'KD3000', _color: 'Dark Green', desc: 'KD3000 adidas Mens 3 Stripe Polo - Green — Dark Green', rate: 40, amount: 80 },
    { qty: 2, _sku: 'KE6407', _color: 'None', desc: 'KE6407 adidas Woven Pant - Black — None', rate: 55, amount: 110 },
    { qty: 2, _sku: 'KE6404', _color: 'None', desc: 'KE6404 adidas Woven Top - Black — None', rate: 60, amount: 120 },
  ] }];

  test('reports the two billed lines that are no longer on the SO, with their dollars', () => {
    const orphans = invoicedLineOrphans(so1804, inv63414);
    expect(orphans.map(o => o.sku).sort()).toEqual(['KD3000', 'KF5972']);
    expect(orphans.reduce((a, o) => a + o.amount, 0)).toBe(130);
    expect(orphans[0].invoice_id).toBe('INV-63414');
  });

  test('the lines still on the SO are matched, not reported as orphans', () => {
    const map = buildInvoicedQtyMap(so1804, inv63414);
    expect(map.get(soLineKey(so1804.items[0], 0))).toBe(2); // KE6407 fully invoiced
    expect(map.get(soLineKey(so1804.items[1], 1))).toBe(2); // KE6404 fully invoiced
    expect(map.get(soLineKey(so1804.items[2], 2))).toBe(0); // AT315 never invoiced
  });

  test('an SO whose invoice still matches it reports no orphans', () => {
    const so = { items: [{ sku: 'AAA', color: 'Red', sizes: { L: 2 } }] };
    const invs = [{ id: 'INV-1', inv_type: 'full', line_items: [
      { qty: 2, _sku: 'AAA', _color: 'Red', desc: 'AAA Thing — Red', amount: 40 },
    ] }];
    expect(invoicedLineOrphans(so, invs)).toEqual([]);
  });

  test('deposit invoices are skipped — they bill a %, not specific units', () => {
    const so = { items: [{ sku: 'AAA', color: 'Red', sizes: { L: 2 } }] };
    const invs = [{ id: 'INV-D', inv_type: 'deposit', line_items: [
      { qty: 2, _sku: 'GONE', _color: '', desc: 'GONE Removed Thing', amount: 999 },
    ] }];
    expect(invoicedLineOrphans(so, invs)).toEqual([]);
  });

  test('non-positive line quantities are ignored, not reported as orphans', () => {
    const so = { items: [{ sku: 'AAA', color: 'Red', sizes: { L: 2 } }] };
    const invs = [{ id: 'INV-1', inv_type: 'full', line_items: [
      { qty: 0, _sku: 'GONE', desc: 'GONE Zero Line', amount: 0 },
      { qty: -3, _sku: 'ALSOGONE', desc: 'ALSOGONE Negative Line', amount: -60 },
    ] }];
    expect(invoicedLineOrphans(so, invs)).toEqual([]);
  });

  test('a stale _so_line_key still falls back to sku matching before being called an orphan', () => {
    const so = { items: [{ sku: 'AAA', color: 'Red', sizes: { L: 2 } }] };
    const invs = [{ id: 'INV-1', inv_type: 'full', line_items: [
      { qty: 2, _so_line_key: 'stale-key-from-an-older-shape', _sku: 'AAA', _color: 'Red', desc: 'AAA Thing — Red', amount: 40 },
    ] }];
    expect(invoicedLineOrphans(so, invs)).toEqual([]);
    expect(buildInvoicedQtyMap(so, invs).get(soLineKey(so.items[0], 0))).toBe(2);
  });

  test('buildInvoicedQtyMap still returns a Map — the orphan split did not change its contract', () => {
    expect(buildInvoicedQtyMap(so1804, inv63414)).toBeInstanceOf(Map);
  });
});
