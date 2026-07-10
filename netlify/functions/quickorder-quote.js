// Coach-facing server-side quick-order quote — the browser never decides a price.
//
// POST { customer_id, lines: [{ product_id, sku?, size?, qty, color?, decorations?: [...] }] }
//   Authorization: Bearer <coach Supabase session JWT>
//
// Auth: the bearer token must resolve (admin.auth.getUser) to an ACTIVE
// coach_accounts row (matched by auth_user_id, falling back to the account email —
// same claim rule the coach RLS policies use, migrations 00129/00130), and that
// coach must be authorized for the requested customer via coach_customer_access
// (or the account's own customer_id — access lives in coach_customer_access, see
// coach-invite.js).
//
// Pricing is 100% server-side with the service role:
//   - product unit sell mirrors the staff estimate seeding in App.js newE():
//     Adidas/UA/NB (non-S&S-adidas import) → retail × (1 − tier discount) at the
//     customer's adidas_ua_tier; otherwise catalog_sell_price when set, else
//     nsa_cost (clearance_cost when clearance) × customer catalog_markup (1.65 default).
//   - decorations price through src/lib/decoPricing.js (the shared CJS single source
//     of truth, bundled via netlify.toml included_files — same pattern as
//     rep-ops-digest / opsRecap). The DEFAULT tables are passed explicitly, so a
//     rep browser's localStorage overrides can never leak into a coach quote.
//
// The response carries a deterministic sha256 quote hash of the normalized line
// set + totals; a later order-placement endpoint echoes it so the server can
// verify the coach is placing exactly the quote they saw. Quote only — this
// function never writes anything.
const crypto = require('crypto');
const { corsHeaders, getSupabaseAdmin } = require('./_shared');
const { verifyCoach, coachHasCustomerAccess } = require('./_coachAuth');
const DECO = require('../../src/lib/decoPricing');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const bad = (status, error, extra) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify({ error, ...(extra || {}) }) });

const MAX_LINES = 100;
const MAX_QTY = 10000;

// Coach auth (verifyCoach / coachHasCustomerAccess) lives in ./_coachAuth so
// other coach-facing endpoints share one implementation. Re-exported below for
// the existing tests.

// Unit sell for one product at this customer's pricing (mirrors App.js newE()).
function unitSell(p, cust) {
  const au = DECO.isAU(p.brand) && !String(p.id || '').startsWith('ssa-');
  if (au) {
    const tier = (cust && cust.adidas_ua_tier) || 'B';
    return DECO.rQ((Number(p.retail_price) || 0) * (1 - DECO.auTierDisc(tier, p.pricing_group, p.category)));
  }
  if (p.catalog_sell_price != null) return r2(p.catalog_sell_price);
  const repCost = p.is_clearance && p.clearance_cost != null ? p.clearance_cost : p.nsa_cost;
  const mk = (cust && Number(cust.catalog_markup)) || 1.65;
  return DECO.rQ((Number(repCost) || 0) * mk);
}

// Normalize a client decoration to the plain type-based shape dP prices without
// art files (screen_print / embroidery / dtf / names / numbers pass through on
// their documented fields). Everything else — overrides especially — is dropped:
// a coach caller must never set its own price.
function cleanDeco(d) {
  const t = String((d && d.type) || '').trim();
  if (t === 'screen_print') return { type: 'screen_print', colors: Math.min(5, Math.max(1, parseInt(d.colors, 10) || 1)), underbase: !!d.underbase };
  if (t === 'embroidery') return { type: 'embroidery', stitches: Math.min(999999, Math.max(1, parseInt(d.stitches, 10) || 8000)) };
  if (t === 'dtf') return { type: 'dtf', dtf_size: DECO.DTF[parseInt(d.dtf_size, 10)] ? parseInt(d.dtf_size, 10) : 0 };
  return null;
}

