// Netlify serverless function to proxy Richardson Sports API calls (avoids CORS)
// Richardson API details TBD — endpoint returned 403, may require dealer credentials or IP allowlist
// Fallback: Richardson products are also available via S&S Activewear API
//
// Environment variables required:
//   RICHARDSON_API_KEY      — API key or bearer token (TBD)
//   RICHARDSON_API_BASE_URL — base URL (default: https://dev-api.richardsonsports.com/api)
//
// Query parameters:
//   path — the API endpoint path (e.g. /products, /inventory)

exports.handler = async (event) => {
  const apiKey = process.env.RICHARDSON_API_KEY;
  const baseUrl = (process.env.RICHARDSON_API_BASE_URL || 'https://dev-api.richardsonsports.com/api').replace(/\/+$/, '');

  if (!apiKey) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'RICHARDSON_API_KEY not configured in environment variables' }) };
  }

  const path = event.queryStringParameters?.path || '/products';
  const url = `${baseUrl}${path}`;

  try {
    const response = await fetch(url, {
      method: event.httpMethod === 'POST' ? 'POST' : 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      redirect: 'manual',
      ...(event.body ? { body: event.body } : {}),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') || '';
      return { statusCode: 502, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Richardson API redirected to ${location}. Check RICHARDSON_API_BASE_URL. Tried: ${url}` }) };
    }

    const data = await response.text();

    if (data.trimStart().startsWith('<')) {
      return { statusCode: 502, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Richardson API returned HTML instead of JSON. Check RICHARDSON_API_BASE_URL. Tried: ${url}` }) };
    }

    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: data,
    };
  } catch (error) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Richardson API call failed: ${error.message}. Tried: ${url}` }) };
  }
};
