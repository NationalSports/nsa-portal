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
// Team Shop flat deco rate card (00194) — when the rates table is live, deco
// pricing comes from it; when it isn't (loadRates → null), we FALL BACK to the
// legacy DECO.dP tables below so the storefront keeps pricing correctly before
// the migration is applied. See the transitional-fallback note in _teamshopRates.js.
const { loadRates, flatDecoSell } = require('./_teamshopRates');

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

// Normalize a client decoration to the plain type-based shape the server
// prices. `type` is the concrete PRODUCTION identity (embroidery | dtf | vinyl
// | silicone_patch | screen_print — a DTF job routes to the DTF printer, vinyl
// to the cutter; 'heat' is a storefront FAMILY, never a type); `option` is the
// rate-card sub-option (00194 option_key, whitelisted below, defaulting to
// 'standard'). colors/underbase, stitches and dtf_size still pass through:
// when the flat rate card is active they are PRODUCTION METADATA only (not
// price inputs); in dP-fallback mode they price exactly as before. Everything
// else — overrides especially — is dropped: a coach caller must never set its
// own price.
const DECO_OPTION_KEYS = ['standard', 'number', 'name_number'];
const cleanOption = (d) => (DECO_OPTION_KEYS.includes(d && d.option) ? d.option : 'standard');
function cleanDeco(d) {
  const t = String((d && d.type) || '').trim();
  const option = cleanOption(d);
  if (t === 'screen_print') return { type: 'screen_print', option, colors: Math.min(5, Math.max(1, parseInt(d.colors, 10) || 1)), underbase: !!d.underbase };
  if (t === 'embroidery') return { type: 'embroidery', option, stitches: Math.min(999999, Math.max(1, parseInt(d.stitches, 10) || 8000)) };
  if (t === 'dtf') return { type: 'dtf', option, dtf_size: DECO.DTF[parseInt(d.dtf_size, 10)] ? parseInt(d.dtf_size, 10) : 0 };
  if (t === 'vinyl') return { type: 'vinyl', option };
  if (t === 'silicone_patch') return { type: 'silicone_patch', option };
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
  // option is also normalized by cleanDeco (same whitelist) — echoing it here
  // keeps the two whitelists agreeing by construction: an un-whitelisted client
  // option can never overwrite cleanDeco's normalized 'standard'.
  if (DECO_OPTION_KEYS.includes(d.option)) out.option = d.option;
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

// ── Quote hash (v3) — THE single normalization + hash implementation ─────────
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
//   { product_id, sku, size, qty, unit_sell, decorations: [{ type, option,
//     unit_sell, colors/underbase | stitches | dtf_size (production metadata),
//     placement?, side?, x?, y?, w?, teamshop_logo_id? | art_file_id? }] }
// `totals` is { customer_id, tier, subtotal }.
//
// Hashed per normalized line: product_id, sku, size, qty, unit garment sell,
// and per decoration the pricing identity as of the RATE-CARD model (v3):
//   pr = [type, option, resolvedPrice]
// where resolvedPrice is the server-priced per-unit deco sell (d.unit_sell).
// A staff rate edit therefore flips every open quote's hash (409
// totals_changed at checkout → re-quote), and in dP-fallback mode a
// colors/stitches/dtf_size change still flips it through the resolved price.
// Placement identity (placement zone id, logo reference, side, x, y, w) is
// hashed as before — a placement nudge, zone change, or logo swap invalidates
// the quote. The version string is inside the hashed payload.
// v2 → v3: pr was [colors, underbase] | [stitches] | [dtf_size]; it is now
// [type, option, resolvedPrice]. teamshop-checkout's compare works unchanged —
// it recomputes through this same export.
const HASH_VERSION = 'v3';
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
        // v3 pricing identity: [type, option, resolvedPrice] — see the
        // contract comment above. resolvedPrice is the server-priced per-unit
        // deco sell, so a rate-card edit (or any dP-fallback input change)
        // flips the hash.
        pr: [str(d.type), str(d.option) || 'standard', Number(d.unit_sell) || 0],
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

  const T = DECO.DEFAULTS; // fallback tables (see below) — server never reads browser overrides
  // Flat deco rate card (00194). null → the table isn't live yet, and deco
  // pricing falls back to the legacy DECO.dP tables so pre-migration deploys
  // keep charging exactly what they charged before (transitional fallback —
  // see _teamshopRates.js).
  const rates = await loadRates(admin);
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
      if (!d) return { status: 400, error: 'Unsupported decoration type — use embroidery, dtf, vinyl, silicone_patch, or screen_print' };
      let sell;
      if (rates) {
        // Rate card live: flat per-piece sell by type + option, with the
        // row's min_qty enforced at THIS LINE's quantity. stitches/dtf_size/
        // colors are production metadata here, never price inputs.
        const fr = flatDecoSell(rates, d, qty);
        if (fr.error === 'MIN_QTY') {
          return { status: 422, error: `${fr.label} requires ${fr.min}+ pieces`, extra: { code: 'MIN_QTY', min: fr.min, type: d.type } };
        }
        if (fr.error) {
          // No active rate row — REJECT, never price at $0.
          return { status: 409, error: 'This decoration isn’t available right now — please pick another method.' };
        }
        sell = fr.sell;
      } else {
        // dP fallback (00194 not applied yet): the exact legacy pricing. The
        // new heat kinds have no dP price — reject rather than charge $0.
        if (d.type === 'vinyl' || d.type === 'silicone_patch') {
          return { status: 409, error: 'This decoration isn’t available right now — please pick another method.' };
        }
        sell = r2(DECO.dP(T, d, qty).sell);
      }
      decoEach = r2(decoEach + sell);
      // pricing fields (cleanDeco) + priced sell + placement/logo metadata echo.
      decos.push({ ...d, unit_sell: sell, ...decoMeta(rawDeco) });
    }
    const lineTotal = r2((unit + decoEach) * qty);
    subtotal = r2(subtotal + lineTotal);
    outLines.push({ product_id: p.id, sku: p.sku, name: p.name, size, color, qty, unit_sell: unit, decorations: decos, line_total: lineTotal });
  }

  // Deterministic v3 hash over the normalized line set + totals (see
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
    if (!res.quote) return bad(res.status, res.error, res.extra);
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
