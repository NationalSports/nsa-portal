// Server-side ShipStation label creation for the Bagging Station: when a
// ship-to-home order's bag completes, bagging-api calls createBagShipLabel so
// the packer never touches a desktop. This is the server port of Webstores'
// createWebstoreLabel / webstoreToShipStation flow and keeps its conventions
// EXACTLY — orderNumber 'WS-<order id>' and lineItemKey = item id — so the
// existing shipstation-webhook reconciles cost/tracking and sends the ship
// email, same as a desk-printed label. If anything here fails, the bag still
// completes; the caller surfaces "print from Webstores" instead.

// Per-line ounces fallback — mirror of src/utils.js estimateWeightOz (functions
// are CommonJS and can't import the CRA src module; keep the two in sync).
function estimateWeightOz(text) {
  const t = String(text || '').toLowerCase();
  const rules = [
    [/back ?pack|duffel|duffle|equipment bag|gear bag/, 28],
    [/tote|sackpack|cinch|drawstring|bag/, 10],
    [/jacket|coat|parka|fleece|pullover|hoodie|hooded|sweatshirt|quarter ?zip|1\/4 ?zip|half ?zip|1\/2 ?zip/, 18],
    [/sweatpant|jogger|tearaway|pant|legging|tight/, 12],
    [/short/, 7],
    [/jersey|tank|singlet/, 5],
    [/tee|t-?shirt|shirt|polo|jersey top|top|warmup|warm-?up/, 6],
    [/beanie|hat|cap|visor/, 3],
    [/sock|glove|belt|headband|wristband|scrunchie/, 2],
    [/bottle|tumbler|mug/, 14],
    [/ball/, 16],
    [/blanket|towel/, 20],
  ];
  for (const [re, oz] of rules) if (re.test(t)) return oz;
  return 8;
}

function labelWeightLbs(items, store, weightByPid) {
  let oz = 0; let any = false;
  for (const i of items) {
    const ov = Number(weightByPid[i.product_id]);
    const w = weightByPid[i.product_id] != null && Number.isFinite(ov) ? ov : estimateWeightOz(i.sku || i.name);
    oz += w * Math.max(0, Number(i.qty) || 0);
    any = true;
  }
  if (any && oz > 0) return Math.max(0.1, Math.round((oz / 16) * 10) / 10);
  return Number(store && store.label_weight_lbs) || 1;
}

const SS_CARRIERS = {
  fedex: { carrierCode: 'fedex', serviceCode: 'fedex_ground' },
  ups: { carrierCode: 'ups', serviceCode: 'ups_ground' },
  usps: { carrierCode: 'stamps_com', serviceCode: 'usps_priority_mail' },
};

// Ship-from — mirror of src/constants.js NSA_DEFAULTS (same CommonJS caveat).
const NSA = { name: 'National Sports Apparel', addr: '2238 N Glassell St Ste E', city: 'Orange', state: 'CA', zip: '92865', phone: '(619) 555-0127' };

