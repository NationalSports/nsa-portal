// Shared by SHIP_NOTIFY and the staff status-check endpoint. Only exact SO
// numbers are accepted; webstore orders retain their separate notification path.
const normalized = value => String(value || '').trim().toLowerCase();
const isSoNumber = value => /^SO-\d+$/.test(String(value || ''));

function mergeShipment(shipments, shipment) {
  if (!Array.isArray(shipments)) throw new Error('Invalid saved shipment list');
  const tracking = String(shipment.trackingNumber || '').trim();
  if (shipment.shipmentId == null || !tracking) throw new Error('Shipment ID and tracking required');
  const index = shipments.findIndex(box =>
    String(box.shipstation_shipment_id || '') === String(shipment.shipmentId) ||
    (normalized(box.tracking_number) === normalized(tracking) &&
      (!box.carrier || normalized(box.carrier) === normalized(shipment.carrierCode))));
  const previous = index < 0 ? null : shipments[index];
  const date = shipment.shipDate || shipment.createDate;
  if (!previous && (!date || !Number.isFinite(Date.parse(date)))) throw new Error('Shipment date required');
  const box = {
    ...(previous || {
      id: `SS-SHP-${shipment.shipmentId}`,
      created_at: shipment.createDate || date,
      items: [],
      contents_unconfirmed: true,
      notes: 'Imported from ShipStation. Package contents require warehouse confirmation.',
    }),
    shipstation_shipment_id: String(shipment.shipmentId),
    tracking_number: tracking,
    carrier: shipment.carrierCode || (previous && previous.carrier) || '',
    ship_date: date || previous.ship_date,
  };
  // Keep provider contents for reconciliation; never infer sizes/colors or
  // full-order fulfillment from a label's aggregate quantity.
  if (Array.isArray(shipment.shipmentItems)) box.shipstation_items = shipment.shipmentItems;
  const next = [...shipments];
  if (index < 0) next.push(box); else next[index] = box;
  return { shipments: next, changed: JSON.stringify(next) !== JSON.stringify(shipments) };
}

async function importSoShipment(admin, shipment) {
  if (!isSoNumber(shipment.orderNumber) || shipment.voided) return { ignored: true };
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: so, error } = await admin.from('sales_orders')
      .select('id,_version,_shipments').eq('id', shipment.orderNumber).is('deleted_at', null).maybeSingle();
    if (error) throw new Error(`Could not load SO: ${error.message}`);
    if (!so) throw new Error(`Sales order ${shipment.orderNumber} not found`);
    const merged = mergeShipment(so._shipments || [], shipment);
    if (!merged.changed) return { changed: false };
    if (!Number.isInteger(so._version)) throw new Error('Sales order version required');
    const saved = await admin.from('sales_orders').update({ _shipments: merged.shipments })
      .eq('id', so.id).eq('_version', so._version).is('deleted_at', null).select('id');
    if (saved.error) throw new Error(`Could not save shipment: ${saved.error.message}`);
    if (saved.data && saved.data.length) return { changed: true };
    // A warehouse edit or another webhook won the race. Re-read and merge its
    // boxes, instead of replacing that newer array with our stale snapshot.
  }
  throw new Error('Sales order changed during import; retry required');
}

async function fetchShipmentPages(resourceUrl) {
  const url = new URL(resourceUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'ssapi.shipstation.com' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Invalid ShipStation URL');
  const key = process.env.SHIPSTATION_API_KEY;
  const secret = process.env.SHIPSTATION_API_SECRET;
  if (!key || !secret) throw new Error('ShipStation not configured');
  url.searchParams.set('includeShipmentItems', 'true');
  const shipments = [];
  let page = Number(url.searchParams.get('page') || 1);
  if (!Number.isInteger(page) || page < 1) throw new Error('Invalid shipment page');
  for (let count = 0; count < 100; count++, page++) {
    url.searchParams.set('page', String(page));
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` },
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`ShipStation returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.shipments)) throw new Error('Invalid ShipStation shipments response');
    shipments.push(...payload.shipments);
    if (payload.pages == null || Number(payload.pages) <= page) return shipments;
    if (!Number.isInteger(Number(payload.pages))) throw new Error('Invalid shipment pagination');
  }
  throw new Error('Shipment pagination limit exceeded; import incomplete');
}

module.exports = { isSoNumber, mergeShipment, importSoShipment, fetchShipmentPages };
