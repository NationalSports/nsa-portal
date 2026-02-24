// Netlify serverless function to proxy OMG API calls (avoids CORS)
exports.handler = async (event) => {
  const OMG_API_KEY = process.env.OMG_API_KEY;
  if (!OMG_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'OMG_API_KEY not configured' }) };
  }

  const path = event.queryStringParameters?.path || '/stores';
  const url = `https://app.ordermygear.com/api/v2${path}`;

  try {
    const response = await fetch(url, {
      method: event.httpMethod === 'POST' ? 'POST' : 'GET',
      headers: {
        'Authorization': `Bearer ${OMG_API_KEY}`,
        'Content-Type': 'application/json',
      },
      ...(event.body ? { body: event.body } : {}),
    });

    const data = await response.text();
    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: data,
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
