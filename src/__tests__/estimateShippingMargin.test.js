/* eslint-disable */
// EST-2526 — the MARGIN tile on an estimate read $846.00 / 43.7% on a quote whose real
// product+deco margin was $753.75 / 40.9%. The totals memo folded the customer's shipping
// charge into marginRev so it could "wash" against actual shipping cost in `cost` — but the
// estimates table has no actual-shipping-cost column (shipping_value / shipping_type /
// ship_to_id only), so on a quote there is never anything to wash against and the entire
// quoted freight landed in margin. Sales Orders are unchanged: there, real ShipStation /
// shipment cost does land in `cost`.
const fs = require('fs');
const path = require('path');
const { DEFAULTS, dP } = require('../lib/decoPricing');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const EDITORS = ['OrderEditor.js', 'OrderEditorClassic.js'];

describe('estimate margin excludes the quoted shipping charge', () => {
  test.each(EDITORS)('%s drops `ship` from marginRev on an estimate', (file) => {
    const src = read(file);
    expect(src).toContain('const marginRev=rev+(isE?0:ship)+fundraiseRev;');
    // the old form booked quoted freight as phantom margin on every quote
    expect(src).not.toContain('const marginRev=rev+ship+fundraiseRev;');
  });

  test('both editors carry byte-identical margin logic (CLAUDE.md: classic AND new)', () => {
    const grab = (src) => src.slice(src.indexOf('const marginRev='), src.indexOf('const marginRev=') + 60);
    expect(grab(read('OrderEditor.js'))).toBe(grab(read('OrderEditorClassic.js')));
  });
});

describe('EST-2526 pricing reconciles end to end', () => {
  const QTY = 45; // S0 M12 L20 XL11 2XL2
  const roster = { M: Array(12).fill('1'), L: Array(20).fill('1'), XL: Array(11).fill('1'), '2XL': Array(2).fill('1') };

  const screenPrint = { kind: 'art', art_file_id: '__tbd', art_tbd_type: 'screen_print', tbd_colors: 2, underbase: true, sell_override: 5 };
  const numbers = { kind: 'numbers', num_method: 'screen_print', two_color: true, roster, sell_override: 12 };

  test('2-color screen print with underbase at 45 pcs costs $3.25 (matrix sell $4.90)', () => {
    const p = dP(DEFAULTS, screenPrint, QTY, [], QTY);
    expect(p.cost).toBe(3.25);        // 2.83 tier (36-47) x 1.15 underbase, quarter-rounded
    expect(p.sell).toBe(5);           // rep override; matrix would be 4.9
    expect(dP(DEFAULTS, { ...screenPrint, sell_override: null }, QTY, [], QTY).sell).toBe(4.9);
  });

  test('2-color screen-print numbers on 45 applications cost $6.00 (matrix sell $11.00)', () => {
    const p = dP(DEFAULTS, numbers, QTY, [], QTY);
    expect(p.cost).toBe(6);           // NP.co[1] 3 + two-colour 3
    expect(p._nq).toBe(45);
    expect(p.sell).toBe(12);          // rep override; matrix would be 11
    expect(dP(DEFAULTS, { ...numbers, sell_override: null }, QTY, [], QTY).sell).toBe(11);
  });

  test('true margin is $753.75 / 40.9% — not the $846.00 / 43.7% the shipping wash produced', () => {
    const sp = dP(DEFAULTS, screenPrint, QTY, [], QTY);
    const np = dP(DEFAULTS, numbers, QTY, [], QTY);
    // Adidas Tier A: sell = MSRP 40 x (1-0.40); cost = MSRP 40 x 0.375
    const rev = QTY * 24 + QTY * sp.sell + np._nq * np.sell;
    const cost = QTY * 15 + QTY * sp.cost + np._nq * np.cost;
    expect(rev).toBe(1845);
    expect(cost).toBe(1091.25);

    const ship = rev * 0.05; // 5% of total
    expect(ship).toBeCloseTo(92.25, 2);

    // Estimate: no shipping cost exists to wash against, so shipping stays out of margin.
    const estMargin = rev - cost;
    expect(estMargin).toBeCloseTo(753.75, 2);
    expect((estMargin / rev) * 100).toBeCloseTo(40.85, 2);

    // The old estimate behaviour — kept here as the regression it was.
    const inflated = rev + ship - cost;
    expect(inflated).toBeCloseTo(846, 2);
    expect((inflated / (rev + ship)) * 100).toBeCloseTo(43.67, 2);

    // A Sales Order still washes: quoted freight in, actual freight out.
    const actualShipCost = 80;
    expect(rev + ship - (cost + actualShipCost)).toBeCloseTo(766, 2);
  });
});
