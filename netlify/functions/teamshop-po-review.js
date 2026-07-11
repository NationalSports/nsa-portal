// Staff Team Shop School-PO verification (follow-up to place_order_po in
// teamshop-checkout.js). STAFF-ONLY: every action gates on _shared's
// verifyUser (bearer token -> active team_members row — the same staff auth
// team-list/team-invite use); coaches and anon callers get 401/403.
//
// Actions (POST, Authorization: Bearer <staff Supabase session JWT>):
//   list    — pending PO orders (order_source='teamshop', status='unpaid',
//             po_number present) with customer/coach names and a SHORT-LIVED
//             signed URL for each PO PDF (private po-docs bucket, 00201 —
//             the service role mints the URL; nobody reads the bucket
//             directly). Pre-00201 (po_number column missing) this returns
//             { ok:true, enabled:false } so the queue UI shows a banner
//             instead of blanking.
//   approve — flip 'unpaid' -> 'po_verified' (the exact status 00199's
//             create_teamshop_sales_order accepts and invoices OPEN), then
//             invoke that RPC — the same conversion path card orders take,
//             which sets status 'batched' + so_id in its own transaction.
//             Guarded + replay-safe: a converted order (so_id set) replays,
//             an order already 'po_verified' (earlier approve whose RPC leg
//             failed) retries the RPC only, anything else is a 409.
//   reject  — terminal: 'unpaid' -> 'cancelled' with the staff reason
//             recorded (po_rejected_reason — always persisted), then a
//             best-effort rejection email to the coach through Brevo (the
//             repo's existing outbound email mechanism, see _webstoreEmail's
//             sendOrderConfirmation) — a missing key or send failure never
//             fails the rejection.
//
// Status lifecycle (documented in 00201): unpaid -> po_verified -> batched,
// or unpaid -> cancelled. All transitions here are compare-and-set updates
// (.eq('status', ...)) so two staff tabs can't double-approve or
// approve-after-reject.
const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');

const bad = (status, error, extra) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify({ error, ...(extra || {}) }) });
const ok = (body) => ({ statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) });

const SIGNED_URL_SECONDS = 600; // 10 minutes — review-session length, not a share link
const REASON_MAX = 500;

// Pre-00201: the po columns don't exist yet (42703 / PostgREST schema-cache
// miss). Same detection shape the Team Shop settings UI uses.
const isMissingPoColumnErr = (e) => !!e
  && /po_number|po_doc_path|po_rejected_reason|po_reviewed/.test(e.message || '')
  && /(column|schema)/i.test(e.message || '');

