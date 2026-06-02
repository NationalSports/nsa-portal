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

exports.handler = async (event) => {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'BREVO_API_KEY not configured in environment variables' }) };
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
      const url = 'https://api.brevo.com/v3/smtp/statistics/events'
        + '?messageId=' + encodeURIComponent(qs.messageId)
        + '&event=' + encodeURIComponent(qs.event || 'opened')
        + '&limit=' + encodeURIComponent(qs.limit || '1');
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'accept': 'application/json', 'api-key': apiKey },
      });
      const data = await response.text();
      return { statusCode: response.status, headers: JSON_HEADERS, body: data };
    }

    // ── Transactional email send (POST) ──
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'Method not allowed. Use POST.' }) };
    }
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      body: event.body,
    });
    const data = await response.text();
    return { statusCode: response.status, headers: JSON_HEADERS, body: data };
  } catch (error) {
    return { statusCode: 500, headers: JSON_HEADERS,
      body: JSON.stringify({ error: `Brevo API call failed: ${error.message}` }) };
  }
};