async function ssCall(path, body) {
  const key = process.env.SHIPSTATION_API_KEY;
  const secret = process.env.SHIPSTATION_API_SECRET;
  if (!key || !secret) throw new Error('ShipStation credentials not configured');
  const res = await fetch('https://ssapi.shipstation.com' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64'),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.ExceptionMessage || json.Message || `ShipStation ${res.status}`);
  return json;
}

function validAddress(a) {
  return a && a.street1 && a.city && a.state && a.zip;
}

// order: full webstore_orders row; items: its webstore_order_items.
// Returns { skipped, reason } or { labelData, trackingNumber, carrier, cost }.
async function createBagShipLabel(sb, order, items) {
  if (order.ship_method !== 'ship_home') return { skipped: true, reason: 'not ship-home' };
  if (!validAddress(order.ship_address)) return { skipped: true, reason: 'no valid ship address' };

  const { data: stores } = await sb.from('webstores')
    .select('id,name,bagging_auto_label,shipstation_tag_id,shipstation_carrier,shipstation_service,shipstation_store_id,label_weight_lbs')
    .eq('id', order.store_id).limit(1);
  const store = stores && stores[0];
  if (!store) return { skipped: true, reason: 'store not found' };
  if (store.bagging_auto_label === false) return { skipped: true, reason: 'auto-label off for this store' };

  // Units still to ship per line = ordered − already shipped − short-now
  // (same plan math as Webstores printShipLabels / OMG shipPlan).
  const plan = (items || [])
    .filter((i) => !i.is_bundle_parent && (i.line_status || '') !== 'cancelled')
    .map((i) => ({ ...i, qty: Math.max(0, (Number(i.qty) || 0) - (Number(i.shipped_qty) || 0) - (Number(i.missing_qty) || 0)) }))
    .filter((i) => i.qty > 0);
  if (!plan.length) return { skipped: true, reason: 'nothing to ship (all shipped or short)' };

  const pids = [...new Set(plan.map((i) => i.product_id).filter(Boolean))];
  const weightByPid = {};
  if (pids.length) {
    const { data: cat } = await sb.from('webstore_products')
      .select('product_id,weight_oz').eq('store_id', order.store_id).in('product_id', pids);
    (cat || []).forEach((c) => { if (c.weight_oz != null) weightByPid[c.product_id] = Number(c.weight_oz); });
  }

  const a = order.ship_address;
  const ss = await ssCall('/orders/createorder', {
    orderNumber: 'WS-' + order.id, orderKey: 'ws-' + order.id,
    orderDate: order.created_at, orderStatus: 'awaiting_shipment',
    customerUsername: store.name, customerEmail: order.buyer_email || '',
    billTo: { name: order.buyer_name || a.name || 'Customer' },
    shipTo: { name: a.name || order.buyer_name || '', street1: a.street1 || '', street2: a.street2 || '', city: a.city || '', state: a.state || '', postalCode: a.zip || '', country: a.country || 'US', phone: order.buyer_phone || '', residential: true },
    items: plan.map((i) => ({
      lineItemKey: i.id,
      sku: i.sku || '',
      name: [i.sku, i.size && ('Size ' + i.size), i.player_number && ('#' + i.player_number), i.player_name].filter(Boolean).join(' · '),
      quantity: i.qty, unitPrice: Number(i.unit_price) || 0,
      options: [i.size && { name: 'Size', value: i.size }, i.player_number && { name: 'Number', value: String(i.player_number) }, i.player_name && { name: 'Name', value: i.player_name }].filter(Boolean),
    })),
    amountPaid: order.payment_mode === 'paid' ? (Number(order.total) || 0) : 0,
    carrierCode: null, serviceCode: null, packageCode: null, confirmation: 'none',
    advancedOptions: {
      source: 'NSA Bagging Station', customField1: store.name, customField2: order.so_id || '',
      ...(store.shipstation_store_id ? { storeId: Number(store.shipstation_store_id) || undefined } : {}),
    },
  });
  if (!ss.orderId) throw new Error('ShipStation order not created');
  if (Number(store.shipstation_tag_id)) {
    try { await ssCall('/orders/addtag', { orderId: ss.orderId, tagId: Number(store.shipstation_tag_id) }); } catch (_) { /* tag is cosmetic */ }
  }

  const cm = SS_CARRIERS[(store.shipstation_carrier || 'fedex').toLowerCase()] || SS_CARRIERS.fedex;
  const res = await ssCall('/orders/createlabelfororder', {
    orderId: ss.orderId, carrierCode: cm.carrierCode, serviceCode: store.shipstation_service || cm.serviceCode,
    packageCode: 'package', confirmation: 'none', shipDate: new Date().toISOString().split('T')[0],
    weight: { value: labelWeightLbs(plan, store, weightByPid), units: 'pounds' },
    shipFrom: { name: NSA.name, company: NSA.name, street1: NSA.addr, city: NSA.city, state: NSA.state, postalCode: NSA.zip, country: 'US', phone: NSA.phone },
    shipTo: { name: a.name || order.buyer_name || '', street1: a.street1 || '', street2: a.street2 || '', city: a.city || '', state: a.state || '', postalCode: a.zip || '', country: a.country || 'US', phone: order.buyer_phone || '' },
    testLabel: false,
  });
  const cost = res.shipmentCost != null ? Number(res.shipmentCost) + (Number(res.insuranceCost) || 0) : null;

  // Same writes the desk flow makes: line progress, then order tracking/label.
  for (const p of plan) {
    const orig = (items || []).find((i) => i.id === p.id) || {};
    const sq = (Number(orig.shipped_qty) || 0) + p.qty;
    const done = sq >= (Number(orig.qty) || 0);
    try {
      await sb.from('webstore_order_items')
        .update({ shipped_qty: sq, ...(done ? { line_status: 'shipped' } : {}) }).eq('id', p.id);
    } catch (_) { /* webhook reconciliation backstops this */ }
  }
  const allShipped = (items || [])
    .filter((i) => !i.is_bundle_parent && (i.line_status || '') !== 'cancelled')
    .every((i) => {
      const shipNow = (plan.find((p) => p.id === i.id) || {}).qty || 0;
      return (Number(i.shipped_qty) || 0) + shipNow + (Number(i.missing_qty) || 0) >= (Number(i.qty) || 0);
    });
  await sb.from('webstore_orders').update({
    tracking_number: res.trackingNumber || null, carrier: cm.carrierCode,
    label_cost: cost, label_data: res.labelData || null,
    shipstation_shipment_id: res.shipmentId || null,
    ...(allShipped ? { shipped_at: new Date().toISOString() } : {}),
  }).eq('id', order.id);

  return { labelData: res.labelData || null, trackingNumber: res.trackingNumber || null, carrier: cm.carrierCode, cost };
}

module.exports = { createBagShipLabel, estimateWeightOz, labelWeightLbs };
