// Staff-authenticated handoff for labels created directly from Webstores.
// ShipStation webhooks remain a replay/backstop, but the order tracker and
// customer notification no longer depend on a webhook arriving later.

const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');
const { processDirectShipment } = require('./shipstation-webhook');

const MAX_LABEL_BYTES = 8 * 1024 * 1024;

function response(statusCode, body) {
  return { statusCode, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function cleanText(value, max = 200) {
  const text = value == null ? '' : String(value).trim();
  return text ? text.slice(0, max) : null;
}

function normalizeShipment(input) {
  const src = input && typeof input === 'object' ? input : {};
  const shipmentId = cleanText(src.shipment_id || src.shipmentId, 120);
  const trackingNumber = cleanText(src.tracking_number || src.trackingNumber, 240);
  if (!shipmentId && !trackingNumber) throw new Error('shipment_id or tracking_number required');
  const rawItems = Array.isArray(src.items) ? src.items : [];
  if (!rawItems.length || rawItems.length > 250) throw new Error('shipment items required');
  const shipmentItems = rawItems.map((item) => {
    const qty = Math.max(0, Math.floor(Number(item && (item.qty != null ? item.qty : item.quantity)) || 0));
    const lineItemKey = cleanText(item && (item.lineItemKey || item.line_item_key), 120);
    if (!lineItemKey || qty <= 0) throw new Error('each shipment item needs lineItemKey and qty');
    return {
      lineItemKey,
      sku: cleanText(item.sku, 200),
      name: cleanText(item.name, 500),
      quantity: qty,
      imageUrl: cleanText(item.image || item.imageUrl, 2000),
      options: Array.isArray(item.options) ? item.options.slice(0, 20) : [],
    };
  });
  return {
    shipmentId,
    trackingNumber,
    carrierCode: cleanText(src.carrier || src.carrierCode, 100),
    serviceCode: cleanText(src.service || src.serviceCode, 120),
    shipDate: cleanText(src.ship_date || src.shipDate, 20),
    shipmentCost: Number.isFinite(Number(src.cost)) ? Number(src.cost) : null,
    insuranceCost: 0,
    shipmentItems,
  };
}

exports.handler = async (event) => {
  const headers = { ...corsHeaders(), 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'POST only' });
  let auth;
  try { auth = await verifyUser(event); }
  catch (error) { return response(500, { ok: false, error: 'Authentication check failed' }); }
  if (!auth.ok) return response(auth.status, { ok: false, error: auth.error });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return response(400, { ok: false, error: 'Invalid JSON' }); }
  const orderId = cleanText(body.order_id, 80);
  if (!orderId) return response(400, { ok: false, error: 'order_id required' });

  let shipment;
  try { shipment = normalizeShipment(body.shipment); }
  catch (error) { return response(400, { ok: false, error: error.message }); }

  const labelData = typeof body.label_data === 'string' && body.label_data.trim() ? body.label_data.trim() : null;
  if (labelData && Buffer.byteLength(labelData, 'utf8') > MAX_LABEL_BYTES) {
    return response(413, { ok: false, error: 'Label PDF is too large' });
  }

  const sb = getSupabaseAdmin();
  try {
    const { data: order, error } = await sb.from('webstore_orders').select('*').eq('id', orderId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) return response(404, { ok: false, error: 'Order not found' });

    const processed = await processDirectShipment(sb, order, shipment);
    const patch = {
      ...(shipment.shipmentId ? { shipstation_shipment_id: shipment.shipmentId } : {}),
      ...(labelData ? { label_data: labelData } : {}),
    };
    const { error: patchError } = await sb.from('webstore_orders').update(patch).eq('id', order.id);
    if (patchError) throw new Error(`Could not save label metadata: ${patchError.message}`);
    return response(200, {
      ok: true,
      shipment_id: processed.shipment.id,
      notification_queued: Boolean(processed.notification && processed.notification.queued),
    });
  } catch (error) {
    console.error('[webstore-shipment-record] failed:', error.message || error);
    return response(500, { ok: false, error: 'Shipment recording failed; retry required' });
  }
};

module.exports.normalizeShipment = normalizeShipment;
