// Public, anonymous shopper-funnel tracking for the club webstores.
//
// The storefront (src/lib/webstoreTracking.js) posts small batches of shopper
// actions here — store opened, item viewed, added to cart, checkout clicked,
// order placed — and we write them to webstore_events with the service role.
// The reports read them back through the webstore_funnel RPCs.
//
// This endpoint must never matter to a sale: the storefront fires and forgets,
// and anything malformed is dropped rather than rejected loudly. It only records
// for stores that are actually open, so staff previews don't pollute the numbers.

const { corsHeaders, getSupabaseAdmin } = require('./_shared');

const EVENTS = new Set(['store_view', 'product_view', 'add_to_cart', 'cart_view', 'checkout_start', 'order_placed']);
const DEVICES = new Set(['mobile', 'tablet', 'desktop']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_EVENTS = 25;
const MAX_BODY = 16 * 1024;

// Store id -> { at, open } so a busy store doesn't cost a lookup per event.
const STORE_TTL_MS = 5 * 60 * 1000;
const _storeCache = new Map();

function uuidOrNull(v) { return typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null; }

// Turn one raw client event into a row, or null if it isn't well-formed.
function normalizeEvent(raw, storeId, sessionId, device) {
  if (!raw || typeof raw !== 'object' || !EVENTS.has(raw.event)) return null;
  const productId = uuidOrNull(raw.productId);
  const orderId = uuidOrNull(raw.orderId);
  if ((raw.event === 'product_view' || raw.event === 'add_to_cart') && !productId) return null;
  if (raw.event === 'order_placed' && !orderId) return null;
  const value = Number(raw.value);
  return {
    store_id: storeId,
    session_id: sessionId,
    event: raw.event,
    webstore_product_id: productId,
    order_id: raw.event === 'order_placed' ? orderId : null,
    device,
    value: Number.isFinite(value) && value >= 0 && value < 1e6 ? Math.round(value * 100) / 100 : null,
  };
}

// Validate a whole request body. Returns { storeId, rows } or { error }.
function normalizeBatch(body) {
  if (!body || typeof body !== 'object') return { error: 'bad body' };
  const storeId = uuidOrNull(body.storeId);
  if (!storeId) return { error: 'bad store' };
  const sessionId = typeof body.sessionId === 'string' && SESSION_RE.test(body.sessionId) ? body.sessionId : null;
  if (!sessionId) return { error: 'bad session' };
  const device = DEVICES.has(body.device) ? body.device : null;
  const list = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
  const rows = list.map((e) => normalizeEvent(e, storeId, sessionId, device)).filter(Boolean);
  return { storeId, rows };
}

async function storeIsOpen(sb, storeId) {
  const hit = _storeCache.get(storeId);
  if (hit && Date.now() - hit.at < STORE_TTL_MS) return hit.open;
  const { data, error } = await sb.from('webstores').select('id,status').eq('id', storeId).maybeSingle();
  if (error) throw error;
  const open = !!(data && data.status === 'open');
  if (_storeCache.size > 500) _storeCache.clear();
  _storeCache.set(storeId, { at: Date.now(), open });
  return open;
}

exports.handler = async (event) => {
  const headers = { ...corsHeaders(), 'Content-Type': 'application/json' };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false });
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  if (raw.length > MAX_BODY) return reply(413, { ok: false });
  let body;
  try { body = JSON.parse(raw); } catch { return reply(400, { ok: false }); }
  const batch = normalizeBatch(body);
  if (batch.error) return reply(400, { ok: false });
  if (!batch.rows.length) return reply(200, { ok: true, recorded: 0 });
  try {
    const sb = getSupabaseAdmin();
    if (!(await storeIsOpen(sb, batch.storeId))) return reply(200, { ok: true, recorded: 0 });
    const { error } = await sb.from('webstore_events').insert(batch.rows);
    if (error) throw error;
    return reply(200, { ok: true, recorded: batch.rows.length });
  } catch (e) {
    console.warn('[webstore-track] insert failed:', e && e.message);
    return reply(200, { ok: false });
  }
};

exports._test = { normalizeBatch, normalizeEvent };
