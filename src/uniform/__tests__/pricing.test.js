import {
  calculateUniformPrice, customerUniformDiscount, normalizeUniformDiscount,
} from '../pricing';

describe('uniform builder pricing', () => {
  test('uses the established public base price', () => {
    expect(calculateUniformPrice({ quantity: 6 })).toMatchObject({
      publicUnit: 80, coachUnit: 80, publicTotal: 480, coachTotal: 480, savingsTotal: 0,
    });
  });

  test('adds configured fabric and decoration adjustments before discounting', () => {
    const price = calculateUniformPrice({
      quantity: 10,
      fabric: 'mesh',
      decorationMethod: 'heat_transfer',
      discountPercent: 10,
      policy: { fabricAdjustments: { mesh: 4 }, decorationAdjustments: { heat_transfer: 6.5 } },
    });
    expect(price).toMatchObject({
      publicUnit: 90.5, discountPerUnit: 9.05, coachUnit: 81.45,
      publicTotal: 905, savingsTotal: 90.5, coachTotal: 814.5,
    });
  });

  test('normalizes invalid discounts and reads the customer field', () => {
    expect(normalizeUniformDiscount(-4)).toBe(0);
    expect(normalizeUniformDiscount(140)).toBe(100);
    expect(customerUniformDiscount({ uniform_discount_percent: '12.5' })).toBe(12.5);
    expect(customerUniformDiscount(null)).toBe(0);
  });
});
