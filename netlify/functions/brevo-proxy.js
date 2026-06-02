// Netlify serverless function to proxy Brevo API calls from the browser.
// Keeps Brevo credentials server-side only (never exposed to the browser).
//
// Outbound Brevo traffic is funnelled through ./lib/brevo, which routes via the
// static-IP relay (BREVO_RELAY_URL) when configured so Brevo only ever sees one
// IP. See /brevo-relay/README.md.
//
// Endpoints (selected via the ?endpoint= query param):
//   (default) — POST: forwards the JSON body to Brevo's /v3/smtp/email
//   stats     — GET:  proxies /v3/smtp/statistics/events for open tracking
//                     (?endpoint=stats&messageId=...&event=opened&limit=1)

const { brevoFetch, brevoConfigured } = require('./lib/brevo');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

exports.handler = async (event) => {
  if (!brevoConfigured()) {
    return { statusCode: 500, headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'Brevo not configured (set BREVO_RELAY_URL or BREVO_API_KEY)' }) };
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
      const path = '/v3/smtp/statistics/events'
        + '?messageId=' + encodeURIComponent(qs.messageId)
        + '&event=' + encodeURIComponent(qs.event || 'opened')
        + '&limit=' + encodeURIComponent(qs.limit || '1');
      const response = await brevoFetch(path, { method: 'GET' });
      const data = await response.text();
      return { statusCode: response.status, headers: JSON_HEADERS, body: data };
    }

    // ── Transactional email send (POST) ──
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'Method not allowed. Use POST.' }) };
    }
    const response = await brevoFetch('/v3/smtp/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: event.body,
    });
    const data = await response.text();
    return { statusCode: response.status, headers: JSON_HEADERS, body: data };
  } catch (error) {
    return { statusCode: 500, headers: JSON_HEADERS,
      body: JSON.stringify({ error: `Brevo API call failed: ${error.message}` }) };
  }
};
