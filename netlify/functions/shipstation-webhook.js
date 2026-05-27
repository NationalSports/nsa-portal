// ShipStation shipment webhook → emails the buyer when their webstore order
// ships, including tracking and the exact items in THAT shipment (so partial
// shipments only list what went out). Also records the shipment and marks the
// shipped line items.
//
// Setup:
//   In ShipStation → Settings → Integrations → Webhooks, add a webhook for
//   "On Items Shipped" (SHIP_NOTIFY) pointing to:
//     https://<your-site>/.netlify/functions/shipstation-webhook
//   Requires env: SHIPSTATION_API_KEY, SHIPSTATION_API_SECRET,
//   REACT_APP_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
//   BREVO_API_KEY, and PORTAL_PUBLIC_URL (or Netlify's URL).
const { createClient } = require('@supabase/supabase-js');

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function trackingUrl(carrier, num) {
  const c = (carrier || '').toLowerCase();
  if (!num) return '';
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${num}`;
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${num}`;
  if (c.includes('usps') || c.includes('stamps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${num}`;
  return `https://www.google.com/search?q=${encodeURIComponent(num)}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const KEY = process.env.SHIPSTATION_API_KEY, SECRET = process.env.SHIPSTATION_API_SECRET;
  const url = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const skey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!KEY || !SECRET || !url || !skey) return { statusCode: 500, body: 'Webhook not configured' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Bad JSON' }; }
  // Only act on shipment events.
  if (body.resource_type && body.resource_type !== 'SHIP_NOTIFY') return { statusCode: 200, body: 'ignored' };
  if (!body.resource_url) return { statusCode: 200, body: 'no resource_url' };

  const auth = Buffer.from(`${KEY}:${SECRET}`).toString('base64');
  const sb = createClient(url, skey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    // Pull the shipments referenced by this event, with their line items.
    const fetchUrl = body.resource_url + (body.resource_url.includes('?') ? '&' : '?') + 'includeShipmentItems=true';
    const res = await fetch(fetchUrl, { headers: { Authorization: `Basic ${auth}` } });
    const data = await res.json();
    const shipments = data.shipments || [];

    for (const sh of shipments) {
      if (sh.voided) continue;
      const orderNumber = sh.orderNumber || '';
      if (!orderNumber.startsWith('WS-')) continue; // not one of ours
      const orderId = orderNumber.slice(3);
      if (!orderId) continue;

      // Match back to the webstore order (orderNumber = 'WS-' + order id).
      const { data: orders } = await sb.from('webstore_orders').select('*').eq('id', orderId).limit(1);
      const order = orders && orders[0];
      if (!order) continue;

      const tracking = sh.trackingNumber || null;
      // Idempotency: skip if we already recorded this tracking number.
      if (tracking) {
        const { data: existing } = await sb.from('webstore_shipments').select('id').eq('tracking_number', tracking).limit(1);
        if (existing && existing.length) continue;
      }

      const shipItems = (sh.shipmentItems || []).map((i) => ({ sku: i.sku, name: i.name, qty: i.quantity, image: i.imageUrl || null }));
      await sb.from('webstore_shipments').insert({
        order_id: order.id, store_id: order.store_id, tracking_number: tracking,
        carrier: sh.carrierCode || null, service: sh.serviceCode || null, ship_date: sh.shipDate || null,
        items: shipItems, emailed: false,
      });

      // Mark shipped line items (match by sku); flag the order shipped.
      const skus = shipItems.map((i) => i.sku).filter(Boolean);
      if (skus.length) await sb.from('webstore_order_items').update({ line_status: 'shipped' }).eq('order_id', order.id).in('sku', skus);
      await sb.from('webstore_orders').update({ tracking_number: tracking, carrier: sh.carrierCode || null, shipped_at: new Date().toISOString() }).eq('id', order.id);

      // Email the buyer.
      if (order.buyer_email) await sendShipEmail(sb, order, sh, shipItems, tracking);
    }
  } catch (e) {
    console.error('[shipstation-webhook] error:', e.message);
  }
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

async function sendShipEmail(sb, order, sh, shipItems, tracking) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey) return;
  const { data: stores } = await sb.from('webstores').select('name,slug,primary_color,accent_color').eq('id', order.store_id).limit(1);
  const store = stores && stores[0]; if (!store) return;

  // Is this the whole order, or a partial shipment?
  const { data: allItems } = await sb.from('webstore_order_items').select('sku,is_bundle_parent').eq('order_id', order.id);
  const totalLines = (allItems || []).filter((i) => !i.is_bundle_parent).length;
  const partial = totalLines > 0 && shipItems.length > 0 && shipItems.length < totalLines;

  const rows = shipItems.map((i) => {
    const img = i.image
      ? `<td style="width:52px;padding:7px 10px 7px 0;border-bottom:1px solid #eef1f5"><img src="${i.image}" width="44" height="44" style="width:44px;height:44px;object-fit:cover;border-radius:6px;display:block;background:#f4f6f9"></td>`
      : `<td style="width:52px;padding:7px 10px 7px 0;border-bottom:1px solid #eef1f5"></td>`;
    return `<tr>${img}<td style="padding:7px 0;border-bottom:1px solid #eef1f5">${i.name || i.sku || 'Item'}</td><td style="padding:7px 0;border-bottom:1px solid #eef1f5;text-align:right;color:#64748b">×${i.qty || 1}</td></tr>`;
  }).join('');
  const tUrl = trackingUrl(sh.carrierCode, tracking);
  const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');
  const orderLink = `${portal}/shop/${store.slug}/order/${order.id}`;
  const accent = store.accent_color || '#e11d2a';
  const carrierName = (sh.carrierCode || '').toUpperCase().replace('STAMPS_COM', 'USPS');

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0b1220;max-width:560px;margin:0 auto">
    <div style="background:${store.primary_color || '#0b1f3a'};color:#fff;padding:20px 24px;border-radius:10px 10px 0 0">
      <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.85">${store.name}</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px">${partial ? 'Part of your order shipped' : 'Your order shipped'} 📦</div>
    </div>
    <div style="border:1px solid #eef1f5;border-top:none;border-radius:0 0 10px 10px;padding:22px 24px">
      <p style="margin:0 0 14px">Hi ${order.buyer_name || ''}, ${partial ? 'some of your items are on the way' : 'your order is on the way'}!</p>
      ${tracking ? `<div style="background:#f8fafc;border:1px solid #eef1f5;border-radius:8px;padding:12px 14px;margin-bottom:16px">
        <div style="font-size:12px;color:#64748b">${carrierName || 'Carrier'} tracking</div>
        <div style="font-size:16px;font-weight:800;margin:2px 0 8px">${tracking}</div>
        ${tUrl ? `<a href="${tUrl}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:700">Track package</a>` : ''}
      </div>` : ''}
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:4px">${partial ? 'Items in this shipment' : 'Items shipped'}</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
      ${partial ? `<p style="font-size:13px;color:#64748b;margin-top:14px">Your remaining items will ship separately — you'll get another email when they do.</p>` : ''}
      <p style="margin-top:18px"><a href="${orderLink}" style="color:${accent}">View your full order</a></p>
    </div></div>`;

  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: store.name || 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
      to: [{ email: order.buyer_email, name: order.buyer_name || '' }],
      subject: `${partial ? 'Part of your' : 'Your'} ${store.name} order shipped`,
      htmlContent: html,
    }),
  });
  if (tracking) await sb.from('webstore_shipments').update({ emailed: true }).eq('tracking_number', tracking);
}
