// Netlify function: enrich OMG orders with buyer contact + shipping info.
//
// The OMG *player report* has no email or address — those live only on the
// packing slip. The admin UI parses the packing-slip PDF in the browser and
// POSTs the extracted contacts here, matched to orders by OMG order number.
//
// POST /.netlify/functions/omg-order-enrich
// Body: {
//   storeId?: "<shadow webstore uuid>",   // OR saleCode
//   saleCode?: "D2SVU",
//   contacts: [{ orderNumber, email, name, phone, address:{name,street1,street2,city,state,zip,country} }]
// }
//
// Env: REACT_APP_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  const sb = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
  const contacts = Array.isArray(body.contacts) ? body.contacts : [];
  if (!contacts.length) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No contacts provided' }) };

  try {
    // Resolve the shadow store.
    let storeId = body.storeId;
    if (!storeId && body.saleCode) {
      const { data } = await sb.from('webstores').select('id').eq('omg_sale_code', body.saleCode).maybeSingle();
      storeId = data && data.id;
    }
    if (!storeId) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Store not found (provide storeId or a valid saleCode)' }) };

    let matched = 0, unmatched = [];
    for (const c of contacts) {
      const orderNumber = c.orderNumber != null ? String(c.orderNumber) : '';
      if (!orderNumber) continue;
      const patch = {};
      if (c.email) patch.buyer_email = String(c.email).trim();
      if (c.name) patch.buyer_name = String(c.name).trim();
      if (c.phone) patch.buyer_phone = String(c.phone).trim();
      if (c.address && (c.address.street1 || c.address.city)) {
        patch.ship_address = c.address;
        patch.ship_method = 'ship_home';
      }
      if (!Object.keys(patch).length) continue;

      const { data, error } = await sb.from('webstore_orders')
        .update(patch).eq('store_id', storeId).eq('omg_order_number', orderNumber).select('id');
      if (error) throw new Error(`Update failed (${orderNumber}): ${error.message}`);
      if (data && data.length) matched += data.length; else unmatched.push(orderNumber);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, matched, unmatched }) };
  } catch (e) {
    console.error('[omg-order-enrich] failed:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
