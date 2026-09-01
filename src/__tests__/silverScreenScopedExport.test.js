import { resolveWebstoreReportLines } from '../lib/soPlayerReport';
import { selectFulfillmentReportScope } from '../lib/fulfillmentReportScope';
import { buildSilverScreenDomesticRows } from '../lib/silverScreenFulfillment';

describe('SO-scoped Silver Screen export', () => {
  test('excludes unbatched null-color KF4549 and exports its batched IQ4808 Navy replacement', () => {
    const orders = [
      { id: 'batched', store_id: 'store-1', so_id: 'SO-1815', status: 'paid', order_number: 1010001, ship_method: 'deliver_club' },
      { id: 'unbatched', store_id: 'store-1', so_id: null, status: 'paid', order_number: 1010411, ship_method: 'deliver_club' },
    ];
    const sourceLines = [
      { order_id: 'batched', sku: 'KF4549', name: 'Adidas Core Sleeve', color: null, size: 'XS/S', qty: 1 },
      { order_id: 'unbatched', sku: 'KF4549', name: 'Adidas Core Sleeve', color: null, size: 'XS/S', qty: 2 },
    ];
    const resolved = resolveWebstoreReportLines({
      orders,
      lines: sourceLines,
      soItemsBySo: { 'SO-1815': [{ sku: 'IQ4808', name: 'Adidas Core Sleeve', color: 'Navy', sizes: { 'XS/S': 1 } }] },
      soMetaBySo: { 'SO-1815': { id: 'SO-1815', webstore_id: 'store-1' } },
    });
    const scope = selectFulfillmentReportScope(resolved.lines);
    expect(scope).toMatchObject({ ok: true, soId: 'SO-1815', excludedOrders: 1, excludedUnits: 2 });

    const built = buildSilverScreenDomesticRows({
      store: { id: 'store-1', delivery_mode: 'deliver_club' },
      lines: scope.lines,
      orderById: resolved.orderById,
      customer: { name: 'School', shipping_attention: 'Athletics', shipping_address_line1: '1 Club Way', shipping_city: 'Fresno', shipping_state: 'CA', shipping_zip: '93703' },
      audit: resolved.audit,
    });
    expect(built.issues).toEqual([]);
    expect(built.rows).toHaveLength(1);
    expect(built.rows[0][5]).toBe('Navy');
    expect(built.rows[0][6]).toBe('IQ4808');
  });
});
