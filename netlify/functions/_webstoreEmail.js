const { resolveSender } = require('./_emailSender');
// Shared webstore order helpers — used by stripe-webhook.js (fallback path when
// the buyer closes the tab right after paying) and webstore-checkout.js (the
// main server-side checkout flow). Single source of truth for the confirmation
// email and the coupon-use counter.
const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Server-side confirmation email. Builds everything from DB rows — callers never
// supply content, so this can run for unauthenticated shoppers without becoming
// an email relay.
async function sendOrderConfirmation(sb, order) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey) return;
  const { data: stores } = await sb.from('webstores').select('name,slug,primary_color,accent_color,logo_url').eq('id', order.store_id).limit(1);
  const store = stores && stores[0];
  if (!store) return;
  const { data: items } = await sb.from('webstore_order_items').select('sku,name,size,qty,unit_price,player_name,player_number,is_bundle_parent,bundle_product_id,product_id,image_url').eq('order_id', order.id);
  // product_id -> image (catalog override, else the product's own image).
  const imgByPid = {};
  const { data: cat } = await sb.from('webstore_products').select('id,product_id,image_url').eq('store_id', order.store_id);
  (cat || []).forEach((c) => { if (c.image_url) { if (c.product_id) imgByPid[c.product_id] = c.image_url; imgByPid['wp:' + c.id] = c.image_url; } });
  const pids = [...new Set((items || []).map((i) => i.product_id).filter((p) => p && !imgByPid[p]))];
  if (pids.length) { const { data: prods } = await sb.from('products').select('id,image_front_url').in('id', pids); (prods || []).forEach((p) => { if (p.image_front_url) imgByPid[p.id] = p.image_front_url; }); }
  const lines = (items || []).filter((i) => !i.bundle_product_id || i.is_bundle_parent).map((i) => {
    const det = [i.size && 'Size ' + i.size, i.player_number && '#' + i.player_number, i.player_name].filter(Boolean).join(' · ');
    const im = i.image_url || imgByPid[i.product_id] || (i.bundle_product_id ? imgByPid['wp:' + i.bundle_product_id] : null);
    const label = i.name || i.sku || (i.is_bundle_parent ? 'Player Pack' : 'Item');
    // For a package, list the included pieces with their sizes/numbers so the buyer
    // can verify their selections straight from the email (components are $0 lines
    // hidden from the totals, matched to this parent by bundle_ref).
    const kids = i.is_bundle_parent
      ? (items || []).filter((c) => !c.is_bundle_parent && (i.bundle_ref ? c.bundle_ref === i.bundle_ref : c.bundle_product_id === i.bundle_product_id))
      : [];
    const subList = kids.length
      ? `<div style="font-size:12px;color:#64748b;margin-top:4px">${kids.map((c) => {
          const cd = [c.size && 'Size ' + c.size, c.player_number && '#' + c.player_number, c.player_name].filter(Boolean).join(' · ');
          return `&bull; ${c.name || c.sku || 'Item'}${cd ? ' &mdash; ' + cd : ''}`;
        }).join('<br>')}</div>`
      : '';
    const imgCell = im
      ? `<td style="width:56px;padding:8px 10px 8px 0;border-bottom:1px solid #eef1f5"><img src="${im}" width="48" height="48" style="width:48px;height:48px;object-fit:cover;border-radius:6px;display:block;background:#f4f6f9"></td>`
      : `<td style="width:56px;padding:8px 10px 8px 0;border-bottom:1px solid #eef1f5"></td>`;
    return `<tr>${imgCell}<td style="padding:8px 0;border-bottom:1px solid #eef1f5">${label}${i.qty > 1 ? ` ×${i.qty}` : ''}${det ? `<div style="font-size:12px;color:#64748b">${det}</div>` : ''}${subList}</td><td style="padding:8px 0;border-bottom:1px solid #eef1f5;text-align:right;font-weight:700;white-space:nowrap">${money((Number(i.unit_price) || 0) * (i.qty || 1))}</td></tr>`;
  }).join('');
  const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');
  const link = `${portal}/shop/${store.slug}/order/${order.id}`;
  const accent = store.accent_color || '#e11d2a';
  const shipping = Number(order.shipping_fee) || 0;
  const processing = Number(order.processing_fee) || 0;
  const discount = Number(order.discount_amt) || 0;
  const tax = Number(order.tax) || 0;
  const a = order.ship_address || null;
  const addrBlock = (order.ship_method === 'ship_home' && a) ? `<div style="margin-top:18px"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:4px">Shipping to</div><div style="font-size:14px;line-height:1.5">${a.name ? a.name + '<br>' : ''}${a.street1 || ''}${a.street2 ? ', ' + a.street2 : ''}<br>${a.city || ''}${a.city ? ', ' : ''}${a.state || ''} ${a.zip || ''}</div></div>` : '';
  const nsaLogo = `${portal}/NEW%20NSA%20Logo%20on%20white.png`;
  const logoBar = `<table width="100%" style="border-collapse:collapse"><tr>
      <td align="left" style="padding:12px 20px;background:#fff;border:1px solid #eef1f5;border-bottom:none;border-radius:10px 0 0 0"><a href="https://nationalsportsapparel.com" style="display:block"><img src="${nsaLogo}" alt="National Sports Apparel" height="32" style="height:32px;display:block;border:none"></a></td>
      <td align="right" style="padding:12px 20px;background:#fff;border:1px solid #eef1f5;border-bottom:none;border-left:none;border-radius:0 10px 0 0">${store.logo_url ? `<img src="${store.logo_url}" alt="${store.name}" height="40" style="height:40px;max-width:130px;object-fit:contain;display:inline-block">` : `<span style="font-weight:800;color:#0b1220">${store.name}</span>`}</td>
    </tr></table>`;
  const paid = order.payment_mode === 'paid';
  const html = `<div style="font-family:'Source Sans 3',-apple-system,Segoe UI,Roboto,sans-serif;color:#2A2F3E;max-width:560px;margin:0 auto">
    ${logoBar}
    <div style="background:${store.primary_color || '#0b1f3a'};color:#fff;padding:18px 24px">
      <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.85">${store.name}</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px">${paid ? 'Order confirmed &amp; paid' : 'Order confirmed'}</div>
      ${order.order_number ? `<div style="font-size:13px;opacity:.85;margin-top:6px">Order #${order.order_number}</div>` : ''}
    </div>
    <div style="border:1px solid #eef1f5;border-top:none;border-radius:0 0 10px 10px;padding:22px 24px">
      <p style="margin:0 0 14px">Thanks, ${order.buyer_name || ''}! ${paid ? "We've received your payment." : 'Your order is in — the team will be invoiced for it.'}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${lines}
        ${shipping > 0 ? `<tr><td></td><td style="padding:8px 0;color:#475569">Shipping</td><td style="padding:8px 0;text-align:right">${money(shipping)}</td></tr>` : ''}
        ${processing > 0 ? `<tr><td></td><td style="padding:8px 0;color:#475569">Processing fee</td><td style="padding:8px 0;text-align:right">${money(processing)}</td></tr>` : ''}
        ${discount > 0 ? `<tr><td></td><td style="padding:8px 0;color:#16a34a">Discount${order.coupon_code ? ` (${order.coupon_code})` : ''}</td><td style="padding:8px 0;text-align:right;color:#16a34a">−${money(discount)}</td></tr>` : ''}
        ${tax > 0 ? `<tr><td></td><td style="padding:8px 0;color:#475569">Sales tax</td><td style="padding:8px 0;text-align:right">${money(tax)}</td></tr>` : ''}
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
      sender: resolveSender({ name: store.name || 'National Sports Apparel' }),
      to: [{ email: order.buyer_email, name: order.buyer_name || '' }],
      subject: order.order_number ? `Your ${store.name} order #${order.order_number} is confirmed` : `Your ${store.name} order is confirmed`,
      htmlContent: html,
    }),
  });
}

// Compare-and-swap increment so concurrent redemptions can't under-count
// (a plain read-add-write loses updates and lets max_uses quotas be exceeded).
async function bumpCouponUse(sb, storeId, code) {
  if (!code) return;
  for (let i = 0; i < 3; i++) {
    const { data } = await sb.from('webstore_coupons').select('id,used_count').eq('store_id', storeId).ilike('code', code).limit(1);
    const c = data && data[0];
    if (!c) return;
    const cur = c.used_count || 0;
    const { data: upd } = await sb.from('webstore_coupons').update({ used_count: cur + 1 }).eq('id', c.id).eq('used_count', cur).select('id');
    if (upd && upd.length) return;
  }
  console.warn('[webstore] coupon used_count increment lost the race 3x for code:', code);
}

module.exports = { sendOrderConfirmation, bumpCouponUse };
