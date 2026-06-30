// Shared QuickBooks Online token helpers. Tokens live ONLY in the service-role-only
// qb_oauth_tokens table (migration 00134) — never in the browser, app_state, or a URL.
// Both qb-auth (OAuth) and qb-api (proxy) use these so storage + refresh live in one place.
const https = require('https');
const { getSupabaseAdmin } = require('./_shared');

const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
// QB access tokens last 60 min; refresh a little early so an in-flight call never uses a dead one.
const ACCESS_TTL_MS = 3300000; // 55 min

function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST', headers };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, data }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function basicAuth() {
  return 'Basic ' + Buffer.from(`${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`).toString('base64');
}

async function getStoredTokens(admin) {
  const { data, error } = await admin.from('qb_oauth_tokens')
    .select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error('QB token read failed: ' + error.message);
  return data || null;
}

async function saveTokens(admin, t) {
  const row = {
    realm_id: t.realm_id,
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_in: t.expires_in != null ? t.expires_in : null,
    token_created_at: t.token_created_at || Date.now(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from('qb_oauth_tokens').upsert(row, { onConflict: 'realm_id' });
  if (error) throw new Error('QB token write failed: ' + error.message);
  return row;
}

async function clearTokens(admin) {
  // Single QB connection — clear every row.
  const { error } = await admin.from('qb_oauth_tokens').delete().neq('realm_id', '');
  if (error) throw new Error('QB token clear failed: ' + error.message);
}

// Exchange the stored refresh token for a fresh access token and persist it.
async function refreshStoredTokens(admin, current) {
  const result = await httpsPost(QB_TOKEN_URL,
    `grant_type=refresh_token&refresh_token=${encodeURIComponent(current.refresh_token)}`,
    { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': basicAuth(), 'Accept': 'application/json' });
  if (result.status !== 200 || !result.data || !result.data.access_token) {
    const e = new Error('QB token refresh failed'); e.code = 'REFRESH_FAILED'; e.details = result.data; throw e;
  }
  return saveTokens(admin, {
    realm_id: current.realm_id,
    access_token: result.data.access_token,
    // QB rotates refresh tokens periodically; keep the existing one if none is returned.
    refresh_token: result.data.refresh_token || current.refresh_token,
    expires_in: result.data.expires_in,
    token_created_at: Date.now(),
  });
}

// Return a currently-valid { access_token, realm_id }, refreshing server-side if stale.
// Throws an error with code 'NOT_CONNECTED' when no tokens are stored.
async function getValidAccessToken(admin) {
  let row = await getStoredTokens(admin);
  if (!row) { const e = new Error('QuickBooks not connected'); e.code = 'NOT_CONNECTED'; throw e; }
  if (Date.now() - (Number(row.token_created_at) || 0) > ACCESS_TTL_MS) {
    row = await refreshStoredTokens(admin, row);
  }
  return { access_token: row.access_token, realm_id: row.realm_id };
}

async function revokeToken(token) {
  if (!token) return;
  try {
    await httpsPost(QB_REVOKE_URL, `token=${encodeURIComponent(token)}`,
      { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': basicAuth(), 'Accept': 'application/json' });
  } catch { /* best effort */ }
}

module.exports = {
  getSupabaseAdmin, httpsPost, basicAuth,
  getStoredTokens, saveTokens, clearTokens, refreshStoredTokens, getValidAccessToken, revokeToken,
};
