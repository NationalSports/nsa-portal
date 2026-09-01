import { applyHistoricalInvoicePayment, historicalInvoiceAr } from '../lib/historicalInvoiceAr';

describe('historical NetSuite invoice AR normalization', () => {
  test('uses Amount Remaining instead of the original invoice total', () => {
    expect(historicalInvoiceAr({total: 1000, open_balance: 125, status: 'Open'})).toMatchObject({
      balance: 125,
      paid: 875,
      status: 'partial',
      collectible: true,
      balanceBasis: 'explicit',
    });
  });

  test('does not turn pending or unfamiliar historical statuses into debt', () => {
    expect(historicalInvoiceAr({total: 1000, open_balance: 1000, status: 'Pending Approval'})).toMatchObject({
      balance: 0,
      collectible: false,
    });
  });

  test('keeps status-only legacy rows out of collectible AR', () => {
    expect(historicalInvoiceAr({total: 1000, status: 'open'})).toMatchObject({
      balance: 0,
      paid: 0,
      status: 'unverified',
      collectible: false,
      balanceBasis: 'missing_authoritative',
    });
  });

  test('partial payments reduce and persist the remaining balance', () => {
    expect(applyHistoricalInvoicePayment({total: 1000, open_balance: 300, status: 'partial'}, 125)).toEqual({
      open_balance: 175,
      status: 'partial',
      applied: 125,
    });
  });

  test('payments are capped at the remaining balance and close the invoice', () => {
    expect(applyHistoricalInvoicePayment({total: 1000, open_balance: 80, status: 'open'}, 500)).toEqual({
      open_balance: 0,
      status: 'paid',
      applied: 80,
    });
  });
});
