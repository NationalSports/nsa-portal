const { lineStock, aggStock, needsSkuStock } = require('../Webstores');

const missing = { name: 'Unisex Cotton Tee', size_stock: null, vendor_size_stock: null, vendor_synced_at: null };
const line = (size = 'M', extra = {}) => ({ product_id: 'ss-3600-black', sku: '3600-BLACK', size, qty: 1, ...extra });
const byPid = (stock = missing) => ({ 'ss-3600-black': stock });
const read = (item, stock = missing, skus = {}, mto = new Set()) => lineStock(item, byPid(stock), skus, mto);

describe('batch availability with missing vendor inventory', () => {
  test.each(['M', 'L', '2XL'])('3600 Black %s without a sync is unknown, not short', (size) => {
    expect(read(line(size))).toMatchObject({ known: false, tracked: false, vendor: 0 });
    expect(needsSkuStock(line(size), byPid())).toBe(true);
    expect(aggStock([line(size)], byPid())[0]).toMatchObject({ known: false, backorder: 0 });
  });
  test('Red and an entirely unlinked product are also unknown', () => {
    expect(lineStock(line('L', { product_id: 'ss-3600-red', sku: '3600-RED' }), { 'ss-3600-red': missing }, {}, new Set()).known).toBe(false);
    expect(lineStock(line('M', { product_id: null }), {}, {}, new Set()).known).toBe(false);
  });
  test('an explicit vendor zero remains a real shortage', () => {
    const stock = { ...missing, vendor_size_stock: { M: 0 } };
    expect(needsSkuStock(line(), byPid(stock))).toBe(false);
    expect(aggStock([line()], byPid(stock))[0]).toMatchObject({ known: true, tracked: true, backorder: 1 });
  });
  test('a different size and placeholder do not prove this size is zero', () => {
    expect(read(line(), { ...missing, vendor_size_stock: { L: 100, _na: 0 } }).known).toBe(false);
  });
  test('fallback stock fills a missing vendor size and preserves warehouse stock', () => {
    expect(read(line(), { ...missing, size_stock: { M: 2 } }, { '3600-BLACK': { sizes: { M: 25 }, syncedAt: '2026-10-01' } }))
      .toMatchObject({ ours: 2, vendor: 25, known: true, tracked: true, syncedAt: '2026-10-01' });
  });
  test('source-scoped explicit zero wins over fallback stock', () => {
    expect(read(line(), { ...missing, vendor_size_stock: { M: 0 } }, { '3600-BLACK': { sizes: { M: 25 } } }).vendor).toBe(0);
  });
  test('warehouse stock is still visible without vendor inventory', () => {
    expect(read(line(), { ...missing, size_stock: { M: 2 } })).toMatchObject({ ours: 2, known: true });
  });
  test('overrides do not borrow base stock or infer zero from another size', () => {
    const item = line('M', { _skuOv: true, _effSku: 'OTHER' });
    const base = { ...missing, size_stock: { M: 10 }, vendor_size_stock: { M: 20 } };
    expect(read(item, base, { OTHER: { sizes: { L: 5 } } })).toMatchObject({ ours: 0, vendor: 0, known: false, tracked: false });
    expect(read(item, base, { OTHER: { sizes: { M: 0 } } })).toMatchObject({ ours: 0, vendor: 0, known: true, tracked: true });
  });
  test('made-to-order still displays known quantities without blocking', () => {
    expect(read(line(), { ...missing, vendor_size_stock: { M: 0 } }, {}, new Set(['ss-3600-black'])))
      .toMatchObject({ known: true, tracked: false });
  });
});
