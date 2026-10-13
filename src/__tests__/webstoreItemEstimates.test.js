const { addBusinessDays, businessDate } = require('../lib/businessDates.shared');
const { estimateItem, loadItemEstimates } = require('../../netlify/functions/_webstoreItemEstimates');
const item = { id: 'item', size: 'M', qty: 2, line_status: 'pending' };
const source = { id: 12, sku: 'A231', color: 'Black', sizes: { M: 2 }, source_webstore_item_ids: ['item'] };
const pick = { sizes: { M: 2 }, status: 'pick', created_at: '2026-10-09', ship_dest: 'in_house' };
const po = { sizes: { M: 2 }, status: 'waiting', expected_date: '2026-10-09' };
const now = new Date('2026-10-09T20:00:00Z');

test('business dates skip weekends, preserve Pacific dates and reject malformed dates', () => {
  expect(addBusinessDays('2026-10-09', 3)).toBe('2026-10-14');
  expect(addBusinessDays('2026-10-09', 2)).toBe('2026-10-13');
  expect(businessDate('2026-10-10T01:00:00Z')).toBe('2026-10-09');
  expect(addBusinessDays('10/9/2026', 3)).toBe('2026-10-14');
  expect(addBusinessDays('2026-02-30', 3)).toBeNull();
});
test('in-house pull and production are separate allowances', () => {
  expect(estimateItem(item, source, [pick], [], 4, now)).toMatchObject({ ready_date: '2026-10-14', ship_date: '2026-10-20', production_days: 4 });
});
test('supplier arrival adds check-in, then production; never the stock pull allowance', () => {
  expect(estimateItem(item, source, [], [po], 4, now)).toMatchObject({ arrival_date: '2026-10-09', ready_date: '2026-10-13', ship_date: '2026-10-19' });
});
test('partial supply or another size cannot promise a date; split sources use the slowest', () => {
  expect(estimateItem(item, source, [{ ...pick, sizes: { M: 1, L: 20 } }], [], 4, now).ship_date).toBeNull();
  expect(estimateItem(item, source, [{ ...pick, sizes: { M: 1 } }], [{ ...po, sizes: { M: 1 }, expected_date: '2026-10-16' }], 4, now).ship_date).toBe('2026-10-26');
});
test('a grouped SO line cannot reuse one allocation for several shopper lines', () => {
  expect(estimateItem(item, { ...source, sizes: { M: 5 } }, [pick], [], 4, now).ship_date).toBeNull();
});
test('seasonal production is the fallback; unknown arrival does not make a ship promise', () => {
  expect(estimateItem(item, source, [pick], [], null, now)).toMatchObject({ ready_date: '2026-10-14', ship_date: '2026-10-21', production_days: 5 });
  expect(estimateItem(item, source, [], [{ ...po, expected_date: '' }], 4, now).ship_date).toBeNull();
});
test('stale dates are flagged, not rolled forward on every visit', () => {
  expect(estimateItem(item, source, [pick], [], 4, new Date('2026-10-16T20:00:00Z'))).toMatchObject({ state: 'delayed', ship_date: null });
  expect(estimateItem(item, source, [{ ...pick, status: 'pulled' }], [], 4, new Date('2026-10-16T20:00:00Z'))).toMatchObject({ state: 'ready', ship_date: '2026-10-20' });
});
test('confirmed receipt, cancellations, shortages, completed production and shipment are respected', () => {
  expect(estimateItem(item, source, [], [{ ...po, received: { M: 2 } }], 4, now).state).toBe('ready');
  expect(estimateItem(item, source, [], [{ ...po, cancelled: { M: 1 } }], 4, now).ship_date).toBeNull();
  expect(estimateItem({ ...item, missing_qty: 1 }, source, [pick], [], 4, now).state).toBe('delayed');
  expect(estimateItem({ ...item, line_status: 'shipped' }, null, [], [], null, now).state).toBe('shipped');
  expect(estimateItem({ ...item, line_status: 'bagging' }, null, [], [], null, now).message).toMatch(/Production complete/);
  expect(estimateItem({ ...item, is_bundle_parent: true }, source, [pick], [], 4, now)).toBeNull();
  expect(estimateItem({ ...item, line_status: 'cancelled' }, source, [pick], [], 4, now)).toBeNull();
});
test('S&S arrival fallback requires exact style, color, size; expected arrival overrides it', () => {
  const line = { style: 'A231', color: 'Black', size: 'M', estimated_arrival: '2026-10-12' };
  const vendorPo = { ...po, expected_date: '', sizes: { M: 2, vendor_keys: { lines: [line, { ...line, color: 'Navy', estimated_arrival: '2026-11-01' }] } } };
  expect(estimateItem(item, source, [], [vendorPo], 0, now).ship_date).toBe('2026-10-14');
  expect(estimateItem(item, { ...source, color: 'Red' }, [], [vendorPo], 0, now).ship_date).toBeNull();
  expect(estimateItem(item, source, [], [{ ...vendorPo, expected_date: '2026-10-13' }], 0, now).ship_date).toBe('2026-10-15');
});
test('drop shipments cannot be treated as NSA warehouse stock', () => {
  expect(estimateItem(item, source, [{ ...pick, ship_dest: 'ship_deco' }], [], 4, now).ship_date).toBeNull();
  expect(estimateItem(item, source, [], [{ ...po, sizes: { M: 2, drop_ship: true } }], 4, now).ship_date).toBeNull();
});
function fakeDb() {
  const calls = [];
  return { calls, from(table) {
    const op = { table }; calls.push(op);
    const chain = { select: () => chain, eq: (k, v) => { op[k] = v; return chain; }, in: (k, v) => { op[k] = v; return chain; }, maybeSingle: () => chain,
      then: resolve => resolve({ data: table === 'webstore_orders' ? { so_id: 'SO1' } : table === 'so_items' ? [source] : table === 'so_item_pick_lines' ? [{ ...pick, so_item_id: 12 }] : [], error: null }) };
    return chain;
  } };
}
test('loader uses verified order and exact source IDs, returning only estimate data', async () => {
  const db = fakeDb();
  const result = await loadItemEstimates(db, { id: 'order1' }, { org_type: 'all_school', all_school_settings: { production: { business_days: 4 } } }, [item, { ...item, id: 'unlinked' }], now);
  expect(result.item.ship_date).toBe('2026-10-20');
  expect(result.unlinked.ship_date).toBeNull();
  expect(db.calls[0]).toMatchObject({ table: 'webstore_orders', id: 'order1' });
  expect(db.calls[1]).toMatchObject({ table: 'so_items', so_id: 'SO1' });
  expect(JSON.stringify(result)).not.toMatch(/SO1|unit_cost|vendor_keys/);
});
test('unavailable data fails safely and regular stores do not load internal fulfillment', async () => {
  const db = { from: jest.fn(() => { throw new Error('unavailable'); }) };
  expect(await loadItemEstimates(db, {}, { org_type: 'club' }, [item])).toBeNull();
  expect(db.from).not.toHaveBeenCalled();
  expect((await loadItemEstimates(db, {}, { org_type: 'all_school' }, [item])).item.ship_date).toBeNull();
});

