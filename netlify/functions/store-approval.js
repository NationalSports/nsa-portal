// Store approval — staff control surface for the store-approval gate (Phase 1 of
// PUBLIC_STORE_BUILDER_PLAN_2026-07-16.md; schema + triggers in
// supabase/migrations/00196_store_approval_gate.sql).
//
// The DB triggers already make it structurally impossible for an order on a
// pending_review/rejected store to reach production (sales_orders / so_jobs BEFORE
// triggers raise NSA_STORE_UNAPPROVED:<status>). This endpoint is the human side: it lists
// stores waiting on the 24h review, and flips approval_status via the two decisions staff
// can make.
//
// State machine is intentionally ONE-WAY out of pending_review:
//   pending_review -> approved   (action: approve)
//   pending_review -> rejected   (action: reject, also closes the store)
// Re-deciding an already-decided store (rejected -> approved, or approved -> rejected) is
// refused here (400, naming the current status) rather than silently flipped — a wrong
// call gets fixed by a direct staff DB edit for now, not by re-POSTing this endpoint.
// Deciding the SAME way twice (approve an already-approved store, reject an
// already-rejected one) is an idempotent no-op instead of an error, since a retried
// click / double-submit is expected client behavior, not a mistake to flag.
//
// Reject only records the decision + closes the store (status='closed') so it stops
// selling. It deliberately does NOT refund captured orders already sitting on it — that's
// Phase 3 (see PUBLIC_STORE_BUILDER_PLAN_2026-07-16.md "Payment flow" / "Reject" note:
// "reuse webstore_order_refunds + the refund txn"). TODO(Phase 3): wire that refund here;
// until then, a rejected store can be holding captured money that needs a manual refund.
const { verifyUser, getSupabaseAdmin } = require('./_shared');

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();

const VALID_ACTIONS = new Set(['list', 'approve', 'reject']);

// Statuses that count as a "held" order for the review queue's per-store stats: captured
// money (paid) or a verified PO (po_verified) sitting on a store that can't yet convert to
// a sales_order — the 00196 trigger blocks that at the webstore_id itself, so these rows
// just sit with so_id null until the store is approved and something batches them.
const HELD_ORDER_STATUSES = ['paid', 'po_verified'];

// ── Pure request validation — no DB, no auth ────────────────────────────────────────
// Returns null when the request shape is fine to proceed, or { status, error } to return
// immediately. Kept separate from the state machine below so "is this a well-formed
// request" and "is this transition allowed right now" are independently testable.
function validateRequest(action, storeId, reason) {
  if (!VALID_ACTIONS.has(action)) return { status: 400, error: `Unknown action "${action}"` };
  if (action === 'list') return null;
  if (!str(storeId)) return { status: 400, error: 'store_id is required' };
  if (action === 'reject' && !str(reason)) return { status: 400, error: 'reason is required' };
  return null;
}

function blockedMsg(action, currentStatus) {
  return `Cannot ${action} — store approval_status is "${currentStatus}", not pending_review ` +
    '(the state machine only moves one-way out of pending_review; a wrong decision must be ' +
    'fixed directly in the DB for now)';
}

// ── Pure state machine ──────────────────────────────────────────────────────────────
// Given the store's CURRENT approval_status + the requested decision, decide the outcome.
// No DB access — reviewer/nowIso/reason are passed in so this stays fully deterministic
// and unit-testable. Returns one of:
//   { ok:true, already:true }   — already in the requested end state; idempotent no-op
//   { ok:true, patch }          — the webstores row patch to apply
//   { ok:false, status, error } — blocked (wrong starting state); 400, names the status
function planTransition({ action, currentStatus, reviewer, nowIso, reason }) {
  if (action === 'approve') {
    if (currentStatus === 'approved') return { ok: true, already: true };
    if (currentStatus !== 'pending_review') {
      return { ok: false, status: 400, error: blockedMsg('approve', currentStatus) };
    }
    return { ok: true, patch: { approval_status: 'approved', approved_by: reviewer, approved_at: nowIso } };
  }

  if (action === 'reject') {
    if (currentStatus === 'rejected') return { ok: true, already: true };
    if (currentStatus !== 'pending_review') {
      return { ok: false, status: 400, error: blockedMsg('reject', currentStatus) };
    }
    return {
      ok: true,
      patch: {
        approval_status: 'rejected',
        rejected_reason: str(reason),
        approved_by: reviewer,
        approved_at: nowIso,
        // Stops the store from selling. Refunding orders already captured on it is Phase 3
        // — deliberately NOT done here. See the file-header TODO.
        status: 'closed',
      },
    };
  }

  return { ok: false, status: 400, error: `Unknown action "${action}"` };
}

