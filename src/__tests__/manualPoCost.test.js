import { manualPoCostRows, manualPoCostTotal, normalizePoPaymentMethod, poPaymentMethodLabel } from '../safeHelpers';
import { calcOrderMargin } from '../pricing';
import fs from 'fs';
import path from 'path';

const BL = require('../businessLogic');

describe('manual PO costs', () => {
  const order = {
    items: [
      {
        sizes: { M: 2 }, unit_sell: 50, nsa_cost: 20, decorations: [],
        po_lines: [{ po_id: 'PO 900 TEST', M: 2, unit_cost: 20, _manual_cost: 12.5, _manual_cost_note: 'Credit-card fee' }],
      },
      {
        sizes: { L: 1 }, unit_sell: 60, nsa_cost: 25, decorations: [],
        // Defensive duplicate: PO metadata may be mirrored across lines by an old edit.
        po_lines: [{ po_id: 'po   900 test', L: 1, unit_cost: 25, _manual_cost: 12.5, _payment_method: 'credit_card' }],
      },
    ],
    deco_pos: [], shipping_type: 'flat', shipping_value: 0,
  };

  test('counts a PO-level manual cost once across multi-line POs', () => {
    expect(manualPoCostRows(order)).toEqual([{
      po_id: 'PO 900 TEST', amount: 12.5, note: 'Credit-card fee', vendor: '', payment_method: 'credit_card', payment_label: 'Credit card',
    }]);
    expect(manualPoCostTotal(order)).toBe(12.5);
  });

  test('reduces the shared pricing margin by the entered amount', () => {
    const result = calcOrderMargin(order);
    expect(result.rev).toBe(160);
    expect(result.cost).toBe(77.5);
    expect(result.margin).toBe(82.5);
  });

  test('is included in the extracted business-logic totals', () => {
    const result = BL.calcTotals(order, { tax_rate: 0 });
    expect(result.cost).toBe(77.5);
    expect(result.margin).toBe(82.5);
  });

  test('is included in promo commission cost deductions', () => {
    const result = BL.calcPromoTotals({ ...order, promo_applied: true, items: order.items.map(it => ({ ...it, is_promo: true })) }, { tax_rate: 0 });
    expect(result.manualPoCost).toBe(12.5);
    expect(result.totalCost).toBe(result.promoCost + result.normalCost + 12.5);
  });

  test('defaults PO payment method to credit card and labels supported methods', () => {
    expect(normalizePoPaymentMethod()).toBe('credit_card');
    expect(normalizePoPaymentMethod('wire')).toBe('wire');
    expect(normalizePoPaymentMethod('cash')).toBe('cash');
    expect(poPaymentMethodLabel('credit_card')).toBe('Credit card');
    expect(poPaymentMethodLabel('wire')).toBe('Wire');
    expect(poPaymentMethodLabel('cash')).toBe('Cash');
  });

  test('sums separate POs while ignoring zero, negative, and non-numeric costs', () => {
    const mixed = {
      items: [{ po_lines: [
        { po_id: 'PO 1', _manual_cost: 5 },
        { po_id: 'PO 2', _manual_cost: 7.25 },
        { po_id: 'PO 3', _manual_cost: 0 },
        { po_id: 'PO 4', _manual_cost: -4 },
        { po_id: 'PO 5', _manual_cost: '9.00' },
      ] }],
    };
    expect(manualPoCostRows(mixed).map(row => row.po_id)).toEqual(['PO 1', 'PO 2']);
    expect(manualPoCostTotal(mixed)).toBe(12.25);
  });

  test('Costs and Commissions pages retain every required manual-cost hook', () => {
    const root = path.join(__dirname, '..');
    const commissions = fs.readFileSync(path.join(root, 'CommissionsPage.js'), 'utf8');
    const editor = fs.readFileSync(path.join(root, 'OrderEditor.js'), 'utf8');
    const classicEditor = fs.readFileSync(path.join(root, 'OrderEditorClassic.js'), 'utf8');

    // Paid invoice GP, open pipeline GP, and promo deductions are separate calculations.
    expect(commissions).toContain('cost+=manualPoCost');
    expect(commissions).toContain('cost+=manualPoCostTotal(so)');
    expect(commissions).toContain('const manualCost=manualPoCostTotal(so)');
    // The order Costs tab must surface the same canonical rows and payment labels.
    expect(editor).toContain("category:'Manual PO Cost'");
    expect(editor).toContain('paymentLabel:row.payment_label');
    [editor, classicEditor].forEach(source => {
      expect(source).toContain('＋ Create Manual PO');
      expect(source).toContain("po_type:'manual_cost'");
      expect(source).toContain('_manual_cost:amount');
      expect(source).toContain('_payment_method:poPaymentMethod');
      expect(source).toContain('_consumeHeldPoNumber(true,false)');
      expect(source).toContain('no merchandise or receiving quantities are added');
    });
  });
});
