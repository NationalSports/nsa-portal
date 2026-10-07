import { vendorCostSnapshot } from '../lib/vendorCostSnapshot.shared';
import { searchVendorCatalogs, vendorColorToProductRow } from '../vendorCatalogSearch';
import { sanmarGetProduct, sanmarGetPricing, sanmarGetInventory } from '../vendorApis';
jest.mock('../vendorApis', () => ({
  sanmarGetProduct: jest.fn(), sanmarGetPricing: jest.fn(), sanmarGetInventory: jest.fn().mockResolvedValue({}),
  ssApiCall: jest.fn().mockResolvedValue([]), richardsonSearchStyles: jest.fn().mockResolvedValue({ results: [] }), momentecStyleV2: jest.fn().mockResolvedValue(null),
}));
beforeEach(() => sanmarGetInventory.mockResolvedValue({}));
test('base cost is independent of size order and retains premiums', () => {
  expect(vendorCostSnapshot([{ size: '2XL', cost: 15 }, { size: 'S', cost: 12 }, { size: 'M', cost: 12 }])).toEqual({ baseCost: 12, sizeCosts: { '2XL': 15 } });
  expect(vendorCostSnapshot([{ size: 'OS', cost: 3.74 }])).toEqual({ baseCost: 3.74, sizeCosts: null });
  expect(vendorCostSnapshot([{ size: 'S', cost: 0 }, { size: 'M', cost: Infinity }])).toBeNull();
});
const products = { items: ['S', '2XL'].map(size => ({ productBasicInfo: { brandName: 'Nike', style: 'NK1', colorName: 'Dark Grey Heather', catalogColor: 'Dk Grey Hthr', size }, productPriceInfo: { piecePrice: 39.87 } })) };
test('live SanMar imports use account prices and retain size costs', async () => {
  sanmarGetProduct.mockResolvedValue(products);
  sanmarGetPricing.mockResolvedValue({ items: [{ catalogColor: 'Dk Grey Hthr', size: 'S', myPrice: 35.87 }, { catalogColor: 'Dk Grey Hthr', size: '2XL', myPrice: 36.87 }] });
  const { results } = await searchVendorCatalogs('NK1');
  const color = results[0].colors[0];
  expect(color.cost).toBe(35.87);
  const row = vendorColorToProductRow(results[0], color);
  expect(row.nsa_cost).toBe(35.87);
  expect(Object.values(row.size_costs)).toEqual([36.87]);
});
test('missing account prices cannot silently import product-info list price', async () => {
  sanmarGetProduct.mockResolvedValue(products);
  sanmarGetPricing.mockRejectedValue(new Error('unavailable'));
  const { results } = await searchVendorCatalogs('NK1');
  expect(results[0].colors[0].cost).toBe(0);
  expect(() => vendorColorToProductRow(results[0], results[0].colors[0])).toThrow(/account pricing is unavailable/);
});
