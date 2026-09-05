// Shared helpers for team-list / team-invite / team-deactivate functions.
// Holds CORS boilerplate + admin verification using the user's JWT.
const { createClient } = require('@supabase/supabase-js');
const { resolvePortalCredential } = require('./_portalAuth');
const crypto = require('crypto');

// Constant-time string compare for shared secrets (station/vendor tokens). A plain
// === short-circuits on the first differing byte, leaking the match length via
// response timing; timingSafeEqual compares in fixed time. Returns false on any
// null/length mismatch (length itself isn't secret-dependent for fixed tokens).
function safeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

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

// Resolve the current production/preview Netlify origin without trusting an
// arbitrary Host header. Runtime Functions do not receive DEPLOY_PRIME_URL, so
// preview-safe internal calls and notification links must use the validated
// request host rather than falling back blindly to the production URL.
function getTrustedSiteBaseUrl(event, env = process.env) {
  const requestHost = String(event?.headers?.host || event?.headers?.Host || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const siteName = String(env.SITE_NAME || '').trim().toLowerCase();
  let primaryUrl = null;
  try {
    if (env.URL) primaryUrl = new URL(env.URL);
  } catch (_) {
    primaryUrl = null;
  }

  let target;
  try {
    target = requestHost ? new URL(`https://${requestHost}`) : primaryUrl;
  } catch (_) {
    return '';
  }
  if (!target) return '';

  const hostname = target.hostname.toLowerCase();
  const primaryHost = primaryUrl?.hostname?.toLowerCase() || '';
  const isPrimary = !!primaryHost && hostname === primaryHost;
  const isNetlifySite = !!siteName && (
    hostname === `${siteName}.netlify.app`
    || hostname.endsWith(`--${siteName}.netlify.app`)
  );
  const isLocalDev = env.NETLIFY_DEV === 'true'
    && ['localhost', '127.0.0.1', '::1'].includes(hostname);
  if (!isPrimary && !isNetlifySite && !isLocalDev) return '';

  const protocol = isLocalDev ? 'http:' : 'https:';
  return `${protocol}//${target.host}`;
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

// QuickBooks contains company-wide financial data. Only accounting and admin
// roles may inspect connection state or perform QBO reads/writes.
async function verifyQBOUser(event) {
  const res = await _verifyTeamMember(event, 'Inactive account');
  if (!res.ok) return res;
  if (!['admin', 'super_admin', 'accounting'].includes(res.role)) {
    return { ok: false, status: 403, error: 'Accounting or admin role required' };
  }
  return { ok: true, userId: res.userId, teamMemberId: res.teamMemberId, role: res.role, admin: res.admin };
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

// Copy only allow-listed keys — the standard defense for service-role write endpoints
// (a crafted payload must not reach arbitrary columns). Shared so the allow-list callers
// (roster-write; portal-action's local copy can migrate here too) stay one implementation.
function pickCols(obj, allowed) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => { if (allowed.has(k)) out[k] = obj[k]; });
  return out;
}

// Canonical coach-portal bearer-credential resolver. It accepts new opaque
// tokens and the staged hash-only legacy credentials, then returns the same
// parent/direct-team family boundary used by every portal read and write.
async function resolveCustomerFamily(admin, credential) {
  return resolvePortalCredential(admin, credential);
}

// Resolve a roster team to the customer_id that owns it (team → session.customer_id).
// Used to scope coach-portal writes/invites that target a team by id: the team's owning
// customer must be in the caller's family, or the caller is reaching outside its portal.
// Returns { customerId } (null if the team doesn't exist) or { error } on a query failure
// (which callers must treat as a retryable 500, NOT as "not owned").
async function rosterTeamCustomerId(admin, teamId) {
  const id = String(teamId || '').trim();
  if (!id) return { customerId: null };
  const { data, error } = await admin.from('roster_teams')
    .select('roster_order_sessions!inner(customer_id)')
    .eq('id', id).maybeSingle();
  if (error) return { error: error.message };
  return { customerId: data?.roster_order_sessions?.customer_id || null };
}

function stripeInvoicePaymentMethod(pi) {
  const type = pi?.payment_method?.type
    || pi?.latest_charge?.payment_method_details?.type
    || (Array.isArray(pi?.payment_method_types) && pi.payment_method_types.length === 1
      ? pi.payment_method_types[0] : '');
  if (type === 'card') return 'cc';
  if (type === 'us_bank_account') return 'ach';
  return 'stripe';
}

function stripeInvoicePaymentDate(pi, settledAt) {
  // A succeeded webhook's event timestamp is the best settlement date. Synchronous finalize calls
  // use the expanded Charge timestamp. Fall back to the current time rather than PI.created, which
  // is the debit-submission date for ACH and may precede settlement by several business days.
  const seconds = Number(settledAt || pi?.latest_charge?.created || 0);
  const date = seconds > 0 ? new Date(seconds * 1000) : new Date();
  return date.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles', month: '2-digit', day: '2-digit', year: 'numeric',
  });
}

