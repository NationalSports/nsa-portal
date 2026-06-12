// Netlify function: back-in-stock alert signup from the public catalog page.
// Stores the request in catalog_stock_alerts (service role — RLS locked);
// the scheduled catalog-stock-alert-check function sends the email when
// stock lands.
exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const email = String(body.email || '').trim().slice(0, 200);
    const sku = String(body.sku || '').trim().slice(0, 40);
    const size = String(body.size || '').trim().slice(0, 20) || null;
    const style_name = String(body.style_name || '').trim().slice(0, 160) || null;
    const color = String(body.color || '').trim().slice(0, 120) || null;
    const brand = String(body.brand || 'adidas').trim().slice(0, 40);

    if (!sku || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'A valid email and SKU are required' }) };
    }

    const sbUrl = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!sbUrl || !sbKey) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: 'Not configured' }) };

    const resp = await fetch(`${sbUrl}/rest/v1/catalog_stock_alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: `Bearer ${sbKey}`, Prefer: 'return=minimal' },
      body: JSON.stringify({ brand, email, sku, size, style_name, color }),
    });
    // 409 = duplicate live alert — treat as success, the coach is already covered
    if (!resp.ok && resp.status !== 409) {
      console.error('[catalog-stock-alert] insert failed:', resp.status, await resp.text());
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: 'Could not save the alert' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
