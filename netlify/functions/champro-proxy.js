// Netlify serverless function to proxy CHAMPRO Sports API calls (avoids CORS) and
// inject the API Customer Key server-side. Champro uses REST/JSON.
// Docs: https://api.champrosports.com/
//
// Environment variables required:
//   CHAMPRO_API_KEY — the Champro "API Customer Key" (a per-customer GUID),
//                     generated at https://champrosports.com/AccountAndContactInfo
//
// IMPORTANT — IP allowlisting: Champro also restricts access by source IP. The
// *outbound* IP of this function must be allowlisted on the Champro "Account &
// Contact Info" page, or every call returns error 15 ("IP Address is not allowed").
// Netlify Functions do NOT have a static outbound IP by default, so a fixed-egress
// path (static outbound IP add-on, or routing through a host with a stable IP) is
// needed before going live. See docs/CHAMPRO_API_SETUP.md.
//
// Query parameters:
//   path — the API path, e.g.
//            /api/Order/ProductInfo?ProductMaster=BS25Y
//            /api/Order/Inventory            (POST)
//
// The API key is injected as:
//   • a query-string param `APICustomerKey` for GET requests
//   • a body field `APICustomerKey` for POST requests
// so it is never shipped to the browser.

const { verifyUser } = require('./_shared');

const BASE = 'https://api.champrosports.com';

exports.handler = async (event) => {
  // Staff-only: this proxy injects the company Champro API key.
  const v = await verifyUser(event);
  if (!v.ok) return { statusCode: v.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: v.error }) };

  const apiKey = process.env.CHAMPRO_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'CHAMPRO_API_KEY not configured in environment variables' }) };
  }

  const path = event.queryStringParameters?.path || '/api/Order/ProductInfo';
  // Bound the proxy to Champro's Order API surface (no open SSRF; key only flows there).
  if (!path.startsWith('/api/')) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid path' }) };
  }
  const method = event.httpMethod === 'POST' ? 'POST' : 'GET';

  // Inject APICustomerKey authoritatively (server key always wins):
  //   GET  → query-string param
  //   POST → JSON body field
  let url = BASE + path;
  let body;
  if (method === 'GET') {
    url += (path.includes('?') ? '&' : '?') + 'APICustomerKey=' + encodeURIComponent(apiKey);
  } else {
    let payload = {};
    if (event.body) { try { payload = JSON.parse(event.body); } catch { payload = {}; } }
    payload.APICustomerKey = apiKey;
    body = JSON.stringify(payload);
  }

  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      ...(body ? { body } : {}),
    });
    // Champro signals logical errors (bad SKU, IP not allowed, etc.) inside the body
    // via Error / ErrorMessages, so pass the response straight through and let the
    // client wrappers read them.
    const text = await response.text();
    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: text,
    };
  } catch (error) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Champro API call failed: ${error.message}` }) };
  }
};
