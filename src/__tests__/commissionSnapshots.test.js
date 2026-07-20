// Locks the commission-snapshot freeze/apply rules: what may be frozen, what a frozen
// row contains, and that a frozen line stops moving when the underlying order changes.
import {
  canSnapshotLine,
  snapshotRowFromLine,
  applySnapshotToLine,
  overrideSnapshotPatch,
  isCommissionEarnedInvoice,
  COMM_RATE_STANDARD,
  COMM_RATE_LATE,
} from '../commissionSnapshots';

// Same date-only-is-local semantics as App.parseDate
const parseDate = (d) => {
  if (!d) return null;
  const m = typeof d === 'string' ? d.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return new Date(d);
};

const paidLine = (over = {}) => ({
  inv: { id: 'INV-100', so_id: 'SO-1', customer_id: 'C-1', status: 'paid', payments: [{ amount: 500, date: '2026-06-10' }], _paymentsHydrated: true, ...(over.inv || {}) },
  so: { id: 'SO-1', _itemsHydrated: true, _posHydrated: true, ...(over.so || {}) },
  gp: { rev: 500, cost: 300, gp: 200, shipRev: 0, shipCost: 0, inboundFreight: 0 },
  commRate: 0.30,
  commAmt: 60,
  paidDate: new Date(2026, 5, 10),
  daysToPay: 12,
  isLate: false,
  overridden: false,
  ovrRaw: undefined,
  repId: 'rep-1',
  paidMonth: '6/2026',
  ...over.line,
});

describe('commission earning gate', () => {
  test('waits for full payment', () => {
    expect(isCommissionEarnedInvoice({ status: 'partial' })).toBe(false);
    expect(isCommissionEarnedInvoice({ status: 'unpaid' })).toBe(false);
    expect(isCommissionEarnedInvoice({ status: 'paid' })).toBe(true);
  });
});

describe('canSnapshotLine — only freeze the truth', () => {
  test('accepts a fully-hydrated paid line', () => {
    expect(canSnapshotLine(paidLine())).toBe(true);
  });
  test('rejects partial invoices (final payment date unknown)', () => {
    expect(canSnapshotLine(paidLine({ inv: { status: 'partial' } }))).toBe(false);
  });
  test('rejects when payment rows have not hydrated', () => {
    expect(canSnapshotLine(paidLine({ inv: { _paymentsHydrated: false } }))).toBe(false);
  });
  test('rejects a paid invoice with no payment rows (paid date would be the invoice-date fallback)', () => {
    expect(canSnapshotLine(paidLine({ inv: { payments: [] } }))).toBe(false);
  });
  test('rejects when the SO is missing or its cost inputs are half-loaded', () => {
    expect(canSnapshotLine({ ...paidLine(), so: null })).toBe(false);
    expect(canSnapshotLine(paidLine({ so: { _itemsHydrated: false } }))).toBe(false);
    expect(canSnapshotLine(paidLine({ so: { _posHydrated: false } }))).toBe(false);
  });
});

describe('snapshotRowFromLine', () => {
  test('captures the money, local-calendar paid date, and attribution', () => {
    const row = snapshotRowFromLine(paidLine(), 'Admin');
    expect(row).toMatchObject({
      invoice_id: 'INV-100', so_id: 'SO-1', customer_id: 'C-1', rep_id: 'rep-1',
      rate: 0.30, amount: 60, paid_date: '2026-06-10', days_to_pay: 12,
      override: null, snapped_by: 'Admin',
    });
    expect(row.gp.gp).toBe(200);
  });
  test('captures an active admin override', () => {
    const row = snapshotRowFromLine(paidLine({ line: { ovrRaw: 0.25, commRate: 0.25, commAmt: 50, overridden: true } }), 'Admin');
    expect(row.override).toEqual({ value: 0.25 });
    expect(row.rate).toBe(0.25);
    expect(row.amount).toBe(50);
  });
});