// Placement/logo metadata carried through (NOT priced) so the client renders
// exactly what was quoted and checkout can persist it. Whitelist only — any
// client-supplied price field (sell_override, unit_sell, ...) never survives.
// Keys are disjoint from cleanDeco's pricing fields by construction.
function decoMeta(d) {
  if (!d || typeof d !== 'object') return {};
  const out = {};
  if (d.placement != null && String(d.placement).trim()) out.placement = String(d.placement).trim();
  if (d.side === 'front' || d.side === 'back') out.side = d.side;
  for (const k of ['x', 'y', 'w']) {
    const n = Number(d[k]);
    if (d[k] != null && d[k] !== '' && Number.isFinite(n)) out[k] = n;
  }
  if (d.logo_source != null && String(d.logo_source).trim()) out.logo_source = String(d.logo_source).trim();
  if (d.teamshop_logo_id != null) out.teamshop_logo_id = d.teamshop_logo_id;
  else if (d.art_file_id != null) out.art_file_id = d.art_file_id;
  if (d.art_url && typeof d.art_url === 'string') out.art_url = d.art_url;
  return out;
}

// ── Quote hash (v2) — THE single normalization + hash implementation ─────────
//
// CONTRACT (Stage 6 checkout): the order-placement function MUST NOT reimplement
// this. It requires this module and recomputes the hash from the quote lines the
// client echoes back:
//
//   const { normalizeAndHash } = require('./quickorder-quote');
//   const { quote_hash } = normalizeAndHash(quote.lines,
//     { customer_id, tier, subtotal });
//   if (quote_hash !== clientSuppliedHash) reject; // quote drifted → re-quote
//
// `lines` is the priced/echoed quote line shape this function produces:
//   { product_id, sku, size, qty, unit_sell, decorations: [{ type,
//     colors/underbase | stitches | dtf_size, placement?, side?, x?, y?, w?,
//     teamshop_logo_id? | art_file_id? }] }
// `totals` is { customer_id, tier, subtotal }.
//
// Hashed per normalized line: product_id, sku, size, qty, unit garment sell,
// and per decoration the full pricing-relevant set (type + colors/underbase |
// stitches | dtf_size) PLUS placement identity (placement zone id, logo
// reference, side, x, y, w) — so a placement nudge, zone change, or logo swap
// invalidates the quote. The version string is inside the hashed payload.
const HASH_VERSION = 'v2';
function normalizeAndHash(lines, totals) {
  const t = totals || {};
  const str = (v) => (v == null || String(v) === '' ? null : String(v));
  const num = (v) => {
    const n = Number(v);
    return v == null || v === '' || !Number.isFinite(n) ? null : n;
  };
  const normalized = {
    v: HASH_VERSION,
    customer_id: str(t.customer_id),
    tier: str(t.tier) || 'B',
    lines: (Array.isArray(lines) ? lines : []).map((l) => ({
      p: str(l.product_id),
      s: str(l.sku),
      z: str(l.size),
      q: Number(l.qty) || 0,
      u: Number(l.unit_sell) || 0,
      d: (Array.isArray(l.decorations) ? l.decorations : []).map((d) => ({
        t: str(d.type),
        // full pricing-relevant set for the type
        pr: d.type === 'screen_print' ? [Number(d.colors) || 1, d.underbase ? 1 : 0]
          : d.type === 'embroidery' ? [Number(d.stitches) || 0]
            : [Number(d.dtf_size) || 0],
        // placement identity
        pl: str(d.placement),
        lg: d.teamshop_logo_id != null ? `teamshop:${d.teamshop_logo_id}`
          : d.art_file_id != null ? `art:${d.art_file_id}` : null,
        sd: str(d.side),
        x: num(d.x),
        y: num(d.y),
        w: num(d.w),
      })),
    })),
    subtotal: Number(t.subtotal) || 0,
  };
  const quote_hash = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  return { normalized, quote_hash, hash_version: HASH_VERSION };
}

