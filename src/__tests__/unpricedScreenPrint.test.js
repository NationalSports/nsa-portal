// ═══════════════════════════════════════════════
// UNPRICED SCREEN-PRINT COMBINATIONS (SO-1727)
// The SP matrix had no under-12 price for a 4-color print, so a 9-piece / 4-color run priced
// at $0 cost AND $0 sell with nothing on screen to say so — SO-1727 and SO-1199 both billed
// nothing for the print. Two guards:
//   1. bracket-0 4-color is now $100 flat (the value the business set).
//   2. any (qty × colors) combination the matrix still can't price — bracket-0 5c, bracket-1
//      5c, or an ink count off the table — comes back flagged `_unpriced` so the deco row can
//      show UNPRICED instead of a legitimate-looking $0.00.
// ═══════════════════════════════════════════════
const DP = require('../lib/decoPricing');
const BL = require('../businessLogic');

const T = DP.DEFAULTS;
const spArt = (id, inks) => ({ id, deco_type: 'screen_print', color_ways: [{ id: 'cw1', inks, garment_color: 'Grey' }] });
const spDeco = (extra = {}) => ({ kind: 'art', art_file_id: 'af1', color_way_id: 'cw1', ...extra });

describe('bracket-0 4-color is priced', () => {
  test('SO-1727 exactly: 9 pieces, 4 inks — $100 flat, not $0', () => {
    const art = spArt('af1', ['PMS 165', 'PMS White', 'PMS 281', '1235']);
    const dp = DP.dP(T, spDeco(), 9, [art], 9);
    // Bracket-0 cells are the ALL-IN sell for the whole run, returned as unrounded per-piece
    // shares — so qty × value rebuilds the flat total exactly (see spFlatShare).
    expect(dp.sell * 9).toBeCloseTo(100, 6);
    expect(dp.cost * 9).toBeCloseTo(DP.rQ(100 / T.SP.mk), 6);
    expect(dp.cost).toBeGreaterThan(0);
    expect(dp._unpriced).toBeUndefined();
  });

  test('the under-12 flat row reads 50/60/80/100 for 1–4 colors', () => {
    expect(T.SP.pr[0].slice(0, 4)).toEqual([50, 60, 80, 100]);
    for (let c = 1; c <= 4; c++) expect(DP.spFlatShare(T, 5, c)).not.toBeNull();
  });

  test('businessLogic mirror carries the same bracket-0 row', () => {
    expect(BL.SP.pr[0]).toEqual(T.SP.pr[0]);
  });
});

describe('spUnpriced — which combinations the matrix cannot price', () => {
  test('blank cells are unpriced', () => {
    expect(DP.spUnpriced(T, 9, 5)).toBe(true);   // bracket 0, 5 colors — still blank
    expect(DP.spUnpriced(T, 20, 5)).toBe(true);  // bracket 1, 5 colors — still blank
  });
  test('ink counts off the table are unpriced', () => {
    expect(DP.spUnpriced(T, 9, 6)).toBe(true);
    expect(DP.spUnpriced(T, 100, 0)).toBe(true);
  });
  test('filled cells are priced', () => {
    expect(DP.spUnpriced(T, 9, 4)).toBe(false);  // the SO-1727 cell, now filled
    for (const q of [1, 11, 12, 24, 48, 144, 500]) {
      for (let c = 1; c <= 3; c++) expect(DP.spUnpriced(T, q, c)).toBe(false);
    }
  });
  test('a zero-qty line is not a matrix gap', () => {
    expect(DP.spUnpriced(T, 0, 4)).toBe(false);
  });
});

