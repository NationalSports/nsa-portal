import { prepareUnpaidInvoiceSplit } from '../lib/invoiceSplit';
const inv = { id: 'I1', _version: 2, status: 'open', paid: 0, line_items: [{ amount: 1 }, { amount: 1 }], shipping: 0.01, tax: 0.01, total: 2.02 };
test('split preserves exact cents and never copies the original version to a new invoice', () => {
  const { original, split } = prepareUnpaidInvoiceSplit(inv, [0], 'I2');
  expect(original.total + split.total).toBe(2.02);
  expect(original.shipping + split.shipping).toBe(0.01);
  expect(original.tax + split.tax).toBe(0.01);
  expect(split._version).toBeUndefined();
  expect(original.line_items).toHaveLength(1);
});
test.each([{ paid: 1 }, { payments: [{ amount: 1 }] }, { credit_amount: 1 }, { deposit_applied: 1 }, { _version: null }])('accounting history blocks split: %j', patch => {
  expect(() => prepareUnpaidInvoiceSplit({ ...inv, ...patch }, [0], 'I2')).toThrow();
});
test('mismatched totals do not produce two invoices with a different combined balance', () => {
  expect(() => prepareUnpaidInvoiceSplit({ ...inv, total: 3 }, [0], 'I2')).toThrow('reconciliation');
});
