/* Payment-level rating — commissionSnapshots.blendedStandardRate and the snapshot
 * round-trip that has to survive it.
 *
 * The rule (per Steve, 2026-09): the late penalty is assessed per PAYMENT, not per
 * invoice. Each payment is rated on its own age — invoice date to that payment's date —
 * and weighted by its share of what was collected. A deposit banked on day 1 keeps the
 * full 30% no matter how late the balance arrives.
 *
 * This replaced a rule that looked at a single date (the LAST payment) and halved the
 * rate on the whole invoice, so a 50/50 deposit order whose balance came in on day 120
 * paid 15% on the deposit too. */

import {
  blendedStandardRate, snapshotRowFromLine, applySnapshotToLine, overrideSnapshotPatch,
  COMM_RATE_STANDARD, COMM_RATE_LATE,
} from '../commissionSnapshots';

const D = (s) => new Date(s + 'T12:00:00');
const INV = D('2026-06-01');
const pay = (amount, dateStr) => ({ amount, date: D(dateStr) });

describe('blendedStandardRate — each payment rated on its own age', () => {
  test('the headline case: day-1 deposit keeps 30% when the balance lands on day 120', () => {
    // 50/50 split. Old rule: whole invoice at 15%. New rule: half at 30%, half at 15%.
    const r = blendedStandardRate([pay(5000, '2026-06-02'), pay(5000, '2026-09-29')], INV);
    expect(r).toBeCloseTo(0.225, 6);
    // On $10,000 of GP that is $2,250, against $1,500 under the old whole-invoice rule.
    expect(Math.round(10000 * r * 100) / 100).toBe(2250);
  });

  test('paid in full on time is exactly the standard rate', () => {
    expect(blendedStandardRate([pay(1000, '2026-06-15')], INV)).toBe(COMM_RATE_STANDARD);
  });

  test('paid in full late is exactly the late rate', () => {
    expect(blendedStandardRate([pay(1000, '2026-10-01')], INV)).toBe(COMM_RATE_LATE);
  });

  test('exactly 90 days is still on time; 91 trips it', () => {
    expect(blendedStandardRate([pay(100, '2026-08-30')], INV)).toBe(COMM_RATE_STANDARD); // 90
    expect(blendedStandardRate([pay(100, '2026-08-31')], INV)).toBe(COMM_RATE_LATE);     // 91
  });

  test('the blend follows the MONEY, not the number of payments', () => {
    // One big on-time payment and three small late ones should stay near 30%.
    const r = blendedStandardRate([
      pay(9700, '2026-06-05'), pay(100, '2026-10-01'), pay(100, '2026-10-02'), pay(100, '2026-10-03'),
    ], INV);
    expect(r).toBeCloseTo(0.2955, 4);
    expect(r).toBeGreaterThan(0.29);
  });

  test('a rounding-error payment cannot swing the rate', () => {
    const r = blendedStandardRate([pay(9999.99, '2026-06-05'), pay(0.01, '2026-12-01')], INV);
    expect(r).toBeCloseTo(COMM_RATE_STANDARD, 4);
  });

  test('returns null when there is nothing to blend, so callers fall back', () => {
    expect(blendedStandardRate([], INV)).toBeNull();
    expect(blendedStandardRate(null, INV)).toBeNull();
    expect(blendedStandardRate([pay(100, '2026-06-05')], null)).toBeNull();
    expect(blendedStandardRate([pay(100, '2026-06-05')], new Date('nope'))).toBeNull();
  });

  test('undated, zero and negative payments are skipped, not guessed at', () => {
    const withJunk = blendedStandardRate([
      pay(5000, '2026-06-02'), pay(5000, '2026-09-29'),
      { amount: 500, date: null }, { amount: 0, date: D('2026-06-02') },
      { amount: -100, date: D('2026-06-02') }, { amount: 'abc', date: D('2026-06-02') },
    ], INV);
    expect(withJunk).toBe(blendedStandardRate([pay(5000, '2026-06-02'), pay(5000, '2026-09-29')], INV));
  });

  test('every payment junk means null, never NaN', () => {
    const r = blendedStandardRate([{ amount: 0, date: null }, { amount: NaN, date: D('2026-06-02') }], INV);
    expect(r).toBeNull();
  });

  test('the blend always sits within [late, standard]', () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 5000; i++) {
      const n = 1 + Math.floor(rnd() * 4);
      const ps = Array.from({ length: n }, () => ({
        amount: rnd() * 5000,
        date: new Date(INV.getTime() + Math.floor(rnd() * 300) * 86400000),
      }));
      const r = blendedStandardRate(ps, INV);
      if (r == null) continue;
      expect(r).toBeGreaterThanOrEqual(COMM_RATE_LATE);
      expect(r).toBeLessThanOrEqual(COMM_RATE_STANDARD);
    }
  });
});

