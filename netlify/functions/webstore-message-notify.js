// Netlify function: email a customer that staff posted a new message on their
// order. The message row itself is inserted client-side (OMG portal) via the
// authenticated Supabase session; this function only sends the Brevo email so
// the server-side key stays off the client.
//
// POST /.netlify/functions/webstore-message-notify
// Body: { orderId: "<uuid>", text: "the message body" }
// Env: REACT_APP_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
//      BREVO_API_KEY, PORTAL_PUBLIC_URL (or Netlify URL)
const { createClient } = require('@supabase/supabase-js');
const { verifyUser } = require('./_shared');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const v = await verifyUser(event);
  if (!v.ok) return { statusCode: v.status, headers, body: JSON.stringify({ error: v.error }) };

  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!sbUrl || !sbKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  if (!brevoKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'BREVO_API_KEY not configured' }) };
  const sb = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
  const text = String(body.text || '').trim();
  if (!body.orderId || !text) return { statusCode: 400, headers, body: JSON.stringify({ error: 'orderId and text required' }) };

  try {
    const { data: orders } = await sb.from('webstore_orders').select('*').eq('id', body.orderId).limit(1);
    const order = orders && orders[0];
    if (!order) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Order not found' }) };
    if (!order.buyer_email) return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent: 0, note: 'No buyer email on file.' }) };
    const { data: stores } = await sb.from('webstores').select('id,name,primary_color,accent_color').eq('id', order.store_id).limit(1);
    const store = (stores && stores[0]) || { name: 'your order' };
    const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');
    const html = buildHtml({ store, order, text, portal });
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify({
        sender: { name: store.name || 'National Sports Apparel', email: 'stores@nationalsportsapparel.com' },
        to: [{ email: order.buyer_email, name: order.buyer_name || '' }],
        subject: `New message about your ${store.name} order${order.omg_order_number ? ` (#${order.omg_order_number})` : ''}`,
        htmlContent: html,
      }),
    });
    if (!resp.ok) {
      let detail = '';
      try { const j = await resp.json(); detail = j.message || j.code || JSON.stringify(j); } catch { detail = await resp.text().catch(() => ''); }
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, sent: 0, error: detail }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent: 1 }) };
  } catch (e) {
    console.error('[webstore-message-notify] failed:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};

function buildHtml({ store, order, text, portal }) {
  const accent = store.accent_color || '#e11d2a';
  const primary = store.primary_color || '#0b1f3a';
  const link = `${portal}/shop/order/${order.status_token}`;
  const nsaLogo = `${portal}/NEW%20NSA%20Logo%20on%20white.png`;
  const safe = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const logoBar = `<div style="background:#fff;border:1px solid #eef1f5;border-bottom:none;border-radius:10px 10px 0 0;padding:14px 24px;text-align:center"><img src="${nsaLogo}" alt="National Sports Apparel" height="36" style="height:36px;display:inline-block;border:none"></div>`;
  return `<div style="font-family:'Source Sans 3',-apple-system,Segoe UI,Roboto,sans-serif;color:#2A2F3E;max-width:560px;margin:0 auto">
    ${logoBar}
    <div style="background:${primary};color:#fff;padding:20px 24px">
      <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.85">${safe(store.name)}</div>
      <div style="font-size:23px;font-weight:800;margin-top:4px">💬 You have a new message</div>
    </div>
    <div style="border:1px solid #eef1f5;border-top:none;border-radius:0 0 10px 10px;padding:24px">
      <p style="margin:0 0 12px">Hi ${safe(order.buyer_name || 'there')}, our team sent you a message about your order${order.omg_order_number ? ` (#${safe(order.omg_order_number)})` : ''}:</p>
      <blockquote style="margin:8px 0 16px;padding:12px 14px;background:#f8fafc;border-left:3px solid ${accent};border-radius:6px;font-size:15px">${safe(text)}</blockquote>
      <p style="margin:0 0 4px">Open your order portal to read it and reply — your reply comes straight back to us.</p>
      <div style="text-align:center;margin:22px 0">
        <a href="${link}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:14px 32px;border-radius:9px;font-weight:800;font-size:16px">View &amp; reply →</a>
      </div>
      <p style="font-size:12px;color:#94a3b8;margin-top:18px">This link is private to your order — save it to check back anytime.</p>
    </div></div>`;
}
