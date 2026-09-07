import { preserveAppliedInvoiceSummary, stripePaymentRepairCandidate } from '../lib/invoicePaymentReconciliation';

describe('invoice payment reconciliation', () => {
  test('recognizes an unapplied covering Stripe payment', () => {
    expect(stripePaymentRepairCandidate({
      id: 'INV-TEST', total: 814.71, paid: 0, status: 'open',
      payments: [{ amount: 838.34, method: 'cc', ref: 'Stripe pi_test_covering_payment' }],
    })).toEqual({ invoiceId: 'INV-TEST', intentId: 'pi_test_covering_payment' });
  });

  test('does not retry partial, refunded, or already-applied payments', () => {
    expect(stripePaymentRepairCandidate({ id: 'INV-1', total: 100, paid: 0, status: 'open', payments: [{ amount: 50, ref: 'Stripe pi_partial' }] })).toBeNull();
    expect(stripePaymentRepairCandidate({ id: 'INV-1', total: 100, paid: 0, status: 'open', payments: [{ amount: 103, ref: 'Stripe pi_paid' }, { amount: -25, ref: 'Refund re_1' }] })).toBeNull();
    expect(stripePaymentRepairCandidate({ id: 'INV-1', total: 103, paid: 103, status: 'paid', payments: [{ amount: 103, ref: 'Stripe pi_paid' }] })).toBeNull();
  });

  test('preserves a newer server payment summary during a stale save', () => {
    expect(preserveAppliedInvoiceSummary(
      { id: 'INV-1', total: 814.71, paid: 0, cc_fee: 0, status: 'open', memo: 'edited' },
      { id: 'INV-1', total: 838.34, paid: 838.34, cc_fee: 23.63, status: 'paid' },
    )).toEqual({
      id: 'INV-1', total: 838.34, paid: 838.34, cc_fee: 23.63, status: 'paid', memo: 'edited',
    });
  });

  test('does not interfere when the local payment summary is current', () => {
    const local = { id: 'INV-1', total: 838.34, paid: 838.34, cc_fee: 23.63, status: 'paid' };
    expect(preserveAppliedInvoiceSummary(local, { ...local })).toBe(local);
  });
});
