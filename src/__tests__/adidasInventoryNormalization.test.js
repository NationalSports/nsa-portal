import {
  adidasInventorySizeEntry,
  aggregateAdidasInventoryRows,
  normalizeAdidasSizeName,
} from '../lib/adidasInventory';

describe('adidas inventory size normalization', () => {
  test('matches numeric and X-count aliases on both sides', () => {
    expect(normalizeAdidasSizeName('2XS')).toBe('XXS');
    expect(normalizeAdidasSizeName('XXS')).toBe('XXS');
    expect(normalizeAdidasSizeName('3XS')).toBe('XXXS');
    expect(normalizeAdidasSizeName('XXXS')).toBe('XXXS');
    expect(normalizeAdidasSizeName('XXL')).toBe('2XL');
    expect(normalizeAdidasSizeName('2XL')).toBe('2XL');
  });

  test('folds CLICK inseam labels into the product size and preserves measured stock', () => {
    const aggregated = aggregateAdidasInventoryRows([
      { sku: 'JL5410', size: '2XS3', stock_qty: 200, source: 'api-materials', last_synced: '2026-10-14T12:00:00Z' },
      { sku: 'JL5410', size: '2XS4', stock_qty: 210, source: 'api-materials', last_synced: '2026-10-14T12:00:00Z' },
      { sku: 'JL5410', size: '2XS5', stock_qty: 223, source: 'api-materials', last_synced: '2026-10-14T12:00:00Z' },
    ]);

    expect(adidasInventorySizeEntry(aggregated.sizes, '2XS')?.qty).toBe(633);
    expect(adidasInventorySizeEntry(aggregated.sizes, 'XXS')?.qty).toBe(633);
  });

  test('trims a trailing inch mark from numeric waist sizes', () => {
    const aggregated = aggregateAdidasInventoryRows([
      { sku: 'KE9495', size: '28"', stock_qty: 41, last_synced: '2026-10-17T12:00:00Z' },
      { sku: 'KE9495', size: '52"', stock_qty: 9, last_synced: '2026-10-17T12:00:00Z' },
    ]);
    expect(adidasInventorySizeEntry(aggregated.sizes, '28')?.qty).toBe(41);
    expect(adidasInventorySizeEntry(aggregated.sizes, '52')?.qty).toBe(9);
  });

  test('does not strip the 2 from tall-2 labels', () => {
    expect(normalizeAdidasSizeName('LT2')).toBe('LT2');
    expect(normalizeAdidasSizeName('XLT2')).toBe('XLT2');
    expect(normalizeAdidasSizeName('2XT2')).toBe('2XT2');
    expect(normalizeAdidasSizeName('LT2')).not.toBe(normalizeAdidasSizeName('LT'));
  });
});

describe('adidas inventory freshness and future stock', () => {
  test('uses the latest successful source run instead of unchanged row timestamps', () => {
    const aggregated = aggregateAdidasInventoryRows([
      { sku: 'KB0712', size: '2XS3', stock_qty: 64, source: 'click', last_synced: '2026-10-14T12:00:00Z' },
    ], { 'api-materials': '2026-10-17T13:30:00Z' });
    expect(aggregated.lastSynced).toBe('2026-10-17T13:30:00Z');
  });

  test('falls back to row last_synced when no successful run is available', () => {
    const aggregated = aggregateAdidasInventoryRows([
      { sku: 'KB0712', size: 'S', stock_qty: 10, last_synced: '2026-10-15T12:00:00Z' },
      { sku: 'KB0712', size: 'M', stock_qty: 10, last_synced: '2026-10-16T12:00:00Z' },
    ]);
    expect(aggregated.lastSynced).toBe('2026-10-16T12:00:00Z');
  });

  test('keeps future ATP as restock rather than current stock', () => {
    const aggregated = aggregateAdidasInventoryRows([
      {
        sku: 'FUTURE1',
        size: 'S',
        stock_qty: 0,
        future_delivery_date: '2026-11-15',
        future_delivery_qty: 120,
        source: 'api-materials',
        last_synced: '2026-10-17T12:00:00Z',
      },
    ]);
    expect(aggregated.sizes.S).toMatchObject({
      qty: 0,
      futureDate: '2026-11-15',
      futureQty: 120,
    });
  });
});
