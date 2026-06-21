// Manual-close path: the rep clicks "Close store" → the app sets status='closed' and POSTs
// here with { store_id }. Staff-gated. Runs the same handler as the scheduled sweep — a rep
// to-do + a breakdown email to the rep & assigned CSR — and is idempotent on
// closed_notified_at, so the sweep and a manual close can never double-notify.
const { corsHeaders, verifyUser } = require('./_shared');
const { notifyStoreClosed } = require('./_webstoreClose');

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const auth = await verifyUser(event);
  if (!auth.ok) return { statusCode: auth.status, headers, body: JSON.stringify({ error: auth.error }) };

  let storeId;
  try { storeId = JSON.parse(event.body || '{}').store_id; } catch { /* */ }
  if (!storeId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'store_id required' }) };

  try {
    const admin = auth.admin;
    const { data: store, error } = await admin.from('webstores').select('*').eq('id', storeId).maybeSingle();
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    if (!store) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Store not found' }) };
    const result = await notifyStoreClosed(admin, store);
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (e) {
    console.error('[closed-notify]', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
