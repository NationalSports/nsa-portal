// Netlify serverless function for QuickBooks Online OAuth2
// Handles: connect (redirect to Intuit), callback (exchange code for tokens), refresh, disconnect
const https = require('https');
const crypto = require('crypto');

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
});

// QB OAuth endpoints
const QB_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST', headers };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || '*';
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(origin), body: '' };
  }

  const QB_CLIENT_ID = process.env.QB_CLIENT_ID;
  const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET;
  const SITE_URL = process.env.URL || process.env.SITE_URL || 'http://localhost:3000';
  const QB_REDIRECT_URI = process.env.QB_REDIRECT_URI || `${SITE_URL}/.netlify/functions/qb-auth?action=callback`;

  if (!QB_CLIENT_ID || !QB_CLIENT_SECRET) {
    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({ error: 'QuickBooks credentials not configured. Add QB_CLIENT_ID, QB_CLIENT_SECRET, QB_REDIRECT_URI to Netlify env vars.' }),
    };
  }

  // Parse action from query params or body
  const params = event.queryStringParameters || {};
  let action = params.action;
  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch { body = {}; }
    if (body.action) action = body.action;
  }

  const basicAuth = 'Basic ' + Buffer.from(QB_CLIENT_ID + ':' + QB_CLIENT_SECRET).toString('base64');

  // ── ACTION: debug ──
  // Returns the current redirect_uri configuration for troubleshooting
  if (action === 'debug') {
    return {
      statusCode: 200,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        redirect_uri: QB_REDIRECT_URI,
        site_url: SITE_URL,
        has_explicit_redirect_uri: !!process.env.QB_REDIRECT_URI,
        client_id_prefix: QB_CLIENT_ID ? QB_CLIENT_ID.substring(0, 8) + '...' : 'NOT SET',
        hint: 'The redirect_uri above must EXACTLY match what is listed in your Intuit Developer portal under Keys & credentials > Redirect URIs.',
      }),
    };
  }

  // ── ACTION: connect ──
  // Returns the OAuth2 authorization URL for the frontend to redirect to
  if (action === 'connect') {
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = `${QB_AUTH_URL}?client_id=${QB_CLIENT_ID}&response_type=code&scope=com.intuit.quickbooks.accounting&redirect_uri=${encodeURIComponent(QB_REDIRECT_URI)}&state=${state}`;
    return {
      statusCode: 200,
      headers: corsHeaders(origin),
      body: JSON.stringify({ authUrl, state, redirect_uri: QB_REDIRECT_URI }),
    };
  }

  // ── ACTION: callback ──
  // Intuit redirects here after user authorizes. Exchange code for tokens.
  if (action === 'callback' || params.code) {
    const code = params.code;
    const realmId = params.realmId;

    if (!code || !realmId) {
      // Redirect back to app with error
      return { statusCode: 302, headers: { Location: `${SITE_URL}/#/qb?error=missing_code` }, body: '' };
    }

    try {
      const tokenBody = `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(QB_REDIRECT_URI)}`;
      const result = await httpsPost(QB_TOKEN_URL, tokenBody, {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': basicAuth,
        'Accept': 'application/json',
      });

      if (result.status !== 200 || !result.data?.access_token) {
        return { statusCode: 302, headers: { Location: `${SITE_URL}/#/qb?error=token_exchange_failed` }, body: '' };
      }

      // Redirect back to app with tokens encoded in hash (stays client-side, not logged in server)
      const tokenData = {
        access_token: result.data.access_token,
        refresh_token: result.data.refresh_token,
        expires_in: result.data.expires_in,
        realm_id: realmId,
        token_type: result.data.token_type,
        created_at: Date.now(),
      };
      const encoded = Buffer.from(JSON.stringify(tokenData)).toString('base64');
      return { statusCode: 302, headers: { Location: `${SITE_URL}/#/qb?tokens=${encoded}` }, body: '' };
    } catch (err) {
      return { statusCode: 302, headers: { Location: `${SITE_URL}/#/qb?error=exception` }, body: '' };
    }
  }

  // ── ACTION: refresh ──
  // Refresh an expired access token
  if (action === 'refresh') {
    const refreshToken = body.refresh_token;
    if (!refreshToken) {
      return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ error: 'refresh_token required' }) };
    }

    try {
      const tokenBody = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;
      const result = await httpsPost(QB_TOKEN_URL, tokenBody, {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': basicAuth,
        'Accept': 'application/json',
      });

      if (result.status !== 200 || !result.data?.access_token) {
        return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Token refresh failed', details: result.data }) };
      }

      return {
        statusCode: 200,
        headers: corsHeaders(origin),
        body: JSON.stringify({
          access_token: result.data.access_token,
          refresh_token: result.data.refresh_token,
          expires_in: result.data.expires_in,
          created_at: Date.now(),
        }),
      };
    } catch (err) {
      return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Refresh failed: ' + err.message }) };
    }
  }

  // ── ACTION: disconnect ──
  // Revoke tokens
  if (action === 'disconnect') {
    const token = body.refresh_token || body.access_token;
    if (token) {
      try {
        await httpsPost(QB_REVOKE_URL, `token=${encodeURIComponent(token)}`, {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': basicAuth,
          'Accept': 'application/json',
        });
      } catch { /* best effort */ }
    }
    return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true }) };
  }

  return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Unknown action. Use: connect, callback, refresh, disconnect' }) };
};
