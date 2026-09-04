// Shared "a webstore closed" handler — used by the scheduled sweep (webstore-close-sweep)
// and the manual-close endpoint (webstore-closed-notify). For a just-closed store it:
//   1. builds an order breakdown (orders, units, gross, fundraising, delivery),
//   2. creates a rep to-do (assigned_todos) assigned to the store's rep to process it,
//   3. emails the rep + assigned CSR that breakdown with a link to the store's orders,
//   4. stamps closed_notified_at so a store is never processed twice (sweep + manual).
// Idempotent: a store that already has closed_notified_at is skipped.
//
// This prompt is about FULFILLMENT (batch the orders into an SO and get product moving)
// and fires at close. The money side — applying store funds to the invoice so
// commissions carry every cost — deliberately waits until the SO's final job finishes
// (see the settle-on-finish to-dos in App.js), not a calendar delay.

const crypto = require('crypto');

const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + (Number(n) || 0).toFixed(2);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const closeIdentity = (store) => `${store.id}:${store.close_at || 'manual-close'}`;
const closeTodoId = (store) => `todo-close-${store.id}-${crypto.createHash('sha256').update(closeIdentity(store)).digest('hex').slice(0, 12)}`;
const closeEmailKey = (store) => {
  const bytes = Buffer.from(crypto.createHash('sha256').update('webstore-close:' + closeIdentity(store)).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

async function sendCloseEmail(payload, idempotencyKey, apiKey) {
  if (!apiKey) throw new Error('BREVO_API_KEY not configured');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey, idempotencyKey },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Brevo returned HTTP ${res.status}: ${await res.text().catch(() => '')}`);
}
// Fundraising the club is owed on an order, net of the coupon discount's share of the pot
// (checkout applies the % to subtotal + fundraise together, so a discounted order collected
// proportionally less fundraising). Keeps this close-out summary in step with the in-app
// payout statement, which uses the same rule.
const netFundraise = (o) => {
  const sub = Number(o.subtotal) || 0, fund = Number(o.fundraise_amt) || 0;
  if (fund <= 0) return 0;
  const base = sub + fund;
  if (base <= 0) return round2(fund);
  const disc = Math.min(Number(o.discount_amt) || 0, base);
  return Math.max(0, round2(fund - disc * (fund / base)));
};

async function buildBreakdown(admin, store) {
  const { data: orders, error: orderError } = await admin.from('webstore_orders')
    .select('id,status,subtotal,fundraise_amt,discount_amt,total').eq('store_id', store.id);
  if (orderError) throw new Error(`Could not load closed-store orders: ${orderError.message}`);
  // Real demand only — drop cancelled / refunded / never-paid carts.
  const live = (orders || []).filter((o) => o.status !== 'cancelled' && o.status !== 'refunded' && o.status !== 'pending' && o.status !== 'pending_payment');
  const orderIds = live.map((o) => o.id);
  let units = 0;
  for (let i = 0; i < orderIds.length; i += 200) {
    const chunk = orderIds.slice(i, i + 200);
    const { data: items, error: itemError } = await admin.from('webstore_order_items').select('qty,is_bundle_parent').in('order_id', chunk);
    if (itemError) throw new Error(`Could not load closed-store items: ${itemError.message}`);
    units += (items || []).filter((it) => !it.is_bundle_parent).reduce((a, it) => a + (Number(it.qty) || 0), 0);
  }
  return {
    orderCount: live.length,
    units,
    gross: live.reduce((a, o) => a + (Number(o.total) || 0), 0),
    fundraise: round2(live.reduce((a, o) => a + netFundraise(o), 0)),
    delivery: store.delivery_mode === 'deliver_club' ? 'Deliver to club' : (store.delivery_mode === 'ship_home' ? 'Ship to home' : (store.delivery_mode || '—')),
  };
}

// Returns { skipped } | { notified, todoId, breakdown }.
async function notifyStoreClosed(admin, store, opts = {}) {
  if (!store || store.closed_notified_at) return { skipped: true, reason: 'already-notified' };
  // A rejected store (store-approval.js closes it as part of the reject) has nothing to
  // process — its captured orders are for refunding, not batching into an SO.
  if (store.approval_status === 'rejected') return { skipped: true, reason: 'rejected-store' };
  const portal = (opts.portal || process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
  const brevoKey = opts.brevoKey || process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';

  const b = await buildBreakdown(admin, store);
  // Deep-link straight to this store's page in the portal (Webstores reads ?store=).
  const link = `${portal}/?pg=webstores&store=${encodeURIComponent(store.id)}`;
  const summaryLines = [
    `${b.orderCount} order${b.orderCount === 1 ? '' : 's'} · ${b.units} unit${b.units === 1 ? '' : 's'}`,
    `Gross ${money(b.gross)}${b.fundraise > 0 ? ` · Fundraising ${money(b.fundraise)}` : ''}`,
    `Delivery: ${b.delivery}`,
  ];

  // 1. Rep to-do (assigned to the store's rep). Mirrors the app's assigned_todos shape.
  const nowIso = new Date().toISOString();
  const todoId = closeTodoId(store);
  let todoOk = false;
  if (store.rep_id) {
    const desc = `Store "${store.name}" has closed. ${summaryLines.join(' · ')}.\n\nProcess the orders into a Sales Order from the store's Orders tab.`;
    const { error } = await admin.from('assigned_todos').insert({
      id: todoId, title: `Process closed store — ${store.name} (${b.orderCount} order${b.orderCount === 1 ? '' : 's'})`,
      description: desc, created_by: null, assigned_to: store.rep_id, so_id: null,
      customer_id: store.customer_id || null, priority: b.orderCount > 0 ? 1 : 2, status: 'open',
      created_at: nowIso, updated_at: nowIso,
    });
    if (error && error.code !== '23505') throw new Error(`Could not create close-out to-do: ${error.message}`);
    todoOk = true; // a duplicate means an earlier retry already created it
  }

  // 2. Email the assigned CSR — they process the closed store. Fall back to the
  //    rep only when no CSR is assigned, and always include the webstore team so
  //    a missing assignment or staff email cannot make the close invisible.
  const ids = [store.csr_id || store.rep_id].filter(Boolean);
  let members = [];
  if (ids.length) {
    const memberResult = await admin.from('team_members').select('id,name,email').in('id', ids);
    if (memberResult.error) throw new Error(`Could not load close-out recipients: ${memberResult.error.message}`);
    members = memberResult.data || [];
  }
  const to = [
    ...members.filter((m) => m && m.email && /.+@.+\..+/.test(m.email)).map((m) => ({ email: m.email, name: m.name || '' })),
    { email: 'stores@nationalsportsapparel.com', name: 'Webstore Team' },
  ];
  const seen = new Set(); const toUniq = to.filter((t) => { const k = t.email.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  const rows = [
    ['Orders', String(b.orderCount)], ['Units', String(b.units)],
    ['Gross', money(b.gross)], ['Fundraising', money(b.fundraise)], ['Delivery', b.delivery],
  ].map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#64748b;font-size:13px">${esc(k)}</td><td style="padding:4px 0;font-weight:700;font-size:13px;color:#0f172a">${esc(v)}</td></tr>`).join('');
  const payload = {
    sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
    to: toUniq,
    subject: `Store closed — ${store.name} (${b.orderCount} order${b.orderCount === 1 ? '' : 's'} to process)`,
    htmlContent: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto">
        <div style="background:#192853;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;font-size:17px">A team store just closed</h2>
        </div>
        <div style="background:#fff;padding:20px 22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
          <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 14px"><strong>${esc(store.name)}</strong> has closed and is ready to process.</p>
          <table style="border-collapse:collapse;margin-bottom:18px">${rows}</table>
          <a href="${esc(link)}" style="display:inline-block;background:#962C32;color:#fff;border-radius:8px;padding:11px 22px;font-weight:700;text-decoration:none;font-size:14px">Process the store →</a>
          <p style="font-size:12px;color:#94a3b8;margin-top:16px">Open the store's Orders tab and batch the orders into a Sales Order. A to-do has also been added to your dashboard.</p>
        </div>
      </div>`,
  };
  const sender = opts.sendEmail || ((body, key) => sendCloseEmail(body, key, brevoKey));
  await sender(payload, closeEmailKey(store));
  const emailed = toUniq.map((t) => t.email);

  // 3. Stamp only after every required step succeeds. A failed email, recipient
  // lookup, to-do insert, or stamp remains eligible for the hourly retry sweep.
  const { error: stampError } = await admin.from('webstores').update({ closed_notified_at: nowIso }).eq('id', store.id);
  if (stampError) throw new Error(`Could not mark close-out notification complete: ${stampError.message}`);
  return { notified: true, todoId: todoOk ? todoId : null, emailed, breakdown: b };
}

module.exports = { notifyStoreClosed, buildBreakdown, netFundraise, closeTodoId, closeEmailKey, sendCloseEmail };
