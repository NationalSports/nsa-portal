/**
 * Phone quote builder vendor stock: which feed key a line maps to, per-size
 * totals, and which sizes ask for more than the vendor has.
 */
import { stockKeys, stockFromRows, shortSizes, fetchStockForItems, stockCacheKey } from '../lib/mobileStock';

describe('mobile stock', () => {
  test('a line is looked up by style and by style + color (SanMar keys)', () => {
    expect(stockKeys({ sku: 'JST480', color: 'Iron Grey' })).toEqual(['JST480', 'JST480-IronGrey']);
    expect(stockKeys({ sku: '5400B-12', color: 'Navy' })).toEqual(['5400B-12']);
    expect(stockKeys({ sku: '' })).toEqual([]);
  });

  test('the color-specific rows win, sizes are normalized, and future deliveries keep the soonest date', () => {
    const rows = [
      { sku: 'JST480', size: 'M', stock_qty: 999, source: 'sanmar' },
      { sku: 'JST480-IronGrey', size: 'M', stock_qty: 40, source: 'sanmar', last_synced: '2026-10-05T10:00:00Z' },
      { sku: 'JST480-IronGrey', size: 'XXL', stock_qty: 3, future_delivery_date: '2026-10-20', future_delivery_qty: 50, source: 'sanmar' },
      { sku: 'JST480-IronGrey', size: 'XXL', stock_qty: 2, future_delivery_date: '2026-10-12', future_delivery_qty: 10, source: 'sanmar' },
    ];
    const st = stockFromRows(rows, stockKeys({ sku: 'JST480', color: 'Iron Grey' }));
    expect(st.source).toBe('sanmar');
    expect(st.lastSynced).toBe('2026-10-05T10:00:00Z');
    expect(st.sizes.M.qty).toBe(40);
    expect(st.sizes['2XL']).toEqual({ qty: 5, futureDate: '2026-10-12', futureQty: 60 });
    expect(shortSizes({ sizes: { M: 12, XXL: 8, L: 4 } }, st)).toEqual(['XXL']);
    expect(stockFromRows(rows, ['NOPE'])).toBeNull();
  });

  test('one request covers every line; styles without a feed come back null', async () => {
    const asked = [];
    const res = await fetchStockForItems([{ sku: 'EG1234' }, { sku: 'XYZ' }], async (skus) => { asked.push(...skus); return [{ sku: 'EG1234', size: 'L', stock_qty: 7, source: 'click' }]; });
    expect(asked).toEqual(['EG1234', 'XYZ']);
    expect(res[stockCacheKey({ sku: 'EG1234' })].sizes.L.qty).toBe(7);
    expect(res[stockCacheKey({ sku: 'XYZ' })]).toBeNull();
  });
});
