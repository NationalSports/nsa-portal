/* eslint-disable */
/**
 * autoSellFromCost — a custom line's "sell = cost x markup" convenience.
 *
 * The formula is a head start for an unpriced line, NOT a rule. It used to re-run on every
 * cost edit AND on a no-op blur of the Cost box ($In re-fired onChange with an unchanged
 * value), so a rep who typed $40 on a $21.04 line watched it snap back to $34.75 the moment
 * they clicked through the Cost field — SO-2539, West Hills CC / Alleson jerseys.
 *
 * SAFE: pure functions only — no Supabase, no DOM, no network.
 */
import { autoSellFromCost } from '../safeHelpers';

const rQ = (v) => Math.round(v * 4) / 4;
const sell = (item, cost, mk = 1.65) => autoSellFromCost(item, cost, mk, rQ);

describe('autoSellFromCost — the markup only drives an unpriced line', () => {
  test('an unpriced line gets the markup price', () => {
    expect(sell({ nsa_cost: 0, unit_sell: 0 }, 21.04)).toBe(34.75);
  });

  test('a line still sitting at its derived price follows the new cost', () => {
    // 21.04 x 1.65 -> 34.75 is what the line carries, so it was never touched by hand.
    expect(sell({ nsa_cost: 21.04, unit_sell: 34.75 }, 25)).toBe(41.25);
  });

  // The SO-2539 case.
  test('a hand-set sell is left alone when the cost changes', () => {
    expect(sell({ nsa_cost: 21.04, unit_sell: 40 }, 25)).toBeNull();
  });

  test('a hand-set sell is left alone on a no-op cost commit', () => {
    expect(sell({ nsa_cost: 21.04, unit_sell: 40 }, 21.04)).toBeNull();
  });

  test('a hand-set sell BELOW the markup price is protected too', () => {
    expect(sell({ nsa_cost: 21.04, unit_sell: 25 }, 21.04)).toBeNull();
  });

  test('a cost of zero never prices the line', () => {
    expect(sell({ nsa_cost: 21.04, unit_sell: 40 }, 0)).toBeNull();
    expect(sell({ nsa_cost: 0, unit_sell: 0 }, 0)).toBeNull();
  });

  test('the order markup is honoured, defaulting to 1.65', () => {
    expect(sell({ nsa_cost: 0, unit_sell: 0 }, 20, 1.9)).toBe(38);
    expect(autoSellFromCost({ nsa_cost: 0, unit_sell: 0 }, 20, null, rQ)).toBe(33);
    expect(autoSellFromCost({ nsa_cost: 0, unit_sell: 0 }, 20, 0, rQ)).toBe(33);
  });

  test('a rounding-width match still counts as auto', () => {
    // rQ(21.04 * 1.65) === 34.75; a cent of drift on the stored value is still "untouched".
    expect(sell({ nsa_cost: 21.04, unit_sell: 34.7501 }, 30)).toBe(49.5);
  });

  test('a numeric column revived as a string is not mistaken for unpriced', () => {
    expect(sell({ nsa_cost: '21.04', unit_sell: '40' }, 25)).toBeNull();
    expect(sell({ nsa_cost: '21.04', unit_sell: '34.75' }, 25)).toBe(41.25);
  });

  test('survives a missing item and a missing rounder', () => {
    expect(sell(null, 20)).toBe(33);
    expect(sell(undefined, 0)).toBeNull();
    expect(autoSellFromCost({ nsa_cost: 0, unit_sell: 0 }, 20, 1.65, null)).toBe(33);
  });
});
