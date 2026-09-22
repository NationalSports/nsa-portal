import { invoiceDetailBalance, invoicePaymentStatus, normalizeInvoiceForDetail } from '../lib/invoiceDetail';

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

describe('invoice payment status', () => {
  test('an edit that drops the total to what was paid settles the invoice', () => {
    // INV-63465: $2,995.70 invoiced, $2,979.54 check applied (correctly 'partial'),
    // then the total was edited down to $2,979.54. The row stayed 'partial' with a
    // $0 balance and kept printing Overdue past its 09/07 due date.
    expect(invoicePaymentStatus(2979.54, 2979.54, 'partial')).toBe('paid');
  });

  test('raising the total above what was paid re-opens the invoice as partial', () => {
    expect(invoicePaymentStatus(2995.7, 2979.54, 'paid')).toBe('partial');
  });

  test('an unpaid invoice stays open', () => {
    expect(invoicePaymentStatus(500, 0, 'open')).toBe('open');
  });

  test('a rounding cent cannot re-open a paid invoice', () => {
    expect(invoicePaymentStatus(100, 99.999, 'paid')).toBe('paid');
    expect(invoicePaymentStatus(0.1 + 0.2, 0.3, 'paid')).toBe('paid');
  });

  test('an overpayment is paid, not partial', () => {
    expect(invoicePaymentStatus(100, 120, 'partial')).toBe('paid');
  });

  test('void is a decision about the document, not a balance', () => {
    expect(invoicePaymentStatus(0, 0, 'void')).toBe('void');
    expect(invoicePaymentStatus(500, 500, 'void')).toBe('void');
  });

  test('missing amounts do not throw or invent a payment', () => {
    expect(invoicePaymentStatus(undefined, undefined, 'open')).toBe('paid');
    expect(invoicePaymentStatus(500, null, null)).toBe('open');
  });
});
