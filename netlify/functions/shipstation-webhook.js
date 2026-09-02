// ShipStation SHIP_NOTIFY webhook for webstore orders.
//
// The shipment ledger, item tracker, cost roll-up, and notification obligation
// are all made retry-safe. Any failure before the notification is durably queued
// returns HTTP 500 so ShipStation retries. Once queued, Brevo delivery may fail
// independently and the five-minute outbox worker resumes it.

const { createClient } = require('@supabase/supabase-js');
const { planShipmentLineUpdates } = require('./_webstoreShipment');
const { processNotificationByDedupe } = require('./_webstoreNotifications');

const HEADERS = { 'Content-Type': 'application/json' };

function result(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

function isDuplicate(error) {
  return error && (error.code === '23505' || /duplicate|unique/i.test(error.message || ''));
}

async function maybeOne(query, label) {
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`${label}: ${error.message}`);
  return data || null;
}

async function findShipment(sb, ssShipmentId, tracking) {
  if (ssShipmentId) {
    const found = await maybeOne(
      sb.from('webstore_shipments').select('id,emailed').eq('ss_shipment_id', ssShipmentId),
      'Could not check existing ShipStation shipment',
    );
    if (found) return found;
  }
  if (tracking) {
    return maybeOne(
      sb.from('webstore_shipments').select('id,emailed').eq('tracking_number', tracking),
      'Could not check existing tracking number',
    );
  }
  return null;
}

function shipmentItems(shipment) {
  return (shipment.shipmentItems || []).map((item) => ({
    sku: item.sku || null,
    name: item.name || null,
    qty: Math.max(0, Number(item.quantity) || 0),
    image: item.imageUrl || null,
    lineItemKey: item.lineItemKey || null,
    options: Array.isArray(item.options) ? item.options : [],
  }));
}

async function recordShipment(sb, order, sh) {
  const tracking = sh.trackingNumber || null;
  const ssShipmentId = sh.shipmentId != null ? String(sh.shipmentId) : null;
  const items = shipmentItems(sh);
  const cost = (Number(sh.shipmentCost) || 0) + (Number(sh.insuranceCost) || 0);
  const patch = {
    order_id: order.id,
    store_id: order.store_id,
    tracking_number: tracking,
    ss_shipment_id: ssShipmentId,
    carrier: sh.carrierCode || null,
    service: sh.serviceCode || null,
    ship_date: sh.shipDate || null,
    items,
    cost: cost || null,
  };

  let existing = await findShipment(sb, ssShipmentId, tracking);
  if (existing) {
    const { error } = await sb.from('webstore_shipments').update(patch).eq('id', existing.id);
    if (error) throw new Error(`Could not refresh shipment ${ssShipmentId || tracking || existing.id}: ${error.message}`);
    return { id: existing.id, emailed: Boolean(existing.emailed), items, tracking };
  }

  const { data, error } = await sb.from('webstore_shipments').insert({ ...patch, emailed: false }).select('id,emailed').single();
  if (!error && data) return { id: data.id, emailed: Boolean(data.emailed), items, tracking };
  if (!isDuplicate(error)) throw new Error(`Could not record shipment ${ssShipmentId || tracking || ''}: ${error && error.message}`);

  // A concurrent webhook delivery won the unique-key race. Resume from its row
  // instead of treating that as completion; the other worker may have stopped
  // before item reconciliation or notification queueing.
  existing = await findShipment(sb, ssShipmentId, tracking);
  if (!existing) throw new Error(`Shipment race could not be recovered for ${ssShipmentId || tracking || ''}`);
  const { error: updateError } = await sb.from('webstore_shipments').update(patch).eq('id', existing.id);
  if (updateError) throw new Error(`Could not refresh raced shipment ${existing.id}: ${updateError.message}`);
  return { id: existing.id, emailed: Boolean(existing.emailed), items, tracking };
}

