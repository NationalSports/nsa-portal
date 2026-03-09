// Netlify serverless function to proxy Momentec Brands API calls (avoids CORS)
// Momentec uses HCL Commerce REST API — catalog endpoints are public (no auth required)
//
// Environment variables (optional):
//   MOMENTEC_API_KEY      — dealer API key for authenticated endpoints (orders, pricing tiers)
//   MOMENTEC_STORE_ID     — HCL Commerce store ID (default: 10251)
//
// Query parameters:
//   path — the API endpoint path after /wcs/resources/store/{storeId}
//          e.g. /productview/bySearchTerm/*?pageSize=50
//               /productview/byId/10032
//               /productview/byCategory/3074457345616683170
//               /categoryview/@top?depthAndLimit=11,11

const BASE_URL = 'https://www.momentecbrands.com';

exports.handler = async (event) => {
  const apiKey = process.env.MOMENTEC_API_KEY;
  const storeId = process.env.MOMENTEC_STORE_ID || '10251';
  const path = event.queryStringParameters?.path || '/productview/bySearchTerm/*?pageSize=50';

  const url = `${BASE_URL}/wcs/resources/store/${storeId}${path}`;

  try {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: event.httpMethod === 'POST' ? 'POST' : 'GET',
      headers,
      redirect: 'manual',
      ...(event.body ? { body: event.body } : {}),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') || '';
      return { statusCode: 502, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Momentec API redirected to ${location}. Tried: ${url}` }) };
    }

    const data = await response.text();

    if (data.trimStart().startsWith('<')) {
      return { statusCode: 502, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Momentec API returned HTML instead of JSON. Tried: ${url}` }) };
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
