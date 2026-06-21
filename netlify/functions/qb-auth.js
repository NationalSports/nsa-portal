// Netlify serverless function for QuickBooks Online OAuth2.
//   connect    → returns the Intuit authorization URL and sets a short-lived state cookie (CSRF).
//   callback   → validates state, exchanges the code, stores tokens SERVER-SIDE (qb_oauth_tokens,
//                service-role only), then redirects WITHOUT any tokens in the URL.
//   refresh    → refreshes the stored token in place (returns status only, never tokens).
//   disconnect → revokes at Intuit + clears the store (staff-only).
// Tokens never cross to the browser or appear in a URL — see _qb.js for the store.
const crypto = require('crypto');
const { verifyUser } = require('./_shared');
const { getSupabaseAdmin, httpsPost, basicAuth, saveTokens, getStoredTokens, clearTokens, refreshStoredTokens, revokeToken } = require('./_qb');

const QB_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const STATE_COOKIE = 'qb_oauth_state';

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
});
// HttpOnly + SameSite=Lax: not readable by JS, and sent on the top-level GET redirect Intuit
// makes back to the callback. Path-scoped to this function so it's only sent where it's needed.
const stateCookie = (val, maxAge) => `${STATE_COOKIE}=${val}; Path=/.netlify/functions/qb-auth; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
const readCookie = (event, name) => {
  const raw = event.headers?.cookie || event.headers?.Cookie || '';
  const hit = raw.split(/;\s*/).find((c) => c.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
};

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || '*';
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(origin), body: '' };

  const QB_CLIENT_ID = process.env.QB_CLIENT_ID;
  const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET;
  const SITE_URL = process.env.URL || process.env.SITE_URL || 'http://localhost:3000';
  const QB_REDIRECT_URI = process.env.QB_REDIRECT_URI || `${SITE_URL}/.netlify/functions/qb-auth?action=callback`;

  if (!QB_CLIENT_ID || !QB_CLIENT_SECRET) {
    return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ error: 'QuickBooks credentials not configured. Add QB_CLIENT_ID, QB_CLIENT_SECRET, QB_REDIRECT_URI to Netlify env vars.' }) };
  }

  const params = event.queryStringParameters || {};
  let action = params.action;
  let body = {};
  if (event.body) { try { body = JSON.parse(event.body); } catch { body = {}; } if (body.action) action = body.action; }

  // ── ACTION: debug ──
  if (action === 'debug') {
    return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({
      redirect_uri: QB_REDIRECT_URI, site_url: SITE_URL, has_explicit_redirect_uri: !!process.env.QB_REDIRECT_URI,
      client_id_prefix: QB_CLIENT_ID ? QB_CLIENT_ID.substring(0, 8) + '...' : 'NOT SET',
      hint: 'The redirect_uri above must EXACTLY match an entry in Intuit Developer > Keys & credentials > Redirect URIs.',
    }) };
  }

  // ── ACTION: connect ──
  // Returns the OAuth2 authorization URL and sets the CSRF state cookie.
  if (action === 'connect') {
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = `${QB_AUTH_URL}?client_id=${QB_CLIENT_ID}&response_type=code&scope=com.intuit.quickbooks.accounting&redirect_uri=${encodeURIComponent(QB_REDIRECT_URI)}&state=${state}`;
    return {
      statusCode: 200,
      headers: { ...corsHeaders(origin), 'Set-Cookie': stateCookie(state, 600) },
      body: JSON.stringify({ authUrl, redirect_uri: QB_REDIRECT_URI }),
    };
  }

  // ── ACTION: callback ──
  // Intuit redirects here after the user authorizes. Validate state, exchange code, store tokens.
  if (action === 'callback' || params.code) {
    const clearState = stateCookie('', 0);
    // CSRF: the state echoed back by Intuit must match the cookie set at connect.
    const cookieState = readCookie(event, STATE_COOKIE);
    if (!params.state || !cookieState || params.state !== cookieState) {
      return { statusCode: 302, headers: { Location: `${SITE_URL}/#/qb?error=state_mismatch`, 'Set-Cookie': clearState }, body: '' };
    }
    const code = params.code;
    const realmId = params.realmId;
    if (!code || !realmId) {
      return { statusCode: 302, headers: { Location: `${SITE_URL}/#/qb?error=missing_code`, 'Set-Cookie': clearState }, body: '' };
    }
    try {
      const tokenBody = `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(QB_REDIRECT_URI)}`;
      const result = await httpsPost(QB_TOKEN_URL, tokenBody, {
        'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': basicAuth(), 'Accept': 'application/json',
      });
      if (result.status !== 200 || !result.data?.access_token) {
        return { statusCode: 302, headers: { Location: `${SITE_URL}/#/qb?error=token_exchange_failed`, 'Set-Cookie': clearState }, body: '' };
      }
      // Persist tokens server-side ONLY. They never reach the browser or the redirect URL.
      await saveTokens(getSupabaseAdmin(), {
        realm_id: realmId,
        access_token: result.data.access_token,
        refresh_token: result.data.refresh_token,
        expires_in: result.data.expires_in,
        token_created_at: Date.now(),
      });
      return { statusCode: 302, headers: { Location: `${SITE_URL}/#/qb?qb_connected=1&realm=${encodeURIComponent(realmId)}`, 'Set-Cookie': clearState }, body: '' };
    } catch (err) {
      return { statusCode: 302, headers: { Location: `${SITE_URL}/#/qb?error=exception`, 'Set-Cookie': clearState }, body: '' };
    }
  }

  // ── ACTION: refresh ──
  // Refresh the stored access token in place. Returns status only — no tokens cross the wire.
  if (action === 'refresh') {
    try {
      const admin = getSupabaseAdmin();
      const cur = await getStoredTokens(admin);
      if (!cur) return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ ok: false, connected: false }) };
      const saved = await refreshStoredTokens(admin, cur);
      return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ ok: true, connected: true, token_created_at: saved.token_created_at }) };
    } catch (err) {
      return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ ok: false, error: err.message }) };
    }
  }

  // ── ACTION: disconnect ──
  // Revoke at Intuit + clear the store. Staff-only (no token is accepted from the client).
  if (action === 'disconnect') {
    const v = await verifyUser(event);
    if (!v.ok) return { statusCode: v.status, headers: corsHeaders(origin), body: JSON.stringify({ error: v.error }) };
    try {
      const admin = getSupabaseAdmin();
      const cur = await getStoredTokens(admin);
      if (cur) { await revokeToken(cur.refresh_token || cur.access_token); await clearTokens(admin); }
    } catch { /* best effort */ }
    return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true }) };
  }

  return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Unknown action. Use: connect, callback, refresh, disconnect' }) };
};
