const { _test } = require('../../netlify/functions/webstore-production-report');

function dbFor(tables) {
  return {
    from(table) {
      let rows = tables[table] || [];
      const q = {
        select() { return q; },
        eq(key, value) { rows = rows.filter((r) => r[key] === value); return q; },
        in(key, values) { rows = rows.filter((r) => values.includes(r[key])); return q; },
        order() { return q; },
        then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
        async maybeSingle() { return { data: rows[0] || null, error: null }; },
        async range(start, end) { return { data: rows.slice(start, end + 1), error: null }; },
      };
      return q;
    },
  };
}

test('decorator snapshot excludes linked SOs from another store and strips financial/customer fields', async () => {
  const tables = {
    webstores: [{ id: 'ours', source: 'webstore', name: 'Team' }],
    webstore_products: [],
    webstore_orders: [
      { id: 'o1', store_id: 'ours', status: 'paid', so_id: 'SO-1', buyer_name: 'Parent', buyer_email: 'private@example.com' },
      { id: 'o2', store_id: 'ours', status: 'paid', so_id: 'SO-OTHER' },
    ],
    webstore_order_items: [{ id: 'i1', order_id: 'o1', sku: 'TEE', qty: 1, player_name: 'Player', unit_price: 99, ship_address: { street: 'private' } }],
    so_items: [
      { id: 1, so_id: 'SO-1', sku: 'TEE', sizes: { M: 1 }, nsa_cost: 50 },
      { id: 2, so_id: 'SO-OTHER', sku: 'SECRET', sizes: { M: 1 } },
    ],
    so_jobs: [{ so_id: 'SO-OTHER', notes: 'other team' }],
    so_art_files: [{ id: 'secret', so_id: 'SO-OTHER', files: ['private-art'] }],
    so_item_decorations: [{ so_item_id: 2, kind: 'art', art_file_id: 'secret' }],
    sales_orders: [
      { id: 'SO-1', webstore_id: 'ours' },
      { id: 'SO-OTHER', webstore_id: 'other' },
    ],
  };
  const snapshot = await _test.snapshot(dbFor(tables), 'ours');
  expect(snapshot.salesOrders.map((s) => s.id)).toEqual(['SO-1']);
  expect(snapshot.soItems.map((s) => s.sku)).toEqual(['TEE']);
  expect(snapshot.art).toEqual([]);
  expect(snapshot.jobs).toEqual([]);
  expect(snapshot.decorations).toEqual([]);
  expect(snapshot.orders[0]).not.toHaveProperty('buyer_email');
  expect(snapshot.items[0]).not.toHaveProperty('unit_price');
  expect(snapshot.items[0]).not.toHaveProperty('ship_address');
  expect(snapshot.soItems[0]).not.toHaveProperty('nsa_cost');
});