describe('applySnapshotToLine — frozen lines stop moving', () => {
  const snap = {
    invoice_id: 'INV-100', gp: { rev: 500, cost: 300, gp: 200 },
    rate: 0.30, amount: 60, paid_date: '2026-06-10', days_to_pay: 12,
    override: null, snapped_at: '2026-07-07T00:00:00Z',
  };
  test('a later SO cost edit no longer changes the line', () => {
    // Live recompute after someone edited the SO: cost ballooned, GP collapsed.
    const drifted = paidLine({ line: { gp: { rev: 500, cost: 450, gp: 50 }, commAmt: 15 } });
    const out = applySnapshotToLine(drifted, snap, parseDate);
    expect(out.gp.gp).toBe(200);
    expect(out.commAmt).toBe(60);
    expect(out.snapped).toBe(true);
  });
  test('paid date and statement month come from the freeze, on the local calendar', () => {
    const drifted = paidLine({ line: { paidDate: new Date(2026, 7, 2), paidMonth: '8/2026', daysToPay: 95, isLate: true } });
    const out = applySnapshotToLine(drifted, snap, parseDate);
    expect(out.paidMonth).toBe('6/2026');
    expect(out.daysToPay).toBe(12);
    expect(out.isLate).toBe(false);
  });
  test('frozen override wins over live app_state', () => {
    const out = applySnapshotToLine(paidLine(), { ...snap, rate: 0.25, amount: 50, override: { value: 0.25 } }, parseDate);
    expect(out.overridden).toBe(true);
    expect(out.ovrRaw).toBe(0.25);
    expect(out.commRate).toBe(0.25);
  });
  test('no snapshot → line passes through untouched', () => {
    const line = paidLine();
    expect(applySnapshotToLine(line, null, parseDate)).toBe(line);
  });
});

describe('overrideSnapshotPatch', () => {
  const lateSnap = { gp: { gp: 200 }, days_to_pay: 120 };
  test('true restores the standard rate on a late invoice', () => {
    expect(overrideSnapshotPatch(lateSnap, true)).toEqual({ rate: COMM_RATE_STANDARD, amount: 60, override: { value: true } });
  });
  test('a number sets an explicit rate', () => {
    expect(overrideSnapshotPatch(lateSnap, 0.2)).toEqual({ rate: 0.2, amount: 40, override: { value: 0.2 } });
  });
  test('clearing falls back to the base rate implied by frozen days-to-pay', () => {
    expect(overrideSnapshotPatch(lateSnap, null)).toEqual({ rate: COMM_RATE_LATE, amount: 30, override: null });
    expect(overrideSnapshotPatch({ gp: { gp: 200 }, days_to_pay: 10 }, null)).toEqual({ rate: COMM_RATE_STANDARD, amount: 60, override: null });
  });
});

// ── Adversarial-input regressions (2026-07-18 sweep) ──
describe('malformed-input hardening', () => {
  test('snapshotRowFromLine: an Invalid Date paidDate writes null, not "NaN-NaN-NaN"', () => {
    const line = paidLine();
    line.paidDate = new Date('garbage');
    expect(snapshotRowFromLine(line, 'Sam').paid_date).toBeNull();
  });
  test('overrideSnapshotPatch: NaN override (blanked admin input) clears instead of writing NaN money', () => {
    const patch = overrideSnapshotPatch({ gp: { gp: 200 }, days_to_pay: 120 }, NaN);
    expect(patch).toEqual({ rate: COMM_RATE_LATE, amount: 30, override: null });
    const patch2 = overrideSnapshotPatch({ gp: { gp: 200 }, days_to_pay: 10 }, Infinity);
    expect(patch2).toEqual({ rate: COMM_RATE_STANDARD, amount: 60, override: null });
  });
  // Characterizations: pinned so these can't drift silently.
  test('canSnapshotLine: hydration flags simply ABSENT (unknown, not false) still allow freezing — optimistic by design', () => {
    const line = paidLine();
    delete line.so._itemsHydrated;
    delete line.so._posHydrated;
    delete line.inv._paymentsHydrated;
    expect(canSnapshotLine(line)).toBe(true);
  });
  test('applySnapshotToLine: legacy snapshot with no gp falls back to LIVE gp while commAmt stays frozen (documented mixed-era display)', () => {
    const line = paidLine();
    const out = applySnapshotToLine(line, { rate: 0.3, amount: 60, paid_date: '2026-06-10', days_to_pay: 12 }, parseDate);
    expect(out.gp).toBe(line.gp); // live fallback — snapshot rows written before GP capture
    expect(out.commAmt).toBe(60);
    expect(out.snapped).toBe(true);
  });
});