async function reconcileOrderTracker(sb, order, sh) {
  const { data: allShipments, error: shipmentsError } = await sb.from('webstore_shipments').select('items').eq('order_id', order.id);
  if (shipmentsError) throw new Error(`Could not load shipment ledger: ${shipmentsError.message}`);
  const { data: orderItems, error: orderItemsError } = await sb.from('webstore_order_items')
    .select('id,sku,size,qty,is_bundle_parent,line_status,shipped_qty').eq('order_id', order.id);
  if (orderItemsError) throw new Error(`Could not load order items: ${orderItemsError.message}`);

  const lines = (orderItems || []).filter((item) => !item.is_bundle_parent && item.line_status !== 'cancelled');
  const updates = planShipmentLineUpdates(lines, allShipments || []);
  for (const update of updates) {
    const patch = {
      shipped_qty: update.shipped_qty,
      ...(update.line_status === 'shipped' ? { line_status: 'shipped' } : {}),
    };
    const { error } = await sb.from('webstore_order_items').update(patch).eq('id', update.id);
    if (error) throw new Error(`Could not update shipped line ${update.id}: ${error.message}`);
    const line = lines.find((item) => String(item.id) === String(update.id));
    if (line) Object.assign(line, patch);
  }

  const fullyShipped = lines.length > 0 && lines.every((item) =>
    Number(item.shipped_qty || 0) >= Number(item.qty || 0));
  const orderPatch = {
    tracking_number: sh.trackingNumber || null,
    carrier: sh.carrierCode || null,
    ...(fullyShipped ? { shipped_at: new Date().toISOString() } : {}),
  };
  const { error: orderError } = await sb.from('webstore_orders').update(orderPatch).eq('id', order.id);
  if (orderError) throw new Error(`Could not update order tracker: ${orderError.message}`);
}

async function reconcileOrderCosts(sb, order) {
  const { data: shipments, error } = await sb.from('webstore_shipments').select('cost').eq('order_id', order.id);
  if (error) throw new Error(`Could not load shipment costs: ${error.message}`);
  const actual = (shipments || []).reduce((sum, shipment) => sum + (Number(shipment.cost) || 0), 0);
  const { error: orderError } = await sb.from('webstore_orders').update({ label_cost: actual || null }).eq('id', order.id);
  if (orderError) throw new Error(`Could not reconcile order shipping cost: ${orderError.message}`);
  await reconcileSoShipping(sb, order);
}

