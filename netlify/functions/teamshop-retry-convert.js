// Team Shop / Club — staff manual "Retry convert" (Team Shop backend
// hardening #3). A paid (or PO-verified) webstore order can end up with
// so_id still null when its conversion RPC failed on every automatic attempt
// (teamshop-checkout's convertOrder, stripe-webhook's fallback, and — for
// School-PO orders — teamshop-po-review's approve leg). teamshop-stuck-sweep.js
// surfaces those in its "paid, never converted" check; this is the button that
// fixes one without staff needing psql/RPC-console access.
//
// STAFF-ONLY: same auth as teamshop-po-review.js — bearer staff session JWT
// via _shared.verifyUser. Single action, POST { order_id }.
//
// Re-verifies everything server-side before calling the RPC (never trusts the
// client beyond the order id):
//   * order exists, order_source is 'teamshop' or 'club'
//   * so_id is still null (already-converted replays with so_id, not an error)
//   * status is 'paid' or 'po_verified' — the only statuses either conversion
//     RPC accepts (00196/00199's po_verified branch; 00204 checks 'paid' only,
//     so 'po_verified' is a no-op-safe allowance for a club order that could
//     never actually reach it)
// Calls the RPC matching order_source (create_teamshop_sales_order /
// create_club_sales_order — different argument names, see RPC_BY_SOURCE
// below, traced from stripe-webhook.js's two conversion branches) and returns
// either the RPC's own result or its REAL error message — never a generic
// "failed" string, so staff can tell a stock/rep/data problem from a genuine
// migration-not-applied condition without checking server logs.
const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');

const bad = (status, error, extra) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify({ error, ...(extra || {}) }) });
const ok = (body) => ({ statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) });

const RPC_BY_SOURCE = { teamshop: 'create_teamshop_sales_order', club: 'create_club_sales_order' };
const RPC_ARG_BY_SOURCE = { teamshop: 'p_webstore_order_id', club: 'p_order_id' };
const RETRYABLE_STATUSES = ['paid', 'po_verified'];

async function retryConvert(admin, body) {
  const orderId = String(body.order_id || '').trim();
  if (!orderId) return bad(400, 'order_id required');

  const { data, error } = await admin.from('webstore_orders')
    .select('id,status,order_source,so_id').eq('id', orderId).limit(1);
  if (error) return bad(500, error.message);
  const order = data && data[0];
  if (!order) return bad(404, 'Order not found');
  if (!RPC_BY_SOURCE[order.order_source]) return bad(409, 'Not a Team Shop or Club order.');
  if (order.so_id) return ok({ ok: true, so_id: order.so_id, replayed: true });
  if (!RETRYABLE_STATUSES.includes(order.status)) return bad(409, `Order is not ready to convert (status: ${order.status}).`);

  const rpcName = RPC_BY_SOURCE[order.order_source];
  const argName = RPC_ARG_BY_SOURCE[order.order_source];
  const rpc = await admin.rpc(rpcName, { [argName]: order.id });
  if (rpc.error) {
    console.error(`[teamshop-retry-convert] ${rpcName} failed for ${orderId}:`, rpc.error.message);
    // The REAL error, not a generic message — this is the one place staff can
    // see exactly why an order won't convert without pulling server logs.
    return bad(502, rpc.error.message);
  }

  // Auto-PO generation mirrors every other teamshop conversion call site
  // (checkout/webhook/po-review) — teamshop only; club orders never trigger it
  // at any other call site either (traced: stripe-webhook's club branch does
  // not call generateForSoSafe), so this doesn't either.
  const soId = rpc.data && rpc.data.so_id;
  if (soId && order.order_source === 'teamshop') {
    try {
      await require('./teamshop-auto-po').generateForSoSafe(admin, soId, 'teamshop-retry-convert', 'teamshop-retry-convert');
    } catch (e) {
      console.error('[teamshop-retry-convert] auto-PO generation error:', e.message);
    }
  }
  return ok({ ok: true, ...(rpc.data || {}) });
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return bad(405, 'Method not allowed');
  try {
    const staff = await verifyUser(event);
    if (!staff.ok) return bad(staff.status, staff.error);
    const admin = staff.admin || getSupabaseAdmin();

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }

    return await retryConvert(admin, body);
  } catch (e) {
    console.error('[teamshop-retry-convert] error:', e);
    return bad(500, e.message || 'Retry convert failed');
  }
};

// ── Test surface ─────────────────────────────────────────────────────
module.exports.retryConvert = retryConvert;
