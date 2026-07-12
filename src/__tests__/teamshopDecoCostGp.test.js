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

// Club conversion (00204) writes numbers/names personalization decos with an explicit
// sell_override=0 — revenue is already inside unit_sell, so the deco's own sell must be
// deterministically zero. The names branch (and App.js's numbers branch) used falsy-||
// on sell_override, silently re-adding the $6/name (or npP) default over a deliberate
// zero — inflating the calcGP cost-scaling denominator and overpaying commissions.
describe('numbers/names sell_override=0 is honored (nullish, all dP copies)', () => {
  const namesDeco = {
    kind: 'names', position: 'Back Center',
    sell_override: 0, sell_each: 6, cost_each: 3,
    names: { M: ['SMITH', 'JONES'] },
  };
  const numbersDeco = {
    kind: 'numbers', position: 'Back', num_method: 'screen_print',
    sell_override: 0, roster: { M: ['12', '34'] },
  };

  test('decoPricing: names sell 0, cost stays real', () => {
    const r = DECO.dP(DECO.DEFAULTS, namesDeco, 12);
    expect(r.sell).toBe(0);
    expect(r.cost).toBe(DECO.rQ(2 * 3 / 12)); // 2 names × $3 cost, prorated
  });

  test('decoPricing: numbers sell 0, cost stays real', () => {
    const r = DECO.dP(DECO.DEFAULTS, numbersDeco, 12);
    expect(r.sell).toBe(0);
    expect(r.cost).toBeGreaterThan(0); // npP cost still applies
  });

  test('businessLogic: names sell 0', () => {
    const r = BL.dP(namesDeco, 12);
    expect(r.sell).toBe(0);
  });

  test('names default is preserved when sell_override is null/absent', () => {
    const r = DECO.dP(DECO.DEFAULTS, { ...namesDeco, sell_override: null }, 12);
    expect(r.sell).toBe(DECO.rQ(2 * 6 / 12)); // falls back to sell_each 6
  });

  test('App.js numbers/names branches use the nullish form (source-text pin)', () => {
    const appSrc = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
    expect(appSrc).toContain("d.sell_suppressed?0:(d.sell_override!=null?d.sell_override:npP(useQty||1,d.two_color,true))");
    expect(appSrc).toContain("const se=safeNum(d.sell_override!=null?d.sell_override:(d.sell_each||6))");
  });
});

// Batched heat-transfer decos (Webstores.js batchOrders) carry art_file_id (the shared
// 'xfer_<code>' pseudo art file) so they hit dP's ART branch, not the no-art-file
// cost_each branch — the art dtf/heat_press branch must therefore ALSO prefer
// cost_each on transfer_code decos (real cost from webstore_transfers.unit_cost, 00204)
// over the generic DTF matrix cost, which was never the actual transfer price.
describe('art-branch transfer decos use cost_each as cost-of-record', () => {
  const xferArt = { id: 'xfer_FALL24', deco_type: 'heat_press', dtf_size: 0 };
  const xferDeco = {
    kind: 'art', art_file_id: 'xfer_FALL24', type: 'heat_press',
    transfer_code: 'FALL24', sell_override: 0, sell_each: 0, cost_each: 1.85,
  };

  test('decoPricing: transfer deco cost = unit_cost, not DTF matrix', () => {
    const r = DECO.dP(DECO.DEFAULTS, xferDeco, 24, [xferArt]);
    expect(r.cost).toBe(1.85);
    expect(r.sell).toBe(DECO.DTF[0].sell); // sell side unchanged (0 is falsy → t.sell)
  });

  test('businessLogic: same', () => {
    const r = BL.dP(xferDeco, 24, [xferArt]);
    expect(r.cost).toBe(1.85);
  });

  test('non-transfer art dtf decos keep the DTF matrix cost', () => {
    const plain = { kind: 'art', art_file_id: 'A9', cost_each: 99 }; // no transfer_code
    const art = { id: 'A9', deco_type: 'dtf', dtf_size: 1 };
    const r = DECO.dP(DECO.DEFAULTS, plain, 24, [art]);
    expect(r.cost).toBe(DECO.DTF[1].cost); // 4.5 — cost_each ignored without transfer_code
  });

  test('App.js art branch carries the same guard (source-text pin)', () => {
    const appSrc = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
    expect(appSrc).toContain("cost:(d.transfer_code&&d.cost_each!=null)?safeNum(d.cost_each):t.cost");
  });
});
