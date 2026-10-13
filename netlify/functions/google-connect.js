// Connect a rep's own Google account (Gmail + Calendar) to the portal.
//   POST {action:'status'}     → { configured, connected, google_email, last_synced_at, last_error }
//   POST {action:'connect'}    → { authUrl } and a short-lived HttpOnly state cookie (CSRF)
//   GET  ?code&state           → Google's redirect back; stores the encrypted refresh token,
//                                then sends the browser to /?pg=my_email
//   POST {action:'disconnect'} → revokes at Google and deletes the stored token
// Tokens never reach the browser or a URL. Same shape as qb-auth.js.
const { corsHeaders, verifyUser, getSupabaseAdmin } = require('./_shared');
const { requestOrigin } = require('./_qbOAuthRedirect');
const {
  signState, verifyState, buildAuthUrl, exchangeCode, fetchGoogleEmail, saveLink, getLink, revokeLink,
} = require('./_repGoogle');

const STATE_COOKIE = 'rep_google_state';
const FN_PATH = '/.netlify/functions/google-connect';
const stateCookie = (val, maxAge) => `${STATE_COOKIE}=${val}; Path=${FN_PATH}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
const readCookie = (event, name) => {
  const raw = event.headers?.cookie || event.headers?.Cookie || '';
  const hit = raw.split(/;\s*/).find((c) => c.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
};
const json = (statusCode, body, extra = {}) => ({ statusCode, headers: { ...corsHeaders(), ...extra }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  const siteUrl = process.env.URL || 'http://localhost:3000';
  const origin = requestOrigin(event, siteUrl);
  const redirectUri = origin + FN_PATH;
  const params = event.queryStringParameters || {};

  // ── Google's redirect back (browser GET, no portal bearer token) ──
  if (event.httpMethod === 'GET' && (params.code || params.error || params.state)) {
    const clear = stateCookie('', 0);
    const back = (values) => ({
      statusCode: 302,
      headers: { Location: `${origin}/?${new URLSearchParams({ pg: 'my_email', ...values }).toString()}`, 'Set-Cookie': clear },
      body: '',
    });
    const cookieState = readCookie(event, STATE_COOKIE);
    if (!params.state || !cookieState || params.state !== cookieState) return back({ google: 'state_mismatch' });
    const state = verifyState(params.state);
    if (!state) return back({ google: 'state_invalid' });
    if (params.error) return back({ google: params.error === 'access_denied' ? 'denied' : 'error' });
    try {
      const tokens = await exchangeCode(params.code, redirectUri);
      if (!tokens.refresh_token) return back({ google: 'no_refresh_token' });
      const googleEmail = await fetchGoogleEmail(tokens.access_token);
      await saveLink(getSupabaseAdmin(), {
        teamMemberId: state.tm,
        googleEmail,
        refreshToken: tokens.refresh_token,
        scopes: tokens.scope,
      });
      return back({ google: 'connected' });
    } catch (err) {
      console.error('[google-connect] callback failed:', err.message);
      return back({ google: 'error' });
    }
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const auth = await verifyUser(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { body = {}; }
  const admin = auth.admin;
  const configured = !!(process.env.GOOGLE_WEB_CLIENT_ID && process.env.GOOGLE_WEB_CLIENT_SECRET && process.env.GOOGLE_TOKEN_ENC_KEY);

  try {
    if (body.action === 'status') {
      const link = await getLink(admin, auth.teamMemberId);
      return json(200, {
        configured,
        connected: !!link,
        google_email: link?.google_email || null,
        last_synced_at: link?.last_synced_at || null,
        last_error: link?.last_error || null,
      });
    }

    if (body.action === 'connect') {
      if (!configured) return json(400, { error: 'Google sign-in is not set up yet. Add GOOGLE_WEB_CLIENT_ID, GOOGLE_WEB_CLIENT_SECRET and GOOGLE_TOKEN_ENC_KEY in Netlify.' });
      const { data: tm } = await admin.from('team_members').select('email').eq('id', auth.teamMemberId).maybeSingle();
      const state = signState(auth.teamMemberId);
      return json(200, { authUrl: buildAuthUrl(redirectUri, state, tm?.email || ''), redirect_uri: redirectUri }, { 'Set-Cookie': stateCookie(state, 900) });
    }

    if (body.action === 'disconnect') {
      const link = await getLink(admin, auth.teamMemberId);
      if (link) await revokeLink(admin, link);
      return json(200, { ok: true });
    }

    return json(400, { error: 'Unknown action' });
  } catch (err) {
    console.error('[google-connect]', body.action, err.message);
    return json(500, { error: err.message });
  }
};
