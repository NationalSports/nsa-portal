import { sanmarAccountPrice, sanmarPricingRows, sanmarPricingSnapshot, sanmarStyleFromSku } from '../lib/sanmarPricing';

describe('SanMar account pricing normalization', () => {
  test('uses the same account-price priority as the Order Editor', () => {
    expect(sanmarAccountPrice({ myPrice: '17.87', salePrice: '19.87', piecePrice: '21.87' })).toBe(17.87);
    expect(sanmarAccountPrice({ myPrice: '', salePrice: '9.76', piecePrice: '11.73' })).toBe(9.76);
    expect(sanmarAccountPrice({ piecePrice: '11.73' })).toBe(11.73);
  });

  test('normalizes alternate SOAP JSON wrappers', () => {
    expect(sanmarPricingRows({ listResponse: { size: 'M', myPrice: '5.00' } })).toHaveLength(1);
    expect(sanmarPricingRows({ return: [{ size: 'S' }, { size: 'M' }] })).toHaveLength(2);
  });

  test('keeps pricing scoped to the requested color and retains size upcharges', () => {
    const data = { items: [
      { catalogColor: 'Black', size: 'S', myPrice: '17.87', piecePrice: '21.87' },
      { catalogColor: 'Black', size: '2XL', myPrice: '18.87', piecePrice: '22.87' },
      { catalogColor: 'True Navy', size: 'S', myPrice: '19.61', piecePrice: '23.61' },
    ] };
    expect(sanmarPricingSnapshot(data, 'Black')).toEqual({
      baseCost: 17.87,
      sizeCosts: { '2XL': 18.87 },
      prices: { S: 17.87, '2XL': 18.87 },
    });
    expect(sanmarPricingSnapshot(data, 'True Navy').baseCost).toBe(19.61);
  });

  test('does not leak another color when SanMar ignores the requested filter', () => {
    expect(sanmarPricingSnapshot({ items: [{ catalogColor: 'Black', size: 'S', myPrice: '17.87' }] }, 'True Navy').baseCost).toBeNull();
  });

  test('uses unlabelled rows from a color-scoped response and extracts the style', () => {
    expect(sanmarPricingSnapshot({ items: [{ size: 'S', myPrice: '9.76' }] }, 'Rainstorm Grey').baseCost).toBe(9.76);
    expect(sanmarStyleFromSku('nea201-RainstormGrey')).toBe('NEA201');
  });
});
