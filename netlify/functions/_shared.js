// Shared helpers for team-list / team-invite / team-deactivate functions.
// Holds CORS boilerplate + admin verification using the user's JWT.
const { createClient } = require('@supabase/supabase-js');

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

function getSupabaseAdmin() {
  const url = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials missing');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function getSiteUrl(event) {
  if (process.env.URL) return process.env.URL;
  const host = event.headers?.host || event.headers?.Host;
  return host ? `https://${host}` : '';
}

// ── Token-verification cache ────────────────────────────────────────────────
// Verifying a caller costs a GoTrue network round-trip (admin.auth.getUser) plus a
// team_members query — PER function invocation. Portal pollers (e.g. the email-open
// checker) hit these endpoints many times a minute from every open tab, so the auth
// server absorbs the multiplied traffic: the same unbounded-repeat shape that caused
// the save_estimate DB storms. Caching a token only AFTER it fully verifies makes
// repeats free while this Netlify container stays warm, keeping GoTrue and the DB out
// of the blast radius of any client loop. TTL is far under the ~1h JWT lifetime the
// rest of the stack already honors (PostgREST accepts a JWT until exp regardless of
// session state), so this adds no new exposure; a deactivation/role change is picked
// up within the TTL. Failures are never cached. Size-capped, oldest-first eviction.
const VERIFY_TTL_MS = 2 * 60 * 1000;
const VERIFY_CACHE_MAX = 500;
const _verifyCache = new Map(); // token -> { at, id: {userId, teamMemberId, role} }

function _verifyCacheGet(token) {
  const hit = _verifyCache.get(token);
  if (!hit) return null;
  if (Date.now() - hit.at > VERIFY_TTL_MS) { _verifyCache.delete(token); return null; }
  return hit.id;
}

function _verifyCachePut(token, id) {
  if (_verifyCache.size >= VERIFY_CACHE_MAX) {
    let drop = _verifyCache.size - VERIFY_CACHE_MAX + 1;
    for (const k of _verifyCache.keys()) { _verifyCache.delete(k); if (--drop <= 0) break; }
  }
  _verifyCache.set(token, { at: Date.now(), id });
}

// Shared core: resolve the bearer token to an ACTIVE team member (cached), or an error.
// `inactiveMsg` preserves the historical per-endpoint wording.
async function _verifyTeamMember(event, inactiveMsg) {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth || !auth.startsWith('Bearer ')) return { ok: false, status: 401, error: 'Missing bearer token' };
  const token = auth.substring(7);

  const admin = getSupabaseAdmin();
  const cached = _verifyCacheGet(token);
  if (cached) return { ok: true, ...cached, admin };

  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData?.user) return { ok: false, status: 401, error: 'Invalid token' };

  const { data: tm, error: tmErr } = await admin
    .from('team_members')
    .select('id, role, is_active')
    .eq('auth_id', userData.user.id)
    .maybeSingle();
  if (tmErr) return { ok: false, status: 500, error: tmErr.message };
  if (!tm || tm.is_active === false) return { ok: false, status: 403, error: inactiveMsg };

  const id = { userId: userData.user.id, teamMemberId: tm.id, role: tm.role };
  _verifyCachePut(token, id);
  return { ok: true, ...id, admin };
}

// Verify caller is signed in and has an admin (or super_admin) team_members row.
async function verifyAdmin(event) {
  const res = await _verifyTeamMember(event, 'Inactive account');
  if (!res.ok) return res;
  if (res.role !== 'admin' && res.role !== 'super_admin') return { ok: false, status: 403, error: 'Admin role required' };
  return { ok: true, userId: res.userId, teamMemberId: res.teamMemberId, admin: res.admin };
}

// Verify caller is any signed-in, active team member (no role requirement).
// Used to gate staff-only endpoints that previously accepted unauthenticated calls.
async function verifyUser(event) {
  return _verifyTeamMember(event, 'Inactive or unknown account');
}

