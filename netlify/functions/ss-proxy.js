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

const { verifyUser } = require('./_shared');

exports.handler = async (event) => {
  // Staff-only: this proxy injects the company S&S Activewear credentials.
  const v = await verifyUser(event);
  if (!v.ok) return { statusCode: v.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: v.error }) };

  const accountNumber = process.env.SS_ACCOUNT_NUMBER;
  const apiKey = process.env.SS_API_KEY;
  if (!accountNumber || !apiKey) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'SS_ACCOUNT_NUMBER and SS_API_KEY not configured in environment variables' }) };
  }

  const path = event.queryStringParameters?.path || '/Styles';
  const auth = Buffer.from(`${accountNumber}:${apiKey}`).toString('base64');

  // Forward the write verbs S&S uses (POST orders, PUT/DELETE CrossRef); anything else is a GET.
  const _m = String(event.httpMethod || 'GET').toUpperCase();
  const method = ['POST', 'PUT', 'DELETE'].includes(_m) ? _m : 'GET';

  // Force JSON response format (Accept header alone is unreliable for some endpoints). EXCEPTION:
  // the CrossRef PUT/DELETE are bodyless and take only `identifier` on the querystring — their
  // documented example URL carries no `mediatype`. Appending it pushes S&S's ASP.NET stack down
  // the same empty-body formatter path that 500s ("unhandled exception") on a declared
  // Content-Type (see the header note below), so a bodyless write gets the bare documented URL.
  const separator = path.includes('?') ? '&' : '?';
  const bodylessWrite = !event.body && (method === 'PUT' || method === 'DELETE');
  const url = bodylessWrite
    ? `https://api.ssactivewear.com/V2${path}`
    : `https://api.ssactivewear.com/V2${path}${separator}mediatype=json`;
  try {
    const headers = {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
      // S&S's firewall 403s the Node runtime's default User-Agent — a real UA is required
      'User-Agent': 'NSA-Portal/1.0 (nationalsportsapparel.com)',
    };
    // Content-Type ONLY when a body is actually forwarded: declaring application/json on a
    // bodyless request (the CrossRef PUT — its identifier rides the querystring) makes S&S's
    // ASP.NET stack try to bind an empty JSON body and 500.
    if (event.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, {
      method,
      headers,
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
