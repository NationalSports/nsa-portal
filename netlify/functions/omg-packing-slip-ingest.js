// Netlify function: ingest parsed PACKING-SLIP data into per-order tracking.
//
// The packing slip carries everything a parent order needs — order #, buyer
// name, email, phone, shipping address, and line items — so it can create the
// orders on its own (the player report becomes optional, used only when slip
// line-items don't parse well). Reuses the webstore "shadow store" rails like
// omg-player-report-ingest.
//
// POST /.netlify/functions/omg-packing-slip-ingest
// Body: {
//   saleCode: "WVD87", storeName?: "…",
//   orders: [{ orderNumber, name, email, phone, address:{...},
//              items:[{ product, color, size, qty }] }]
// }
//
// Behavior per order (idempotent by store + omg_order_number):
//   • Creates or updates the order with name/email/phone/address.
//   • If the slip provided line items, replaces the order's items with them.
//     If it didn't (parse miss), existing items are left intact — so a prior
//     player-report import isn't wiped.
//
// Env: REACT_APP_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
const { createClient } = require('@supabase/supabase-js');
const { verifyUser } = require('./_shared');

const extractSku = (str) => { const m = (str || '').match(/\(([A-Za-z0-9]{4,10})\)/); return m ? m[1].toUpperCase() : ''; };
const cleanColor = (str) => (str || '').replace(/\s*\([A-Za-z0-9]{4,10}\)\s*/g, '').trim();
const normSku = (x) => String(x || '').trim().toUpperCase();
const baseSku = (x) => (normSku(x).split(/\s+/)[0] || '');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  // Staff-only: patches buyer contact/shipping on orders via service role.
  const v = await verifyUser(event);
  if (!v.ok) return { statusCode: v.status, headers, body: JSON.stringify({ error: v.error }) };

  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  const sb = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
  const saleCode = (body.saleCode || '').trim();
  const orders = Array.isArray(body.orders) ? body.orders : [];
  if (!saleCode) return { statusCode: 400, headers, body: JSON.stringify({ error: 'saleCode required' }) };
  if (!orders.length) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No orders provided' }) };

  try {
    // Ensure the shadow webstore for this sale exists.
    let store;
    const { data: existingStore } = await sb.from('webstores').select('*').eq('omg_sale_code', saleCode).maybeSingle();
    if (existingStore) {
      store = existingStore;
    } else {
      const { data: created, error: cErr } = await sb.from('webstores').insert({
        slug: `omg-${saleCode.toLowerCase()}`, name: body.storeName || `OMG Store ${saleCode}`,
        source: 'omg', omg_sale_code: saleCode, status: 'archived', payment_mode: 'paid',
      }).select().single();
      if (cErr) throw new Error(`Shadow store create failed: ${cErr.message}`);
      store = created;
    }

    // Product images from the OMG store catalog, keyed by normalized SKU.
    const imgBySku = {};
    let storeProducts = [];
    {
      const { data: sp } = await sb.from('omg_store_products')
        .select('sku,name,image_url').eq('store_id', `OMG-sale_${saleCode}`);
      storeProducts = (sp || []).filter((p) => p.image_url);
      storeProducts.forEach((p) => { imgBySku[normSku(p.sku)] = p.image_url; imgBySku[baseSku(p.sku)] = p.image_url; });
    }
    const imgFor = (sku, productName) => {
      if (sku) {
        const hit = imgBySku[normSku(sku)] || imgBySku[baseSku(sku)];
        if (hit) return hit;
      }
      if (productName) {
        const lower = productName.toLowerCase();
        const sorted = [...storeProducts].sort((a, b) => (b.name || '').length - (a.name || '').length);
        const match = sorted.find((p) => p.name && lower.includes(p.name.toLowerCase()));
        if (match) return match.image_url;
      }
      return null;
    };

    let created = 0, updated = 0, itemsWritten = 0, skipped = 0;
    for (const o of orders) {
      const orderNumber = o.orderNumber != null ? String(o.orderNumber).trim() : '';
      if (!orderNumber) { skipped++; continue; }

      const buyerName = (o.name || '').trim();
      const fields = {
        buyer_name: buyerName || null,
        buyer_email: o.email ? String(o.email).trim() : null,
        buyer_phone: o.phone ? String(o.phone).trim() : null,
      };
      if (o.address && (o.address.street1 || o.address.city)) {
        fields.ship_address = { name: buyerName, street1: o.address.street1 || '', street2: o.address.street2 || '', city: o.address.city || '', state: (o.address.state || '').toUpperCase(), zip: o.address.zip || '', country: o.address.country || 'US' };
        fields.ship_method = 'ship_home';
      }

      const { data: existing } = await sb.from('webstore_orders')
        .select('id').eq('store_id', store.id).eq('omg_order_number', orderNumber).maybeSingle();

      let orderId;
      if (existing) {
        orderId = existing.id;
        // Don't null out previously-set values when the slip is missing one.
        const patch = {}; Object.keys(fields).forEach((k) => { if (fields[k] != null) patch[k] = fields[k]; });
        if (Object.keys(patch).length) await sb.from('webstore_orders').update(patch).eq('id', orderId);
        updated++;
      } else {
        const { data: ins, error: oErr } = await sb.from('webstore_orders').insert({
          store_id: store.id, status: 'paid', payment_mode: 'paid', order_kind: 'individual',
          omg_order_number: orderNumber, ...fields,
          notes: `OMG order ${orderNumber} · from packing slip`,
        }).select('id').single();
        if (oErr) throw new Error(`Order insert failed (${orderNumber}): ${oErr.message}`);
        orderId = ins.id;
        created++;
      }

      // Replace line items only when the slip actually gave us some.
      const items = Array.isArray(o.items) ? o.items.filter((i) => (i.product || i.color) && (i.qty || 1) > 0) : [];
      if (items.length) {
        await sb.from('webstore_order_items').delete().eq('order_id', orderId);
        const rows = items.map((i) => {
          const sku = extractSku(i.color) || '';
          return {
            order_id: orderId,
            sku,
            name: i.product || '',
            color: cleanColor(i.color) || i.color || '',
            size: i.size || 'OS',
            qty: i.qty || 1,
            unit_price: 0,
            player_name: buyerName,
            line_status: 'pending',
            image_url: imgFor(sku, i.product),
          };
        });
        const { error: iErr } = await sb.from('webstore_order_items').insert(rows);
        if (iErr) throw new Error(`Items insert failed (${orderNumber}): ${iErr.message}`);
        itemsWritten += rows.length;
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, store: { id: store.id, saleCode }, created, updated, itemsWritten, skipped }) };
  } catch (e) {
    console.error('[omg-packing-slip-ingest] failed:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