// Verify the caller is EITHER an active team member (a staff browser session) OR a
// trusted internal Netlify function presenting the shared internal secret. The
// vendor proxies are normally staff-only, but a couple of server-side jobs (e.g.
// sanmar-nike-sync-background) reuse a credentialed proxy over HTTP and have no
// user JWT — they authenticate with the secret instead. The secret is a
// server-only env var (never shipped to the browser); we accept a dedicated
// INTERNAL_FUNCTION_SECRET or fall back to the service-role key that both
// functions already share, so the existing sync keeps working with no new config.
async function verifyUserOrInternal(event) {
  const provided = event.headers?.['x-internal-secret'] || event.headers?.['X-Internal-Secret'];
  const expected = process.env.INTERNAL_FUNCTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (provided && expected && provided === expected) return { ok: true, internal: true };
  return verifyUser(event);
}

// Mark the invoice(s) referenced by a succeeded Stripe PaymentIntent's metadata as paid, using the
// service role. This is the reliable reconciliation path for coach-portal payments: the portal is
// anonymous and RLS-blocks it from writing `invoices`, and the Stripe webhook can't be relied on as
// the sole mechanism (it depends on dashboard config that may be absent). Shared by stripe-payment's
// `finalize_invoice` action (called by the portal right after payment) and the stripe-webhook backstop.
// Idempotent: invoices already paid / with no open balance are skipped, so repeated calls (portal +
// webhook, or Stripe retries) can't double-apply the surcharge. The surcharge actually collected
// (amount captured − open balance) is folded into the total, mirroring the in-app payment handler.
async function reconcileInvoiceFromIntent(admin, pi) {
  const ids = String((pi && pi.metadata && pi.metadata.invoice_id) || '')
    .split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return { reconciled: [] };
  const { data: rows, error } = await admin.from('invoices').select('id,total,paid,cc_fee,status').in('id', ids);
  if (error) { console.error('[reconcileInvoice] lookup failed:', error.message); return { reconciled: [], error: error.message }; }
  if (!rows || !rows.length) return { reconciled: [] };
  // Only invoices that still owe money — this is what makes the call idempotent.
  const targets = rows.filter((r) => r.status !== 'paid' && (Number(r.total) || 0) - (Number(r.paid) || 0) > 0.005);
  const balTotal = targets.reduce((a, r) => a + ((Number(r.total) || 0) - (Number(r.paid) || 0)), 0);
  const collected = (pi.amount_received != null ? pi.amount_received : (pi.amount || 0)) / 100;
  // SECURITY: never settle an invoice for less than its open balance. This function sets
  // paid = total for every target, so without this guard ANY succeeded PaymentIntent —
  // including a $0.50 underpayment — would mark a large invoice fully paid. Legitimate portal
  // payments always capture the full balance (plus the card surcharge), so this only rejects
  // genuine underpayments; the 1-cent tolerance absorbs rounding. Captured funds remain in
  // Stripe (visible in the dashboard) for manual handling.
  if (targets.length && collected + 0.01 < balTotal) {
    console.error('[reconcileInvoice] underpayment ignored for intent', pi.id,
      '— captured', collected, 'vs open balance', balTotal,
      '; left open:', targets.map((r) => r.id).join(','));
    return { reconciled: [], underpaid: true, collected, balanceDue: balTotal };
  }
  const feeTotal = Math.max(0, Math.round((collected - balTotal) * 100) / 100);
  const nowIso = new Date().toISOString();
  const payDate = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const reconciled = [];
  for (const r of targets) {
    const bal = (Number(r.total) || 0) - (Number(r.paid) || 0);
    const fee = balTotal > 0 ? Math.round(feeTotal * (bal / balTotal) * 100) / 100 : 0;
    const newTotal = Math.round(((Number(r.total) || 0) + fee) * 100) / 100;
    const { error: updErr } = await admin.from('invoices')
      .update({ total: newTotal, paid: newTotal, cc_fee: Math.round(((Number(r.cc_fee) || 0) + fee) * 100) / 100, status: 'paid', updated_at: nowIso })
      .eq('id', r.id).neq('status', 'paid'); // guard against a racing reconcile
    if (updErr) { console.error('[reconcileInvoice] update failed for', r.id, ':', updErr.message); continue; }
    // Best-effort audit row. invoice_payments has no cc_fee column, so it's omitted. Same ref format
    // the app uses ('Stripe <intentId>') so its payment-preservation logic dedupes instead of duplicating.
    try {
      const ref = 'Stripe ' + pi.id;
      const { data: existing } = await admin.from('invoice_payments').select('id').eq('invoice_id', r.id).eq('ref', ref).limit(1);
      if (!existing || !existing.length) {
        await admin.from('invoice_payments').insert({ invoice_id: r.id, amount: Math.round((bal + fee) * 100) / 100, method: 'cc', ref, date: payDate });
      }
    } catch (e) { /* audit row is best-effort */ }
    reconciled.push(r.id);
  }
  return { reconciled };
}

