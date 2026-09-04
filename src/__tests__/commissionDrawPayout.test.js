/* Rep payout math — businessLogic.calcRepPayout (the REAL module the Payouts panel calls).
 *
 * The rule (per Steve, 2026-09): the monthly DRAW is a cash advance against COMMISSION.
 * The rep is paid the draw through payroll; it is recovered out of the commission they
 * earn. payable = net commission − draw, floored at $0, and a shortfall does NOT carry
 * into the next month.
 *
 * This replaced a rule that compared the draw against GROSS PROFIT dollars. That version
 * cleared far too easily — a $5,000 draw passed on $5,000 of GP, which is only $1,500 of
 * commission — and then paid commission on top of a draw that was never earned back.
 * The regression cases below pin the real September 2026 rows that exposed it. */

import { calcRepPayout } from '../businessLogic';

describe('calcRepPayout — draw is an advance against commission', () => {
  test('Kevin, Sept 2026: $4,078.47 earned against a $5,000 draw is UNDER, pays $0', () => {
    const r = calcRepPayout({ netCommission: 4078.47, draw: 5000, loanBalance: 6033, loanPct: 50 });
    expect(r.underBy).toBe(921.53);
    expect(r.payable).toBe(0);
    expect(r.payout).toBe(0);
    // He did produce $13,594.85 of GP — more than his draw in GP dollars. Under the old
    // rule that cleared the draw and paid him $2,578.47. It must not any more.
    expect(r.payout).not.toBe(2578.47);
  });

  test('Kelly, Sept 2026: $7,265.96 earned against a $16,667 draw is UNDER, pays $0', () => {
    const r = calcRepPayout({ netCommission: 7265.96, draw: 16667, loanBalance: 0 });
    expect(r.underBy).toBe(9401.04);
    expect(r.payable).toBe(0);
    expect(r.payout).toBe(0);
    expect(r.payout).not.toBe(2265.85); // what the old GP-hurdle rule paid her
  });

  test('a rep with no draw is untouched — full net commission is payable', () => {
    for (const draw of [0, undefined, null]) {
      const r = calcRepPayout({ netCommission: 3049.64, draw });
      expect(r.underBy).toBe(0);
      expect(r.payable).toBe(3049.64);
      expect(r.payout).toBe(3049.64);
    }
  });

  test('draw fully earned back: only the excess commission is payable', () => {
    const r = calcRepPayout({ netCommission: 8000, draw: 5000 });
    expect(r.underBy).toBe(0);
    expect(r.payable).toBe(3000);
    expect(r.payout).toBe(3000);
  });

  test('break-even to the cent: commission exactly equal to the draw pays $0, not a negative', () => {
    const r = calcRepPayout({ netCommission: 5000, draw: 5000 });
    expect(r.underBy).toBe(0);
    expect(r.payable).toBe(0);
    expect(r.payout).toBe(0);
  });

  test('a shortfall never becomes a negative payout, and never carries between months', () => {
    const jan = calcRepPayout({ netCommission: 1000, draw: 5000 });
    expect(jan.payable).toBe(0);
    expect(jan.underBy).toBe(4000);
    // February is computed from February's own numbers only — January's $4,000 hole is
    // gone. A rep clearing their draw in Feb is paid the full excess.
    const feb = calcRepPayout({ netCommission: 6000, draw: 5000 });
    expect(feb.payable).toBe(1000);
    expect(feb.payout).toBe(1000);
  });
});

