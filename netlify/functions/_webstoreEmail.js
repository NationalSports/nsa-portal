// Shared webstore order helpers — used by stripe-webhook.js (fallback path when
// the buyer closes the tab right after paying), webstore-checkout.js (the main
// server-side checkout flow), teamshop-checkout.js (School-PO placement,
// place_order_po), and teamshop-po-review.js (School-PO staff approval).
// Single source of truth for every buyer-facing transactional email and the
// coupon-use counter — ONE brand shell (logo bar + store-colored header +
// white content card), not a copy per email.
const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// NSA + store logo header row, shared by every transactional email below.
function logoBarHtml(store, portal) {
  const nsaLogo = `${portal}/NEW%20NSA%20Logo%20on%20white.png`;
  return `<table width="100%" style="border-collapse:collapse"><tr>
      <td align="left" style="padding:12px 20px;background:#fff;border:1px solid #eef1f5;border-bottom:none;border-radius:10px 0 0 0"><a href="https://nationalsportsapparel.com" style="display:block"><img src="${nsaLogo}" alt="National Sports Apparel" height="32" style="height:32px;display:block;border:none"></a></td>
      <td align="right" style="padding:12px 20px;background:#fff;border:1px solid #eef1f5;border-bottom:none;border-left:none;border-radius:0 10px 0 0">${store.logo_url ? `<img src="${store.logo_url}" alt="${esc(store.name)}" height="40" style="height:40px;max-width:130px;object-fit:contain;display:inline-block">` : `<span style="font-weight:800;color:#0b1220">${esc(store.name)}</span>`}</td>
    </tr></table>`;
}

// Full brand shell: logo bar + store-colored header (headline/subhead) + white
// content card wrapping bodyHtml. Every transactional email in this file
// renders through this ONE template — see sendOrderConfirmation,
// sendPoOrderReceived, sendPoOrderApproved below.
function emailShell({ store, portal, headline, subhead, bodyHtml }) {
  return `<div style="font-family:'Source Sans 3',-apple-system,Segoe UI,Roboto,sans-serif;color:#2A2F3E;max-width:560px;margin:0 auto">
    ${logoBarHtml(store, portal)}
    <div style="background:${store.primary_color || '#0b1f3a'};color:#fff;padding:18px 24px">
      <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.85">${esc(store.name)}</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px">${headline}</div>
      ${subhead ? `<div style="font-size:13px;opacity:.85;margin-top:6px">${subhead}</div>` : ''}
    </div>
    <div style="border:1px solid #eef1f5;border-top:none;border-radius:0 0 10px 10px;padding:22px 24px">
      ${bodyHtml}
    </div></div>`;
}

// POST to Brevo's transactional endpoint — the ONE outbound email mechanism
// every sender in this file uses (teamshop-po-review's inline rejection email
// posts to the same endpoint with the same shape).
function postBrevo(brevoKey, { fromName, toEmail, toName, subject, html }) {
  return fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: fromName || 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
      to: [{ email: toEmail, name: toName || '' }],
      subject,
      htmlContent: html,
    }),
  });
}

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
  const paid = order.payment_mode === 'paid';
  const bodyHtml = `
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
      <p style="font-size:12px;color:#94a3b8;margin-top:18px">Save this email — the link above is how you check your order status anytime.</p>`;
  const html = emailShell({
    store, portal,
    headline: paid ? 'Order confirmed &amp; paid' : 'Order confirmed',
    subhead: order.order_number ? `Order #${order.order_number}` : '',
    bodyHtml,
  });
  await postBrevo(brevoKey, {
    fromName: store.name,
    toEmail: order.buyer_email, toName: order.buyer_name || '',
    subject: order.order_number ? `Your ${store.name} order #${order.order_number} is confirmed` : `Your ${store.name} order is confirmed`,
    html,
  });
}

// The public, login-free order tracker — /shop/order/<status_token> — the
// SAME link Team Shop's own UI uses everywhere (CheckoutPage, ChatWidget,
// AccountPage): host-agnostic, works regardless of store/host, no login.
function poTrackerLink(portal, order) {
  return order.status_token ? `${portal}/shop/order/${order.status_token}` : null;
}

