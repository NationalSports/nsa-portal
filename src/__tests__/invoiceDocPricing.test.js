/* eslint-disable */
// ═══════════════════════════════════════════════
// REGRESSION — what an invoice document is allowed to print.
//
// Two defects, same visible symptom: a customer's PDF whose lines contradict its own
// total.
//
//   1. INV-63191 (SO-1346) billed 6 of the order's 8 lines. The document walked the
//      SALES ORDER, so the customer's copy listed two visor lines it was never charged
//      for — $5,394.00 of lines under a $4,897.78 total. Fixed by scoping the SO walk
//      (partialInvoiceScoping.test.js); pinned again here on the real order's shape.
//   2. The same walk priced each line from the SO's `unit_sell` — the ORDER's list
//      price — rather than the invoice's own stored rate. INV-63187 comped 24 jackets
//      at $0 and the document printed them at $58.50 each: $1,404 of phantom charges.
//      Per-size (2XL+) upcharges and rep price edits diverge the same way.
//   3. No document printed `cc_fee`, so the 66 invoices carrying a card surcharge
//      printed a totals block that did not add up to the Total beneath it.
// ═══════════════════════════════════════════════
const { scopeSoItemsToInvoice } = require('../safeHelpers');
const { invoiceTotalsRows, invoiceDocReconcile } = require('../lib/invoiceDocTotals');

const fmt = n => '$' + Number(n).toFixed(2);
const text = rows => rows.map(r => r.cells.map(c => String(c.value)).join(' ')).join('\n');

// ── SO-1346 / INV-63191, as stored ──
const SO_1346 = [
  { sku: 'JX4461', name: 'Adidas M SS Pregame A', color: 'Navy,White', unit_sell: 18, sizes: { XS: 10, S: 10, M: 10, L: 10, XL: 10 } },
  { sku: 'JX4468', name: 'Adidas Unisex Pregame Tee', color: 'Orange,White', unit_sell: 18, sizes: { XS: 10, S: 10, M: 10, L: 10, XL: 10 } },
  { sku: 'JX4467', name: 'Adidas Unisex Pregame Tee', color: 'White,Black', unit_sell: 18, sizes: { XS: 10, S: 10, M: 10, L: 10, XL: 10 } },
  { sku: 'JX4484', name: 'Adidas LS Pregame Tee', color: 'Navy,White', unit_sell: 21, sizes: { XS: 3, S: 3, M: 4, L: 3, XL: 2, '2XL': 2 } },
  { sku: 'JX4486', name: 'Adidas LS Pregame Tee', color: 'Med Grey', unit_sell: 21, sizes: { XS: 3, S: 3, M: 4, L: 3, XL: 2, '2XL': 2 } },
  { sku: 'JX4482', name: 'Adidas LS Pregame Tee', color: 'White', unit_sell: 21, sizes: { XS: 3, S: 3, M: 4, L: 3, XL: 2, '2XL': 2 } },
  { sku: 'KW4961', name: 'Adidas TEAM VISOR', color: 'Navy', unit_sell: 9, sizes: { OSFA: 30 } },
  { sku: 'KW4965', name: 'Adidas TEAM VISOR', color: 'White', unit_sell: 9, sizes: { OSFA: 30 } },
];
const line = (i, qty, rate) => ({
  qty, rate, amount: qty * rate, _sku: SO_1346[i].sku, _color: SO_1346[i].color,
  _so_line_key: SO_1346[i].sku + '|' + SO_1346[i].color + '|' + i,
});
const INV_63191 = {
  inv_type: 'partial',
  line_items: [line(0, 50, 21), line(1, 50, 21), line(2, 50, 21), line(3, 17, 24), line(4, 17, 24), line(5, 17, 24)],
};

