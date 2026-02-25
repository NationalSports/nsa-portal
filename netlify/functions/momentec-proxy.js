// Netlify serverless function to proxy Momentec Brands API calls (avoids CORS)
// Momentec API docs may require dealer login — check https://www.momentecbrands.com/api
//
// Environment variables required:
//   MOMENTEC_API_KEY      — API key or bearer token (TBD)
//   MOMENTEC_API_BASE_URL — base URL (default: https://www.momentecbrands.com/api)
//
// Query parameters:
//   path — the API endpoint path (e.g. /products, /inventory)

exports.handler = async (event) => {
  const apiKey = process.env.MOMENTEC_API_KEY;
  const baseUrl = (process.env.MOMENTEC_API_BASE_URL || 'https://www.momentecbrands.com/api').replace(/\/+$/, '');

  if (!apiKey) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'MOMENTEC_API_KEY not configured in environment variables' }) };
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
        body: JSON.stringify({ error: `Momentec API redirected to ${location}. Check MOMENTEC_API_BASE_URL. Tried: ${url}` }) };
    }

    const data = await response.text();

    if (data.trimStart().startsWith('<')) {
      return { statusCode: 502, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Momentec API returned HTML instead of JSON. Check MOMENTEC_API_BASE_URL. Tried: ${url}` }) };
    }

    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: data,
    };
  } catch (error) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Momentec API call failed: ${error.message}. Tried: ${url}` }) };
  }
};