// ── list ─────────────────────────────────────────────────────────────
async function listPending(admin) {
  const { data: orders, error } = await admin.from('webstore_orders')
    .select('id,order_number,created_at,status,total,buyer_name,buyer_email,po_number,po_doc_path,customer_id,coach_id')
    .eq('order_source', 'teamshop')
    .eq('status', 'unpaid')
    .not('po_number', 'is', null)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) {
    if (isMissingPoColumnErr(error)) return ok({ ok: true, enabled: false, orders: [] });
    return bad(500, error.message);
  }
  const rows = orders || [];

  const custIds = [...new Set(rows.map((o) => o.customer_id).filter(Boolean))];
  const coachIds = [...new Set(rows.map((o) => o.coach_id).filter(Boolean))];
  const [custRes, coachRes] = await Promise.all([
    custIds.length ? admin.from('customers').select('id,name').in('id', custIds) : Promise.resolve({ data: [], error: null }),
    coachIds.length ? admin.from('coach_accounts').select('id,name,email').in('id', coachIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const custName = {}; (custRes.data || []).forEach((c) => { custName[c.id] = c.name || ''; });
  const coachName = {}; (coachRes.data || []).forEach((c) => { coachName[c.id] = c.name || c.email || ''; });

  const out = [];
  for (const o of rows) {
    let pdfUrl = null;
    if (o.po_doc_path) {
      // Best-effort per order — a single bad path must not hide the queue.
      const { data: signed } = await admin.storage.from('po-docs').createSignedUrl(o.po_doc_path, SIGNED_URL_SECONDS);
      pdfUrl = (signed && signed.signedUrl) || null;
    }
    out.push({
      id: o.id,
      order_number: o.order_number || null,
      created_at: o.created_at,
      total: o.total,
      customer_name: custName[o.customer_id] || '',
      coach_name: coachName[o.coach_id] || o.buyer_name || '',
      buyer_email: o.buyer_email || '',
      po_number: o.po_number,
      pdf_url: pdfUrl,
    });
  }
  return ok({ ok: true, enabled: true, orders: out });
}

// ── approve ──────────────────────────────────────────────────────────
async function approve(admin, body, staff) {
  const orderId = String(body.order_id || '').trim();
  if (!orderId) return bad(400, 'order_id required');
  const { data, error } = await admin.from('webstore_orders')
    .select('id,status,order_source,so_id,po_number').eq('id', orderId).limit(1);
  if (error) return bad(500, error.message);
  const order = data && data[0];
  if (!order) return bad(404, 'Order not found');
  if (order.order_source !== 'teamshop') return bad(409, 'Not a Team Shop order.');
  if (order.so_id) return ok({ ok: true, so_id: order.so_id, replayed: true });
  if (!order.po_number) return bad(409, 'This order was not placed with a PO.');

  if (order.status === 'unpaid') {
    // Compare-and-set: only an order still awaiting review may advance. Zero
    // rows updated = someone else approved/rejected first — re-read and 409.
    const { data: upd, error: updErr } = await admin.from('webstore_orders')
      .update({ status: 'po_verified', po_reviewed_by: staff.teamMemberId || null, po_reviewed_at: new Date().toISOString() })
      .eq('id', orderId).eq('status', 'unpaid').select('id');
    if (updErr) return bad(500, updErr.message);
    if (!upd || !upd.length) return bad(409, 'Order was already reviewed by someone else — refresh the list.');
  } else if (order.status !== 'po_verified') {
    // po_verified = an earlier approve whose conversion leg failed; retry the
    // RPC below. Anything else (cancelled, batched without so_id, …) is stale.
    return bad(409, `Order is not awaiting PO review (status: ${order.status}).`);
  }

  // Same conversion path card orders take (00196/00199): SO + jobs + an OPEN
  // invoice (the RPC's po_verified branch), status -> 'batched'. Idempotent by
  // RPC design. On failure the order stays 'po_verified' — approve can simply
  // be retried; nothing is lost.
  const rpc = await admin.rpc('create_teamshop_sales_order', { p_webstore_order_id: orderId });
  if (rpc.error) {
    console.error('[teamshop-po-review] convert after approve failed:', rpc.error.message);
    return bad(502, 'PO approved, but creating the production order failed — retry approve: ' + rpc.error.message);
  }
  // Best-effort auto-PO generation (Phase 3, 00202): School-PO orders convert
  // here instead of convert_order/stripe-webhook. Idempotent; a failure never
  // fails the approval (staff can sweep from the Auto POs tab).
  if (rpc.data && rpc.data.so_id) {
    await require('./teamshop-auto-po').generateForSoSafe(admin, rpc.data.so_id, 'po-review-approve', 'teamshop-po-review');
  }
  return ok({ ok: true, ...(rpc.data || {}) });
}

// ── reject ───────────────────────────────────────────────────────────
// Best-effort coach notification through Brevo — the repo's one outbound
// email mechanism (_webstoreEmail.js uses the same endpoint/key). The reason
// is ALWAYS recorded on the order first; a missing key or failed send only
// flips `emailed` in the response.
async function sendRejectionEmail(order, reason) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey || !order.buyer_email) return false;
  const num = order.order_number || String(order.id || '').slice(0, 8);
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#2A2F3E;max-width:560px;margin:0 auto">
    <h2 style="font-size:18px">Your Team Shop PO order #${esc(num)} could not be verified</h2>
    <p>Hi ${esc(order.buyer_name || '')},</p>
    <p>We reviewed the purchase order (PO #${esc(order.po_number || '')}) submitted with your National Team Shop order, and we weren't able to verify it, so the order has been cancelled.</p>
    <p style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px"><b>Reason:</b> ${esc(reason)}</p>
    <p>No payment was collected. If this is a mistake or you have an updated PO, reply to your rep or place the order again with the corrected PO.</p>
  </div>`;
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify({
        sender: { name: 'National Team Shop', email: 'noreply@nationalsportsapparel.com' },
        to: [{ email: order.buyer_email, name: order.buyer_name || '' }],
        subject: `Team Shop order #${num} — PO could not be verified`,
        htmlContent: html,
      }),
    });
    return res.ok;
  } catch (e) {
    console.warn('[teamshop-po-review] rejection email failed:', e.message);
    return false;
  }
}

async function reject(admin, body, staff) {
  const orderId = String(body.order_id || '').trim();
  if (!orderId) return bad(400, 'order_id required');
  const reason = String(body.reason || '').trim().slice(0, REASON_MAX);
  if (!reason) return bad(400, 'A rejection reason is required.');

  const { data, error } = await admin.from('webstore_orders')
    .select('id,status,order_source,so_id,po_number,order_number,buyer_name,buyer_email').eq('id', orderId).limit(1);
  if (error) return bad(500, error.message);
  const order = data && data[0];
  if (!order) return bad(404, 'Order not found');
  if (order.order_source !== 'teamshop') return bad(409, 'Not a Team Shop order.');
  if (order.so_id) return bad(409, 'Order already converted to a Sales Order — it can no longer be rejected here.');
  if (order.status !== 'unpaid') return bad(409, `Order is not awaiting PO review (status: ${order.status}).`);

  // Terminal, compare-and-set. 'cancelled' is the stack's existing terminal
  // value: 00199 refuses to convert it and the coach label map shows Cancelled.
  const { data: upd, error: updErr } = await admin.from('webstore_orders')
    .update({
      status: 'cancelled',
      po_rejected_reason: reason,
      po_reviewed_by: staff.teamMemberId || null,
      po_reviewed_at: new Date().toISOString(),
    })
    .eq('id', orderId).eq('status', 'unpaid').select('id');
  if (updErr) return bad(500, updErr.message);
  if (!upd || !upd.length) return bad(409, 'Order was already reviewed by someone else — refresh the list.');

  const emailed = await sendRejectionEmail(order, reason);
  return ok({ ok: true, emailed });
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

    if (body.action === 'list') return await listPending(admin);
    if (body.action === 'approve') return await approve(admin, body, staff);
    if (body.action === 'reject') return await reject(admin, body, staff);
    return bad(400, 'Unknown action.');
  } catch (e) {
    console.error('[teamshop-po-review] error:', e);
    return bad(500, e.message || 'PO review failed');
  }
};

// ── Test surface ─────────────────────────────────────────────────────
// Exported only for src/__tests__/teamshopPoReview.test.js (same pattern as
// teamshop-checkout.js). Netlify invokes `handler`.
module.exports.listPending = listPending;
module.exports.approve = approve;
module.exports.reject = reject;