describe('INV-63191 — the visors the customer was never billed for', () => {
  test('only the six billed lines reach the document', () => {
    const { items, extraLines } = scopeSoItemsToInvoice(INV_63191, SO_1346);
    expect(items.map(i => i.sku)).toEqual(['JX4461', 'JX4468', 'JX4467', 'JX4484', 'JX4486', 'JX4482']);
    expect(items.some(i => i.sku.startsWith('KW'))).toBe(false);
    expect(extraLines).toEqual([]);
  });

  test('the printed lines add up to the invoice subtotal, not the order total', () => {
    const { items } = scopeSoItemsToInvoice(INV_63191, SO_1346);
    const subtotal = items.reduce((a, it) => a + it._invAmount, 0);
    expect(subtotal).toBe(4374);            // what INV-63191 bills
    expect(subtotal).not.toBe(5394);        // what the customer's copy printed
    // …and the whole document reconciles to the stored total.
    expect(invoiceDocReconcile({ subtotal, shipping: 97.31, tax: 426.47, total: 4897.78 }).ok).toBe(true);
  });

  test('each line prints the rate the invoice charges, decoration folded in', () => {
    const { items } = scopeSoItemsToInvoice(INV_63191, SO_1346);
    expect(items[0]._invRate).toBe(21);     // $18 garment + $3 screen print
    expect(items[0].unit_sell).toBe(18);    // the order's list price, which must NOT print
    expect(items[3]._invRate).toBe(24);
  });
});

describe('the printed price comes from the invoice, not the order', () => {
  const SO = [{ sku: 'JR9291', name: 'Jacket', color: 'White', unit_sell: 58.5, sizes: { M: 15 } }];

  test('a comped line prints $0, not the order list price (INV-63187)', () => {
    const inv = { inv_type: 'final', line_items: [{ qty: 15, rate: 0, amount: 0, _sku: 'JR9291', _color: 'White', _so_line_key: 'JR9291|White|0' }] };
    const { items } = scopeSoItemsToInvoice(inv, SO);
    expect(items[0]._invRate).toBe(0);
    expect(items[0]._invAmount).toBe(0);
  });

  test('a rep price edit is honoured', () => {
    const inv = { inv_type: 'final', line_items: [{ qty: 15, rate: 40, amount: 600, _sku: 'JR9291', _color: 'White', _so_line_key: 'JR9291|White|0' }] };
    const { items } = scopeSoItemsToInvoice(inv, SO);
    expect(items[0]._invRate).toBe(40);
    expect(items[0]._invAmount).toBe(600);
  });

  test('a deposit carries every line, already scaled — never re-scaled by the caller', () => {
    const inv = { inv_type: 'deposit', deposit_pct: 50, line_items: [{ qty: 15, rate: 58.5, amount: 438.75, _sku: 'JR9291', _color: 'White', _so_line_key: 'JR9291|White|0' }] };
    const { items } = scopeSoItemsToInvoice(inv, SO);
    expect(items).toHaveLength(1);
    expect(items[0]._invAmount).toBe(438.75);
  });

  test('a legacy invoice with no stored lines still prices off the order', () => {
    const { items } = scopeSoItemsToInvoice({ inv_type: 'final', line_items: [] }, SO);
    expect(items[0]._invRate).toBeUndefined();
    expect(items[0]._invAmount).toBeUndefined();
  });
});

describe('the totals block prints every component of the total', () => {
  test('a card surcharge prints, so the document adds up', () => {
    const rows = invoiceTotalsRows({ subtotal: 120, shipping: 0, tax: 9.3, ccFee: 3.75, total: 133.05, balance: 133.05 }, fmt);
    expect(text(rows)).toContain('Credit Card Fee');
    expect(text(rows)).toContain('$3.75');
    expect(text(rows)).not.toContain('do not add up');
  });

  test('components carrying no money stay off the page', () => {
    const out = text(invoiceTotalsRows({ subtotal: 100, total: 100, balance: 100 }, fmt));
    expect(out).not.toContain('Shipping');
    expect(out).not.toContain('Credit Card Fee');
    expect(out).not.toContain('Deposit Applied');
    expect(out).toContain('Subtotal');
    expect(out).toContain('Total');
  });

  test('a document that does not reconcile says so instead of printing a silent lie', () => {
    // INV-63754, as stored: $2,197.00 of lines under an $1,833.96 total.
    const rows = invoiceTotalsRows({ subtotal: 2197, shipping: 87.33, tax: 125.63, total: 1833.96 }, fmt);
    expect(text(rows)).toContain('do not add up');
    expect(invoiceDocReconcile({ subtotal: 2197, shipping: 87.33, tax: 125.63, total: 1833.96 }).ok).toBe(false);
  });

  test('a cent of rounding is not a mismatch', () => {
    expect(invoiceDocReconcile({ subtotal: 100.004, tax: 0, total: 100 }).ok).toBe(true);
    expect(invoiceDocReconcile({ subtotal: 100.02, tax: 0, total: 100 }).ok).toBe(false);
  });
});
