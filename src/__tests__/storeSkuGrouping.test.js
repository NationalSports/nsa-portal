import { consolidateOmgProductRows, storeSkuColorKey, webstoreProductionKey, webstoreSourcingKey } from '../lib/storeSkuGrouping';

describe('store SKU grouping', () => {
  test('does not split the same SKU/color because product ids differ', () => {
    expect(storeSkuColorKey(' at200 ', 'Black / White')).toBe(storeSkuColorKey('AT200', 'black / white'));
  });

  test('keeps colors of the same SKU separate', () => {
    expect(storeSkuColorKey('A230', 'Black')).not.toBe(storeSkuColorKey('A230', 'White'));
  });

  test('keeps identical SKU/color lines from different suppliers separate', () => {
    expect(webstoreSourcingKey('A230', 'Black', 'v1')).not.toBe(webstoreSourcingKey('A230', 'Black', 'v4'));
  });

  test('merges stale product ids only when production treatment is equivalent', () => {
    const common = { sku: 'A230', color: 'Black', vendorId: 'v1', personalize: { num: true }, transferCodes: ['HT-1'] };
    const front = [{ art_id: 'art-1', placement: 'left_chest', side: 'front' }];
    expect(webstoreProductionKey({ ...common, decorations: front })).toBe(webstoreProductionKey({ ...common, decorations: [{ side: 'front', placement: 'left_chest', art_id: 'art-1' }] }));
    expect(webstoreProductionKey({ ...common, decorations: front })).not.toBe(webstoreProductionKey({ ...common, decorations: [{ art_id: 'art-2', placement: 'left_chest', side: 'front' }] }));
    expect(webstoreProductionKey({ ...common, decorations: front })).not.toBe(webstoreProductionKey({ ...common, decorations: front, personalize: { name: true } }));
  });

  test('ignores repeated OMG snapshots instead of multiplying quantities', () => {
    const rows = [
      { id: 1, sku: 'JX4482', color: 'White', cost: 10, sizes: { M: 4, XL: 2 } },
      { id: 29, sku: 'JX4482', color: 'White', cost: 11, sizes: { XL: 2, M: 4 } },
      { id: 57, sku: 'JX4482', color: 'White', cost: 12, sizes: { M: 4, XL: 2 } },
    ];
    expect(consolidateOmgProductRows(rows)).toEqual([
      expect.objectContaining({ id: 57, cost: 12, sizes: { M: 4, XL: 2 } }),
    ]);
  });

  test('merges genuine per-size OMG fragments into one line', () => {
    const rows = [
      { id: 1, sku: 'AT203', color: 'Black', sizes: { S: 2 } },
      { id: 2, sku: 'AT203', color: 'Black', sizes: { M: 3 } },
      { id: 3, sku: 'AT203', color: 'Red', sizes: { S: 1 } },
    ];
    expect(consolidateOmgProductRows(rows).map((r) => ({ color: r.color, sizes: r.sizes }))).toEqual([
      { color: 'Black', sizes: { S: 2, M: 3 } },
      { color: 'Red', sizes: { S: 1 } },
    ]);
  });

  test('uses the newest quantity for overlapping OMG snapshots', () => {
    const rows = [
      { id: 1, sku: 'AT203', color: 'Black', vendor_id: 'v1', sizes: { S: 2, M: 3 } },
      { id: 2, sku: 'AT203', color: 'Black', vendor_id: 'v1', sizes: { S: 4, M: 3 } },
    ];
    expect(consolidateOmgProductRows(rows)[0].sizes).toEqual({ S: 4, M: 3 });
  });

  test('keeps OMG rows from different suppliers separate', () => {
    const rows = [
      { id: 1, sku: 'A230', color: 'Black', vendor_id: 'v1', sizes: { M: 2 } },
      { id: 2, sku: 'A230', color: 'Black', vendor_id: 'v2', sizes: { L: 3 } },
    ];
    expect(consolidateOmgProductRows(rows)).toHaveLength(2);
  });
});
