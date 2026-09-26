// Netlify serverless function to proxy Brevo API calls.
// Keeps the BREVO_API_KEY server-side only (never exposed to the browser).
//
// Environment variables required:
//   BREVO_API_KEY — your Brevo API key
//
// Endpoints (selected via the ?endpoint= query param):
//   (default) — POST: forwards the JSON body to Brevo's /v3/smtp/email
//   stats     — GET:  proxies /v3/smtp/statistics/events for open tracking
//                     (?endpoint=stats&messageId=...&event=opened&limit=1)

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const { verifyUser } = require('./_shared');
const { retryStatus } = require('./_emailFirewallRetry');
const { checkGmailDelivery } = require('./_gmailDelivery');
const { sendPortalEmail } = require('./_emailRouter');

exports.handler = async (event) => {
  const apiKey = process.env.BREVO_API_KEY;


  // Staff-only: this forwards arbitrary content to Brevo's send API with the
  // company key — unauthenticated it was an open relay from the verified sender
  // domain. Public surfaces no longer need it: storefront confirmations are sent
  // by webstore-checkout/stripe-webhook, and the public quote form notifies reps
  // via the content-locked quote-notify function.
  const v = await verifyUser(event);
  if (!v.ok) {
    return { statusCode: v.status, headers: JSON_HEADERS, body: JSON.stringify({ error: v.error }) };
  }

  const endpoint = (event.queryStringParameters && event.queryStringParameters.endpoint) || 'email';

  try {
    // ── Open-tracking stats lookup (GET) ──
    if (endpoint === 'stats') {
      const qs = event.queryStringParameters || {};
      if (!qs.messageId) {
        return { statusCode: 400, headers: JSON_HEADERS,
          body: JSON.stringify({ error: 'messageId query param is required for stats' }) };
      }
      if (String(qs.messageId).startsWith('gmail:')) {
        const delivery = await checkGmailDelivery(qs.messageId);
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ delivery }) };
      }
      if (!apiKey) return { statusCode: 503, headers: JSON_HEADERS, body: JSON.stringify({ error: 'BREVO_API_KEY not configured' }) };
      // `event` is OPTIONAL on Brevo's side, and omitting it returns EVERY event for the
      // message — opens, bounces, blocks, spam, deferrals — in one call. The caller needs
      // all of them to tell "delivered but unread" apart from "never arrived", and one
      // unfiltered call is cheaper than one call per event type. Only forward the filter
      // when a caller explicitly asks for a single event.
      const url = 'https://api.brevo.com/v3/smtp/statistics/events'
        + '?messageId=' + encodeURIComponent(qs.messageId)
        + (qs.event ? '&event=' + encodeURIComponent(qs.event) : '')
        + '&limit=' + encodeURIComponent(qs.limit || '1');
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'accept': 'application/json', 'api-key': apiKey },
      });
      const data = await response.text();
      if (response.ok) {
        const automaticRetry = await retryStatus(v.admin, qs.messageId);
        if (automaticRetry) {
          try { return { statusCode: response.status, headers: JSON_HEADERS, body: JSON.stringify({ ...JSON.parse(data), automaticRetry }) }; }
          catch (_) { /* preserve the provider response if it is not JSON */ }
        }
      }
      return { statusCode: response.status, headers: JSON_HEADERS, body: data };
    }

    // ── Transactional email send (POST) ──
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'Method not allowed. Use POST.' }) };
    }
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid email payload');
      const isSaveGuardAlert = payload.sender && payload.sender.name === 'NSA Portal'
        && /^⚠️ NSA Portal — (?:Save blocked|Save protection triggered|Save not persisting|data-loss alerts throttled)/.test(payload.subject || '');
      // Old browser bundles can remain open with durable recovery entries that correctly block
      // their auto-reload. Their writes are fail-closed, but before protocol v2 they could still
      // repeat the same admin alert storm after every background cycle. Suppress only those legacy
      // save-guard emails; their audit rows remain in System Health. Current clients carry v2.
      if (isSaveGuardAlert && payload.portalAlertVersion !== 2) {
        return { statusCode: 202, headers: JSON_HEADERS,
          body: JSON.stringify({ messageId: null, suppressed: true, reason: 'stale-portal-alert-client' }) };
      }
      delete payload.portalAlertVersion;
    } catch (_) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Invalid email payload' }) };
    }
    const { status, ...data } = await sendPortalEmail(v.admin, payload);
    return { statusCode: status, headers: JSON_HEADERS, body: JSON.stringify(data) };
  } catch (error) {
    return { statusCode: 500, headers: JSON_HEADERS,
      body: JSON.stringify({ error: `Brevo API call failed: ${error.message}` }) };
  }
};
