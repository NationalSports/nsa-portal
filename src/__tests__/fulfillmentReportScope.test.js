import { selectFulfillmentReportScope } from '../lib/fulfillmentReportScope';

describe('fulfillment report scope', () => {
  test('uses one linked SO and excludes later/unbatched orders from every output', () => {
    const lines = [
      { order_id: 'batched-1', _sourceSoId: 'SO-1815', sku: 'JX4461', qty: 200 },
      { order_id: 'batched-2', _sourceSoId: 'SO-1815', sku: 'IQ4808', qty: 32 },
      { order_id: 'late-1', sku: 'JX4467', qty: 5 },
      { order_id: 'late-2', sku: 'JL5412', qty: 11 },
    ];
    const scope = selectFulfillmentReportScope(lines);
    expect(scope).toMatchObject({
      ok: true, soId: 'SO-1815', label: 'SO-1815', excludedOrders: 2, excludedUnits: 16,
    });
    expect(scope.lines.reduce((sum, line) => sum + line.qty, 0)).toBe(232);
    expect(scope.lines.every((line) => line._sourceSoId === 'SO-1815')).toBe(true);
  });

  test('preserves the useful report before a first SO exists', () => {
    const lines = [{ order_id: 'open-1', sku: 'JX4467', qty: 3 }];
    const scope = selectFulfillmentReportScope(lines);
    expect(scope).toMatchObject({ ok: true, soId: '', label: 'Unbatched orders', excludedOrders: 0, excludedUnits: 0 });
    expect(scope.lines).toEqual(lines);
  });

  test('refuses to merge multiple SOs into one vendor-facing report', () => {
    const scope = selectFulfillmentReportScope([
      { order_id: 'a', _sourceSoId: 'SO-1', qty: 1 },
      { order_id: 'b', _sourceSoId: 'SO-2', qty: 1 },
    ]);
    expect(scope.ok).toBe(false);
    expect(scope.message).toContain('Open the specific SO');
  });
});