// ── Pure response shaping ────────────────────────────────────────────────────────────
// webstore_orders rows held on a pending store (so_id null, status paid/po_verified),
// grouped by store_id -> { count, sum }. Sum rounded to cents (same rounding convention as
// reconcileInvoiceFromIntent in _shared.js) so float drift never leaks into the response.
function aggregateHeldOrders(rows) {
  const out = {};
  for (const r of (rows || [])) {
    const sid = r.store_id;
    if (!sid) continue;
    if (!out[sid]) out[sid] = { count: 0, sum: 0 };
    out[sid].count += 1;
    out[sid].sum += Number(r.total) || 0;
  }
  for (const sid of Object.keys(out)) out[sid].sum = Math.round(out[sid].sum * 100) / 100;
  return out;
}

// Shape one pending store for the review-queue list, folding in its held-order stats.
function shapeListRow(store, heldByStore) {
  const held = (heldByStore && heldByStore[store.id]) || { count: 0, sum: 0 };
  return {
    id: store.id,
    slug: store.slug,
    name: store.name,
    customer_id: store.customer_id,
    created_at: store.created_at,
    approval_deadline: store.approval_deadline,
    created_via: store.created_via,
    held_orders: { count: held.count, sum: held.sum },
  };
}

// Shape the updated row returned from an approve/reject decision.
function shapeDecisionStore(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    approval_status: row.approval_status,
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    rejected_reason: row.rejected_reason,
  };
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };

  const auth = await verifyUser(event);
  if (!auth.ok) return { statusCode: auth.status || 401, headers, body: JSON.stringify({ ok: false, error: auth.error || 'Not authorized' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const action = str(body.action);
  const storeId = str(body.store_id);
  const reason = str(body.reason);

  const invalid = validateRequest(action, storeId, reason);
  if (invalid) return { statusCode: invalid.status, headers, body: JSON.stringify({ ok: false, error: invalid.error }) };

  const admin = getSupabaseAdmin();

  try {
    if (action === 'list') {
      const { data: stores, error: listErr } = await admin
        .from('webstores')
        .select('id, slug, name, customer_id, created_at, approval_deadline, created_via')
        .eq('approval_status', 'pending_review')
        .order('approval_deadline', { ascending: true, nullsFirst: false });
      if (listErr) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: listErr.message }) };

      const ids = (stores || []).map((s) => s.id);
      let heldByStore = {};
      if (ids.length) {
        const { data: heldRows, error: heldErr } = await admin
          .from('webstore_orders')
          .select('store_id, total')
          .in('store_id', ids)
          .is('so_id', null)
          .in('status', HELD_ORDER_STATUSES);
        if (heldErr) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: heldErr.message }) };
        heldByStore = aggregateHeldOrders(heldRows);
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, stores: (stores || []).map((s) => shapeListRow(s, heldByStore)) }) };
    }

    // approve / reject share the same lookup + state-machine + patch shape.
    const { data: store, error: findErr } = await admin
      .from('webstores')
      .select('id, slug, name, status, approval_status')
      .eq('id', storeId)
      .maybeSingle();
    if (findErr) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: findErr.message }) };
    if (!store) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'store_id not found' }) };

    const plan = planTransition({
      action,
      currentStatus: store.approval_status,
      reviewer: String(auth.teamMemberId || ''),
      nowIso: new Date().toISOString(),
      reason,
    });

    if (!plan.ok) return { statusCode: plan.status, headers, body: JSON.stringify({ ok: false, error: plan.error }) };
    if (plan.already) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, already: true }) };

    // Compare-and-set: the update only lands if the store is STILL pending_review, so two
    // staff racing opposite decisions can't silently overwrite each other — the loser gets
    // a 409 naming what happened instead of a wrong final state.
    const { data: updated, error: updErr } = await admin
      .from('webstores')
      .update(plan.patch)
      .eq('id', storeId)
      .eq('approval_status', 'pending_review')
      .select('id, slug, name, status, approval_status, approved_by, approved_at, rejected_reason')
      .maybeSingle();
    if (updErr) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: updErr.message }) };
    if (!updated) {
      return { statusCode: 409, headers, body: JSON.stringify({ ok: false, error: 'Store was just decided by someone else — refresh the review queue' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, store: shapeDecisionStore(updated) }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message || 'Server error' }) };
  }
};

// Exposed for tests (mirrors coach-leads-sheet-sync.js / store-quick-build.js's
// _internals pattern — pure helpers only, no DB/auth in this half).
exports._internals = {
  VALID_ACTIONS, HELD_ORDER_STATUSES,
  validateRequest, planTransition, aggregateHeldOrders, shapeListRow, shapeDecisionStore,
};
