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

// Momentec /v2 API (order submission, inventory) — a different host from the HCL
// storefront above. Onboarding/test orders go to STAGE; production to prod. env
// defaults to 'stage' so an accidental call can't place a real production order.
const { verifyUser } = require('./_shared');
const V2_HOSTS = {
  stage: 'https://stage-api.momentecbrands.com',
  prod:  'https://api.momentecbrands.com',
};

exports.handler = async (event) => {
  // ─── Momentec /v2 Order submission ───
  // service=order&env=stage|prod — body is the order payload (built by src/momentecOrder.js).
  // Credentials (logonId/password) are injected here, server-side; the `id` is the dealer login.
  if (event.queryStringParameters?.service === 'order') {
    const v = await verifyUser(event);
    if (!v.ok) return { statusCode: v.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: v.error }) };
    const env = (event.queryStringParameters?.env || 'stage').toLowerCase();
    const host = V2_HOSTS[env];
    if (!host) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Unknown Momentec env "${env}". Use stage or prod.` }) };
    const logonId = process.env.MOMENTEC_LOGON_ID;
    const password = process.env.MOMENTEC_PASSWORD;
    if (!logonId || !password) return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'MOMENTEC_LOGON_ID and MOMENTEC_PASSWORD not configured in environment variables' }) };
    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Momentec order requires a JSON body.' }) }; }
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Momentec order payload missing items.' }) };
    }
    // Inject credentials server-side — never trust client-supplied creds.
    payload.credentials = { logonId, password };
    try {
      console.log(`[Momentec] order → ${host}/v2/Order (env: ${env}, po: ${payload.poNum}, items: ${payload.items.length})`);
      const resp = await fetch(`${host}/v2/Order`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await resp.text();
      let json; try { json = JSON.parse(text); } catch { json = null; }
      if (resp.ok && json && json.orderId) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, env, orderId: json.orderId }) };
      }
      console.error('[Momentec] order failed:', resp.status, text.slice(0, 800));
      return { statusCode: resp.ok ? 400 : resp.status, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: (json && (json.message || json.error)) || `Momentec order failed (${resp.status})`, raw: text.slice(0, 800) }) };
    } catch (error) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Momentec order call failed: ${error.message}` }) };
    }
  }

  // ─── Momentec order verification (GET /v2/Order + /v2/OrderLines) ───
  // service=order-details&env=stage|prod&ecomOrderId=… (or invoiceOrderId=…) — reads back
  // what Momentec actually registered for an order: header status/CO#/tracking plus every
  // line's itemNumber+quantity. Used to confirm an API order landed (their intake has gone
  // quiet on us before) and that the registered SKUs match what we submitted.
  if (event.queryStringParameters?.service === 'order-details') {
    const v = await verifyUser(event);
    if (!v.ok) return { statusCode: v.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: v.error }) };
    const env = (event.queryStringParameters?.env || 'prod').toLowerCase();
    const host = V2_HOSTS[env];
    if (!host) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Unknown Momentec env "${env}". Use stage or prod.` }) };
    const ecomOrderId = String(event.queryStringParameters?.ecomOrderId || '').trim();
    const invoiceOrderId = String(event.queryStringParameters?.invoiceOrderId || '').trim();
    if (!ecomOrderId && !invoiceOrderId) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'ecomOrderId or invoiceOrderId is required.' }) };
    const idQ = ecomOrderId ? `ecomOrderId=${encodeURIComponent(ecomOrderId)}` : `invoiceOrderId=${encodeURIComponent(invoiceOrderId)}`;
    const logonId = process.env.MOMENTEC_LOGON_ID || '';
    const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };
    try {
      const [oResp, lResp] = await Promise.all([
        fetch(`${host}/v2/Order?${logonId ? `logonId=${encodeURIComponent(logonId)}&` : ''}${idQ}`, { headers: { 'Accept': 'application/json' } }),
        fetch(`${host}/v2/OrderLines?${idQ}`, { headers: { 'Accept': 'application/json' } }),
      ]);
      const [oText, lText] = await Promise.all([oResp.text(), lResp.text()]);
      const oJson = parse(oText), lJson = parse(lText);
      const orders = Array.isArray(oJson?.asgOrderResponse) ? oJson.asgOrderResponse : [];
      const lines = Array.isArray(lJson?.asgOrderLinesResponse) ? lJson.asgOrderLinesResponse : [];
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        ok: true, env,
        found: orders.length > 0 || lines.length > 0,
        order: orders[0] || null, lines,
        _status: { order: oResp.status, lines: lResp.status },
      }) };
    } catch (error) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Momentec order lookup failed: ${error.message}` }) };
    }
  }

  // ─── Momentec /v2/Style (catalog read: colors, sizes, images, price, live stock) ───
  // service=style — public "Basic" variant, no credentials. Body: { productOrDesignNumber }.
  // Reads from prod by default (real catalog data); ?env=stage to target the sandbox.
  if (event.queryStringParameters?.service === 'style') {
    const env = (event.queryStringParameters?.env || 'prod').toLowerCase();
    const host = V2_HOSTS[env] || V2_HOSTS.prod;
    let design = '';
    try { design = String(JSON.parse(event.body || '{}').productOrDesignNumber || '').trim(); } catch {}
    if (!design) design = String(event.queryStringParameters?.design || '').trim();
    if (!design) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'productOrDesignNumber is required.' }) };
    try {
      const resp = await fetch(`${host}/v2/Style`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ productOrDesignNumber: design }),
      });
      const text = await resp.text();
      return { statusCode: resp.status, headers: { 'Content-Type': 'application/json' }, body: text };
    } catch (error) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Momentec /v2/Style call failed: ${error.message}` }) };
    }
  }

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