async function queueShipmentEmail(sb, order, shipment) {
  // Preserve the old emailed=true marker when replaying historical webhooks.
  // New sends complete the outbox and this marker in one database transaction.
  if (shipment.emailed) return { queued: false, reason: 'already_emailed' };
  const dedupeKey = `shipment_customer_email:${shipment.id}`;
  const { error } = await sb.from('webstore_notification_outbox').upsert({
    kind: 'shipment_customer_email',
    dedupe_key: dedupeKey,
    order_id: order.id,
    shipment_id: shipment.id,
  }, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  if (error) throw new Error(`Could not queue shipment notification: ${error.message}`);

  // Low-latency attempt; a provider failure is already durable and the sweep
  // will retry it, so it does not need to fail the ShipStation webhook.
  const delivery = await processNotificationByDedupe(sb, dedupeKey);
  return { queued: true, delivery };
}

async function processShipStationPayload(sb, payload) {
  const stats = { received: 0, processed: 0, ignored: 0, notificationsQueued: 0 };
  for (const sh of payload.shipments || []) {
    stats.received += 1;
    if (sh.voided) { stats.ignored += 1; continue; }
    const orderNumber = String(sh.orderNumber || '');
    if (!orderNumber.startsWith('WS-')) { stats.ignored += 1; continue; }
    const orderId = orderNumber.slice(3);
    if (!orderId) { stats.ignored += 1; continue; }

    const order = await maybeOne(sb.from('webstore_orders').select('*').eq('id', orderId), `Could not load webstore order ${orderId}`);
    if (!order) throw new Error(`Webstore order ${orderId} not found`);

    const shipment = await recordShipment(sb, order, sh);
    await reconcileOrderTracker(sb, order, sh);
    await reconcileOrderCosts(sb, order);
    const notification = await queueShipmentEmail(sb, order, shipment);
    if (notification.queued) stats.notificationsQueued += 1;
    stats.processed += 1;
  }
  return stats;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return result(405, { error: 'Method not allowed' });

  const apiKey = process.env.SHIPSTATION_API_KEY;
  const apiSecret = process.env.SHIPSTATION_API_SECRET;
  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey || !apiSecret || !supabaseUrl || !serviceKey) return result(500, { error: 'Webhook not configured' });

  // Fail closed: ShipStation's configured webhook URL must include the same
  // secret stored in Netlify (…/shipstation-webhook?token=<secret>).
  const webhookSecret = process.env.SHIPSTATION_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[shipstation-webhook] SHIPSTATION_WEBHOOK_SECRET not configured');
    return result(401, { error: 'Webhook secret not configured' });
  }
  const query = event.queryStringParameters || {};
  if ((query.token || query.secret || '') !== webhookSecret) return result(401, { error: 'Unauthorized' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return result(400, { error: 'Bad JSON' }); }
  if (body.resource_type && body.resource_type !== 'SHIP_NOTIFY') return result(200, { ignored: true });
  if (!body.resource_url) return result(400, { error: 'resource_url required' });

  // The URL is attacker-controllable and receives ShipStation Basic auth. Only
  // fetch its exact API host over TLS, without following redirects.
  let resourceUrl;
  try { resourceUrl = new URL(body.resource_url); } catch (_) { return result(400, { error: 'Bad resource_url' }); }
  if (resourceUrl.protocol !== 'https:' || resourceUrl.hostname.toLowerCase() !== 'ssapi.shipstation.com') {
    return result(400, { error: 'resource_url host not allowed' });
  }
  resourceUrl.searchParams.set('includeShipmentItems', 'true');

  const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  try {
    const response = await fetch(resourceUrl.toString(), {
      headers: { Authorization: `Basic ${auth}` },
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`ShipStation returned HTTP ${response.status}`);
    const payload = await response.json();
    const stats = await processShipStationPayload(sb, payload);
    return result(200, { received: true, ...stats });
  } catch (error) {
    console.error('[shipstation-webhook] error:', error.message || error);
    // Non-2xx is intentional: ShipStation must retry any processing failure.
    return result(500, { received: false, error: 'Shipment processing failed; retry required' });
  }
};

// Set the linked Sales Order's outbound shipping cost to the sum of actual
// label costs across all webstore orders tied to that SO/store.
async function reconcileSoShipping(sb, order) {
  let soId = order.so_id || null;
  let orderIds = [];
  if (soId) {
    const { data, error } = await sb.from('webstore_orders').select('id').eq('so_id', soId);
    if (error) throw new Error(`Could not load Sales Order webstore orders: ${error.message}`);
    orderIds = (data || []).map((row) => row.id);
  } else {
    const store = await maybeOne(
      sb.from('webstores').select('source,omg_sale_code').eq('id', order.store_id),
      'Could not load OMG store link',
    );
    if (!store || store.source !== 'omg' || !store.omg_sale_code) return;
    const { data: salesOrders, error: salesOrderError } = await sb.from('sales_orders').select('id')
      .eq('omg_store_id', `OMG-sale_${store.omg_sale_code}`).order('created_at', { ascending: false }).limit(1);
    if (salesOrderError) throw new Error(`Could not load linked Sales Order: ${salesOrderError.message}`);
    if (!salesOrders || !salesOrders[0]) return;
    soId = salesOrders[0].id;
    const { data, error } = await sb.from('webstore_orders').select('id').eq('store_id', order.store_id);
    if (error) throw new Error(`Could not load store orders: ${error.message}`);
    orderIds = (data || []).map((row) => row.id);
  }
  if (!soId || !orderIds.length) return;
  const { data: shipments, error } = await sb.from('webstore_shipments').select('cost').in('order_id', orderIds);
  if (error) throw new Error(`Could not load Sales Order shipment costs: ${error.message}`);
  const total = (shipments || []).reduce((sum, shipment) => sum + (Number(shipment.cost) || 0), 0);
  const { error: updateError } = await sb.from('sales_orders')
    .update({ _shipping_cost: total, _shipstation_cost: total }).eq('id', soId);
  if (updateError) throw new Error(`Could not reconcile Sales Order shipping cost: ${updateError.message}`);
}

module.exports.processShipStationPayload = processShipStationPayload;
module.exports.recordShipment = recordShipment;
module.exports.reconcileSoShipping = reconcileSoShipping;
module.exports.isDuplicate = isDuplicate;