// ── School-PO transactional emails (00200/00201 School-PO checkout) ────
// Both read the buyer identity + store branding straight from webstore_orders
// / webstores (same contract as sendOrderConfirmation above) and share the
// same emailShell — callers never supply content beyond the order row itself.
// Neither internally try/catches: exactly like sendOrderConfirmation, the
// caller (teamshop-checkout's placeOrderPo / teamshop-po-review's approve)
// wraps the call in try/catch so a Brevo hiccup never fails the order write
// or the approval.

// "PO order received" — sent once a School-PO Team Shop order is placed
// (teamshop-checkout.js placeOrderPo, after the order + PO PDF are written).
// Confirms the order + PO document were received and that it's pending staff
// verification — never a ship date, never any implication payment cleared
// (none was collected on this path).
async function sendPoOrderReceived(sb, order) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey || !order.buyer_email) return;
  const { data: stores } = await sb.from('webstores').select('name,slug,primary_color,accent_color,logo_url').eq('id', order.store_id).limit(1);
  const store = stores && stores[0];
  if (!store) return;
  const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');
  const link = poTrackerLink(portal, order);
  const accent = store.accent_color || '#e11d2a';
  const num = order.order_number || String(order.id || '').slice(0, 8);
  const bodyHtml = `
      <p style="margin:0 0 14px">Thanks, ${esc(order.buyer_name || '')}! We've received your order and the purchase order document${order.po_number ? ` (PO #${esc(order.po_number)})` : ''}.</p>
      <p style="margin:0 0 14px">Your order is on hold while our staff verifies the school PO — no payment has been collected and production hasn't started yet. We'll email you again as soon as it's verified.</p>
      ${link ? `<a href="${link}" style="display:inline-block;margin-top:6px;background:${accent};color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:700">Track your order</a>` : ''}
      <p style="font-size:12px;color:#94a3b8;margin-top:18px">Save this email — the link above is how you check your order status anytime.</p>`;
  const html = emailShell({
    store, portal,
    headline: 'Order received &mdash; PO pending verification',
    subhead: `Order #${esc(num)}`,
    bodyHtml,
  });
  await postBrevo(brevoKey, {
    fromName: store.name,
    toEmail: order.buyer_email, toName: order.buyer_name || '',
    subject: `Team Shop order #${num} received — PO pending verification`,
    html,
  });
}

// "PO order approved" — sent once staff verify the school PO and the order
// converts into production (teamshop-po-review.js approve(), after the
// create_teamshop_sales_order RPC succeeds — so this only ever claims
// "in production" once the order has actually converted). Confirms
// verification + production start only, order number + tracker link — no
// money totals beyond what sendOrderConfirmation already shows elsewhere.
async function sendPoOrderApproved(sb, order) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey || !order.buyer_email) return;
  const { data: stores } = await sb.from('webstores').select('name,slug,primary_color,accent_color,logo_url').eq('id', order.store_id).limit(1);
  const store = stores && stores[0];
  if (!store) return;
  const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');
  const link = poTrackerLink(portal, order);
  const accent = store.accent_color || '#e11d2a';
  const num = order.order_number || String(order.id || '').slice(0, 8);
  const bodyHtml = `
      <p style="margin:0 0 14px">Good news, ${esc(order.buyer_name || '')}! We've verified your purchase order${order.po_number ? ` (PO #${esc(order.po_number)})` : ''} and your order is now in production.</p>
      ${link ? `<a href="${link}" style="display:inline-block;margin-top:6px;background:${accent};color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:700">Track your order</a>` : ''}
      <p style="font-size:12px;color:#94a3b8;margin-top:18px">Save this email — the link above is how you check your order status anytime.</p>`;
  const html = emailShell({
    store, portal,
    headline: 'PO verified &mdash; order in production',
    subhead: `Order #${esc(num)}`,
    bodyHtml,
  });
  await postBrevo(brevoKey, {
    fromName: store.name,
    toEmail: order.buyer_email, toName: order.buyer_name || '',
    subject: `Team Shop order #${num} — PO verified, now in production`,
    html,
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

module.exports = { sendOrderConfirmation, sendPoOrderReceived, sendPoOrderApproved, bumpCouponUse };