describe('snapshot round-trip — a blended rate survives the freeze', () => {
  const line = {
    inv: { id: 'INV-1', customer_id: 'c1', so_id: 'SO-1' }, so: { id: 'SO-1' }, repId: 'rep1',
    gp: { gp: 10000, rev: 30000 }, commRate: 0.225, commAmt: 2250, baseRate: 0.225,
    paidDate: D('2026-09-29'), daysToPay: 120, ovrRaw: undefined,
  };

  test('the freeze stores the pre-override rate', () => {
    expect(snapshotRowFromLine(line, 'steve').base_rate).toBe(0.225);
  });

  test('clearing an override restores the BLEND, not a flat 15%', () => {
    // This is the whole reason base_rate exists: days_to_pay is 120, so the old
    // derivation would drop this rep to 15% and quietly halve $2,250 to $1,500.
    const snap = { ...snapshotRowFromLine(line, 'steve'), snapped_at: 'x' };
    const patch = overrideSnapshotPatch(snap, null, 'gp', null);
    expect(patch.rate).toBe(0.225);
    expect(patch.amount).toBe(2250);
    expect(patch.override).toBeNull();
  });

  test('an admin can still force the full 30% over a blend', () => {
    const snap = snapshotRowFromLine(line, 'steve');
    const patch = overrideSnapshotPatch(snap, true, 'gp', null);
    expect(patch.rate).toBe(COMM_RATE_STANDARD);
    expect(patch.amount).toBe(3000);
  });

  test('rows frozen before base_rate existed keep the old single-date behaviour', () => {
    const legacy = { gp: { gp: 10000, rev: 30000 }, days_to_pay: 120, base_rate: null };
    expect(overrideSnapshotPatch(legacy, null, 'gp', null).rate).toBe(COMM_RATE_LATE);
    const onTime = { gp: { gp: 10000, rev: 30000 }, days_to_pay: 10, base_rate: null };
    expect(overrideSnapshotPatch(onTime, null, 'gp', null).rate).toBe(COMM_RATE_STANDARD);
  });

  test('a part-late invoice reads back as late so it appears in the report', () => {
    const snap = { ...snapshotRowFromLine(line, 'steve'), snapped_at: 'x' };
    const back = applySnapshotToLine({ ...line }, snap, (s) => new Date(s + 'T12:00:00'));
    expect(back.baseRate).toBe(0.225);
    expect(back.isLate).toBe(true);
    expect(back.commRate).toBe(0.225);
  });

  test('a fully on-time invoice does not read back as late', () => {
    const ok = { ...line, commRate: 0.30, commAmt: 3000, baseRate: 0.30, daysToPay: 10 };
    const back = applySnapshotToLine({ ...ok }, snapshotRowFromLine(ok, 'steve'), (s) => new Date(s + 'T12:00:00'));
    expect(back.isLate).toBe(false);
  });

  test('revenue-basis reps are untouched by the blend', () => {
    const snap = { ...snapshotRowFromLine(line, 'steve'), days_to_pay: 120 };
    const patch = overrideSnapshotPatch(snap, null, 'revenue', 0.01);
    expect(patch.rate).toBe(0.01);
    expect(patch.amount).toBe(300); // 1% of the frozen revenue, not of GP
  });
});
