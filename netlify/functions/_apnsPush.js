// Apple Push Notification (APNs) sender for the NSA Team Portal iOS app.
// Underscore prefix = internal module, not an endpoint (same convention as
// _shared.js / _coachAuth.js).
//
// DORMANT until configured. sendToCustomer()/sendOne() no-op with
// {skipped:true} unless these env vars are set on the portal's Netlify site:
//   APNS_KEY_ID    — the 10-char Key ID of your APNs Auth Key (.p8)
//   APNS_TEAM_ID   — your Apple Developer Team ID
//   APNS_KEY       — the .p8 contents (PEM, or base64 of the PEM, or with \n)
//   APNS_BUNDLE_ID — optional; defaults to com.nationalsportsapparel.teamportal
//
// No third-party deps: token JWT is signed with Node crypto (ES256, raw R||S
// via dsaEncoding 'ieee-p1363'), delivery is Node http2 to Apple. See
// coach-ios/PUSH_NOTIFICATIONS.md for setup + where to call this from.
const http2 = require('http2');
const crypto = require('crypto');

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function isConfigured() {
  return !!(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && (process.env.APNS_KEY || process.env.APNS_AUTH_KEY));
}

// APNs auth JWT — valid up to 1h; Apple rate-limits token regeneration, so cache
// and reuse for ~50 min.
let _jwt = null;
let _jwtAt = 0;
function apnsJwt() {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  let key = process.env.APNS_KEY || process.env.APNS_AUTH_KEY;
  if (!keyId || !teamId || !key) return null;
  const now = Math.floor(Date.now() / 1000);
  if (_jwt && now - _jwtAt < 3000) return _jwt;
  if (!/BEGIN/.test(key)) { try { key = Buffer.from(key, 'base64').toString('utf8'); } catch { /* raw */ } }
  key = key.replace(/\\n/g, '\n');
  const signingInput = b64url(JSON.stringify({ alg: 'ES256', kid: keyId })) + '.' +
    b64url(JSON.stringify({ iss: teamId, iat: now }));
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  _jwt = signingInput + '.' + b64url(sig);
  _jwtAt = now;
  return _jwt;
}

const apnsHost = (env) => (env === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');
const reasonOf = (raw) => { try { return JSON.parse(raw).reason || null; } catch { return null; } };

// Send one notification. Resolves {ok, status, reason, dead} — never rejects.
// `dead` = the token should be disabled (unregistered / bad token).
function sendOne({ token, environment, notification }) {
  return new Promise((resolve) => {
    const jwt = apnsJwt();
    if (!jwt) return resolve({ ok: false, skipped: true, reason: 'apns-not-configured' });
    const topic = process.env.APNS_BUNDLE_ID || 'com.nationalsportsapparel.teamportal';
    let client;
    try { client = http2.connect(apnsHost(environment)); } catch (e) { return resolve({ ok: false, error: e.message }); }
    let settled = false;
    const done = (r) => { if (settled) return; settled = true; try { client.close(); } catch {} resolve(r); };
    client.on('error', (e) => done({ ok: false, error: e.message }));
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': topic,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    });
    let status = 0;
    let data = '';
    req.on('response', (h) => { status = h[':status']; });
    req.setEncoding('utf8');
    req.on('data', (d) => { data += d; });
    req.on('end', () => {
      const reason = data ? reasonOf(data) : null;
      const dead = status === 410 || reason === 'Unregistered' || reason === 'BadDeviceToken';
      done({ ok: status === 200, status, reason, dead });
    });
    req.on('error', (e) => done({ ok: false, error: e.message }));
    req.setTimeout(8000, () => done({ ok: false, error: 'timeout' }));
    req.end(JSON.stringify(notification));
  });
}

// Build the APNs payload from a simple {title, body, badge, data}.
function buildNotification({ title, body, badge, data }) {
  const aps = { alert: { title, body }, sound: 'default' };
  if (typeof badge === 'number') aps.badge = badge;
  return { aps, ...(data || {}) };
}

// Send to every live device of a team (customer_id). Loads tokens with the
// passed service-role client, sends, and disables any dead tokens. Returns
// {sent, failed, skipped}. No-op ({skipped:true}) when APNs isn't configured.
async function sendToCustomer(admin, customerId, payload) {
  if (!isConfigured()) return { skipped: true, reason: 'apns-not-configured' };
  if (!admin || !customerId) return { skipped: true, reason: 'no-admin-or-customer' };
  const { data: rows, error } = await admin
    .from('coach_push_tokens')
    .select('id,token,platform,environment')
    .eq('customer_id', String(customerId))
    .eq('disabled', false);
  if (error) return { error: error.message };
  const ios = (rows || []).filter((r) => r.platform === 'ios');
  const notification = buildNotification(payload);
  let sent = 0;
  let failed = 0;
  const dead = [];
  for (const r of ios) {
    const res = await sendOne({ token: r.token, environment: r.environment, notification });
    if (res.ok) sent++; else failed++;
    if (res.dead) dead.push(r.id);
  }
  if (dead.length) {
    await admin.from('coach_push_tokens').update({ disabled: true }).in('id', dead);
  }
  return { sent, failed, disabled: dead.length, androidSkipped: (rows || []).length - ios.length };
}

module.exports = { isConfigured, sendOne, sendToCustomer, buildNotification };
