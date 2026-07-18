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
const { buildInvoicedQtyMap, sumDepositInvoiced, rekeyGarmentMocks, soLineKey } = require('../safeHelpers');

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
describe('Gap 12: buildInvoicedQtyMap sums a negative line qty as-is (credit-memo semantics)', () => {
  test('a negative qty line item reduces the invoiced total for that key below zero', () => {
    const so = makeSO();
    const key0 = soLineKey(so.items[0], 0);
    const invoices = [{ inv_type: 'final', line_items: [{ _so_line_key: key0, qty: -2 }] }];
    // PINNED: buildInvoicedQtyMap does `map.get(k) + q` with no floor at 0 and
    // no sign check — `if (!q) return` only skips a falsy (zero) qty, so a
    // negative line (e.g. a credit memo represented as a negative-qty line
    // item) is summed straight in, producing a negative "invoiced qty" for
    // that SO line. OVER-INVOICE RISK: any caller treating a negative result
    // as "line not yet fully invoiced" (e.g. `invoicedQty < orderedQty`)
    // would let the line be invoiced again on top of the credit, rather than
    // reading it as already netted down.
    expect(buildInvoicedQtyMap(so, invoices).get(key0)).toBe(-2);
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