// Sync an order's webstore_order_items to `lineItems` WITHOUT destroying fulfillment state.
// Existing rows are matched by (sku, size) and updated in place, so each row's id and its
// fulfillment columns (shipped_qty, missing_qty, line_status) survive. The id matters because
// webstore_shipments references it (items[].lineItemKey) to reconcile partial shipments — a
// blind delete + reinsert minted new ids and reset fulfillment to defaults on every re-ingest,
// permanently orphaning shipment links and discarding received/shipped counts. New lines are
// inserted; lines no longer present are removed ONLY when they carry no fulfillment progress,
// so a shipment link is never orphaned. `contentKeys` are the columns copied from each lineItem
// onto a matched row (must exclude the fulfillment columns). Each lineItem must include `sku`
// and `size` (the match key) plus the columns needed to insert a brand-new row.
async function syncOrderItems(sb, orderId, lineItems, contentKeys) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const key = (o) => `${String(o.sku || '').toUpperCase()}|${String(o.size || '')}`;
  const { data: existingItems, error } = await sb.from('webstore_order_items')
    .select('id,sku,size,shipped_qty,missing_qty,line_status').eq('order_id', orderId);
  if (error) {
    // Can't read current items — fall back to the historical replace so we never risk
    // double-inserting. Worst case this reverts to the old behavior, not data corruption.
    console.warn('[syncOrderItems] item read failed, falling back to replace:', error.message);
    await sb.from('webstore_order_items').delete().eq('order_id', orderId);
    if (items.length) {
      const { error: iErr } = await sb.from('webstore_order_items')
        .insert(items.map((li) => ({ ...li, order_id: orderId })));
      if (iErr) throw new Error(`Items insert failed: ${iErr.message}`);
    }
    return { matched: 0, inserted: items.length, removed: 0, fallback: true };
  }
  // Bucket existing rows by (sku,size); a queue tolerates the rare duplicate line.
  const queues = new Map();
  for (const it of (existingItems || [])) {
    const k = key(it);
    if (!queues.has(k)) queues.set(k, []);
    queues.get(k).push(it);
  }
  let matched = 0;
  const toInsert = [];
  for (const li of items) {
    const q = queues.get(key(li));
    const hit = (q && q.length) ? q.shift() : null;
    if (hit) {
      const patch = {};
      for (const c of contentKeys) patch[c] = li[c];
      const { error: uErr } = await sb.from('webstore_order_items').update(patch).eq('id', hit.id);
      if (uErr) throw new Error(`Item update failed: ${uErr.message}`);
      matched++;
    } else {
      toInsert.push({ ...li, order_id: orderId });
    }
  }
  if (toInsert.length) {
    const { error: iErr } = await sb.from('webstore_order_items').insert(toInsert);
    if (iErr) throw new Error(`Items insert failed: ${iErr.message}`);
  }
  // Leftover existing rows = lines no longer in the source. Drop only those with no
  // fulfillment progress so we never orphan a shipment link or lose shipped/received counts.
  const stale = [];
  for (const q of queues.values()) {
    for (const it of q) {
      const active = (Number(it.shipped_qty) || 0) > 0
        || (Number(it.missing_qty) || 0) > 0
        || (it.line_status && it.line_status !== 'pending');
      if (!active) stale.push(it.id);
    }
  }
  if (stale.length) {
    const { error: dErr } = await sb.from('webstore_order_items').delete().in('id', stale);
    if (dErr) throw new Error(`Stale item cleanup failed: ${dErr.message}`);
  }
  return { matched, inserted: toInsert.length, removed: stale.length };
}

module.exports = { corsHeaders, getSupabaseAdmin, getSiteUrl, verifyAdmin, verifyUser, verifyUserOrInternal, reconcileInvoiceFromIntent, syncOrderItems };
