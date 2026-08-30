import { manualPoCostRows, manualPoCostTotal, normalizePoPaymentMethod, poPaymentMethodLabel } from '../safeHelpers';
import { calcOrderMargin } from '../pricing';

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
});
