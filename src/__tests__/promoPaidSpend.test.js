// Paid-only promo earning (ownership rule 2026-07-06): % of Spend promo earns from PAID
// revenue only — portal SOs whose invoices are fully paid, plus paid NetSuite history
// invoices — combined by calcPaidQualifyingSpend.
import { promoDateKey, soIsPaid, calcPaidQualifyingSpend } from '../pricing';

// A simple SO whose single line passes the ≥20% margin gate: 10 units × $10 sell / $5 cost.
const paidSO = (over = {}) => ({
  id: 'SO1', customer_id: 'C1', order_date: '2026-03-15',
  items: [{ unit_sell: 10, nsa_cost: 5, sizes: { M: 10 } }],
  ...over,
});

describe('promoDateKey', () => {
  test('passes through ISO dates and datetimes', () => {
    expect(promoDateKey('2026-03-15')).toBe('2026-03-15');
    expect(promoDateKey('2026-03-15T10:22:00Z')).toBe('2026-03-15');
  });
  test('normalizes locale strings from legacy created_at values', () => {
    expect(promoDateKey('7/6/2026, 3:04 PM')).toBe('2026-07-06');
  });
  test('returns empty string for garbage', () => {
    expect(promoDateKey('not a date')).toBe('');
    expect(promoDateKey('')).toBe('');
    expect(promoDateKey(null)).toBe('');
  });
});

describe('soIsPaid', () => {
  const so = { id: 'SO1' };
  test('false with no invoices at all', () => {
    expect(soIsPaid(so, [])).toBe(false);
    expect(soIsPaid(so, [{ so_id: 'OTHER', total: 100, paid: 100 }])).toBe(false);
  });
  test('true when payments cover the invoiced total', () => {
    expect(soIsPaid(so, [{ so_id: 'SO1', total: 100, paid: 100, status: 'paid' }])).toBe(true);
    expect(soIsPaid(so, [
      { so_id: 'SO1', total: 60, paid: 60 },
      { so_id: 'SO1', total: 40, paid: 40 },
    ])).toBe(true);
  });
  test('false while partially paid', () => {
    expect(soIsPaid(so, [{ so_id: 'SO1', total: 100, paid: 40, status: 'partial' }])).toBe(false);
  });
  test('void invoices are ignored', () => {
    expect(soIsPaid(so, [
      { so_id: 'SO1', total: 100, paid: 100 },
      { so_id: 'SO1', total: 50, paid: 0, status: 'void' },
    ])).toBe(true);
    expect(soIsPaid(so, [{ so_id: 'SO1', total: 50, paid: 0, status: 'void' }])).toBe(false);
  });
  test('$0 totals fall back to status', () => {
    expect(soIsPaid(so, [{ so_id: 'SO1', total: 0, paid: 0, status: 'paid' }])).toBe(true);
    expect(soIsPaid(so, [{ so_id: 'SO1', total: 0, paid: 0, status: 'open' }])).toBe(false);
  });
});

describe('calcPaidQualifyingSpend', () => {
  const range = { famIds: ['C1'], start: '2026-01-01', end: '2026-06-30' };

  test('counts an SO only when its invoice is fully paid', () => {
    const sos = [paidSO()];
    const paidInvs = [{ so_id: 'SO1', total: 100, paid: 100, status: 'paid' }];
    const openInvs = [{ so_id: 'SO1', total: 100, paid: 0, status: 'open' }];
    expect(calcPaidQualifyingSpend({ sos, invs: paidInvs, histInvs: [], ...range }).total).toBe(100);
    expect(calcPaidQualifyingSpend({ sos, invs: openInvs, histInvs: [], ...range }).total).toBe(0);
    expect(calcPaidQualifyingSpend({ sos, invs: [], histInvs: [], ...range }).total).toBe(0);
  });

  test('SO spend still applies the ≥20% margin gate', () => {
    // 10 × $10 sell / $9 cost = 10% margin — excluded even though paid.
    const sos = [paidSO({ items: [{ unit_sell: 10, nsa_cost: 9, sizes: { M: 10 } }] })];
    const invs = [{ so_id: 'SO1', total: 100, paid: 100, status: 'paid' }];
    expect(calcPaidQualifyingSpend({ sos, invs, histInvs: [], ...range }).total).toBe(0);
  });

  test('counts paid NetSuite invoices by subtotal, skips open ones', () => {
    const histInvs = [
      { customer_id: 'C1', date: '2026-02-01', status: 'paid', subtotal: 500, tax: 40, total: 540, invoice_type: 'invoice' },
      { customer_id: 'C1', date: '2026-02-15', status: 'open', subtotal: 300, tax: 24, total: 324, invoice_type: 'invoice' },
    ];
    const r = calcPaidQualifyingSpend({ sos: [], invs: [], histInvs, ...range });
    expect(r.histSpend).toBe(500);
    expect(r.total).toBe(500);
  });

  test('falls back to total − tax when subtotal is missing', () => {
    const histInvs = [{ customer_id: 'C1', date: '2026-02-01', status: 'paid', subtotal: null, tax: 40, total: 540, invoice_type: 'invoice' }];
    expect(calcPaidQualifyingSpend({ sos: [], invs: [], histInvs, ...range }).histSpend).toBe(500);
  });

  test('credit memos net out as negatives', () => {
    const histInvs = [
      { customer_id: 'C1', date: '2026-02-01', status: 'paid', subtotal: 500, tax: 0, total: 500, invoice_type: 'invoice' },
      { customer_id: 'C1', date: '2026-03-01', status: 'paid', subtotal: 200, tax: 0, total: 200, invoice_type: 'credit_memo' },
    ];
    expect(calcPaidQualifyingSpend({ sos: [], invs: [], histInvs, ...range }).histSpend).toBe(300);
  });

  test('filters by family and period, combining both sources', () => {
    const sos = [
      paidSO(),                                             // in range, paid → counts (100)
      paidSO({ id: 'SO2', order_date: '2026-08-01' }),      // out of range
      paidSO({ id: 'SO3', customer_id: 'OTHER' }),          // other customer
    ];
    const invs = [
      { so_id: 'SO1', total: 100, paid: 100, status: 'paid' },
      { so_id: 'SO2', total: 100, paid: 100, status: 'paid' },
      { so_id: 'SO3', total: 100, paid: 100, status: 'paid' },
    ];
    const histInvs = [
      { customer_id: 'C1', date: '2026-04-01', status: 'paid', subtotal: 250, tax: 0, total: 250, invoice_type: 'invoice' },
      { customer_id: 'C1', date: '2025-12-01', status: 'paid', subtotal: 999, tax: 0, total: 999, invoice_type: 'invoice' }, // out of range
      { customer_id: 'OTHER', date: '2026-04-01', status: 'paid', subtotal: 999, tax: 0, total: 999, invoice_type: 'invoice' },
    ];
    const r = calcPaidQualifyingSpend({ sos, invs, histInvs, ...range });
    expect(r.soSpend).toBe(100);
    expect(r.histSpend).toBe(250);
    expect(r.total).toBe(350);
  });

  test('locale-string created_at dates are bucketed correctly (legacy rows)', () => {
    const sos = [paidSO({ order_date: null, created_at: '3/15/2026, 2:00 PM' })];
    const invs = [{ so_id: 'SO1', total: 100, paid: 100, status: 'paid' }];
    expect(calcPaidQualifyingSpend({ sos, invs, histInvs: [], ...range }).soSpend).toBe(100);
  });
});
