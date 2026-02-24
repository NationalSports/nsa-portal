// Netlify serverless function to proxy ShipStation API calls (avoids CORS)
exports.handler = async (event) => {
  const SS_API_KEY = process.env.SHIPSTATION_API_KEY;
  const SS_API_SECRET = process.env.SHIPSTATION_API_SECRET;
  if (!SS_API_KEY || !SS_API_SECRET) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ShipStation API credentials not configured' }) };
  }

  const path = event.queryStringParameters?.path || '/stores';
  const url = `https://ssapi.shipstation.com${path}`;
  const auth = Buffer.from(`${SS_API_KEY}:${SS_API_SECRET}`).toString('base64');

  try {
    const response = await fetch(url, {
      method: event.httpMethod === 'POST' ? 'POST' : 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
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
