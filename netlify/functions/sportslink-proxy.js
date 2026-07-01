// Netlify serverless function to proxy Sports Inc "SportsLink" API calls.
// Keeps the dealer API key server-side and avoids browser CORS. REST/JSON,
// auth via the X-API-KEY request header.
// Docs: https://api.sportsinc.com/
//
// Environment variables:
//   SPORTSLINK_API_KEY       — dealer API key (request from mhoerner@hq.sportsinc.com)
//   SPORTSLINK_API_BASE_URL  — optional; defaults to https://api.sportsinc.com/
//
// Query parameters:
//   path — the API path, e.g. dealers/documents/?active=true&lines=true
//          or dealers/documents/status (PATCH)
//
// Gated by verifyUserOrInternal so signed-in staff (JWT) and the background sync
// job (X-Internal-Secret) can both call it, but the public cannot.

const { verifyUserOrInternal } = require('./_shared');

exports.handler = async (event) => {
  const v = await verifyUserOrInternal(event);
  if (!v.ok) return { statusCode: v.status || 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: v.error || 'Unauthorized' }) };

  const apiKey = process.env.SPORTSLINK_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'SPORTSLINK_API_KEY not configured in environment variables' }) };
  }
  // Normalize the base to exactly one trailing slash so base + path joins cleanly.
  const base = (process.env.SPORTSLINK_API_BASE_URL || 'https://api.sportsinc.com/').replace(/\/+$/, '') + '/';
  const path = (event.queryStringParameters?.path || 'dealers/documents/').replace(/^\/+/, '');
  const url = base + path;

  // Only GET (read documents) and PATCH (set active/historical status) are used.
  const method = event.httpMethod === 'PATCH' ? 'PATCH' : 'GET';

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'NSA-Portal/1.0 (nationalsportsapparel.com)',
      },
      ...(method === 'PATCH' && event.body ? { body: event.body } : {}),
    });

    // 204 (PATCH success) has no body; pass through an empty object so callers can json() safely.
    const data = await response.text();
    // Log upstream failures (status + body) so the real reason lands in the function logs, not
    // just a bare status code in the browser — the SportsLink API hides the cause in problem+json.
    if (!response.ok) {
      console.error('[sportslink-proxy]', method, url, '→', response.status, (data || '').slice(0, 500));
    }
    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: data || '{}',
    };
  } catch (error) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Sports Inc API call failed: ${error.message}` }) };
  }
};
