// Netlify function: send the "your order is being processed" email for OMG
// orders. Emails every order in a shadow store that has a buyer_email and
// hasn't been notified yet (processing_email_sent=false), then marks it sent.
//
// Each email links to the public, login-free status page:
//   <PORTAL_PUBLIC_URL>/shop/order/<status_token>
//
// POST /.netlify/functions/omg-order-notify
// Body: { storeId?: "<uuid>", saleCode?: "D2SVU", orderId?: "<uuid>", resend?: false }
//   • orderId → just that order; otherwise all un-notified orders in the store.
//   • resend  → ignore the processing_email_sent guard (re-send).
//
// Env: REACT_APP_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
//      BREVO_API_KEY, PORTAL_PUBLIC_URL (or Netlify URL)
const { createClient } = require('@supabase/supabase-js');

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!sbUrl || !sbKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  if (!brevoKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'BREVO_API_KEY not configured' }) };
  const sb = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
  const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');

  // Test mode: redirect EVERY email to testEmail instead of the real buyer, and
  // don't mark orders as notified — so you can rehearse the parent experience
  // safely on a deploy preview without emailing real parents.
  const testEmail = (body.testEmail || '').trim();
  const testMode = !!testEmail;

  try {
    let storeId = body.storeId;
    if (!storeId && body.saleCode) {
      const { data } = await sb.from('webstores').select('id').eq('omg_sale_code', body.saleCode).maybeSingle();
      storeId = data && data.id;
    }
    if (!storeId && !body.orderId) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Provide storeId, saleCode, or orderId' }) };

    // Pull candidate orders.
    let q = sb.from('webstore_orders').select('*');
    if (body.orderId) q = q.eq('id', body.orderId);
    else q = q.eq('store_id', storeId);
    const { data: orders, error } = await q;
    if (error) throw new Error(error.message);

    // Optional explicit selection from the confirm modal (the rep's checkboxes).
    const pick = Array.isArray(body.orderIds) && body.orderIds.length ? new Set(body.orderIds.map(String)) : null;

    // In test mode we still need orders, but they don't need a buyer email
    // (everything routes to testEmail) and the sent-guard is ignored.
    const targets = (orders || [])
      .filter((o) => !pick || pick.has(String(o.id)))
      .filter((o) => testMode ? true : (o.buyer_email && (body.resend || !o.processing_email_sent)));
    if (!targets.length) return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent: 0, note: testMode ? 'No orders in this store to test with.' : 'No orders need notifying (missing emails or already sent).' }) };

    // Store branding (one fetch).
    const sIds = [...new Set(targets.map((o) => o.store_id))];
    const { data: stores } = await sb.from('webstores').select('id,name,slug,logo_url,primary_color,accent_color').in('id', sIds);
    const storeById = {}; (stores || []).forEach((s) => { storeById[s.id] = s; });

    let sent = 0, failures = [], firstMsgId = null;
    for (const o of targets) {
      const store = storeById[o.store_id] || { name: 'Your order' };
      const { data: its } = await sb.from('webstore_order_items').select('*').eq('order_id', o.id);
      const items = (its || []).filter((i) => !i.is_bundle_parent);
      const html = buildHtml({ store, order: o, items, portal, testFor: testMode ? (o.buyer_email || o.buyer_name || `order ${o.omg_order_number}`) : null });
      const toEmail = testMode ? testEmail : o.buyer_email;
      try {
        const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
          body: JSON.stringify({
            sender: { name: store.name || 'National Sports Apparel', email: 'stores@nationalsportsapparel.com' },
            to: [{ email: toEmail, name: o.buyer_name || '' }],
            subject: `${testMode ? '[TEST] ' : ''}We’ve started processing your ${store.name} order`,
            htmlContent: html,
          }),
        });
        if (!resp.ok) {
          // Capture Brevo's actual error so the UI can show WHY (bad key,
          // unverified sender, invalid recipient, etc.) instead of failing silently.
          let detail = '';
          try { const j = await resp.json(); detail = j.message || j.code || JSON.stringify(j); } catch { detail = await resp.text().catch(() => ''); }
          failures.push({ order: o.omg_order_number, to: toEmail, status: resp.status, detail });
          continue;
        }
        // Only mark real sends; test mode leaves processing_email_sent untouched.
        if (!testMode) await sb.from('webstore_orders').update({ processing_email_sent: true, processing_email_sent_at: new Date().toISOString() }).eq('id', o.id);
        sent++;
        if (!firstMsgId) { try { const j = await resp.json(); firstMsgId = j.messageId || j.messageIds || 'accepted'; } catch { firstMsgId = 'accepted'; } }
      } catch (e) { failures.push({ order: o.omg_order_number, to: toEmail, error: e.message }); }
    }

    const firstErr = failures[0] ? (failures[0].detail || failures[0].error || `HTTP ${failures[0].status}`) : null;
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent, failed: failures.length, firstError: firstErr, brevoMessageId: firstMsgId, sentTo: testMode ? testEmail : undefined, failures }) };
  } catch (e) {
    console.error('[omg-order-notify] failed:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};

function buildHtml({ store, order, items, portal, testFor }) {
  const accent = store.accent_color || '#e11d2a';
  const primary = store.primary_color || '#0b1f3a';
  const link = `${portal}/shop/order/${order.status_token}`;
  const testBanner = testFor ? `<div style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin:0 0 14px;font-size:13px;font-weight:600">⚠️ TEST EMAIL — in production this would go to <b>${testFor}</b>. No real parent was emailed.</div>` : '';
  const nsaLogo = `${portal}/NEW%20NSA%20Logo%20on%20white.png`;
  const rows = items.map((i) => {
    const img = i.image_url
      ? `<td style="width:52px;padding:8px 10px 8px 0;border-bottom:1px solid #eef1f5"><img src="${i.image_url}" width="44" height="44" style="width:44px;height:44px;object-fit:cover;border-radius:6px;display:block;background:#f4f6f9"></td>`
      : `<td style="width:52px;padding:8px 10px 8px 0;border-bottom:1px solid #eef1f5"></td>`;
    const det = [i.color, i.size && `Size ${i.size}`, `Qty ${i.qty || 1}`, i.player_number && `#${i.player_number}`].filter(Boolean).join(' · ');
    return `<tr>${img}<td style="padding:8px 0;border-bottom:1px solid #eef1f5">${i.name || i.sku || 'Item'}${det ? `<div style="font-size:12px;color:#64748b">${det}</div>` : ''}</td></tr>`;
  }).join('');
  const logoBar = `<table width="100%" style="border-collapse:collapse"><tr>
      <td align="left" style="padding:12px 20px;background:#fff;border:1px solid #eef1f5;border-bottom:none;border-radius:10px 0 0 0"><img src="${nsaLogo}" alt="National Sports Apparel" height="32" style="height:32px;display:block"></td>
      <td align="right" style="padding:12px 20px;background:#fff;border:1px solid #eef1f5;border-bottom:none;border-left:none;border-radius:0 10px 0 0">${store.logo_url ? `<img src="${store.logo_url}" alt="${store.name}" height="40" style="height:40px;max-width:130px;object-fit:contain;display:inline-block">` : `<span style="font-weight:800;color:#0b1220">${store.name}</span>`}</td>
    </tr></table>`;
  return `<div style="font-family:'Source Sans 3',-apple-system,Segoe UI,Roboto,sans-serif;color:#2A2F3E;max-width:560px;margin:0 auto">
    ${logoBar}
    <div style="background:${primary};color:#fff;padding:20px 24px">
      <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.85">${store.name}</div>
      <div style="font-size:23px;font-weight:800;margin-top:4px">Your order is being processed 🎬</div>
    </div>
    <div style="border:1px solid #eef1f5;border-top:none;border-radius:0 0 10px 10px;padding:24px">
      ${testBanner}
      <p style="margin:0 0 14px">Hi ${order.buyer_name || 'there'}, good news — we’ve received your order${order.omg_order_number ? ` (#${order.omg_order_number})` : ''} and started getting it ready. You can follow every step — received, in production, shipped — from the link below.</p>
      <div style="text-align:center;margin:22px 0">
        <a href="${link}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:14px 32px;border-radius:9px;font-weight:800;font-size:16px">Track your order →</a>
      </div>
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:4px">Your items</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
      ${order.total > 0 ? `<div style="text-align:right;font-weight:800;font-size:16px;margin-top:12px">Total: ${money(order.total)}</div>` : ''}
      <p style="font-size:12px;color:#94a3b8;margin-top:18px">Save this email — the button above is your private link to check status anytime.</p>
    </div></div>`;
}
