// GP parity for club-store heat-transfer decorations (migration 00204).
//
// create_club_sales_order writes transfer-code decorations as kind='art' with NO
// art_file_id, sell_override=0, sell_each=0, and cost_each stamped from
// webstore_transfers.unit_cost — the exact shape decoPricing.dP's "Team Shop
// conversion decos (00199)" branch already consumes (teamshopDecoCostGp.test.js
// pins that branch for the rate-card case). This test pins the SAME branch for the
// club-transfer shape specifically, so a future edit to that branch that happens to
// keep the teamshop case working but breaks the club case is still caught.
const DECO = require('../lib/decoPricing');
const BL = require('../businessLogic');

// The exact shape create_club_sales_order writes for a transfer-code decoration
// (00204: kind 'art', type 'heat_press', art_file_id NULL, cost_each = the
// transfer's unit_cost, sells suppressed — revenue already folded into unit_sell).
const clubTransferDeco = (unitCost) => ({
  kind: 'art',
  type: 'heat_press',
  position: 'Front',
  placement: 'full_front',
  side: 'front',
  color_label: 'original',
  transfer_code: 'left-chest-logo',
  sell_override: 0,
  sell_each: 0,
  cost_each: unitCost,
});

describe('decoPricing.dP — club transfer-code decos use webstore_transfers.unit_cost', () => {
  test('returns {cost: unit_cost, sell: 0} for a club-shaped transfer deco row', () => {
    const r = DECO.dP(DECO.DEFAULTS, clubTransferDeco(1.85), 24);
    expect(r).toEqual({ cost: 1.85, sell: 0 });
  });

  test('a transfer with no unit_cost set yet (cost_each coalesced to 0) still short-circuits — no matrix fallback, never blocks conversion', () => {
    const r = DECO.dP(DECO.DEFAULTS, clubTransferDeco(0), 24);
    expect(r).toEqual({ cost: 0, sell: 0 });
  });

  test('businessLogic.dP (App.js commissions copy) agrees', () => {
    const r = BL.dP(clubTransferDeco(2.4), 24);
    expect(r).toEqual({ cost: 2.4, sell: 0 });
  });
});

// The OTHER transfer shape: the team-store batch path (src/Webstores.js:3001-3002)
// writes the deco WITH art_file_id 'xfer_<code>' AND registers a matching art file
// (deco_type 'heat_press'), so dP takes the art-file heat_press/dtf branch — NOT the
// no-art-file branch the club shape above uses. That branch read sell_override with a
// FALSY `||`, so an explicit sell_override:0 fell through to the DTF matrix sell ($4.50/
// $7.50), double-counting revenue already inside unit_sell → GP/commissions overstated
// (audit MEDIUM). It must honor an explicit 0, exactly like the screen_print/embroidery/
// names/numbers branches already do.
describe('decoPricing.dP — team-store batch transfer deco (art-file heat_press branch) honors sell_override=0', () => {
  const batchTransferDeco = (code) => ({
    kind: 'art', art_file_id: 'xfer_' + code, type: 'heat_press',
    transfer_code: code, placement: 'full_front', side: 'front',
    color_label: 'original', sell_override: 0, sell_each: 0, cost_each: 1.2,
  });
  const artFiles = [{ id: 'xfer_LOGO1', deco_type: 'heat_press' }];

  test('decoPricing.dP: sell suppressed to 0, real transfer cost preserved', () => {
    const r = DECO.dP(DECO.DEFAULTS, batchTransferDeco('LOGO1'), 24, artFiles);
    expect(r).toEqual({ cost: 1.2, sell: 0 });
  });

  test('businessLogic.dP (commissions copy) agrees — no phantom $4.50 revenue', () => {
    const r = BL.dP(batchTransferDeco('LOGO1'), 24, artFiles);
    expect(r).toEqual({ cost: 1.2, sell: 0 });
  });

  test('a normal DTF art deco with NO override is still matrix-priced (fix did not over-reach)', () => {
    const normal = { kind: 'art', art_file_id: 'a1', type: 'dtf' };
    const files = [{ id: 'a1', deco_type: 'dtf', dtf_size: 0 }];
    const r = DECO.dP(DECO.DEFAULTS, normal, 24, files);
    expect(r.sell).toBe(DECO.DEFAULTS.DTF[0].sell);
  });
});
