// AI cleanup of spec-dump product descriptions (lazy, saved once).
//
// The store builder fires this in the background with the product ids used in a
// store. For Adidas items that have a raw description but no AI copy yet, it asks
// Claude (Haiku — cheap and plenty capable for a rewrite) to turn the vendor
// spec-sheet text into clean ecommerce copy, then saves it to
// products.description_ai so it's cleaned at most once and reused everywhere
// (storefront view prefers description_ai). Staff-gated; a no-op without
// ANTHROPIC_API_KEY so the feature degrades gracefully until the key is set.
const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');

const MODEL = 'claude-haiku-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const SYSTEM = [
  'You rewrite raw vendor product descriptions into clean, friendly ecommerce copy for a youth/team apparel webstore.',
  'Rules:',
  "- Stay accurate to the source. Never invent materials, features, technologies, or claims that aren't in the input.",
  '- Remove spec-sheet noise: drop empty fields like "WOVEN: N/A" / "HOOD: N/A", style/SKU codes, color codes, and ALL-CAPS label dumps.',
  '- Fix odd casing and spacing; expand an abbreviation only when it is unambiguous.',
  '- Write 1-3 short, plain sentences. You may add a brief list of real features (fabric, fit, closures) when the source clearly states them.',
  '- No marketing hype, no sizes, no prices, no stock/availability, no brand boilerplate.',
  '- Output ONLY the cleaned description text. No preamble, no quotes, no headings.',
].join('\n');

// Cap the work per invocation so we stay well under the function's wall-clock limit.
// On-add typically passes 1-2 new items; a big store is cleaned across a few loads.
const MAX_PER_CALL = 12;
const TIME_BUDGET_MS = 8000;

async function cleanOne(apiKey, name, raw) {
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Product: ${name || '(unnamed)'}\n\nRaw description:\n${String(raw).slice(0, 4000)}` }],
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error('anthropic ' + resp.status + ' ' + t.slice(0, 200));
  }
  const data = await resp.json();
  return (data.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const auth = await verifyUser(event);
  if (!auth.ok) return { statusCode: auth.status, headers, body: JSON.stringify({ error: auth.error }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, reason: 'missing_api_key', cleaned: 0 }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { /* ignore */ }
  let ids = Array.isArray(body.product_ids) ? body.product_ids.filter(Boolean) : (body.product_id ? [body.product_id] : []);
  const force = !!body.force;
  ids = [...new Set(ids)];
  if (!ids.length) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, cleaned: 0, skipped: 0 }) };

  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from('products')
    .select('id,name,brand,description,description_ai')
    .in('id', ids.slice(0, 200));
  if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };

  // Only Adidas items with a real description that haven't been cleaned yet (unless forced).
  const targets = (rows || []).filter((r) => {
    const hasDesc = r.description && String(r.description).trim().length > 0;
    const isAdidas = /adidas/i.test(r.brand || '');
    const needs = force || !(r.description_ai && String(r.description_ai).trim());
    return hasDesc && isAdidas && needs;
  });

  const started = Date.now();
  let cleaned = 0;
  const errors = [];
  for (const r of targets.slice(0, MAX_PER_CALL)) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    try {
      const text = await cleanOne(apiKey, r.name, r.description);
      if (text) {
        const { error: uErr } = await admin
          .from('products')
          .update({ description_ai: text, description_ai_at: new Date().toISOString() })
          .eq('id', r.id);
        if (uErr) errors.push(r.id + ': ' + uErr.message); else cleaned++;
      }
    } catch (e) { errors.push(r.id + ': ' + (e.message || String(e))); }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, cleaned, remaining: Math.max(0, targets.length - cleaned), considered: rows ? rows.length : 0, errors: errors.slice(0, 5) }),
  };
};
