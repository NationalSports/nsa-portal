/* eslint-disable */
// Adversarial / characterization tests for src/pricing.js, src/lib/decoPricing.js,
// src/richardsonPrices.js.
//
// Two production fixes were JUST applied and are pinned here as REGRESSION tests
// asserting the NEW (fixed) behavior:
//   1. getRichardsonLevel4Price — a whitespace-only style no longer prefix-matches
//      the whole table (''.startsWith('') was true for every key).
//   2. normSzName(42) no longer throws (String() coercion added before .toUpperCase()).
//   3. decoPricing dP — a non-numeric sell_override (e.g. 'abc' from a bad paste) is
//      now ignored instead of NaN-ing totals, while a numeric-string or explicit 0
//      override is still honored.
//
// Everything else here CHARACTERIZES current behavior (pins it, with a comment on
// why it's surprising) so it can't drift silently — it is not asserting these are
// the "right" answers, just the current, verified ones.

import {
  normSzName,
  auTierDisc,
  auCostMult,
  isAU,
  mergeColors,
  _decoVendorPrice,
  calcOrderTotals,
  soIsPaid,
  calcPaidQualifyingSpend,
  calcAdidasItemSpend,
} from '../pricing';
import { getRichardsonLevel4Price, RICHARDSON_LEVEL4_PRICES } from '../richardsonPrices';

