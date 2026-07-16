// Team Shop handoff (Coach Crossover, Workstream 1) — one-time codes that
// carry a signed-in Connect coach to nationalteamshop.com already signed in.
//
// POST { action: 'mint', customer_id? }
//   Authorization: Bearer <coach Supabase session JWT>
//   → { ok, code }   code = 64-hex opaque one-time handle, 60s TTL
//
// POST { action: 'exchange', code }
//   (no auth — the code IS the credential)
//   → { ok, token_hash, email, customer_id, customer_name, alpha_tag }
//   The client finishes sign-in with supabaseCoach.auth.verifyOtp({ type:
//   'email', email, token_hash }). 410 { error: 'expired' } for any code that
//   is unknown, already used, or past its 60s TTL (deliberately one opaque
//   answer — no oracle for which it was).
//
// Security model: the URL carries ONLY the opaque single-use code. The real
// sign-in credential (generateLink's hashed_token) is minted server-side at
// exchange time and returned in the response body — it never appears in a
// URL, a Referer header, or browser history. The raw code is never stored
// (only its sha256) and never logged. 'mint' never returns a token_hash.
//
// Auth/structure mirrors netlify/functions/teamshop-context.js: verifyCoach +
// coachHasCustomerAccess from ./_coachAuth, corsHeaders/getSupabaseAdmin from
// ./_shared.
const crypto = require('crypto');
const { corsHeaders, getSupabaseAdmin } = require('./_shared');
const { verifyCoach, coachHasCustomerAccess } = require('./_coachAuth');

const bad = (status, error) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify({ error }) });
const ok = (body) => ({ statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, ...body }) });

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const CODE_TTL_MS = 60 * 1000; // codes live 60 seconds — long enough for one redirect
const CODE_RE = /^[0-9a-f]{64}$/; // exactly what mint produces (32 random bytes, hex)

// ── Per-IP failure rate limiting for 'exchange' ──────────────────────────────
// After RL_MAX failed exchanges from one IP within RL_WINDOW_MS → 429.
// Deliberately in-memory per warm function instance (approved limitation): a
// cold start or a different instance resets the counter, so this is a brake on
// casual brute force, not a hard guarantee — the real security margin is the
// 2^256 code space and 60s single-use TTL. No table for this on purpose.
const RL_WINDOW_MS = 10 * 60 * 1000;
const RL_MAX = 5;
const _rlFailures = new Map(); // ip -> [failure timestamps]

const clientIp = (event) => {
  const h = event.headers || {};
  return (h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
};
function rlBlocked(ip) {
  const now = Date.now();
  const recent = (_rlFailures.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  _rlFailures.set(ip, recent);
  return recent.length >= RL_MAX;
}
function rlRecordFailure(ip) {
  const arr = _rlFailures.get(ip) || [];
  arr.push(Date.now());
  _rlFailures.set(ip, arr);
  // Bound memory on a long-lived instance.
  if (_rlFailures.size > 5000) _rlFailures.clear();
}
// Test hook only.
function _resetRateLimit() { _rlFailures.clear(); }

// ── mint ─────────────────────────────────────────────────────────────────────
async function mint(admin, event, body) {
  const v = await verifyCoach(admin, event);
  if (!v.coach) return bad(v.status, v.error);
  const coach = v.coach;

  let customerId = null;
  if (body.customer_id != null && body.customer_id !== '') {
    customerId = String(body.customer_id);
    const acc = await coachHasCustomerAccess(admin, coach, customerId);
    if (acc.error) return bad(500, acc.error);
    if (!acc.ok) return bad(403, 'No access to this customer');
  }

  const code = crypto.randomBytes(32).toString('hex');
  const { error } = await admin.from('teamshop_handoff_codes').insert({
    code_hash: sha256(code),
    coach_id: coach.id,
    customer_id: customerId,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) return bad(500, error.message);
  return ok({ code }); // never a token_hash here — mint only hands out the transport code
}

// ── exchange ─────────────────────────────────────────────────────────────────
async function exchange(admin, event, body) {
  const ip = clientIp(event);
  if (rlBlocked(ip)) return bad(429, 'Too many attempts — try again later');

  const code = typeof body.code === 'string' ? body.code : '';
  if (!CODE_RE.test(code)) { rlRecordFailure(ip); return bad(410, 'expired'); }

  // Atomic single-use claim: one UPDATE ... RETURNING with the not-used /
  // not-expired predicates in the WHERE clause, so two racing exchanges can
  // never both win — the loser matches zero rows.
  const nowIso = new Date().toISOString();
  const { data: rows, error: claimErr } = await admin.from('teamshop_handoff_codes')
    .update({ used_at: nowIso })
    .eq('code_hash', sha256(code))
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .select('coach_id,customer_id');
  if (claimErr) return bad(500, claimErr.message);
  const row = rows && rows[0];
  if (!row) { rlRecordFailure(ip); return bad(410, 'expired'); }

  // The coach must still be in verifyCoach's allowed status set ('active' or
  // 'invited') — a coach disabled between mint and exchange gets the same
  // opaque 410 as a bad code (no status oracle for an unauthenticated caller).
  const { data: coach, error: cErr } = await admin.from('coach_accounts')
    .select('id,email,name,status,customer_id')
    .eq('id', row.coach_id).maybeSingle();
  if (cErr) return bad(500, cErr.message);
  if (!coach || !coach.email) { rlRecordFailure(ip); return bad(410, 'expired'); }
  if (coach.status && coach.status !== 'active' && coach.status !== 'invited') { rlRecordFailure(ip); return bad(410, 'expired'); }

  // alpha_tag (for the "← Back to Connect" link) + name (for the team-context
  // preselect) from the handed-off customer row, when one was minted in.
  let alphaTag = null;
  let customerName = null;
  if (row.customer_id) {
    const { data: cust, error: custErr } = await admin.from('customers')
      .select('alpha_tag,name').eq('id', row.customer_id).maybeSingle();
    if (custErr) return bad(500, custErr.message);
    if (cust) { alphaTag = cust.alpha_tag || null; customerName = cust.name || null; }
  }

  // Mint the actual session credential server-side. hashed_token is consumed
  // exactly once by the client's verifyOtp — it never appears in any URL.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: coach.email,
  });
  if (linkErr || !linkData?.properties?.hashed_token) return bad(500, 'Could not create sign-in');

  return ok({
    token_hash: linkData.properties.hashed_token,
    email: coach.email,
    customer_id: row.customer_id || null,
    customer_name: customerName,
    alpha_tag: alphaTag,
  });
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return bad(405, 'Method not allowed');
  try {
    let admin;
    try { admin = getSupabaseAdmin(); } catch (e) { return bad(500, 'Service not configured'); }

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }

    if (body.action === 'mint') return await mint(admin, event, body);
    if (body.action === 'exchange') return await exchange(admin, event, body);
    return bad(400, 'Unknown action');
  } catch (e) {
    return bad(500, e.message);
  }
};

// Exported for tests (src/__tests__/teamshopHandoff.test.js) — same pattern as teamshop-context.
module.exports._resetRateLimit = _resetRateLimit;
module.exports._sha256 = sha256;
