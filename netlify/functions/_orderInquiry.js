// Shared "order inquiry" brain — resolves a customer's team-store order(s) from
// an order number and/or their email address, and summarizes where each order is
// in the pipeline. Used by hello-inbound.js (the hello@ email auto-responder);
// built to be reused by the website chatbot so the two never drift apart.
//
// Data model recap (see OrderTrack.js + migrations 011/031/034/037):
//   webstore_orders.order_number      — native team-store orders (7-digit bigint)
//   webstore_orders.omg_order_number  — OMG pop-up orders (9-digit text)
//   webstore_order_items.line_status  — pending/on_order → received → in_production
//                                       → bagging → shipped/complete (monotonic)
//   webstore_shipments                — tracking_number/carrier per shipment
//   webstore_orders.status_token      — credential for the public /shop/order/<token> page

// Same ladder as OrderTrack.js — keep in sync if stages ever change.
const STAGE_RANK = { pending: 0, on_order: 0, received: 1, in_production: 2, bagging: 3, shipped: 4, complete: 4 };

const STAGE_COPY = {
  0: { label: 'Order received', text: 'Your order is confirmed and in line for production.' },
  1: { label: 'Gear received', text: 'The blank gear for your order has arrived at our facility and is queued for customization.' },
  2: { label: 'In production', text: 'Your items are being customized right now — printing, embroidery, names and numbers.' },
  3: { label: 'Packing', text: 'Production is done and your order is being packed for shipment.' },
  4: { label: 'Shipped', text: 'Your order has shipped!' },
};

// Mirrors OrderTrack.js carrier deep-links.
function trackingUrl(carrier, num) {
  const c = String(carrier || '').toLowerCase();
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${num}`;
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${num}`;
  if (c.includes('usps') || c.includes('stamps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${num}`;
  return `https://www.google.com/search?q=${encodeURIComponent((carrier || '') + ' tracking ' + num)}`;
}

// Pull order-number candidates out of free text. Native numbers are 7 digits,
// OMG numbers 9 — accept 6-10 so we tolerate typos/new ranges, and let the DB
// lookup decide. Strips #/spaces; dedupes; caps at 5 so a forwarded receipt
// full of digits can't fan out into dozens of queries.
function extractOrderNumbers(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text || '').matchAll(/#?\b(\d{6,10})\b/g)) {
    const n = m[1];
    // Obvious non-order digit runs: phone-ish groupings are caught by the word
    // boundary; years/zips are shorter than 6. Skip runs that are part of a
    // longer number (tracking numbers are 12+ digits and match elsewhere).
    if (!seen.has(n)) { seen.add(n); out.push(n); }
    if (out.length >= 5) break;
  }
  return out;
}

// Find orders by explicit numbers first, then (optionally) by buyer email.
// Returns { matches: [{order, store, items, shipments}], matchedBy, unmatchedNumbers }.
async function findOrders(sb, { numbers = [], email = null } = {}) {
  const found = new Map(); // order id → order row
  const unmatched = [];
  for (const raw of numbers) {
    const n = String(raw).replace(/^#/, '');
    let hit = null;
    if (/^\d+$/.test(n) && n.length <= 12) {
      const { data } = await sb.from('webstore_orders').select('*').eq('order_number', Number(n)).limit(1);
      hit = data && data[0];
    }
    if (!hit) {
      const { data } = await sb.from('webstore_orders').select('*').eq('omg_order_number', n).limit(1);
      hit = data && data[0];
    }
    if (hit) found.set(hit.id, hit);
    else unmatched.push(n);
  }
  let matchedBy = found.size ? 'order_number' : null;

  if (!found.size && email) {
    const cutoff = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
    const { data } = await sb.from('webstore_orders').select('*')
      .ilike('buyer_email', String(email).trim())
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(3);
    (data || []).forEach((o) => found.set(o.id, o));
    if (found.size) matchedBy = 'buyer_email';
  }

  const matches = [];
  for (const order of found.values()) {
    const [{ data: stores }, { data: items }, { data: shipments }] = await Promise.all([
      sb.from('webstores').select('id,name,slug,close_at,source,primary_color,accent_color').eq('id', order.store_id).limit(1),
      sb.from('webstore_order_items').select('name,sku,size,qty,player_name,player_number,line_status,missing_qty,is_bundle_parent,bundle_product_id').eq('order_id', order.id),
      sb.from('webstore_shipments').select('tracking_number,carrier,ship_date,created_at').eq('order_id', order.id).order('created_at', { ascending: true }),
    ]);
    matches.push({ order, store: (stores && stores[0]) || null, items: items || [], shipments: shipments || [] });
  }
  return { matches, matchedBy, unmatchedNumbers: unmatched };
}

// Summarize one matched order into the pieces a reply (email or chat) needs.
function summarizeOrder({ order, store, items, shipments }, { turnaroundDays = 21, portalUrl = '' } = {}) {
  const active = items.filter((i) => i.line_status !== 'cancelled' && !i.is_bundle_parent);
  const ranks = active.map((i) => STAGE_RANK[i.line_status] ?? 0);
  // The order "is" wherever its furthest-behind item is. A shipment with some
  // items still behind = partially shipped.
  const stage = ranks.length ? Math.min(...ranks) : 0;
  const partial = shipments.length > 0 && stage < 4;
  const displayNumber = order.omg_order_number || (order.order_number != null ? String(order.order_number) : null);

  // Estimated ship date: no promised-date field exists, so derive one — team
  // orders enter production after the store closes, so close date + standard
  // turnaround. If that lands in the past (or there's no close date), don't
  // invent a date; the copy falls back to "in the final stretch".
  let estShipDate = null;
  if (stage < 4) {
    const base = store && store.close_at ? new Date(store.close_at) : new Date(order.created_at);
    const est = new Date(base.getTime() + turnaroundDays * 24 * 3600 * 1000);
    if (est.getTime() > Date.now() + 2 * 24 * 3600 * 1000) estShipDate = est;
  }

  return {
    displayNumber,
    storeName: (store && store.name) || 'your team store',
    stage,
    stageLabel: STAGE_COPY[stage].label,
    stageText: STAGE_COPY[stage].text,
    partialShipment: partial,
    estShipDate, // Date or null
    trackUrl: portalUrl ? `${portalUrl}/shop/order/${order.status_token}` : null,
    shipments: shipments.map((s) => ({ carrier: s.carrier, tracking: s.tracking_number, url: trackingUrl(s.carrier, s.tracking_number), shipDate: s.ship_date })),
    items: active.map((i) => ({
      label: [i.name || i.sku || 'Item', i.size && `Size ${i.size}`, i.player_number && `#${i.player_number}`, i.player_name].filter(Boolean).join(' · '),
      qty: i.qty || 1,
      stageLabel: STAGE_COPY[STAGE_RANK[i.line_status] ?? 0].label,
      missing: (i.missing_qty || 0) > 0,
    })),
    buyerName: order.buyer_name || '',
    buyerEmail: order.buyer_email || '',
  };
}

module.exports = { extractOrderNumbers, findOrders, summarizeOrder, trackingUrl, STAGE_RANK, STAGE_COPY };
