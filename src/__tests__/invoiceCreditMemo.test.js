import {
  calculateCreditMemo,
  creditableBalance,
  creditedTotal,
  seedCreditMemoLines,
  setCreditMemoLineQty,
  validateCreditMemo,
} from '../invoiceCreditMemo';

const invoice = {
  total: 118,
  paid: 118,
  tax: 8,
  line_items: [
    { desc: 'Baseballs', qty: 65, rate: 1, amount: 65 },
    { desc: 'Game balls', qty: 45, rate: 1, amount: 45 },
  ],
  credit_memos: [],
};

describe('invoice credit memo calculations', () => {
  test('supports a partial quantity and prorates invoice tax', () => {
    const lines = seedCreditMemoLines(invoice.line_items);
    lines[0] = setCreditMemoLineQty(lines[0], 35);
    const result = calculateCreditMemo({ invoice, lines });

    expect(result.line_items).toEqual([
      { line_index: 0, desc: 'Baseballs', sku: '', qty: 35, rate: 1, amount: 35 },
    ]);
    expect(result.subtotal).toBe(35);
    expect(result.tax).toBe(2.55);
    expect(result.amount).toBe(37.55);
  });

  test('clamps credited quantities to the original invoice line', () => {
    const line = setCreditMemoLineQty(seedCreditMemoLines(invoice.line_items)[0], 999);
    expect(line.qty).toBe(65);
  });

  test('tracks prior memos and prevents over-crediting', () => {
    const withPrior = {
      ...invoice,
      credit_memos: [
        { amount: 18, line_items: [{ line_index: 0, qty: 18 }] },
        { amount: 20, line_items: [{ line_index: 0, qty: 20 }] },
      ],
    };
    expect(creditedTotal(withPrior)).toBe(38);
    expect(creditableBalance(withPrior)).toBe(80);
    expect(seedCreditMemoLines(invoice.line_items, withPrior.credit_memos)[0]).toMatchObject({
      invoiced_qty: 65,
      credited_qty: 38,
      max_qty: 27,
    });

    expect(validateCreditMemo({
      invoice: withPrior,
      calculation: { amount: 80.01 },
      reason: 'Returned items',
    })).toMatch(/exceeds/i);
  });

  test('only turns money already paid into a reusable account credit', () => {
    expect(creditableBalance({ ...invoice, paid: 40 })).toBe(40);
    expect(creditableBalance({ ...invoice, paid: 0 })).toBe(0);
  });

  test('requires a reason and a nonzero selection', () => {
    expect(validateCreditMemo({ invoice, calculation: { amount: 10 }, reason: '' })).toMatch(/reason/i);
    expect(validateCreditMemo({ invoice, calculation: { amount: 0 }, reason: 'Cancelled' })).toMatch(/select/i);
  });
});
