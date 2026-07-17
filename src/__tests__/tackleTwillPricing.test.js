// Tackle-twill decoration pricing (added 2026-07). Two flat menus priced per application:
//   TWA — chest/logo placements (kind:'twill', menu index on d.dtf_size)
//   TWN — jersey numbers (kind:'numbers', num_method:'tackle_twill', keyed by num_size × two_color)
// Costs are the shop's real twill cost; sell defaults to 2× cost and is editable in Settings.
// This suite pins the intended VALUES and dP behavior (parity across the hand-synced copies is
// guarded separately by pricingDrift.test.js).
const DP = require('../lib/decoPricing');
const T = DP.DEFAULTS;

describe('tackle-twill logo menu (TWA / twaP)', () => {
  test('default menu is the 5 placements at 2× cost', () => {
    expect(DP.TWA).toEqual([
      { label: 'Left Chest 1 Color', cost: 6, sell: 12 },
      { label: 'Full Chest 1 Color', cost: 11, sell: 22 },
      { label: 'Full Chest 1 Color — Open Jerseys', cost: 12.5, sell: 25 },
      { label: 'Full Chest 2 Color', cost: 13.5, sell: 27 },
      { label: 'Full Chest 2 Color — Open Jerseys', cost: 16.5, sell: 33 },
    ]);
  });

  test('twaP returns the row cost/sell by index', () => {
    expect(DP.twaP(T, 0, false)).toBe(6);
    expect(DP.twaP(T, 0, true)).toBe(12);
    expect(DP.twaP(T, 3, false)).toBe(13.5);
    expect(DP.twaP(T, 3, true)).toBe(27);
    expect(DP.twaP(T, 4, true)).toBe(33);
  });

  test('twaP falls back to the first row for an out-of-range index', () => {
    expect(DP.twaP(T, 99, true)).toBe(12);
    expect(DP.twaP(T, undefined, true)).toBe(12);
  });
});

describe('tackle-twill number menu (TWN / twnP)', () => {
  const cases = [
    ['1-4"', false, 1.5, 3], ['1-4"', true, 2.5, 5],
    ['6"', false, 1.75, 3.5], ['6"', true, 2.75, 5.5],
    ['8-10"', false, 3, 6], ['8-10"', true, 4, 8],
  ];
  test.each(cases)('twnP(%s, twoColor=%s) → cost %d / sell %d', (size, tw, cost, sell) => {
    expect(DP.twnP(T, size, tw, false)).toBe(cost);
    expect(DP.twnP(T, size, tw, true)).toBe(sell);
  });

  test('twnP falls back to the first size row when num_size is unknown', () => {
    expect(DP.twnP(T, 'bogus', false, false)).toBe(1.5);
    expect(DP.twnP(T, 'bogus', true, true)).toBe(5);
  });
});

describe('dP — tackle-twill logo (kind:twill)', () => {
  test('prices from TWA at the chosen index', () => {
    expect(DP.dP(T, { kind: 'twill', dtf_size: 3 }, 10, [], 10)).toEqual({ sell: 27, cost: 13.5 });
    expect(DP.dP(T, { kind: 'twill', dtf_size: 0 }, 10, [], 10)).toEqual({ sell: 12, cost: 6 });
  });

  test('honors a sell_override, including an explicit 0', () => {
    expect(DP.dP(T, { kind: 'twill', dtf_size: 3, sell_override: 20 }, 10, [], 10).sell).toBe(20);
    expect(DP.dP(T, { kind: 'twill', dtf_size: 3, sell_override: 0 }, 10, [], 10)).toEqual({ sell: 0, cost: 13.5 });
  });
});

describe('dP — tackle-twill numbers (kind:numbers, num_method:tackle_twill)', () => {
  test('prices per application from TWN, defaulting the count to the garment qty', () => {
    const r = DP.dP(T, { kind: 'numbers', num_method: 'tackle_twill', num_size: '6"', two_color: false }, 12, [], 12);
    expect(r.sell).toBe(3.5);
    expect(r.cost).toBe(1.75);
    expect(r._nq).toBe(12); // no roster/num_qty → falls back to q
  });

  test('front+back and reversible each double the application count (_nq)', () => {
    const r = DP.dP(T, { kind: 'numbers', num_method: 'tackle_twill', num_size: '8-10"', two_color: true, num_qty: 10, front_and_back: true, reversible: true }, 10, [], 10);
    expect(r.sell).toBe(8);
    expect(r.cost).toBe(4);
    expect(r._nq).toBe(40); // 10 × 2 (F+B) × 2 (reversible)
  });

  test('counts assigned roster numbers over the garment qty', () => {
    const roster = { M: ['10', '11', ''], L: ['23'] }; // 3 real numbers
    const r = DP.dP(T, { kind: 'numbers', num_method: 'tackle_twill', num_size: '1-4"', two_color: false, roster }, 20, [], 20);
    expect(r._nq).toBe(3);
    expect(r.sell).toBe(3);
  });
});

describe('twill folds into the item line the same way other decos do', () => {
  test('per-garment logo sell adds to the line rate', () => {
    // Mirrors the estimate/SO doc math: rate = unit_sell + Σ dP(deco).sell
    const decoSell = DP.dP(T, { kind: 'twill', dtf_size: 3 }, 10, [], 10).sell; // Full Chest 2 Color
    expect(25 + decoSell).toBe(52); // $25 garment + $27 twill
  });
});
