/* eslint-disable */
// Regression guard for reversible / numbers decoration pricing.
//
// There are two copies of the deco-pricing function dP():
//   • src/pricing.js        — used by the editor, coach portal, customer detail,
//                             mobile portal and every in-app customer document.
//   • src/businessLogic.js  — used by the QuickBooks sales-order / invoice builders.
//
// They MUST agree, otherwise the price a rep sees in the editor differs from what
// gets billed in QuickBooks. They had drifted for reversible / front+back / qty-override
// numbers: businessLogic looked the per-number price break up at the UN-doubled qty and
// ignored num_qty, while pricing.js (correctly) uses the doubled "applications" count.
const pricing = require('../pricing');
const BL = require('../businessLogic');

const npP = pricing.npP;

describe('reversible / numbers deco pricing — editor (pricing.js) and QB (businessLogic.js) agree', () => {
  // qty 30 reversible → 60 number applications. The 60-app volume break (≤? → $5)
  // is cheaper than the 30 break ($6); both must price at the 60-app rate.
  test('reversible numbers price at the doubled (applications) volume break', () => {
    const d = { kind: 'numbers', two_color: false, reversible: true };
    const p = pricing.dP(d, 30, []);
    const b = BL.dP(d, 30, [], 30);
    expect(p.sell).toBe(npP(60, false, true)); // 5
    expect(p.cost).toBe(npP(60, false, false)); // 3
    expect(p._nq).toBe(60);
    expect(b.sell).toBe(p.sell);
    expect(b.cost).toBe(p.cost);
    expect(b._nq).toBe(p._nq);
  });

  // num_qty is the rep's manual "this many get numbers" override (shown as "or Qty:" in the UI).
  test('num_qty is honored (and doubled when reversible) in both copies', () => {
    const d = { kind: 'numbers', two_color: false, reversible: true, num_qty: 20 };
    const p = pricing.dP(d, 8, []);
    const b = BL.dP(d, 8, [], 8);
    expect(p._nq).toBe(40); // 20 × 2 sides
    expect(p.sell).toBe(npP(40, false, true)); // 6
    expect(b._nq).toBe(p._nq);
    expect(b.sell).toBe(p.sell);
    expect(b.cost).toBe(p.cost);
  });

  // front_and_back + reversible + roster: multiplier of 4 (existing behavior, must stay green).
  test('front+back + reversible roster multiplier = 4', () => {
    const d = { kind: 'numbers', two_color: false, reversible: true, front_and_back: true, roster: { S: ['1', '2'] } };
    const p = pricing.dP(d, 10, []);
    const b = BL.dP(d, 10, [], 10);
    expect(p._nq).toBe(8); // 2 assigned × 2 (F+B) × 2 (reversible)
    expect(b._nq).toBe(8);
    expect(b.sell).toBe(p.sell);
  });

  test('sublimated numbers are zero-cost and qty-multiplied in both copies', () => {
    const d = { kind: 'numbers', num_method: 'sublimated', reversible: true, num_qty: 10, sell_override: 9 };
    const p = pricing.dP(d, 10, []);
    const b = BL.dP(d, 10, [], 10);
    expect(p.cost).toBe(0);
    expect(p._nq).toBe(20); // 10 × 2 sides
    expect(p.sell).toBe(9);
    expect(b.cost).toBe(p.cost);
    expect(b._nq).toBe(p._nq);
    expect(b.sell).toBe(p.sell);
  });

  // Non-reversible numbers behavior must be unchanged (these match the existing suite).
  test('non-reversible numbers unchanged', () => {
    const noRoster = { kind: 'numbers', two_color: false };
    expect(pricing.dP(noRoster, 24, [])._nq).toBe(24);
    expect(pricing.dP(noRoster, 24, []).sell).toBe(npP(24, false, true));
    expect(BL.dP(noRoster, 24, [], 24)._nq).toBe(24);
    expect(BL.dP(noRoster, 24, [], 24).sell).toBe(npP(24, false, true));
  });
});

describe('deco sell override holds even when set to 0 (must not silently revert to auto price)', () => {
  test('numbers sell_override of 0 is respected', () => {
    const d = { kind: 'numbers', two_color: false, num_qty: 24, sell_override: 0 };
    expect(pricing.dP(d, 24, []).sell).toBe(0);
    expect(BL.dP(d, 24, [], 24).sell).toBe(0);
  });

  test('a normal numbers sell_override is respected', () => {
    const d = { kind: 'numbers', two_color: false, num_qty: 24, sell_override: 9 };
    expect(pricing.dP(d, 24, []).sell).toBe(9);
    expect(BL.dP(d, 24, [], 24).sell).toBe(9);
  });
});

describe('QuickBooks sales order bills the reversible / numbers multiplier (not just the garment qty)', () => {
  test('reversible numbers deco line is billed at the doubled application count', () => {
    const so = {
      id: 'SO-TEST', created_at: '2026-06-15',
      items: [{
        sku: 'JSY', name: 'Reversible Jersey', unit_sell: 8, sizes: { M: 24 },
        decorations: [{ kind: 'numbers', two_color: false, reversible: true, num_qty: 24 }],
      }],
    };
    const r = BL.buildQBSalesOrder(so, { name: 'Team' }, { income_account: 'Sales' });
    const decoLine = r.lines.find(l => /Decoration/.test(l.desc));
    // 24 jerseys × 2 sides = 48 number applications at npP(48) = $6 → $288
    expect(decoLine.qty).toBe(48);
    expect(decoLine.rate).toBe(npP(48, false, true));
    expect(decoLine.amount).toBe(48 * npP(48, false, true));
  });

  test('reversible art deco line is billed at 2× the garment qty', () => {
    const artFile = { id: 'af1', deco_type: 'screen_print', ink_colors: 'PMS 1' };
    const so = {
      id: 'SO-TEST2', created_at: '2026-06-15', art_files: [artFile],
      items: [{
        sku: 'JSY', name: 'Reversible Jersey', unit_sell: 8, sizes: { M: 24 },
        decorations: [{ kind: 'art', art_file_id: 'af1', reversible: true }],
      }],
    };
    const r = BL.buildQBSalesOrder(so, { name: 'Team' }, { income_account: 'Sales' });
    const decoLine = r.lines.find(l => /Decoration/.test(l.desc));
    // reversible art prints both sides → 48 imprints; volume break also uses 48
    const dp = pricing.dP({ kind: 'art', art_file_id: 'af1', reversible: true }, 24, [artFile], 48);
    expect(decoLine.qty).toBe(48);
    expect(decoLine.amount).toBe(48 * dp.sell);
  });
});
