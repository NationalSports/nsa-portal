// Netlify function: registers an NSA Team Portal app device for push.
//
// The iOS app (coach-ios/) is link-gated like the coach portal — it runs under
// a team's ?portal=<alpha_tag> and is anon, so (like portal-action.js and
// roster-write.js) the actual write goes through the service role here after
// re-verifying the alpha_tag resolves to a real customer. Sending happens
// elsewhere (netlify/functions/_apnsPush.js) once an APNs key is configured;
// this endpoint only stores/refreshes the device token.
const { getSupabaseAdmin: _getSupabaseAdmin } = require('./_shared');

function getSupabaseAdmin() {
  try { return _getSupabaseAdmin(); } catch { return null; }
}

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Bad JSON' }); }

  const alphaTag = String(body.alpha_tag || body.portal || '').trim();
  const token = String(body.token || '').trim();
  const platform = String(body.platform || 'ios').trim().toLowerCase();
  const environment = String(body.environment || 'production').trim().toLowerCase();
  const appVersion = body.app_version ? String(body.app_version).trim().slice(0, 40) : null;

  if (!alphaTag) return json(400, { ok: false, error: 'alpha_tag required' });
  if (!token) return json(400, { ok: false, error: 'token required' });
  if (!['ios', 'android'].includes(platform)) return json(400, { ok: false, error: 'bad platform' });

  const admin = getSupabaseAdmin();
  if (!admin) return json(503, { ok: false, error: 'service-creds-missing' });

  // Re-verify the tag maps to a real team (same lookup as uniform-order.js).
  const { data: customer, error: custErr } = await admin
    .from('customers').select('id').ilike('alpha_tag', alphaTag).maybeSingle();
  if (custErr) return json(500, { ok: false, error: custErr.message });
  if (!customer) return json(404, { ok: false, error: 'Unknown team' });

  // One row per (token, platform); re-registering refreshes it and re-enables a
  // token that was previously marked dead.
  const { error: upErr } = await admin.from('coach_push_tokens').upsert({
    customer_id: String(customer.id),
    alpha_tag: alphaTag,
    platform,
    token,
    environment: environment === 'sandbox' ? 'sandbox' : 'production',
    app_version: appVersion,
    disabled: false,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'token,platform' });
  if (upErr) return json(500, { ok: false, error: upErr.message });

  return json(200, { ok: true });
};
