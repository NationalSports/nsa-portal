// Coach-facing Team Shop order history (Stage 8) — the list a signed-in coach
// sees on the teamshop Account page's "Recent orders" section and the Connect
// coach portal's "Team Shop orders" card (TODO(account-orders) in
// src/teamshop/AccountPage.js — this function is the "real list-my-orders
// API" that TODO was waiting on).
//
// POST { action: 'list', customer_id }
//   Authorization: Bearer <coach Supabase session JWT>
//
// Auth mirrors every other coach-facing endpoint (teamshop-context.js,
// teamshop-checkout.js, teamshop-art.js): verifyCoach + coachHasCustomerAccess
// from ./_coachAuth, so a coach can only ever list orders for a customer they
// are actually linked to — never trusted from the request body alone.
//
// Read-only. Every read uses the service role (this function never grants the
// browser direct table access), and the response is a hand-picked field set —
// no ship_address, buyer_email/phone, stripe_pi_id, quote_hash, po file paths,
// or production_notes ever leave this function. Money reporting, checkout,
// and the tokenless /shop/order/<status_token> tracker (webstore-checkout.js
// trackOrder) are UNTOUCHED — this is an additive, parallel read.
//
// Production stage (only meaningful once the order has converted to a Sales
// Order — migration 00192's so_id): fetches that SO's so_jobs (00188's
// prod_status vocabulary: hold|staging|in_process|completed) and summarizes
// the WHOLE order with the least-advanced-first rule production already uses
// elsewhere (OrderTrack's `reached = min(...)`):
//   any webstore_shipments row for the order  -> 'shipped'   (ships last, wins)
//   every job prod_status === 'completed'     -> 'decorated'
//   any job prod_status === 'in_process'      -> 'in production'
//   any job prod_status === 'staging'         -> 'queued'
//   otherwise (all 'hold', or no jobs yet)    -> 'received'
const { corsHeaders, getSupabaseAdmin } = require('./_shared');
const { verifyCoach, coachHasCustomerAccess } = require('./_coachAuth');

const bad = (status, error) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify({ error }) });
const ok = (body) => ({ statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) });

// Pure — exported for tests. jobs = the so_jobs rows for ONE so_id (any shape
// with a prod_status field); hasShipment = whether any webstore_shipments row
// exists for the order.
function summarizeProdStage(jobs, hasShipment) {
  if (hasShipment) return 'shipped';
  const list = Array.isArray(jobs) ? jobs : [];
  if (!list.length) return 'received';
  if (list.every((j) => j && j.prod_status === 'completed')) return 'decorated';
  if (list.some((j) => j && j.prod_status === 'in_process')) return 'in production';
  if (list.some((j) => j && j.prod_status === 'staging')) return 'queued';
  return 'received';
}

async function listOrders(admin, body, coach) {
  const customerId = String(body.customer_id || '').trim();
  if (!customerId) return bad(400, 'customer_id required');
  const acc = await coachHasCustomerAccess(admin, coach, customerId);
  if (acc.error) return bad(500, acc.error);
  if (!acc.ok) return bad(403, 'Not authorized for this customer');

  const { data: orderRows, error: oErr } = await admin.from('webstore_orders')
    .select('id,created_at,status,total,buyer_name,status_token,so_id,customer_id,order_source')
    .eq('order_source', 'teamshop')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (oErr) return bad(500, oErr.message);
  const orders = orderRows || [];
  if (!orders.length) return ok({ ok: true, orders: [] });

  const orderIds = orders.map((o) => o.id);
  const soIds = [...new Set(orders.map((o) => o.so_id).filter(Boolean))];

  const [itemsRes, shipRes, jobsRes] = await Promise.all([
    admin.from('webstore_order_items')
      .select('order_id,product_id,sku,name,qty,size,image_url')
      .in('order_id', orderIds),
    admin.from('webstore_shipments').select('order_id').in('order_id', orderIds),
    soIds.length
      ? admin.from('so_jobs').select('so_id,prod_status').in('so_id', soIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (itemsRes.error) return bad(500, itemsRes.error.message);
  if (shipRes.error) return bad(500, shipRes.error.message);
  if (jobsRes.error) return bad(500, jobsRes.error.message);

  const itemsByOrder = {};
  (itemsRes.data || []).forEach((i) => {
    const list = itemsByOrder[i.order_id] || (itemsByOrder[i.order_id] = []);
    list.push({
      product_id: i.product_id || null,
      sku: i.sku || '',
      name: i.name || '',
      qty: i.qty || 1,
      size: i.size || '',
      image_url: i.image_url || null,
    });
  });

  const shippedOrderIds = new Set((shipRes.data || []).map((s) => s.order_id));

  const jobsBySo = {};
  (jobsRes.data || []).forEach((j) => {
    const list = jobsBySo[j.so_id] || (jobsBySo[j.so_id] = []);
    list.push(j);
  });

  const out = orders.map((o) => {
    const production = o.so_id
      ? { stage: summarizeProdStage(jobsBySo[o.so_id], shippedOrderIds.has(o.id)) }
      : null;
    return {
      id: o.id,
      created_at: o.created_at,
      status: o.status,
      total: o.total,
      buyer_name: o.buyer_name || '',
      status_token: o.status_token,
      so_id: o.so_id || null,
      items: itemsByOrder[o.id] || [],
      production,
    };
  });

  return ok({ ok: true, orders: out });
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return bad(405, 'Method not allowed');
  try {
    let admin;
    try { admin = getSupabaseAdmin(); } catch (e) { return bad(500, 'Service not configured'); }

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }

    const v = await verifyCoach(admin, event);
    if (!v.coach) return bad(v.status, v.error);

    if (body.action === 'list') return await listOrders(admin, body, v.coach);
    return bad(400, 'Unknown action.');
  } catch (e) {
    console.error('[teamshop-orders] error:', e);
    return bad(500, e.message || 'Could not load orders');
  }
};

// ── Test surface ─────────────────────────────────────────────────────
module.exports.listOrders = listOrders;
module.exports.summarizeProdStage = summarizeProdStage;