describe('dP stamps _unpriced instead of a silent $0', () => {
  test('5-color under 12 — still $0, but flagged', () => {
    const art = spArt('af1', ['a', 'b', 'c', 'd', 'e']);
    const dp = DP.dP(T, spDeco(), 9, [art], 9);
    expect(dp.cost).toBe(0);
    expect(dp._unpriced).toBe(true);
  });

  test('6-ink colorway (off the table entirely) is flagged', () => {
    const art = spArt('af1', ['a', 'b', 'c', 'd', 'e', 'f']);
    const dp = DP.dP(T, spDeco(), 50, [art], 50);
    expect(dp.cost).toBe(0);
    expect(dp._unpriced).toBe(true);
  });

  test('ART TBD decos are flagged too', () => {
    const dp = DP.dP(T, { kind: 'art', art_file_id: '__tbd', art_tbd_type: 'screen_print', tbd_colors: 5 }, 9, [], 9);
    expect(dp._unpriced).toBe(true);
  });

  test('legacy type:screen_print decos are flagged too', () => {
    const dp = DP.dP(T, { type: 'screen_print', colors: 5 }, 9, null, null);
    expect(dp._unpriced).toBe(true);
  });

  test('a sell_override does not clear the flag — the COST is still $0', () => {
    // SO-1171 shape: rep hand-set the sell to $6, cost silently stayed at zero.
    const art = spArt('af1', ['a', 'b', 'c', 'd', 'e']);
    const dp = DP.dP(T, spDeco({ sell_override: 6 }), 4, [art], 4);
    expect(dp.sell).toBe(6);
    expect(dp.cost).toBe(0);
    expect(dp._unpriced).toBe(true);
  });

  test('priced decos never carry the flag', () => {
    const art = spArt('af1', ['a', 'b']);
    for (const q of [1, 9, 12, 24, 48, 144, 500]) {
      expect(DP.dP(T, spDeco(), q, [art], q)._unpriced).toBeUndefined();
    }
    // embroidery / DTF paths are untouched by the flag
    const emb = { id: 'af2', deco_type: 'embroidery', stitches: 18000, color_ways: [] };
    expect(DP.dP(T, { kind: 'art', art_file_id: 'af2' }, 9, [emb], 9)._unpriced).toBeUndefined();
  });
});

describe('split runs — flagged when any run lands on a blank cell', () => {
  test('a 5-color split with an under-12 run is flagged', () => {
    const art = spArt('af1', ['a', 'b', 'c', 'd', 'e']);
    const dp = DP.dP(T, spDeco({ split_runs: [6, 30] }), 36, [art], 36);
    expect(dp._unpriced).toBe(true);
  });
  test('a fully priced split is not flagged', () => {
    const art = spArt('af1', ['a', 'b']);
    const dp = DP.dP(T, spDeco({ split_runs: [6, 30] }), 36, [art], 36);
    expect(dp._unpriced).toBeUndefined();
    expect(dp.cost).toBeGreaterThan(0);
  });
});

describe('sell/cost are unchanged for everything the matrix already priced', () => {
  // The refactor routed all three screen-print branches through spDecoPrice. dP must still
  // agree with the businessLogic mirror (which kept its own inline copy) everywhere.
  // NOTE: ink count is expressed via art.ink_colors, not color_ways — businessLogic's dP copy
  // has never read color_ways for the screen-print ink count (decoPricing.js and App.js both
  // do), so a colorway-keyed grid would compare two different color counts. Pre-existing
  // mirror drift, unrelated to this change; no production path uses businessLogic's dP.
  test('dP matches businessLogic.dP across the grid', () => {
    for (let nc = 1; nc <= 4; nc++) {
      const art = { id: 'af1', deco_type: 'screen_print', ink_colors: Array.from({ length: nc }, (_, i) => 'Color ' + (i + 1)).join('\n') };
      for (const q of [1, 5, 11, 12, 23, 24, 47, 48, 143, 144, 499, 500]) {
        for (const ub of [false, true]) {
          const d = { kind: 'art', art_file_id: 'af1', underbase: ub };
          const a = DP.dP(T, d, q, [art], q);
          const b = BL.dP(d, q, [art], q);
          expect(a.sell).toBe(b.sell);
          expect(a.cost).toBe(b.cost);
        }
      }
    }
  });
});