// Price the request. Pure given the loaded rows. Returns { quote } or { status, error }.
async function buildQuote(admin, { customerId, lines }) {
  if (!customerId) return { status: 400, error: 'customer_id required' };
  if (!Array.isArray(lines) || !lines.length) return { status: 400, error: 'At least one line required' };
  if (lines.length > MAX_LINES) return { status: 400, error: `Too many lines (max ${MAX_LINES})` };

  const { data: cust, error: custErr } = await admin.from('customers')
    .select('id,name,adidas_ua_tier,catalog_markup').eq('id', customerId).maybeSingle();
  if (custErr) return { status: 500, error: custErr.message };
  if (!cust) return { status: 404, error: 'Customer not found' };

  const ids = [...new Set(lines.map((l) => l && l.product_id).filter(Boolean))];
  if (!ids.length) return { status: 400, error: 'Every line needs a product_id' };
  const { data: prods, error: pErr } = await admin.from('products')
    .select('id,sku,name,brand,category,retail_price,catalog_sell_price,pricing_group,nsa_cost,is_clearance,clearance_cost')
    .in('id', ids);
  if (pErr) return { status: 500, error: pErr.message };
  const byId = {};
  (prods || []).forEach((p) => { byId[p.id] = p; });

  const T = DECO.DEFAULTS; // server always prices at the default tables
  const outLines = [];
  let subtotal = 0;
  for (const l of lines) {
    const p = l && byId[l.product_id];
    if (!p) return { status: 409, error: `Product not found: ${(l && l.product_id) || '(missing)'}` };
    const qty = Math.min(MAX_QTY, Math.max(1, parseInt(l.qty, 10) || 1));
    const size = l.size != null && String(l.size).trim() ? String(l.size).trim() : null;
    const color = l.color != null && String(l.color).trim() ? String(l.color).trim() : null;
    const unit = unitSell(p, cust);
    const decos = [];
    let decoEach = 0;
    // decorations: [] (or absent) is a plain retail line — garment-only price.
    for (const rawDeco of (Array.isArray(l.decorations) ? l.decorations : [])) {
      const d = cleanDeco(rawDeco);
      if (!d) return { status: 400, error: 'Unsupported decoration type — use screen_print, embroidery, or dtf' };
      const dp = DECO.dP(T, d, qty);
      const sell = r2(dp.sell);
      decoEach = r2(decoEach + sell);
      // pricing fields (cleanDeco) + priced sell + placement/logo metadata echo.
      decos.push({ ...d, unit_sell: sell, ...decoMeta(rawDeco) });
    }
    const lineTotal = r2((unit + decoEach) * qty);
    subtotal = r2(subtotal + lineTotal);
    outLines.push({ product_id: p.id, sku: p.sku, name: p.name, size, color, qty, unit_sell: unit, decorations: decos, line_total: lineTotal });
  }

  // Deterministic v2 hash over the normalized line set + totals (see
  // normalizeAndHash above). Order placement recomputes it via the same export.
  const { quote_hash, hash_version } = normalizeAndHash(outLines, {
    customer_id: cust.id,
    tier: cust.adidas_ua_tier || 'B',
    subtotal,
  });

  return {
    quote: {
      customer_id: cust.id,
      customer_name: cust.name,
      tier: cust.adidas_ua_tier || 'B',
      lines: outLines,
      subtotal,
      total: subtotal, // goods + deco only; tax/shipping are applied at order placement
      hash: quote_hash, // legacy alias of quote_hash (kept for response-shape compat)
      quote_hash,
      hash_version,
      generated_at: new Date().toISOString(),
    },
  };
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

    const customerId = String(body.customer_id || '').trim();
    if (!customerId) return bad(400, 'customer_id required');
    const acc = await coachHasCustomerAccess(admin, v.coach, customerId);
    if (acc.error) return bad(500, acc.error);
    if (!acc.ok) return bad(403, 'Not authorized for this customer');

    const res = await buildQuote(admin, { customerId, lines: body.lines });
    if (!res.quote) return bad(res.status, res.error);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, quote: res.quote }) };
  } catch (e) {
    return bad(500, e.message);
  }
};

// Exported for tests (src/__tests__/quickorderQuote.test.js) — same pattern as webstore-checkout.
module.exports.verifyCoach = verifyCoach;
module.exports.coachHasCustomerAccess = coachHasCustomerAccess;
module.exports.buildQuote = buildQuote;
module.exports.unitSell = unitSell;
module.exports.cleanDeco = cleanDeco;
// Stage 6 checkout requires this to recompute the identical quote hash — see
// the contract comment on normalizeAndHash.
module.exports.normalizeAndHash = normalizeAndHash;
module.exports.HASH_VERSION = HASH_VERSION;
