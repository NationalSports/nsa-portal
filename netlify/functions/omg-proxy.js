// Netlify serverless function to proxy OMG API calls (avoids CORS)
exports.handler = async (event) => {
  const OMG_API_KEY = process.env.OMG_API_KEY;
  if (!OMG_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'OMG_API_KEY not configured' }) };
  }

  // Base URL is configurable — set OMG_API_BASE_URL in Netlify env vars
  // OMG Pop-up Stores API v1: https://docs.ordermygear.com
  const baseUrl = (process.env.OMG_API_BASE_URL || 'https://app.ordermygear.com/v1').replace(/\/+$/, '');
  const path = event.queryStringParameters?.path || '/sales';
  const url = `${baseUrl}${path}`;

  try {
    const response = await fetch(url, {
      method: event.httpMethod === 'POST' ? 'POST' : 'GET',
      headers: {
        'X-ACCESS-TOKEN': OMG_API_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      redirect: 'manual',
      ...(event.body ? { body: event.body } : {}),
    });

    // If the API redirects to a login page, the base URL is wrong
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') || '';
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: `OMG API redirected to ${location}. The base URL is likely wrong. Set OMG_API_BASE_URL in Netlify env vars. Tried: ${url}`
        }),
      };
    }

    const data = await response.text();

    // If we got HTML back instead of JSON, the endpoint is wrong
    if (data.trimStart().startsWith('<')) {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: `OMG API returned HTML instead of JSON. The base URL is likely wrong. Set OMG_API_BASE_URL in Netlify env vars. Tried: ${url}`
        }),
      };
    }

    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: data,
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: `Fetch to OMG API failed: ${error.message}. Tried: ${url}. Set OMG_API_BASE_URL in Netlify env vars if the URL is wrong.`
      }),
    };
  }
};