describe('calcRepPayout — loan withholding rides on payable, not on gross commission', () => {
  test('withholds the set % of payable', () => {
    const r = calcRepPayout({ netCommission: 8000, draw: 5000, loanBalance: 6033, loanPct: 50 });
    expect(r.payable).toBe(3000);
    expect(r.withhold).toBe(1500);
    expect(r.payout).toBe(1500);
  });

  test('never withholds more than the outstanding balance', () => {
    const r = calcRepPayout({ netCommission: 8000, draw: 5000, loanBalance: 800, loanPct: 50 });
    expect(r.withhold).toBe(800);
    expect(r.payout).toBe(2200);
  });

  test('an under-draw month withholds nothing — there is no payable to withhold from', () => {
    const r = calcRepPayout({ netCommission: 4078.47, draw: 5000, loanBalance: 6033, loanPct: 50 });
    expect(r.withhold).toBe(0);
    expect(r.payout).toBe(0);
  });

  test('"pay full this month" skips the withholding entirely', () => {
    const r = calcRepPayout({ netCommission: 8000, draw: 5000, loanBalance: 6033, loanPct: 50, payFull: true });
    expect(r.withhold).toBe(0);
    expect(r.payout).toBe(3000);
  });

  test('once applied, the stored amount is authoritative and the % is not recomputed', () => {
    const r = calcRepPayout({ netCommission: 7578.47, draw: 5000, loanBalance: 4743.77, loanPct: 90, appliedAmt: 1289.23 });
    expect(r.payable).toBe(2578.47);
    expect(r.withhold).toBe(1289.23); // NOT 90% of payable
    expect(r.payout).toBe(1289.24);
  });

  test('an applied month whose payable later drops cannot produce a negative payout', () => {
    const r = calcRepPayout({ netCommission: 4000, draw: 5000, appliedAmt: 1289.23 });
    expect(r.payable).toBe(0);
    expect(r.payout).toBe(0);
    expect(r.payout).toBeGreaterThanOrEqual(0);
  });

  test('loanPct defaults to 50 when unset', () => {
    expect(calcRepPayout({ netCommission: 3000, draw: 0, loanBalance: 5000 }).withhold).toBe(1500);
  });
});

describe('calcRepPayout — garbage in cannot mint money', () => {
  test('missing / non-numeric inputs read as zero', () => {
    expect(calcRepPayout().payout).toBe(0);
    expect(calcRepPayout({ netCommission: null, draw: undefined }).payout).toBe(0);
    expect(calcRepPayout({ netCommission: 'abc', draw: 'xyz' }).payout).toBe(0);
  });

  test('a negative draw cannot inflate the payout above commission earned', () => {
    const r = calcRepPayout({ netCommission: 1000, draw: -5000 });
    expect(r.draw).toBe(0);
    expect(r.payable).toBe(1000);
  });

  test('a negative net commission floors at $0 payable', () => {
    expect(calcRepPayout({ netCommission: -500, draw: 0 }).payable).toBe(0);
  });

  test('loanPct is clamped to 0..100', () => {
    expect(calcRepPayout({ netCommission: 1000, draw: 0, loanBalance: 9999, loanPct: 500 }).withhold).toBe(1000);
    expect(calcRepPayout({ netCommission: 1000, draw: 0, loanBalance: 9999, loanPct: -10 }).withhold).toBe(0);
  });

  test('every returned amount is a clean 2-decimal money value', () => {
    const r = calcRepPayout({ netCommission: 4078.466666, draw: 1000.004, loanBalance: 6033, loanPct: 33 });
    for (const k of ['netComm', 'draw', 'underBy', 'payable', 'loanBal', 'withhold', 'payout']) {
      expect(Math.round(r[k] * 100) / 100).toBe(r[k]);
    }
  });
});

/* ── Adversarial pass ──────────────────────────────────────────────────────────
 * Each case below is a hole that was actually open in calcRepPayout and is now
 * closed. The inputs are not hypothetical shapes: draw / loanBalance / loanPct /
 * loanLog all come out of a hand-editable JSON blob in app_state, so the function
 * has to survive values the settings modal would never have written. */
