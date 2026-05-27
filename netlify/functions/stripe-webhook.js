// Stripe webhook — reconciles webstore orders so a charge can never end up
// without a matching order (e.g. the buyer closed the tab right after paying).
// On payment_intent.succeeded we flip the matching pending order to "paid".
//
// Setup:
//   1. Add STRIPE_WEBHOOK_SECRET (from the Stripe dashboard endpoint) to env.
//   2. In Stripe → Developers → Webhooks, add endpoint:
//        https://<your-site>/.netlify/functions/stripe-webhook
//      subscribed to: payment_intent.succeeded
//   Also requires STRIPE_SECRET_KEY, REACT_APP_SUPABASE_URL (or SUPABASE_URL),
//   and SUPABASE_SERVICE_ROLE_KEY.
const stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const sk = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sk || !whSecret) return { statusCode: 500, body: 'Stripe webhook not configured' };

  const client = stripe(sk);
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

  let evt;
  try {
    evt = client.webhooks.constructEvent(raw, sig, whSecret);
  } catch (e) {
    return { statusCode: 400, body: `Webhook signature verification failed: ${e.message}` };
  }

  try {
    if (evt.type === 'payment_intent.succeeded') {
      const pi = evt.data.object;
      const url = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (url && key && pi && pi.id) {
        const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
        // Idempotent: only touches an order still awaiting payment for this intent.
        await sb.from('webstore_orders').update({ status: 'paid' }).eq('stripe_pi_id', pi.id).neq('status', 'paid');
        // Fallback confirmation email — only if the client hasn't already sent
        // it (e.g. the buyer closed the tab right after paying). The flag claim
        // is atomic, so the buyer never gets two emails.
        const { data: claimed } = await sb.from('webstore_orders')
          .update({ confirmation_sent: true })
          .eq('stripe_pi_id', pi.id).neq('confirmation_sent', true)
          .select('id,store_id,buyer_email,buyer_name,total,shipping_fee,ship_method,ship_address').limit(1);
        const order = claimed && claimed[0];
        if (order && order.buyer_email) await sendConfirmation(sb, order);
      }
    }
  } catch (e) {
    // Don't 500 on a downstream error — that would make Stripe retry forever.
    console.error('[stripe-webhook] reconcile error:', e.message);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Server-side confirmation email (used only when the client didn't send one).
async function sendConfirmation(sb, order) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey) return;
  const { data: stores } = await sb.from('webstores').select('name,slug,primary_color,accent_color,logo_url').eq('id', order.store_id).limit(1);
  const store = stores && stores[0];
  if (!store) return;
  const { data: items } = await sb.from('webstore_order_items').select('sku,size,qty,unit_price,player_name,player_number,is_bundle_parent,bundle_product_id,product_id').eq('order_id', order.id);
  // product_id -> image (catalog override, else the product's own image).
  const imgByPid = {};
  const { data: cat } = await sb.from('webstore_products').select('product_id,image_url').eq('store_id', order.store_id);
  (cat || []).forEach((c) => { if (c.product_id && c.image_url) imgByPid[c.product_id] = c.image_url; });
  const pids = [...new Set((items || []).map((i) => i.product_id).filter((p) => p && !imgByPid[p]))];
  if (pids.length) { const { data: prods } = await sb.from('products').select('id,image_front_url').in('id', pids); (prods || []).forEach((p) => { if (p.image_front_url) imgByPid[p.id] = p.image_front_url; }); }
  const lines = (items || []).filter((i) => !i.bundle_product_id || i.is_bundle_parent).map((i) => {
    const det = [i.size && 'Size ' + i.size, i.player_number && '#' + i.player_number, i.player_name].filter(Boolean).join(' · ');
    const im = imgByPid[i.product_id];
    const imgCell = im
      ? `<td style="width:56px;padding:8px 10px 8px 0;border-bottom:1px solid #eef1f5"><img src="${im}" width="48" height="48" style="width:48px;height:48px;object-fit:cover;border-radius:6px;display:block;background:#f4f6f9"></td>`
      : `<td style="width:56px;padding:8px 10px 8px 0;border-bottom:1px solid #eef1f5"></td>`;
    return `<tr>${imgCell}<td style="padding:8px 0;border-bottom:1px solid #eef1f5">${i.sku || 'Item'}${i.qty > 1 ? ` ×${i.qty}` : ''}${det ? `<div style="font-size:12px;color:#64748b">${det}</div>` : ''}</td><td style="padding:8px 0;border-bottom:1px solid #eef1f5;text-align:right;font-weight:700;white-space:nowrap">${money((Number(i.unit_price) || 0) * (i.qty || 1))}</td></tr>`;
  }).join('');
  const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');
  const link = `${portal}/shop/${store.slug}/order/${order.id}`;
  const accent = store.accent_color || '#e11d2a';
  const shipping = Number(order.shipping_fee) || 0;
  const a = order.ship_address || null;
  const addrBlock = (order.ship_method === 'ship_home' && a) ? `<div style="margin-top:18px"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:4px">Shipping to</div><div style="font-size:14px;line-height:1.5">${a.name ? a.name + '<br>' : ''}${a.street1 || ''}${a.street2 ? ', ' + a.street2 : ''}<br>${a.city || ''}${a.city ? ', ' : ''}${a.state || ''} ${a.zip || ''}</div></div>` : '';
  const nsaLogo = `${portal}/NEW%20NSA%20Logo%20on%20white.png`;
  const logoBar = `<table width="100%" style="border-collapse:collapse"><tr>
      <td align="left" style="padding:12px 20px;background:#fff;border:1px solid #eef1f5;border-bottom:none;border-radius:10px 0 0 0"><img src="${nsaLogo}" alt="National Sports Apparel" height="32" style="height:32px;display:block"></td>
      <td align="right" style="padding:12px 20px;background:#fff;border:1px solid #eef1f5;border-bottom:none;border-left:none;border-radius:0 10px 0 0">${store.logo_url ? `<img src="${store.logo_url}" alt="${store.name}" height="40" style="height:40px;max-width:130px;object-fit:contain;display:inline-block">` : `<span style="font-weight:800;color:#0b1220">${store.name}</span>`}</td>
    </tr></table>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0b1220;max-width:560px;margin:0 auto">
    ${logoBar}
    <div style="background:${store.primary_color || '#0b1f3a'};color:#fff;padding:18px 24px">
      <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.85">${store.name}</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px">Order confirmed &amp; paid</div>
    </div>
    <div style="border:1px solid #eef1f5;border-top:none;border-radius:0 0 10px 10px;padding:22px 24px">
      <p style="margin:0 0 14px">Thanks, ${order.buyer_name || ''}! We've received your payment.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${lines}
        ${shipping > 0 ? `<tr><td></td><td style="padding:8px 0;color:#475569">Shipping</td><td style="padding:8px 0;text-align:right">${money(shipping)}</td></tr>` : ''}
        <tr><td></td><td style="padding:12px 0 0;font-weight:800;font-size:16px">Total</td><td style="padding:12px 0 0;text-align:right;font-weight:800;font-size:16px">${money(order.total)}</td></tr>
      </table>
      ${addrBlock}
      <a href="${link}" style="display:inline-block;margin-top:20px;background:${accent};color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:700">Track your order</a>
      <p style="font-size:12px;color:#94a3b8;margin-top:18px">Save this email — the link above is how you check your order status anytime.</p>
    </div></div>`;
  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: store.name || 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
      to: [{ email: order.buyer_email, name: order.buyer_name || '' }],
      subject: `Your ${store.name} order is confirmed`,
      htmlContent: html,
    }),
  });
}