// Atomically apply a succeeded Stripe PaymentIntent to every invoice named in its metadata. The
// database RPC locks the complete invoice set and writes both summaries and immutable ledger rows
// in one transaction. It also owns the idempotency check: retries replay the persisted cent
// allocations, while a legacy partial application is rejected for manual review rather than
// guessing that already-applied principal is a new fee.
async function reconcileInvoiceFromIntent(admin, pi, { settledAt } = {}) {
  if (pi?.status !== 'succeeded') {
    throw new Error('Only a succeeded Stripe PaymentIntent can settle invoices');
  }
  const ids = [...new Set(String(pi?.metadata?.invoice_id || '')
    .split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
  if (!ids.length) return { reconciled: [] };
  if (pi?.metadata?.source && pi.metadata.source !== 'nsa_coach_portal') {
    return { reconciled: [], ignored: true, reason: 'not_coach_portal' };
  }
  if (!pi?.id) throw new Error('Stripe PaymentIntent id is required for invoice reconciliation');

  const capturedCents = Number(pi.amount_received != null ? pi.amount_received : pi.amount);
  if (!Number.isSafeInteger(capturedCents) || capturedCents <= 0) {
    throw new Error('Stripe PaymentIntent captured amount is invalid');
  }

  const { data, error } = await admin.rpc('settle_stripe_invoice_payment', {
    p_payment_intent_id: pi.id,
    p_invoice_ids: ids,
    p_captured_cents: capturedCents,
    p_payment_method: stripeInvoicePaymentMethod(pi),
    p_payment_date: stripeInvoicePaymentDate(pi, settledAt),
  });
  if (error) {
    console.error('[reconcileInvoice] atomic settlement failed for', pi.id, ':', error.message);
    throw new Error(`Invoice settlement failed: ${error.message}`);
  }
  if (!data || data.ok !== true) {
    throw new Error(`Invoice settlement did not commit${data?.reason ? `: ${data.reason}` : ''}`);
  }
  if (data.ignored && (pi?.metadata?.source === 'nsa_coach_portal'
      || ids.some((id) => /^INV-/i.test(id)))) {
    throw new Error('Invoice settlement did not commit: referenced invoices were not found');
  }
  return {
    ...data,
    reconciled: Array.isArray(data.allocations)
      ? data.allocations.map((row) => row.invoice_id).filter(Boolean)
      : [],
  };
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
// OMG report product names often end with the SKU, sometimes duplicated by the
// report ("Sport-Tek Repeat 7\" Short ST485 ST485" → ST485). Fallback for rows
// whose color string carries no "(SKU)" suffix, so parent order lines don't
// land with an empty SKU (which breaks receiving-based status sync — see
// OMG_TRACKING_AUDIT_2026-07-11.md fix #5). SKU-ish = 3-12 alphanumerics
// containing a digit, or 4+ all-caps characters.
function skuFromProductName(name) {
  const toks = String(name || '').trim().split(/\s+/);
  const last = toks[toks.length - 1] || '';
  const skuish = /^[A-Za-z0-9-]{3,12}$/.test(last)
    && (/\d/.test(last) || (last === last.toUpperCase() && last.length >= 4));
  return skuish ? last.toUpperCase() : '';
}

// Unique-containment SKU lookup against the OMG store catalog
// (omg_store_products): returns the catalog SKU when EXACTLY ONE product's
// name (>= 8 chars) appears inside the line's product name. OMG line names
// are often "<catalog name> <display alias>" concatenations; the catalog is
// the same source, so containment is reliable — but ambiguity returns ''
// rather than guessing (same guarded rule as migration 00192's backfill).
function skuFromCatalogName(productName, catalog) {
  const hay = String(productName || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!hay) return '';
  const skus = new Set();
  for (const p of catalog || []) {
    const nm = String(p.name || '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (nm.length >= 8 && p.sku && hay.includes(nm)) skus.add(String(p.sku).toUpperCase().trim());
  }
  if (skus.size === 1) return skus.values().next().value;
  if (skus.size > 1) return '';
  // No name containment — try tokens: a whitespace token of the line name that
  // equals a catalog SKU ("…FULL-ZIP JACKET - BLACK A268 BLACK" → A268).
  // Unique-or-nothing, same as above.
  const catSkus = new Set((catalog || []).map((p) => String(p.sku || '').toUpperCase().trim()).filter(Boolean));
  const hits = new Set(hay.split(' ').filter((t) => catSkus.has(t)));
  return hits.size === 1 ? hits.values().next().value : '';
}

async function syncOrderItems(sb, orderId, lineItems, contentKeys) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const key = (o) => `${String(o.sku || '').toUpperCase()}|${String(o.size || '')}`;
  const { data: existingItems, error } = await sb.from('webstore_order_items')
    .select('id,sku,size,shipped_qty,missing_qty,line_status,bagged_qty,short_status').eq('order_id', orderId);
  if (error) {
    // The existing rows contain fulfillment state and are referenced by shipment
    // lineItemKey values. If we cannot read them, there is no safe way to decide
    // what may be replaced. Fail closed so the caller can retry without deleting
    // received, bagged, shorted, or shipped progress.
    throw new Error(`Could not load existing order items: ${error.message}`);
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
        || (it.line_status && it.line_status !== 'pending')
        // Bagging Station progress: a line that's physically in a bag, or has an
        // unresolved packer short, must survive a packing-slip re-ingest.
        || (Number(it.bagged_qty) || 0) > 0
        || it.short_status === 'open';
      if (!active) stale.push(it.id);
    }
  }
  if (stale.length) {
    const { error: dErr } = await sb.from('webstore_order_items').delete().in('id', stale);
    if (dErr) throw new Error(`Stale item cleanup failed: ${dErr.message}`);
  }
  return { matched, inserted: toInsert.length, removed: stale.length };
}

module.exports = { corsHeaders, getSupabaseAdmin, safeEqualStr, getSiteUrl, getTrustedSiteBaseUrl, verifyAdmin, verifyUser, verifyQBOUser, verifyUserOrInternal, reconcileInvoiceFromIntent, syncOrderItems, skuFromProductName, skuFromCatalogName, pickCols, resolveCustomerFamily, rosterTeamCustomerId };
