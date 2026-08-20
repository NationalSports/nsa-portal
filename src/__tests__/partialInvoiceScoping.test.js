/* eslint-disable */
// ═══════════════════════════════════════════════
// REGRESSION — src/safeHelpers.js: scopeSoItemsToInvoice
//
// Every invoice document (order-editor review + emailed PDF, coach portal,
// customer portal) walks the SALES ORDER to print size breakdowns and
// decoration detail. Walking it raw printed the WHOLE order on a partial
// invoice: INV-63640 billed 94 hoodies for $3,487.52 and printed all eight
// lines of SO-1101 under a $14,117.45 subtotal.
// ═══════════════════════════════════════════════
const { scopeSoItemsToInvoice, soLineKey } = require('../safeHelpers');

const SO_ITEMS = [
  { sku: 'KB9093', color: 'Black', name: '3 Stripe Short', sizes: { S: 4, M: 68, L: 47, XL: 34 } },
  { sku: 'IM9855', color: 'White/Grey', name: 'D4T LS Hood', sizes: { S: 3, M: 22, L: 31, XL: 26 } },
  { sku: 'GM2365', color: 'Black/White', name: 'Knit Short', sizes: { '2XL': 10 } },
];
const line = (idx, qty) => ({ _so_line_key: soLineKey(SO_ITEMS[idx], idx), _sku: SO_ITEMS[idx].sku, qty });

describe('scopeSoItemsToInvoice — a partial invoice prints only what it bills', () => {
  test('one billed line out of three: the other two never reach the document', () => {
    const inv = { inv_type: 'partial', line_items: [line(1, 82)] };
    const { items, extraLines } = scopeSoItemsToInvoice(inv, SO_ITEMS);
    expect(items.map(i => i.sku)).toEqual(['IM9855']);
    expect(items[0]._invQty).toBe(82);
    expect(items[0]._soQty).toBe(82);
    expect(items[0]._soIdx).toBe(1);
    // Whole line billed → the SO's size breakdown is the invoice's size breakdown.
    expect(items[0]._invSizes).toEqual({ S: 3, M: 22, L: 31, XL: 26 });
    expect(extraLines).toEqual([]);
  });

  test('multiple billed lines stay in SO order', () => {
    const inv = { inv_type: 'partial', line_items: [line(2, 10), line(0, 153)] };
    const { items } = scopeSoItemsToInvoice(inv, SO_ITEMS);
    expect(items.map(i => i.sku)).toEqual(['KB9093', 'GM2365']);
  });

  test('a line billed short of the SO quantity prints no size breakdown', () => {
    // The invoice records a quantity, never WHICH sizes — printing the SO's full
    // curve next to a smaller quantity is a breakdown that does not add up.
    const inv = { inv_type: 'partial', line_items: [line(1, 40)] };
    const { items } = scopeSoItemsToInvoice(inv, SO_ITEMS);
    expect(items[0]._invQty).toBe(40);
    expect(items[0]._soQty).toBe(82);   // pricing basis stays the SO line's own qty
    expect(items[0]._invSizes).toBeNull();
  });

  test('a second invoice line against an already-matched SO line still prints', () => {
    // matchInvoiceLinesToSo consumes an SO item once, so the duplicate falls through to
    // extraLines rather than vanishing — the document's subtotal still reconciles.
    const inv = { inv_type: 'partial', line_items: [line(2, 4), { ...line(2, 6), amount: 90 }] };
    const { items, extraLines } = scopeSoItemsToInvoice(inv, SO_ITEMS);
    expect(items).toHaveLength(1);
    expect(items[0]._invQty).toBe(4);
    expect(extraLines).toHaveLength(1);
    expect(extraLines[0].qty).toBe(6);
  });
});

describe('scopeSoItemsToInvoice — invoices that bill the whole order', () => {
  test('a deposit bills a percentage of everything, so every line prints', () => {
    const inv = { inv_type: 'deposit', deposit_pct: 50, line_items: [line(0, 153)] };
    const { items } = scopeSoItemsToInvoice(inv, SO_ITEMS);
    expect(items.map(i => i.sku)).toEqual(['KB9093', 'IM9855', 'GM2365']);
    expect(items.map(i => i._invQty)).toEqual([153, 82, 10]);
  });

  test('a legacy invoice with no stored line_items falls back to the full SO', () => {
    const { items, extraLines } = scopeSoItemsToInvoice({ inv_type: 'final' }, SO_ITEMS);
    expect(items).toHaveLength(3);
    expect(extraLines).toEqual([]);
  });

  test('lines that match nothing on the SO do not silently blank the document', () => {
    const inv = { inv_type: 'partial', line_items: [{ _sku: 'ZZZ', desc: 'Rush fee', qty: 1, amount: 75 }] };
    const { items, extraLines } = scopeSoItemsToInvoice(inv, SO_ITEMS);
    expect(items).toEqual([]);
    expect(extraLines).toHaveLength(1);   // printed as a plain row so the subtotal reconciles
  });
});

describe('scopeSoItemsToInvoice — no sales order behind the invoice', () => {
  test('every line becomes an extra line, matching the old no-SO fallback', () => {
    const lines = [{ _sku: 'X', qty: 2, rate: 10, amount: 20 }];
    expect(scopeSoItemsToInvoice({ inv_type: 'full', line_items: lines }, [])).toEqual({ items: [], extraLines: lines });
    expect(scopeSoItemsToInvoice({ inv_type: 'full', line_items: lines }, null)).toEqual({ items: [], extraLines: lines });
  });

  test('a null/undefined invoice does not throw', () => {
    expect(scopeSoItemsToInvoice(null, SO_ITEMS).items).toHaveLength(3);
    expect(scopeSoItemsToInvoice(undefined, null)).toEqual({ items: [], extraLines: [] });
  });
});
