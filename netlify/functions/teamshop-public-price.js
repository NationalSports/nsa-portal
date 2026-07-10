// Public (no-auth) standard-retail price estimate for the Team Shop product
// builder — anonymous shoppers see a real, server-priced number, never a
// client-computed one. This is the SAME pricing math quickorder-quote.js
// uses for a signed-in coach's quote, just without a customer record (so no
// tier discount / catalog markup override applies — standard public rates
// only). It reuses quickorder-quote.js's exported unitSell/cleanDeco
// helpers and decoPricing.js's dP/DEFAULTS directly rather than
// reimplementing any pricing formula.
//
// POST { lines: [{ product_id, sku?, size?, qty?, decorations?: [...] }] }
//   No Authorization header — public endpoint.
//
// Read-only: loads product rows via the service-role client (getSupabaseAdmin)
// selecting ONLY the pricing fields unitSell needs (plus sku/name for the
// echo) — no customer data is read or returned, and this never writes
// anything.
//
// Response: { ok: true, lines: [{ product_id, sku, size, qty, unit_garment,
//   unit_deco, unit_total, line_total }], subtotal }
// All money values are plain numbers (dollars, 2dp) — the client only
// displays them, per the "browser never computes a price" rule.
const { corsHeaders, getSupabaseAdmin } = require('./_shared');
const { unitSell, cleanDeco } = require('./quickorder-quote');
const DECO = require('../../src/lib/decoPricing');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const bad = (status, error, extra) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify({ error, ...(extra || {}) }) });

const MAX_LINES = 100; // mirrors quickorder-quote.js's own limit
const MAX_QTY = 10000;

// Price the request at standard public retail (no customer_id, no tier).
// Pure given the loaded product rows — same shape/contract as
// quickorder-quote.js's buildQuote, minus the customer lookup.
async function buildPublicQuote(admin, { lines }) {
  if (!Array.isArray(lines) || !lines.length) return { status: 400, error: 'At least one line required' };
  if (lines.length > MAX_LINES) return { status: 400, error: `Too many lines (max ${MAX_LINES})` };

  const ids = [...new Set(lines.map((l) => l && l.product_id).filter(Boolean))];
  if (!ids.length) return { status: 400, error: 'Every line needs a product_id' };
  const { data: prods, error: pErr } = await admin.from('products')
    .select('id,sku,name,retail_price,catalog_sell_price,pricing_group,nsa_cost,is_clearance,clearance_cost,brand,category')
    .in('id', ids);
  if (pErr) return { status: 500, error: pErr.message };
  const byId = {};
  (prods || []).forEach((p) => { byId[p.id] = p; });

  const T = DECO.DEFAULTS; // standard default pricing tables — same ones quickorder-quote.js prices with
  const outLines = [];
  let subtotal = 0;
  for (const l of lines) {
    const p = l && byId[l.product_id];
    if (!p) return { status: 409, error: `Product not found: ${(l && l.product_id) || '(missing)'}` };
    const qty = Math.min(MAX_QTY, Math.max(1, parseInt(l.qty, 10) || 1));
    const size = l.size != null && String(l.size).trim() ? String(l.size).trim() : null;
    // unitSell(p, null) — no customer record — falls back to the same
    // standard-retail path quickorder-quote.js uses for a customer with no
    // AU tier / default catalog_markup (1.65): exactly public retail.
    const unitGarment = unitSell(p, null);
    let unitDeco = 0;
    for (const rawDeco of (Array.isArray(l.decorations) ? l.decorations : [])) {
      const d = cleanDeco(rawDeco);
      if (!d) return { status: 400, error: 'Unsupported decoration type — use screen_print, embroidery, or dtf' };
      const dp = DECO.dP(T, d, qty);
      unitDeco = r2(unitDeco + r2(dp.sell));
    }
    const unitTotal = r2(unitGarment + unitDeco);
    const lineTotal = r2(unitTotal * qty);
    subtotal = r2(subtotal + lineTotal);
    outLines.push({
      product_id: p.id, sku: p.sku, size, qty,
      unit_garment: unitGarment, unit_deco: unitDeco, unit_total: unitTotal, line_total: lineTotal,
    });
  }

  return { quote: { lines: outLines, subtotal, generated_at: new Date().toISOString() } };
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

    const res = await buildPublicQuote(admin, { lines: body.lines });
    if (!res.quote) return bad(res.status, res.error);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...res.quote }) };
  } catch (e) {
    return bad(500, e.message);
  }
};

// Exported for tests.
module.exports.buildPublicQuote = buildPublicQuote;
