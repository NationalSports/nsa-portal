import { buildProductionReport } from '../lib/webstoreProductionReport';

const base = {
  store: { id: 'STORE-A' },
  products: [{ id: 'p1', product_id: 'product-1', sku: 'OLD' }],
  orders: [{ id: 'order-1', store_id: 'STORE-A', status: 'paid', so_id: 'SO-1', order_number: 123, buyer_name: 'Parent' }],
  items: [{ id: 'line-1', order_id: 'order-1', product_id: 'product-1', sku: 'OLD', name: 'Old tee', color: 'Navy', size: 'M', qty: 2, player_name: 'Taylor', player_number: '8' }],
  soItems: [{ id: 1, so_id: 'SO-1', sku: 'NEW', name: 'Replacement tee', color: 'Navy', sizes: { M: 2, L: 1 } }],
  salesOrders: [{ id: 'SO-1', webstore_id: 'STORE-A' }],
  decorations: [{ so_item_id: 1, kind: 'art', art_file_id: 'logo', position: 'Front', type: 'embroidery' }],
};

test('shows edited SO quantities and decoration alongside reconciled player SKU', () => {
  const r = buildProductionReport(base);
  expect(r.productionUnits).toBe(3);
  expect(r.unassignedBySo).toEqual({ 'SO-1': 1 });
  expect(r.production[0]).toMatchObject({ sku: 'NEW', units: 3, decorations: [{ art_file_id: 'logo' }] });
  expect(r.players[0]).toMatchObject({ name: 'Taylor', number: '8', units: 2 });
  expect(r.players[0].lines[0]).toMatchObject({ sku: 'NEW', _wasSku: 'OLD', qty: 2 });
});

test('flags a missing SO and keeps unbatched demand separate from SO totals', () => {
  const r = buildProductionReport({
    ...base, salesOrders: [], soItems: [],
    orders: [...base.orders, { id: 'order-2', store_id: 'STORE-A', status: 'paid', buyer_name: 'Parent' }],
    items: [...base.items, { id: 'line-2', order_id: 'order-2', sku: 'TEE', size: 'S', qty: 1, player_name: 'Alex' }],
  });
  expect(r.problems.join(' ')).toContain('could not be loaded');
  expect(r.unbatched).toHaveLength(1);
  expect(r.productionUnits).toBe(0);
});