test('token-verified tracker includes sanitized item estimates alongside existing order fields', async () => {
  const checkout = require('../../netlify/functions/webstore-checkout');
  const calls = [];
  const sb = { from(table) {
    const op = { table }; calls.push(op);
    const chain = { select: fields => { op.fields = fields; return chain; }, eq: (k, v) => { op[k] = v; return chain; }, in: () => chain, is: () => chain, limit: () => chain, order: () => chain, maybeSingle: () => chain,
      then: resolve => {
        let data = [];
        if (table === 'webstore_orders') data = op.fields === 'so_id' ? { so_id: 'SO1' } : [{ id: 'order1', store_id: 'store1', status: 'paid' }];
        if (table === 'webstores') data = [{ org_type: 'all_school', name: 'Store', all_school_settings: { production: { business_days: 4 } } }];
        if (table === 'webstore_order_items') data = [{ ...item, image_url: 'item.png' }];
        if (table === 'so_items') data = [source];
        if (table === 'so_item_pick_lines') data = [{ ...pick, so_item_id: 12 }];
        return resolve({ data, error: null });
      } };
    return chain;
  } };
  const result = await checkout.trackOrder(sb, { token: 'private-token' });
  expect(result.statusCode).toBe(200);
  expect(calls[0]).toMatchObject({ table: 'webstore_orders', status_token: 'private-token' });
  const data = JSON.parse(result.body);
  expect(data.item_estimates.item).toHaveProperty('ship_date');
  expect(data.items[0].name).toBeUndefined();
  expect(JSON.stringify(data)).not.toMatch(/SO1|vendor_keys|unit_cost|source_webstore_item_ids|auto_release_enabled/);
});
