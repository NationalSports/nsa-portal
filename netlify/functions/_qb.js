// Shared QuickBooks Online token helpers. Tokens live ONLY in the service-role-only
// qb_oauth_tokens table (migration 00134) — never in the browser, app_state, or a URL.
// Both qb-auth (OAuth) and qb-api (proxy) use these so storage + refresh live in one place.
const https = require('https');
const { getSupabaseAdmin } = require('./_shared');

const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const QB_BASE = 'https://quickbooks.api.intuit.com';
const QB_SANDBOX = 'https://sandbox-quickbooks.api.intuit.com';
// QB access tokens last 60 min; refresh a little early so an in-flight call never uses a dead one.
const ACCESS_TTL_MS = 3300000; // 55 min
const COMPANY_KEYS = new Set(['national', 'methodic']);

function normalizeCompanyKey(value) {
  const key = String(value || 'national').trim().toLowerCase();
  if (!COMPANY_KEYS.has(key)) throw new Error('Unknown QuickBooks company.');
  return key;
}

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

function qbCredentials(companyKey = 'national') {
  const key = normalizeCompanyKey(companyKey);
  const prefix = key === 'methodic' ? 'METHODIC_' : '';
  return {
    clientId: process.env[`${prefix}QB_CLIENT_ID`] || process.env.QB_CLIENT_ID,
    clientSecret: process.env[`${prefix}QB_CLIENT_SECRET`] || process.env.QB_CLIENT_SECRET,
  };
}

function basicAuth(companyKey = 'national') {
  const credentials = qbCredentials(companyKey);
  return 'Basic ' + Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
}

async function getStoredTokens(admin, companyKey = 'national') {
  const key = normalizeCompanyKey(companyKey);
  let query = admin.from('qb_oauth_tokens').select('*');
  // The guard preserves the existing token-race unit-test fake and lets National
  // continue reading the legacy one-row table while the migration is rolling out.
  if (typeof query.eq === 'function') query = query.eq('company_key', key);
  let result = await query.order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (result.error && key === 'national' && /company_key|column/i.test(result.error.message || '')) {
    result = await admin.from('qb_oauth_tokens').select('*')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  }
  const { data, error } = result;
  if (error) throw new Error('QB token read failed: ' + error.message);
  if (data?.company_key && data.company_key !== key) return null;
  return data || null;
}

async function saveTokens(admin, t, companyKey = t.company_key || 'national') {
  const key = normalizeCompanyKey(companyKey);
  const row = {
    company_key: key,
    realm_id: t.realm_id,
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_in: t.expires_in != null ? t.expires_in : null,
    token_created_at: t.token_created_at || Date.now(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from('qb_oauth_tokens').upsert(row, { onConflict: 'company_key' });
  if (error) throw new Error('QB token write failed: ' + error.message);
  return row;
}

async function clearTokens(admin, companyKey = 'national') {
  const key = normalizeCompanyKey(companyKey);
  const deletion = admin.from('qb_oauth_tokens').delete();
  const { error } = typeof deletion.eq === 'function'
    ? await deletion.eq('company_key', key)
    : await deletion.neq('realm_id', '');
  if (error) throw new Error('QB token clear failed: ' + error.message);
}

// Exchange the stored refresh token for a fresh access token and persist it.
async function refreshStoredTokens(admin, current, companyKey = current.company_key || 'national') {
  const key = normalizeCompanyKey(companyKey);
  const result = await httpsPost(QB_TOKEN_URL,
    `grant_type=refresh_token&refresh_token=${encodeURIComponent(current.refresh_token)}`,
    { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': basicAuth(key), 'Accept': 'application/json' });
  if (result.status !== 200 || !result.data || !result.data.access_token) {
    const e = new Error('QB token refresh failed'); e.code = 'REFRESH_FAILED'; e.details = result.data; throw e;
  }
  return saveTokens(admin, {
    company_key: key,
    realm_id: current.realm_id,
    access_token: result.data.access_token,
    // QB rotates refresh tokens periodically; keep the existing one if none is returned.
    refresh_token: result.data.refresh_token || current.refresh_token,
    expires_in: result.data.expires_in,
    token_created_at: Date.now(),
  }, key);
}

// Return a currently-valid { access_token, realm_id }, refreshing server-side if stale.
// Throws an error with code 'NOT_CONNECTED' when no tokens are stored.
async function getValidAccessToken(admin, companyKey = 'national') {
  const key = normalizeCompanyKey(companyKey);
  let row = await getStoredTokens(admin, key);
  if (!row) { const e = new Error('QuickBooks not connected'); e.code = 'NOT_CONNECTED'; throw e; }
  if (Date.now() - (Number(row.token_created_at) || 0) > ACCESS_TTL_MS) {
    try {
      row = await refreshStoredTokens(admin, row, key);
    } catch (e) {
      // Refresh race: two concurrent calls can both see a stale row and race the rotating
      // refresh token — the loser's exchange fails at Intuit even though the winner already
      // stored a fresh pair. Re-read before surfacing REFRESH_FAILED; if another caller
      // refreshed while we were in flight, use its tokens instead of forcing a spurious
      // "reconnect QuickBooks" on staff.
      if (e && e.code === 'REFRESH_FAILED') {
        const latest = await getStoredTokens(admin, key);
        if (latest && latest.access_token && latest.access_token !== row.access_token &&
            Date.now() - (Number(latest.token_created_at) || 0) <= ACCESS_TTL_MS) {
          return { access_token: latest.access_token, realm_id: latest.realm_id };
        }
      }
      throw e;
    }
  }
  return { access_token: row.access_token, realm_id: row.realm_id };
}

function qbRequest(method, path, accessToken, body, useSandbox) {
  const base = useSandbox ? QB_SANDBOX : QB_BASE;
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    // Fail before the Netlify function's hard timeout so callers receive a
    // structured error instead of an ambiguous function timeout.
    req.setTimeout(8000, () => req.destroy(new Error('QBO upstream request timed out')));
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function revokeToken(token, companyKey = 'national') {
  if (!token) return;
  try {
    await httpsPost(QB_REVOKE_URL, `token=${encodeURIComponent(token)}`,
      { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': basicAuth(companyKey), 'Accept': 'application/json' });
  } catch { /* best effort */ }
}

module.exports = {
  getSupabaseAdmin, httpsPost, basicAuth, qbCredentials, normalizeCompanyKey, qbRequest,
  getStoredTokens, saveTokens, clearTokens, refreshStoredTokens, getValidAccessToken, revokeToken,
};
