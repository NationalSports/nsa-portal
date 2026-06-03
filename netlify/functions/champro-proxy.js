// Netlify serverless function to proxy CHAMPRO Sports API calls (avoids CORS,
// keeps the API key server-side, and injects it into every request).
// CHAMPRO uses REST/JSON. Docs: https://api.champrosports.com/
//
// Environment variables required:
//   CHAMPRO_API_KEY — your CHAMPRO "API Customer Key" UUID (from Account & Contact Info)
//
// IMPORTANT: CHAMPRO also requires IP whitelisting. The egress IP of this
// function must be added to "API Allowed IP Addresses" in your CHAMPRO account,
// otherwise requests are rejected with error code 15 ("IP Address is not allowed").
// Netlify Functions use dynamic egress IPs unless you're on a plan with static
// outbound IPs / a fixed-IP egress proxy.
//
// Query parameters:
//   path — the API endpoint path, optionally with its own query string
//          (e.g. /api/Order/ProductInfo?ProductMaster=JSBJ8)
//
// The API Customer Key is injected automatically:
//   - GET  requests: appended to the query string as APICustomerKey
//   - POST requests: merged into the JSON request body as "APICustomerKey"
//
// Key endpoints:
//   GET  /api/Order/ProductInfo?ProductMaster={master}  — product master, MOQ, SKUs
//   POST /api/Order/Inventory                            — warehouse stock (IL/CA/DR)
//   POST /api/Order/PlaceOrder                           — submit stock/custom order
//   GET  /api/Order/OrderStatus?OrderNumber={n}          — tracking + fulfillment status

exports.handler = async (event) => {
  const apiKey = process.env.CHAMPRO_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'CHAMPRO_API_KEY not configured in environment variables' }) };
  }

  const path = event.queryStringParameters?.path || '/api/Order/ProductInfo';
  const isPost = event.httpMethod === 'POST';

  // Build the upstream URL, injecting the key into the query string for GET.
  let url = `https://api.champrosports.com${path}`;
  if (!isPost) {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}APICustomerKey=${encodeURIComponent(apiKey)}`;
  }

  // For POST, inject the key into the JSON body.
  let body;
  if (isPost) {
    let parsed = {};
    if (event.body) {
      try { parsed = JSON.parse(event.body); }
      catch {
        return { statusCode: 400, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Request body must be valid JSON' }) };
      }
    }
    parsed.APICustomerKey = apiKey;
    body = JSON.stringify(parsed);
  }

  try {
    const response = await fetch(url, {
      method: isPost ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      ...(isPost ? { body } : {}),
    });

    const data = await response.text();
    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: data,
    };
  } catch (error) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `CHAMPRO API call failed: ${error.message}` }) };
  }
};
