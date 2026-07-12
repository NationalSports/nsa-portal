// GP commissions deco-cost fix — Team Shop conversion decorations.
//
// create_teamshop_sales_order (00199) writes every storefront decoration as
// kind='art' with NO art_file_id, sell_override=0, sell_each=0, and cost_each
// stamped from the teamshop_deco_rates rate card (00198). Before this fix,
// dP() had no branch for that shape:
//   - vinyl / silicone_patch fell to the terminal `{sell:0,cost:0}` — the
//     deco cost vanished from GP, overstating commissions;
//   - embroidery / dtf / screen_print hit the generic matrix branches — the
//     wrong cost source, and dtf's `sell_override||t.sell` re-added a phantom
//     sell (0 is falsy) on revenue already folded into unit_sell.
// The fix: in every dP copy, kind='art' + no art_file_id + cost_each present
// returns cost_each as the cost-of-record and the row's own (zeroed) sell.
//
// dP is TRIPLE-maintained (FABLE_SYSTEM_AUDIT: src/lib/decoPricing.js is the
// shared source of truth; src/App.js and src/businessLogic.js carry local
// copies). CommissionsPage's calcGP walks App.js's copy via _decoUnitCostComb,
// so this test pins all three: the two importable ones by behavior, App.js
// (unimportable app root) by source text — same technique as pricingDrift.

const fs = require('fs');
const path = require('path');
const DECO = require('../lib/decoPricing');
const BL = require('../businessLogic');

// The exact shape 00199 writes (embroidery example; type varies).
const tsDeco = (over) => ({
  kind: 'art',
  art_file_id: null,
  position: 'left_chest',
  sell_override: 0,
  sell_each: 0,
  cost_each: 3.5,
  ...over,
});

describe('decoPricing.dP — Team Shop conversion decos use cost_each', () => {
  test.each(['vinyl', 'silicone_patch', 'embroidery', 'dtf', 'screen_print'])(
    'type=%s → cost is the rate-card cost_each, sell stays 0',
    (type) => {
      const r = DECO.dP(DECO.DEFAULTS, tsDeco({ type }), 24);
      expect(r.cost).toBe(3.5);
      expect(r.sell).toBe(0);
    }
  );

  test('cost_each=0 (missing rate row at conversion) still short-circuits — no matrix fallback', () => {
    const r = DECO.dP(DECO.DEFAULTS, tsDeco({ type: 'embroidery', cost_each: 0 }), 24);
    expect(r).toEqual({ sell: 0, cost: 0 });
  });

  test('art-file decos are untouched (art_file_id set → art branch, not cost_each)', () => {
    const art = { id: 'A1', deco_type: 'embroidery', stitches: 8000 };
    const withArt = DECO.dP(DECO.DEFAULTS, { kind: 'art', art_file_id: 'A1', cost_each: 99 }, 24, [art]);
    // 8000 st / qty 24 → EM.pr[0][1] = 5.1 cost — matrix, NOT the 99 cost_each.
    expect(withArt.cost).toBe(5.1);
  });

  test('plain type-based decos without cost_each are untouched', () => {
    const r = DECO.dP(DECO.DEFAULTS, { type: 'embroidery', stitches: 8000 }, 24);
    expect(r.cost).toBe(5.1); // matrix cost, unchanged path
  });
});

describe('businessLogic.dP — same branch, same behavior', () => {
  test.each(['vinyl', 'silicone_patch', 'dtf'])('type=%s → {sell:0, cost:3.5}', (type) => {
    const r = BL.dP(tsDeco({ type }), 24);
    expect(r.cost).toBe(3.5);
    expect(r.sell).toBe(0);
  });
});

describe('App.js local dP carries the branch (source-text pin — App.js is unimportable)', () => {
  test('the Team Shop cost_each branch exists in App.js', () => {
    const appSrc = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
    expect(appSrc).toContain(
      "if(d.kind==='art'&&!d.art_file_id&&d.cost_each!=null)return{sell:safeNum(d.sell_override)||safeNum(d.sell_each),cost:safeNum(d.cost_each)};"
    );
  });
});
