// Per-rep Google OAuth (Gmail + Calendar) for "My Email".
//
// Unlike _gmailAi.js (one shared sales@ mailbox, token in env), every rep
// connects their own Google account from the portal. The refresh token is
// AES-256-GCM encrypted with GOOGLE_TOKEN_ENC_KEY and stored in
// rep_google_links, a table only the service role can read. Access tokens are
// minted per request and never leave the server.
//
// Env: GOOGLE_WEB_CLIENT_ID, GOOGLE_WEB_CLIENT_SECRET (a "Web application"
// OAuth client in the same Google Cloud project as the Gmail AI inbox), and
// GOOGLE_TOKEN_ENC_KEY (openssl rand -base64 32).
const crypto = require('crypto');
const { encryptField, decryptField } = require('./_onboardingCrypto');

const ENC_KEY_ENV = 'GOOGLE_TOKEN_ENC_KEY';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

// gmail.compose covers both "save to Gmail drafts" and "send" for portal replies.
const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.readonly',
];

function googleCredentials() {
  const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_WEB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google sign-in is not configured (GOOGLE_WEB_CLIENT_ID / GOOGLE_WEB_CLIENT_SECRET)');
  return { clientId, clientSecret };
}

// OAuth state carries the team member id so the callback (a plain browser
// redirect with no portal bearer token) knows whose mailbox was connected.
// It is HMAC-signed AND must match the HttpOnly cookie set at connect time.
function stateSecret() {
  const base = process.env.GOOGLE_TOKEN_ENC_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base) throw new Error('No secret available to sign Google OAuth state');
  return crypto.createHash('sha256').update('rep-google-state:' + base).digest();
}

function signState(teamMemberId) {
  const payload = Buffer.from(JSON.stringify({ tm: teamMemberId, n: crypto.randomBytes(12).toString('hex'), t: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyState(state) {
  const [payload, sig] = String(state || '').split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.tm || Date.now() - Number(data.t || 0) > 15 * 60 * 1000) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function buildAuthUrl(redirectUri, state, loginHint) {
  const { clientId } = googleCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    // Force the consent screen so Google always returns a refresh token.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(body) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const err = new Error(`Google token request failed (${response.status}): ${data.error_description || data.error || 'unknown error'}`);
    err.googleError = data.error || null;
    throw err;
  }
  return data;
}

async function exchangeCode(code, redirectUri) {
  const { clientId, clientSecret } = googleCredentials();
  return tokenRequest({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
}

async function fetchGoogleEmail(accessToken) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.email) throw new Error('Could not read the Google account email');
  return String(data.email).toLowerCase();
}

async function saveLink(admin, { teamMemberId, googleEmail, refreshToken, scopes }) {
  const row = {
    team_member_id: teamMemberId,
    google_email: googleEmail,
    refresh_token_enc: encryptField(refreshToken, ENC_KEY_ENV),
    scopes: scopes || SCOPES.join(' '),
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from('rep_google_links').upsert(row, { onConflict: 'team_member_id' });
  if (error) throw new Error(`Saving Google link failed: ${error.message}`);
}

async function getLink(admin, teamMemberId) {
  const { data, error } = await admin.from('rep_google_links').select('*').eq('team_member_id', teamMemberId).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

// Returns a fresh access token for a stored link. If Google says the grant is
// gone (revoked / password change), records the error so the UI can prompt a reconnect.
async function accessTokenForLink(admin, link) {
  const { clientId, clientSecret } = googleCredentials();
  const refreshToken = decryptField(link.refresh_token_enc, ENC_KEY_ENV);
  if (!refreshToken) throw new Error('Stored Google token is unreadable; reconnect Google');
  try {
    const data = await tokenRequest({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' });
    return data.access_token;
  } catch (err) {
    if (err.googleError === 'invalid_grant') {
      await admin.from('rep_google_links').update({
        last_error: 'Google access was revoked or expired. Reconnect Google.',
        updated_at: new Date().toISOString(),
      }).eq('team_member_id', link.team_member_id);
    }
    throw err;
  }
}

async function revokeLink(admin, link) {
  try {
    const refreshToken = decryptField(link.refresh_token_enc, ENC_KEY_ENV);
    if (refreshToken) {
      await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' });
    }
  } catch (_) {
    // Best effort — the row is deleted either way so the portal stops using it.
  }
  const { error } = await admin.from('rep_google_links').delete().eq('team_member_id', link.team_member_id);
  if (error) throw new Error(error.message);
}

module.exports = {
  SCOPES,
  signState,
  verifyState,
  buildAuthUrl,
  exchangeCode,
  fetchGoogleEmail,
  saveLink,
  getLink,
  accessTokenForLink,
  revokeLink,
};