const DP = require('../lib/decoPricing');
const T = DP.DEFAULTS;

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION 1 — getRichardsonLevel4Price: whitespace-only no longer prefix-matches
// ─────────────────────────────────────────────────────────────────────────────
describe('getRichardsonLevel4Price — whitespace/empty fix (regression)', () => {
  test('whitespace-only style returns 0, not the cheapest table price', () => {
    expect(getRichardsonLevel4Price(' ')).toBe(0);
    expect(getRichardsonLevel4Price('\t\t')).toBe(0);
  });

  test('null/undefined/empty string all return 0', () => {
    expect(getRichardsonLevel4Price(null)).toBe(0);
    expect(getRichardsonLevel4Price(undefined)).toBe(0);
    expect(getRichardsonLevel4Price('')).toBe(0);
  });

  test('a real style still returns its exact Level 4 price', () => {
    expect(getRichardsonLevel4Price('R15')).toBe(RICHARDSON_LEVEL4_PRICES['R15']);
    expect(getRichardsonLevel4Price('r15')).toBe(RICHARDSON_LEVEL4_PRICES['R15']); // case-insensitive
  });

  test('prefix matching still works for a real family (lowest matching price wins)', () => {
    // "PTS20" is a feed-style prefix covering catalog models PTS20M (7.44) and PTS20S (7.65).
    expect(getRichardsonLevel4Price('PTS20')).toBe(
      Math.min(RICHARDSON_LEVEL4_PRICES['PTS20M'], RICHARDSON_LEVEL4_PRICES['PTS20S'])
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION 2 — normSzName: numeric input no longer throws
// ─────────────────────────────────────────────────────────────────────────────
describe('normSzName — numeric-input fix (regression)', () => {
  test('a bare number no longer throws and returns its String() form', () => {
    expect(() => normSzName(42)).not.toThrow();
    expect(normSzName(42)).toBe('42');
  });

  test('0 is falsy and passes through unchanged (returns the number 0, not a string)', () => {
    expect(normSzName(0)).toBe(0);
  });

  test('normal strings still normalize — "Mens S" strips the adult qualifier to bare "S"', () => {
    // SZ_NORM has no 'S' key (only 'SM'/'SML'/'SMALL' -> 'S'), so the adult-qualifier
    // branch returns the stripped remainder ('S') as-is when it's not itself a SZ_NORM key.
    expect(normSzName('Mens S')).toBe('S');
    expect(normSzName('Mens Small')).toBe('S');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION 3 — decoPricing dP: non-numeric sell_override ignored, numeric honored
// ─────────────────────────────────────────────────────────────────────────────
describe('dP — sell_override coercion fix (regression)', () => {
  const emDeco = { type: 'embroidery', stitches: 8000 };

  test('a non-numeric sell_override ("abc") is ignored — computed sell is used (finite)', () => {
    const withBad = DP.dP(T, { ...emDeco, sell_override: 'abc' }, 6);
    const withNone = DP.dP(T, emDeco, 6);
    expect(Number.isFinite(withBad.sell)).toBe(true);
    expect(withBad.sell).toBe(withNone.sell);
    expect(Number.isNaN(withBad.sell)).toBe(false);
  });

  test('a numeric-string sell_override ("12.5") is still honored', () => {
    const r = DP.dP(T, { ...emDeco, sell_override: '12.5' }, 6);
    expect(r.sell).toBe('12.5'); // override value is passed through as-is when Number()-coercible
  });

  test('sell_override of explicit 0 is still honored (not treated as "no override")', () => {
    const r = DP.dP(T, { ...emDeco, sell_override: 0 }, 6);
    expect(r.sell).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTERIZATION — everything below pins CURRENT behavior
// ─────────────────────────────────────────────────────────────────────────────

// 4. Negative qty on the numbers branch flows straight through as a negative _nq;
//    calcOrderTotals then treats a negative est_qty numbers line as a revenue credit.
// Pinned so this can't drift silently — negative lines acting as implicit credits
// is surprising behavior with no explicit guard against it in the code.
describe('dP numbers branch — negative qty characterization', () => {
  test('negative num_qty flows through to _nq unchanged (non-reversible)', () => {
    const d = { kind: 'numbers', num_qty: -10 };
    const r = DP.dP(T, d, 5);
    expect(r._nq).toBe(-10);
  });

  test('negative num_qty doubles into _nq when reversible', () => {
    const d = { kind: 'numbers', num_qty: -10, reversible: true };
    const r = DP.dP(T, d, 5);
    expect(r._nq).toBe(-20);
  });

  test('calcOrderTotals subtracts revenue for a negative est_qty numbers line', () => {
    const order = {
      items: [
        {
          unit_sell: 20,
          est_qty: -5, // no sizes -> falls back to est_qty, which is negative here
          decorations: [{ kind: 'numbers' }], // no roster/num_qty -> useQty falls back to q (-5)
        },
      ],
    };
    const totals = calcOrderTotals(order);
    // product rev: -5 * 20 = -100; deco rev: eq(-5) * npP sell(7, bracket-0 since -5<=10) = -35
    expect(totals.rev).toBe(-100 + -5 * 7);
    expect(totals.rev).toBeLessThan(0);
  });
});

// 5. screen_print with a negative color count silently prices at $0/$0 instead of
//    erroring — spP's c<1||c>5 guard rejects the color count but the caller doesn't
//    surface that as a failure. Pinned to keep this silent-zero behavior visible.
describe('dP screen_print — negative colors characterization', () => {
  test('colors: -1 silently returns {sell: 0, cost: 0}', () => {
    const d = { type: 'screen_print', colors: -1 };
    const r = DP.dP(T, d, 10);
    expect(r).toEqual({ sell: 0, cost: 0 });
  });
});

// 6. auCostMult has no brand gate of its own — a non-AU brand still returns the
//    UA/NB multiplier because isAdidasPriced(brand) is false for it. Callers MUST
//    gate with isAU() first, or a random brand silently prices like UA/NB.
describe('auCostMult / auTierDisc — no internal brand gate (characterization)', () => {
  test('a non-AU brand (e.g. Nike) still returns the UA/NB multiplier, not a rejection', () => {
    expect(isAU('Nike')).toBe(false); // confirms Nike is NOT actually an AU brand
    expect(auCostMult('Nike', false)).toBe(0.425); // apparel UA/NB multiplier anyway
    expect(auCostMult('Nike', true)).toBeCloseTo(0.55 * 0.85, 10); // footwear UA/NB multiplier anyway
  });

  test('an unknown/lowercase tier code defaults to tier B', () => {
    expect(auTierDisc('z', undefined, 'Apparel')).toBe(0.35); // std schedule tier B
    expect(auTierDisc('a', undefined, 'Apparel')).toBe(0.35); // lowercase 'a' doesn't match key 'A' -> falls to B
    expect(auTierDisc(undefined, undefined, 'Apparel')).toBe(0.35);
  });
});

// 7. mergeColors falls back to the customer's own colors when the parent_id points
//    at a customer that isn't in the provided list (deleted/unloaded parent).
describe('mergeColors — unknown/missing parent characterization', () => {
  test('parent_id set but parent not found in allCustomers -> own colors only', () => {
    const cust = { parent_id: 'ghost-parent', pantone_colors: [{ code: 'PMS 100' }] };
    const result = mergeColors(cust, [], 'pantone_colors');
    expect(result).toEqual([{ code: 'PMS 100' }]);
  });

  test('no parent_id at all -> own colors only, trivially', () => {
    const cust = { pantone_colors: [{ code: 'PMS 200' }] };
    expect(mergeColors(cust, [{ id: 'other' }], 'pantone_colors')).toEqual([{ code: 'PMS 200' }]);
  });
});

// 8. _decoVendorPrice: unrecognized deco_type never sets a tier (none of the
//    embroidery/screen_print/dtf branches run) -> null. Exact min/max stitch
//    boundaries are inclusive on both ends.
describe('_decoVendorPrice — characterization', () => {
  const tiers = [
    { min_stitches: 0, max_stitches: 7999, qty_breaks: [{ min_qty: 1, price: 5 }] },
    { min_stitches: 8000, max_stitches: 15999, qty_breaks: [{ min_qty: 1, price: 8 }] },
  ];
  const pricingList = [{ deco_vendor_id: 'v1', deco_type: 'embroidery', pricing_tiers: { tiers } }];

  test('unknown deco_type returns null (no matching pricing row)', () => {
    expect(_decoVendorPrice(pricingList, 'v1', 'laser_etch', {})).toBeNull();
  });

  test('stitch count at the exact upper boundary (7999) picks the lower tier', () => {
    expect(_decoVendorPrice(pricingList, 'v1', 'embroidery', { stitches: 7999, qty: 1 })).toBe(5);
  });

  test('stitch count at the exact lower boundary of the next tier (8000) picks it', () => {
    expect(_decoVendorPrice(pricingList, 'v1', 'embroidery', { stitches: 8000, qty: 1 })).toBe(8);
  });
});

// 9. calcOrderTotals: a negative sizes total doesn't go negative on its own — it
//    fails the `sq>0` check and falls back to est_qty (sq is only used when positive).
describe('calcOrderTotals — negative sizes total characterization', () => {
  test('negative sizes sum falls back to est_qty rather than producing negative revenue from sizes', () => {
    const order = {
      items: [{ unit_sell: 10, est_qty: 4, sizes: { S: -5 } }],
    };
    const totals = calcOrderTotals(order);
    // sq = -5 (not > 0) -> q falls back to est_qty (4) -> rev = 4 * 10 = 40
    expect(totals.rev).toBe(40);
  });
});

// 10. soIsPaid tolerance: exactly $0.01 short of total counts as paid (the >= total-0.01
//     tolerance check); $0.02 short does not.
describe('soIsPaid — tolerance boundary characterization', () => {
  test('paid exactly $0.01 short of total counts as paid', () => {
    const so = { id: 'so1' };
    const invs = [{ so_id: 'so1', status: 'open', total: 100, paid: 99.99 }];
    expect(soIsPaid(so, invs)).toBe(true);
  });

  test('paid $0.02 short of total does not count as paid', () => {
    const so = { id: 'so1' };
    const invs = [{ so_id: 'so1', status: 'open', total: 100, paid: 99.98 }];
    expect(soIsPaid(so, invs)).toBe(false);
  });
});

// 11. calcPaidQualifyingSpend with an empty famIds set matches nothing -> all-zero result.
describe('calcPaidQualifyingSpend — empty famIds characterization', () => {
  test('empty famIds returns all-zero spend', () => {
    const result = calcPaidQualifyingSpend({
      sos: [{ id: 'so1', customer_id: 'cust1', order_date: '2026-01-01' }],
      invs: [],
      histInvs: [{ customer_id: 'cust1', status: 'paid', date: '2026-01-01', subtotal: 500 }],
      famIds: [],
      start: '2026-01-01',
      end: '2026-12-31',
    });
    expect(result).toEqual({ soSpend: 0, histSpend: 0, total: 0 });
  });
});

// 12. calcAdidasItemSpend: a negative unit_sell (credit/correction line) flows through
//     to a negative total — there's no floor at 0.
describe('calcAdidasItemSpend — negative unit_sell characterization', () => {
  test('negative unit_sell produces a negative total (no floor at 0)', () => {
    const order = {
      items: [{ brand: 'adidas', unit_sell: -10, est_qty: 2 }],
    };
    expect(calcAdidasItemSpend(order)).toBe(-20);
  });
});
