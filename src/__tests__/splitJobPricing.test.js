// ═══════════════════════════════════════════════
// SPLIT-JOB PRICING (JOB-1393-05)
// When a production job is split, the halves are separate press runs: screen-print setup
// isn't shared, so the design must bill each run at its own qty tier — a 1-pc run pays the
// bracket-0 flat charge, a 24-pc run pays the 24-tier rate — blended back into the line as
// an average per piece. Covers:
//   - decoPricing.spRunBlend (pure run-blend math)
//   - decoPricing.decoSplitRuns (stale-stamp guard)
//   - dP honoring d.split_runs (and the App/businessLogic copies via spRunBlend parity)
//   - splitJobPricing.buildSplitRunMap / stampSplitRuns (deriving runs from so_jobs)
// ═══════════════════════════════════════════════
const DP = require('../lib/decoPricing');
const BL = require('../businessLogic');
const { buildSplitRunMap, stampSplitRuns } = require('../lib/splitJobPricing');

const T = DP.DEFAULTS;
const rT = DP.rT;
const rQ = DP.rQ;
// Per-piece tier cost/sell exactly as dP's screen-print branch computes them (cost is
// quarter-rounded BEFORE markup — so 2.33 → 2.25 → sell 3.4, not spP's standalone 3.5).
const tierCost = (r, c, u = 1) => rQ(DP.spP(T, r, c, false) * u);
const tierSell = (r, c, u = 1) => rT(tierCost(r, c, u) * T.SP.mk);

describe('spRunBlend — independent per-run pricing, blended per piece', () => {
  test('SO-1393 case: 1 + 24 pieces, 1 color', () => {
    // 1-pc run: bracket-0 flat $50 sell / rQ(50/1.5)=$33.25 cost (all-in).
    // 24-pc run: tier cost rQ(2.33)=2.25 → sell rT(2.25×1.5)=3.4 per pc.
    const b = DP.spRunBlend(T, [1, 24], 1);
    const expSell = (50 + 24 * tierSell(24, 1)) / 25;
    const expCost = (rQ(50 / 1.5) + 24 * tierCost(24, 1)) / 25;
    expect(b.sell).toBeCloseTo(expSell, 10);
    expect(b.cost).toBeCloseTo(expCost, 10);
    // eq × share reconstructs the exact summed totals (the whole point of unrounded shares)
    expect(b.sell * 25).toBeCloseTo(50 + 24 * tierSell(24, 1), 10);
  });

  test('split total exceeds the combined-tier price (that is the business point)', () => {
    const combined = DP.spP(T, 25, 1, true) * 25; // 25 @ combined tier
    const split = DP.spRunBlend(T, [1, 24], 1).sell * 25;
    expect(split).toBeGreaterThan(combined);
  });

  test('two tier runs blend to the sum of their own tiers', () => {
    const b = DP.spRunBlend(T, [12, 24], 2);
    const exp = (12 * tierSell(12, 2) + 24 * tierSell(24, 2)) / 36;
    expect(b.sell).toBeCloseTo(exp, 10);
  });

  test('underbase scales both flat and tier runs', () => {
    const u = 1 + T.SP.ub;
    const b = DP.spRunBlend(T, [1, 24], 1, u);
    expect(b.sell * 25).toBeCloseTo(50 * u + 24 * tierSell(24, 1, u), 10);
  });

  test('returns null for <2 positive runs or zero qty', () => {
    expect(DP.spRunBlend(T, [25], 1)).toBeNull();
    expect(DP.spRunBlend(T, [0, 0], 1)).toBeNull();
    expect(DP.spRunBlend(T, [], 1)).toBeNull();
    expect(DP.spRunBlend(T, [25, 0], 1)).toBeNull(); // one live run → no blend
  });

  test('agrees with the businessLogic.js copy across brackets and colors', () => {
    const RUNS = [[1, 24], [5, 6], [12, 24], [11, 12], [1, 1], [24, 48, 108], [3, 500]];
    for (const runs of RUNS) {
      for (let c = 1; c <= 3; c++) {
        for (const u of [1, 1.15]) {
          const a = DP.spRunBlend(T, runs, c, u);
          const b = BL.spRunBlend(runs, c, u);
          expect(b.sell).toBeCloseTo(a.sell, 10);
          expect(b.cost).toBeCloseTo(a.cost, 10);
        }
      }
    }
  });
});

describe('decoSplitRuns — stale-stamp guard', () => {
  test('accepts runs summing to live qty; rejects stale sums', () => {
    expect(DP.decoSplitRuns({ split_runs: [1, 24] }, 25)).toEqual([1, 24]);
    expect(DP.decoSplitRuns({ split_runs: [1, 24] }, 31)).toBeNull(); // sizes edited after split
    expect(DP.decoSplitRuns({ split_runs: [25] }, 25)).toBeNull();
    expect(DP.decoSplitRuns({}, 25)).toBeNull();
  });
  test('reversible: matches the pre-doubled caller qty and doubles the runs', () => {
    expect(DP.decoSplitRuns({ split_runs: [1, 24], reversible: true }, 50)).toEqual([2, 48]);
    // caller convention without the ×2 still matches raw
    expect(DP.decoSplitRuns({ split_runs: [1, 24], reversible: true }, 25)).toEqual([1, 24]);
  });
});

