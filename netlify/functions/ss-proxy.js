// Netlify serverless function to proxy S&S Activewear API v2 calls (avoids CORS)
// S&S uses REST/JSON with Basic HTTP auth
// Docs: https://api.ssactivewear.com/V2/Default.aspx
//
// Environment variables required:
//   SS_ACCOUNT_NUMBER  — your S&S Activewear account number (username)
//   SS_API_KEY         — your S&S API key (password)
//
// Query parameters:
//   path — the API endpoint path (e.g. /Products, /Inventory, /Styles?style=PC61)
//
// Key endpoints:
//   GET /Products              — full catalog with inventory, pricing, images
//   GET /Products/{sku}        — single product by SKU
//   GET /Products?style={id}   — products by style
//   GET /Inventory             — stock levels across warehouses
//   GET /Styles                — style/category listing
//   GET /Brands                — brand listing
//   GET /Categories            — category listing
//   GET /Specs                 — product specifications
//
// Rate limit: 60 requests per minute (check X-Rate-Limit-Remaining header)

exports.handler = async (event) => {
  const accountNumber = process.env.SS_ACCOUNT_NUMBER;
  const apiKey = process.env.SS_API_KEY;
  if (!accountNumber || !apiKey) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'SS_ACCOUNT_NUMBER and SS_API_KEY not configured in environment variables' }) };
  }

  const path = event.queryStringParameters?.path || '/Styles';
  const url = `https://api.ssactivewear.com/V2${path}`;
  const auth = Buffer.from(`${accountNumber}:${apiKey}`).toString('base64');

  try {
    const response = await fetch(url, {
      method: event.httpMethod === 'POST' ? 'POST' : 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      ...(event.body ? { body: event.body } : {}),
    });

    const data = await response.text();
    const rateLimitRemaining = response.headers.get('X-Rate-Limit-Remaining');

    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        ...(rateLimitRemaining ? { 'X-Rate-Limit-Remaining': rateLimitRemaining } : {}),
      },
      body: data,
    };
  } catch (error) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `S&S Activewear API call failed: ${error.message}` }) };
  }
};
