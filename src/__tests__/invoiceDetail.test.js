import { invoiceDetailBalance, normalizeInvoiceForDetail } from '../lib/invoiceDetail';

describe('invoice detail normalization', () => {
  test('fills sparse portal amounts before the detail page formats them', () => {
    const invoice = normalizeInvoiceForDetail({
      id: 'INV-SPARSE',
      payments: [{ ref: 'check-1' }],
    });

    expect(invoice.total).toBe(0);
    expect(invoice.paid).toBe(0);
    expect(invoice.shipping).toBe(0);
    expect(invoice.tax).toBe(0);
    expect(invoice.payments[0].amount).toBe(0);
    expect(invoiceDetailBalance(invoice)).toBe(0);
  });

  test('derives NetSuite paid and balance amounts from open_balance', () => {
    const invoice = normalizeInvoiceForDetail({
      id: 'INV63436',
      _hist: true,
      status: 'partial',
      total: 15331.97,
      open_balance: 5331.97,
    });

    expect(invoice.total).toBe(15331.97);
    expect(invoice.paid).toBe(10000);
    expect(invoiceDetailBalance(invoice)).toBe(5331.97);
    expect(() => invoice.total.toLocaleString()).not.toThrow();
    expect(() => invoice.paid.toLocaleString()).not.toThrow();
  });
});
