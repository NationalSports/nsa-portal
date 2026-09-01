const mockFrom = jest.fn();
jest.mock('../lib/supabase', () => ({
  supabase: { from: (...args) => mockFrom(...args) },
}));

import { fetchStockMap, stockSkuAliases, stockSkuKey } from '../lib/storeInventory';
import { haveSameDecorations, variantGroupFields } from '../lib/webstoreGrouping';

describe('webstore vendor SKU matching', () => {
  test('matches SanMar catalog and inventory spellings for ST650 True Navy', () => {
    expect(stockSkuAliases('ST650-TRUE-NAVY')).toContain('ST650-TrueNavy');
    expect(stockSkuKey('ST650-TRUE-NAVY')).toBe(stockSkuKey('ST650-TrueNavy'));
  });

  test('keeps an already vendor-formatted SKU available as an exact query alias', () => {
    expect(stockSkuAliases('LST650-White')).toContain('LST650-White');
  });

  test('fetchStockMap queries the alias and attaches its stock to the catalog product', async () => {
    let queriedSkus = [];
    mockFrom.mockImplementation((table) => {
      const query = {
        select: () => query,
        in: (column, values) => { if (table === 'inventory_unified' && column === 'sku') queriedSkus = values; return query; },
        or: () => query,
        gt: () => query,
        order: () => query,
        range: () => Promise.resolve({
          data: table === 'inventory_unified'
            ? [{ id: 1, sku: 'ST650-TrueNavy', size: 'M', stock_qty: 500, future_delivery_date: null, future_delivery_qty: null }]
            : [],
          error: null,
        }),
      };
      return query;
    });

    const stock = await fetchStockMap([{ id: 'sm-st650-true-navy', sku: 'ST650-TRUE-NAVY' }]);

    expect(queriedSkus).toContain('ST650-TrueNavy');
    expect(stock.get('sm-st650-true-navy')).toMatchObject({ units: 500, sizes: ['M'], sizeStock: { M: 500 } });
  });
});

describe('webstore color grouping', () => {
  const logo = (id, extras = {}) => ({
    kind: 'art', art_id: id, placement: 'left_chest', side: 'front', ...extras,
  });

  test('same logo instructions can share a color card regardless of object key order', () => {
    expect(haveSameDecorations(
      [logo('crest', { x: 10, y: 20 })],
      [{ y: 20, art_id: 'crest', side: 'front', x: 10, placement: 'left_chest', kind: 'art' }],
    )).toBe(true);
  });

  test('different logos stay as separate storefront items', () => {
    expect(haveSameDecorations([logo('crest')], [logo('wordmark')])).toBe(false);
  });

  test('decorated and undecorated versions stay separate', () => {
    expect(haveSameDecorations([logo('crest')], [])).toBe(false);
  });

  test('different-logo color flow leaves the new row outside the variant group', () => {
    expect(variantGroupFields('primary-id', true)).toEqual({});
    expect(variantGroupFields('primary-id', false)).toEqual({ variant_group_id: 'primary-id' });
  });
});