describe('dP honors split_runs on screen-print art', () => {
  const art = [{ id: 'a1', deco_type: 'screen_print', ink_colors: 'Navy' }];
  const deco = { kind: 'art', art_file_id: 'a1', split_runs: [1, 24] };

  test('blended sell/cost at cq=25 (both decoPricing and businessLogic copies)', () => {
    const exp = DP.spRunBlend(T, [1, 24], 1);
    for (const fn of [(d, q, af, cq) => DP.dP(T, d, q, af, cq), BL.dP]) {
      const r = fn(deco, 25, art, 25);
      expect(r.sell).toBeCloseTo(exp.sell, 10);
      expect(r.cost).toBeCloseTo(exp.cost, 10);
    }
  });

  test('stale runs fall back to combined-tier pricing', () => {
    const r = DP.dP(T, deco, 31, art, 31);
    expect(r.sell).toBe(tierSell(31, 1));
  });

  test('sell_override still wins over the blend', () => {
    const r = DP.dP(T, { ...deco, sell_override: 9 }, 25, art, 25);
    expect(r.sell).toBe(9);
    expect(r.cost).toBeCloseTo(DP.spRunBlend(T, [1, 24], 1).cost, 10);
  });

  test('no split_runs → identical to pre-change combined pricing', () => {
    const r = DP.dP(T, { kind: 'art', art_file_id: 'a1' }, 25, art, 25);
    expect(r.sell).toBe(tierSell(25, 1));
  });
});

describe('buildSplitRunMap — deriving runs from so_jobs', () => {
  const j = (over) => ({ id: 'J1', art_file_id: 'a1', total_units: 24, ...over });

  test('flagged split partitions the design; unflagged legacy splits do not (forward-only)', () => {
    expect(buildSplitRunMap([
      j({ id: 'J1', total_units: 24, priced_separately: true }),
      j({ id: 'J1-C1', total_units: 1, split_from: 'J1', priced_separately: true }),
    ])).toEqual({ a1: [24, 1] });
    // legacy split without the flag → no partition
    expect(buildSplitRunMap([
      j({ id: 'J1', total_units: 24 }),
      j({ id: 'J1-C1', total_units: 1, split_from: 'J1' }),
    ])).toEqual({});
  });

  test('an approved override on any covering job restores combined pricing for the design', () => {
    expect(buildSplitRunMap([
      j({ id: 'J1', total_units: 24, priced_separately: true }),
      j({ id: 'J1-C1', total_units: 1, split_from: 'J1', priced_separately: true, price_override: { status: 'approved' } }),
    ])).toEqual({});
    // requested / denied do NOT restore it
    expect(buildSplitRunMap([
      j({ id: 'J1', total_units: 24, priced_separately: true }),
      j({ id: 'J1-C1', total_units: 1, split_from: 'J1', priced_separately: true, price_override: { status: 'requested' } }),
    ])).toEqual({ a1: [24, 1] });
  });

  test('unflagged sibling jobs of the same design contribute their units as runs', () => {
    expect(buildSplitRunMap([
      j({ id: 'J1', total_units: 20, priced_separately: true }),
      j({ id: 'J1-C1', total_units: 4, split_from: 'J1', priced_separately: true }),
      j({ id: 'J2', total_units: 6 }), // separate auto job, same art
    ])).toEqual({ a1: [20, 4, 6] });
  });

  test('drafts and zero-unit jobs are ignored', () => {
    expect(buildSplitRunMap([
      j({ id: 'J1', total_units: 24, priced_separately: true }),
      j({ id: 'J1-C1', total_units: 1, split_from: 'J1', priced_separately: true }),
      j({ id: 'D', _draft: true, total_units: 25 }),
      j({ id: 'Z', total_units: 0 }),
    ])).toEqual({ a1: [24, 1] });
  });
});

describe('stampSplitRuns — writes runs onto the order decorations', () => {
  const order = () => ({
    items: [
      { sku: 'DT6117', sizes: { '2XL': 1 }, decorations: [{ kind: 'art', art_file_id: 'a1' }] },
      { sku: 'DT6150', sizes: { S: 4, M: 11, L: 5, XL: 3, '2XL': 1 }, decorations: [{ kind: 'art', art_file_id: 'a1' }] },
    ],
    jobs: [
      { id: 'J1', art_file_id: 'a1', total_units: 24, priced_separately: true },
      { id: 'J1-C1', art_file_id: 'a1', total_units: 1, split_from: 'J1', priced_separately: true },
    ],
  });

  test('stamps every art deco of the design, and end-to-end totals bill the split price', () => {
    const { changed, order: o2 } = stampSplitRuns(order());
    expect(changed).toBe(true);
    expect(o2.items[0].decorations[0].split_runs).toEqual([24, 1]);
    expect(o2.items[1].decorations[0].split_runs).toEqual([24, 1]);
    // end-to-end: dP at each line with cq=25 reconstructs the exact summed run totals
    const af = [{ id: 'a1', deco_type: 'screen_print', ink_colors: 'Navy' }];
    let rev = 0;
    o2.items.forEach(it => {
      const q = Object.values(it.sizes).reduce((a, v) => a + v, 0);
      const dp = DP.dP(T, it.decorations[0], q, af, 25);
      rev += q * dp.sell;
    });
    expect(rev).toBeCloseTo(50 + 24 * tierSell(24, 1), 10); // $50 + 24×$3.40 = $131.60, ≈$5.26/pc blended
  });

  test('clears a stale stamp when the partition no longer applies, and is idempotent', () => {
    const o1 = stampSplitRuns(order()).order;
    // merge-back happened: only one job remains, flag dropped
    const o2raw = { ...o1, jobs: [{ id: 'J1', art_file_id: 'a1', total_units: 25 }] };
    const { changed, order: o2 } = stampSplitRuns(o2raw);
    expect(changed).toBe(true);
    expect(o2.items[0].decorations[0].split_runs).toBeNull();
    // unchanged input → same reference, no phantom saves
    const again = stampSplitRuns(o2);
    expect(again.changed).toBe(false);
    expect(again.order).toBe(o2);
  });
});
