/** @jest-environment node */
const { mergeShipment, importSoShipment, fetchShipmentPages } = require('../../netlify/functions/_soShipStationBridge');
const { classifyBoxes } = require('../../netlify/functions/so-shipment-notify-sweep');
const sh = { orderNumber: 'SO-2173', shipmentId: 17, trackingNumber: 'TRACK1', carrierCode: 'ups', shipDate: '2026-10-05', shipmentItems: [{ sku: 'SHIRT', quantity: 2 }] };
function database(initial, conflict = false) {
  let row = { id: sh.orderNumber, _version: 1, _shipments: [], ...initial };
  const writes = [];
  return {
    writes, row: () => row,
    from: jest.fn(() => {
      let patch, filters = {};
      const q = {
        select: () => patch ? Promise.resolve(save()) : q,
        update: value => { patch = value; return q; },
        eq: (key, value) => { filters[key] = value; return q; },
        is: () => q,
        maybeSingle: async () => ({ data: JSON.parse(JSON.stringify(row)) }),
      };
      function save() {
        if (conflict) {
          conflict = false;
          row._version++;
          row._shipments.push({ id: 'warehouse-box', tracking_number: 'OTHER' });
          return { data: [] };
        }
        if (filters._version !== row._version) return { data: [] };
        writes.push(patch); row = { ...row, ...patch, _version: row._version + 1 };
        return { data: [{ id: row.id }] };
      }
      return q;
    }),
  };
}

test('a partial label becomes sweep-visible without closing the SO or inventing contents', async () => {
  const db = database({ _shipped: false });
  await importSoShipment(db, sh);
  expect(classifyBoxes(db.row()._shipments).announceable).toHaveLength(1);
  expect(db.row()._shipped).toBe(false);
  expect(Object.keys(db.writes[0])).toEqual(['_shipments']);
  expect(db.row()._shipments[0]).toMatchObject({ items: [], created_at: '2026-10-05', shipstation_items: sh.shipmentItems });
});
test('multiple packages survive webhook replays and concurrent warehouse saves', async () => {
  const db = database({}, true);
  await importSoShipment(db, sh);
  await importSoShipment(db, { ...sh, shipmentId: 18, trackingNumber: 'TRACK2' });
  await importSoShipment(db, sh);
  expect(db.row()._shipments.map(s => s.tracking_number)).toEqual(['OTHER', 'TRACK1', 'TRACK2']);
  expect(db.writes).toHaveLength(2);
});
test('existing package identity, contents and transfer exclusions survive import', () => {
  const existing = { id: 'BOX-9', tracking_number: 'TRACK1', carrier: 'ups', fulfillment: false, shipment_scope: 'deco_transfer', items: [{ sku: 'A', sizes: { M: 3 } }], created_at: '2026-10-01' };
  const { shipments } = mergeShipment([existing], sh);
  expect(shipments).toHaveLength(1);
  expect(shipments[0]).toMatchObject(existing);
  expect(classifyBoxes(shipments).announceable).toHaveLength(0);
});
test('voided and unrelated orders never write; malformed new shipments fail visibly', async () => {
  const db = database();
  await importSoShipment(db, { ...sh, voided: true });
  await importSoShipment(db, { ...sh, orderNumber: 'WS-1' });
  expect(db.from).not.toHaveBeenCalled();
  await expect(importSoShipment(db, { ...sh, trackingNumber: '' })).rejects.toThrow('tracking');
  expect(db.writes).toHaveLength(0);
});
test('missing orders and database errors are retryable failures', async () => {
  const q = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => ({ data: null }) };
  await expect(importSoShipment({ from: () => q }, sh)).rejects.toThrow('not found');
  q.maybeSingle = async () => ({ error: { message: 'offline' } });
  await expect(importSoShipment({ from: () => q }, sh)).rejects.toThrow('offline');
});
test('shipment fetch includes every page and requests contents, never follows redirects', async () => {
  process.env.SHIPSTATION_API_KEY = 'test'; process.env.SHIPSTATION_API_SECRET = 'test';
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ shipments: [sh], pages: 2 }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ shipments: [{ ...sh, shipmentId: 18 }], pages: 2 }) });
  const result = await fetchShipmentPages('https://ssapi.shipstation.com/shipments?orderNumber=SO-2173');
  expect(result).toHaveLength(2);
  expect(fetch.mock.calls[1][0]).toContain('page=2');
  expect(fetch.mock.calls[0][0]).toContain('includeShipmentItems=true');
  expect(fetch.mock.calls[0][1].redirect).toBe('error');
  await expect(fetchShipmentPages('https://evil.test/shipments')).rejects.toThrow('URL');
});

test('repeated concurrent edits exhaust retries without reporting a successful save', async () => {
  const q = {
    select: jest.fn(() => q), eq: () => q, is: () => q,
    maybeSingle: async () => ({ data: { id: sh.orderNumber, _version: 1, _shipments: [] } }),
    update: () => ({ eq: () => ({ eq: () => ({ is: () => ({ select: async () => ({ data: [] }) }) }) }) }),
  };
  await expect(importSoShipment({ from: () => q }, sh)).rejects.toThrow('retry required');
});
