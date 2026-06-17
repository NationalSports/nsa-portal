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

// Verify caller is signed in and has an admin (or super_admin) team_members row.
async function verifyAdmin(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth || !auth.startsWith('Bearer ')) return { ok: false, status: 401, error: 'Missing bearer token' };
  const token = auth.substring(7);

  const admin = getSupabaseAdmin();
  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData?.user) return { ok: false, status: 401, error: 'Invalid token' };

  const { data: tm, error: tmErr } = await admin
    .from('team_members')
    .select('id, role, is_active')
    .eq('auth_id', userData.user.id)
    .maybeSingle();
  if (tmErr) return { ok: false, status: 500, error: tmErr.message };
  if (!tm || tm.is_active === false) return { ok: false, status: 403, error: 'Inactive account' };
  if (tm.role !== 'admin' && tm.role !== 'super_admin') return { ok: false, status: 403, error: 'Admin role required' };

  return { ok: true, userId: userData.user.id, teamMemberId: tm.id, admin };
}

// Verify caller is any signed-in, active team member (no role requirement).
// Used to gate staff-only endpoints that previously accepted unauthenticated calls.
async function verifyUser(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth || !auth.startsWith('Bearer ')) return { ok: false, status: 401, error: 'Missing bearer token' };
  const token = auth.substring(7);

  const admin = getSupabaseAdmin();
  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData?.user) return { ok: false, status: 401, error: 'Invalid token' };

  const { data: tm, error: tmErr } = await admin
    .from('team_members')
    .select('id, role, is_active')
    .eq('auth_id', userData.user.id)
    .maybeSingle();
  if (tmErr) return { ok: false, status: 500, error: tmErr.message };
  if (!tm || tm.is_active === false) return { ok: false, status: 403, error: 'Inactive or unknown account' };

  return { ok: true, userId: userData.user.id, teamMemberId: tm.id, role: tm.role, admin };
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

module.exports = { corsHeaders, getSupabaseAdmin, getSiteUrl, verifyAdmin, verifyUser, reconcileInvoiceFromIntent };
