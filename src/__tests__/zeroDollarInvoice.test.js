import { shouldSkipZeroFinalInvoice } from '../safeHelpers';
import { soIsPaid } from '../pricing';

describe('shouldSkipZeroFinalInvoice', () => {
  test('never-invoiced $0 Final (FREE PROMO) must create a $0 invoice — do not skip', () => {
    expect(shouldSkipZeroFinalInvoice({
      invType: 'final',
      invTotal: 0,
      isPromoOrder: false,
      priorInvs: [],
      depositApplied: 0,
    })).toBe(false);
  });

  test('skips only when prior invoices already cover a $0 Final balance', () => {
    expect(shouldSkipZeroFinalInvoice({
      invType: 'final',
      invTotal: 0,
      isPromoOrder: false,
      priorInvs: [{ id: 'INV-1', so_id: 'SO-1', total: 100, inv_type: 'full' }],
      depositApplied: 0,
    })).toBe(true);
  });

  test('skips when deposit credit zeros the Final balance', () => {
    expect(shouldSkipZeroFinalInvoice({
      invType: 'final',
      invTotal: 0,
      isPromoOrder: false,
      priorInvs: [{ id: 'INV-D', so_id: 'SO-1', total: 50, inv_type: 'deposit' }],
      depositApplied: 50,
    })).toBe(true);
  });

  test('promo_applied $0 Final still creates a $0 invoice (never skip)', () => {
    expect(shouldSkipZeroFinalInvoice({
      invType: 'final',
      invTotal: 0,
      isPromoOrder: true,
      priorInvs: [],
      depositApplied: 0,
    })).toBe(false);
  });

  test('non-final or non-zero totals never skip', () => {
    expect(shouldSkipZeroFinalInvoice({
      invType: 'full', invTotal: 0, isPromoOrder: false, priorInvs: [], depositApplied: 0,
    })).toBe(false);
    expect(shouldSkipZeroFinalInvoice({
      invType: 'final', invTotal: 12.5, isPromoOrder: false, priorInvs: [], depositApplied: 0,
    })).toBe(false);
  });
});

describe('$0 invoice paid status for promo spend', () => {
  test('soIsPaid requires status paid when invoice total is $0', () => {
    const so = { id: 'SO-1' };
    expect(soIsPaid(so, [{ so_id: 'SO-1', total: 0, paid: 0, status: 'open' }])).toBe(false);
    expect(soIsPaid(so, [{ so_id: 'SO-1', total: 0, paid: 0, status: 'paid' }])).toBe(true);
  });
});