describe('calcRepPayout — adversarial', () => {
  test('a negative stored loan amount cannot pay out MORE than was earned', () => {
    // Was: withhold -500 → payout 4500 on a payable of 4000. Money out of thin air.
    const r = calcRepPayout({ netCommission: 9000, draw: 5000, appliedAmt: -500 });
    expect(r.withhold).toBe(0);
    expect(r.payout).toBe(4000);
    expect(r.payout).toBeLessThanOrEqual(r.payable);
  });

  test('a blank or unparseable withholding % falls back to 50, never to 0', () => {
    // Was: '' and NaN both read as 0% — withholding silently stopped and the rep was
    // overpaid, with nothing on screen to say the loan had been skipped.
    // Number([]) is 0 and Number(true) is 1 — loose coercion would read these as a real
    // withholding rate rather than as the junk they are.
    for (const loanPct of ['', '   ', 'abc', NaN, {}, [], true, false]) {
      const r = calcRepPayout({ netCommission: 9000, draw: 5000, loanBalance: 9999, loanPct });
      expect(r.pct).toBe(50);
      expect(r.withhold).toBe(2000);
    }
  });

  test('an exact half-cent split is deterministic — the penny always goes to the loan', () => {
    // Was: decided by binary float. 2578.47*50 === 128923.49999999999 rounded DOWN while
    // 1000.01*50 === 50000.500000000007 rounded UP — same half-cent, opposite ways.
    const cases = [[2578.47, 1289.24, 1289.23], [1000.01, 500.01, 500], [3333.33, 1666.67, 1666.66], [0.03, 0.02, 0.01]];
    for (const [payable, withhold, payout] of cases) {
      const r = calcRepPayout({ netCommission: payable + 5000, draw: 5000, loanBalance: 999999, loanPct: 50 });
      expect(r.payable).toBe(payable);
      expect(r.withhold).toBe(withhold);
      expect(r.payout).toBe(payout);
      expect(Math.round((r.withhold + r.payout) * 100) / 100).toBe(payable); // no penny lost
    }
  });

  test('withholding never exceeds payable, even at 100%', () => {
    const r = calcRepPayout({ netCommission: 9000, draw: 5000, loanBalance: 99999, loanPct: 100 });
    expect(r.withhold).toBe(4000);
    expect(r.payout).toBe(0);
  });

  test('numeric strings from stored JSON are honoured, not silently read as no-draw', () => {
    const r = calcRepPayout({ netCommission: 9000, draw: '5000', loanBalance: '800', loanPct: '50' });
    expect(r.draw).toBe(5000);
    expect(r.payable).toBe(4000);
    expect(r.withhold).toBe(800);
  });

  test('non-finite money never reaches the screen as Infinity or NaN', () => {
    for (const v of [Infinity, -Infinity, NaN]) {
      const r = calcRepPayout({ netCommission: v, draw: v, loanBalance: v });
      for (const k of ['netComm', 'draw', 'underBy', 'payable', 'loanBal', 'withhold', 'payout']) {
        expect(Number.isFinite(r[k])).toBe(true);
      }
    }
  });

  test('invariants hold across the whole input space (fuzz)', () => {
    const MONEY = ['netComm', 'draw', 'underBy', 'payable', 'loanBal', 'withhold', 'payout'];
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 20000; i++) {
      const applied = rnd() < 0.15 ? rnd() * 4000 - 500 : null;
      const payFull = rnd() < 0.15;
      const r = calcRepPayout({
        netCommission: rnd() * 40000 - 5000,
        draw: rnd() < 0.4 ? 0 : rnd() * 20000,
        loanBalance: rnd() < 0.5 ? 0 : rnd() * 20000,
        loanPct: rnd() < 0.2 ? null : rnd() * 120 - 10,
        payFull, appliedAmt: applied,
      });
      expect(r.payout).toBeGreaterThanOrEqual(0);        // a rep is never billed to work
      expect(r.withhold).toBeGreaterThanOrEqual(0);
      expect(r.underBy).toBeGreaterThanOrEqual(0);
      expect(r.withhold).toBeLessThanOrEqual(r.payable); // withholding can't exceed the check
      expect(Math.round((r.withhold + r.payout) * 100) / 100).toBe(r.payable); // no penny created or lost
      if (applied == null && !payFull) expect(r.withhold).toBeLessThanOrEqual(r.loanBal);
      for (const k of MONEY) expect(Math.round(r[k] * 100) / 100).toBe(r[k]);
    }
  });
});
