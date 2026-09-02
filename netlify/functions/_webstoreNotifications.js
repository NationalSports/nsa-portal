// Durable webstore notification delivery.
//
// Callers persist an outbox obligation before invoking this module. Delivery is
// then safe to retry: workers atomically claim a row, Brevo receives a stable
// UUID idempotency key, and completion is recorded transactionally.

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const MAX_ATTEMPTS = 8;

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function safeHttpUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
  } catch (_) {
    return '';
  }
}

function safeColor(value, fallback) {
  const color = String(value || '').trim();
  return /^(#[0-9a-f]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|[a-z]{3,20})$/i.test(color) ? color : fallback;
}

function staffRecipientIds(csrId, repId) {
  return [...new Set([csrId, repId].filter(Boolean).map(String))];
}

function staffEmailRecipients(assigned) {
  const recipients = [...(assigned || []), { email: 'stores@nationalsportsapparel.com', name: 'Webstore Team' }];
  return recipients.filter((person, index, all) => person && person.email
    && all.findIndex((candidate) => candidate && String(candidate.email).toLowerCase() === String(person.email).toLowerCase()) === index);
}

function trackingUrl(carrier, tracking) {
  if (!tracking) return '';
  const number = encodeURIComponent(String(tracking));
  const name = String(carrier || '').toLowerCase();
  if (name.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${number}`;
  if (name.includes('ups')) return `https://www.ups.com/track?tracknum=${number}`;
  if (name.includes('usps') || name.includes('stamps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${number}`;
  return `https://www.google.com/search?q=${number}`;
}

function portalBase() {
  const configured = process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app';
  return safeHttpUrl(configured).replace(/\/+$/, '') || 'https://nsa-portal.netlify.app';
}

function buildCustomerStaffEmail({ order, store, message, recipients }) {
  const portal = portalBase();
  const storeName = store && store.name ? store.name : 'Webstore';
  const orderNumber = order.omg_order_number ? ` #${escapeHtml(order.omg_order_number)}` : '';
  const html = `<div style="font-family:'Source Sans 3',-apple-system,Segoe UI,Roboto,sans-serif;color:#2A2F3E;max-width:560px;margin:0 auto">
    <div style="background:#0b1f3a;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
      <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.85">${escapeHtml(storeName)}</div>
      <div style="font-size:21px;font-weight:800;margin-top:4px">💬 New customer reply</div>
    </div>
    <div style="border:1px solid #eef1f5;border-top:none;border-radius:0 0 10px 10px;padding:22px">
      <p style="margin:0 0 6px"><b>${escapeHtml(order.buyer_name || 'A customer')}</b> replied on order${orderNumber}:</p>
      <blockquote style="margin:8px 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #e11d2a;border-radius:6px;font-size:15px">${escapeHtml(message.text)}</blockquote>
      <p style="font-size:13px;color:#64748b">Open the order in OMG Stores to reply — your reply emails the customer their portal link.</p>
      <div style="margin:18px 0"><a href="${escapeHtml(`${portal}/?omg=1`)}" style="display:inline-block;background:#e11d2a;color:#fff;text-decoration:none;padding:11px 24px;border-radius:8px;font-weight:700">Open OMG Stores →</a></div>
    </div></div>`;

  return {
    sender: { name: 'NSA Order Portal', email: 'stores@nationalsportsapparel.com' },
    to: recipients,
    replyTo: order.buyer_email ? { email: order.buyer_email, name: order.buyer_name || '' } : undefined,
    subject: `💬 ${order.buyer_name || 'Customer'} replied — ${storeName} order${order.omg_order_number ? ` #${order.omg_order_number}` : ''}`,
    htmlContent: html,
  };
}

function buildShipmentCustomerEmail({ order, store, shipment, remainingUnits }) {
  const portal = portalBase();
  const items = Array.isArray(shipment.items) ? shipment.items : [];
  const partial = Number(remainingUnits) > 0;
  const accent = safeColor(store.accent_color, '#e11d2a');
  const primary = safeColor(store.primary_color, '#0b1f3a');
  const tracking = shipment.tracking_number || '';
  const carrier = shipment.carrier || '';
  const trackLink = trackingUrl(carrier, tracking);
  const storeLogo = safeHttpUrl(store.logo_url);
  const nsaLogo = `${portal}/NEW%20NSA%20Logo%20on%20white.png`;
  const orderLink = order.status_token ? `${portal}/shop/order/${encodeURIComponent(order.status_token)}` : '';
  const carrierName = String(carrier).toUpperCase().replace('STAMPS_COM', 'USPS');
  const rows = items.map((item) => {
    const image = safeHttpUrl(item && item.image);
    const imageCell = image
      ? `<td style="width:52px;padding:7px 10px 7px 0;border-bottom:1px solid #eef1f5"><img src="${escapeHtml(image)}" width="44" height="44" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px;display:block;background:#f4f6f9"></td>`
      : '<td style="width:52px;padding:7px 10px 7px 0;border-bottom:1px solid #eef1f5"></td>';
    const name = (item && (item.name || item.sku)) || 'Item';
    const qty = Math.max(0, Number(item && (item.qty != null ? item.qty : item.quantity)) || 0);
    return `<tr>${imageCell}<td style="padding:7px 0;border-bottom:1px solid #eef1f5">${escapeHtml(name)}</td><td style="padding:7px 0;border-bottom:1px solid #eef1f5;text-align:right;color:#64748b">×${escapeHtml(qty || 1)}</td></tr>`;
  }).join('');
  const logo = storeLogo
    ? `<img src="${escapeHtml(storeLogo)}" alt="${escapeHtml(store.name)}" height="40" style="height:40px;max-width:130px;object-fit:contain;display:inline-block">`
    : `<span style="font-weight:800;color:#0b1220">${escapeHtml(store.name)}</span>`;
  const html = `<div style="font-family:'Source Sans 3',-apple-system,Segoe UI,Roboto,sans-serif;color:#2A2F3E;max-width:560px;margin:0 auto">
    <table width="100%" style="border-collapse:collapse"><tr>
      <td align="left" style="padding:12px 20px;background:#fff;border:1px solid #eef1f5;border-bottom:none;border-radius:10px 0 0 0"><a href="https://nationalsportsapparel.com"><img src="${escapeHtml(nsaLogo)}" alt="National Sports Apparel" height="32" style="height:32px;display:block;border:none"></a></td>
      <td align="right" style="padding:12px 20px;background:#fff;border:1px solid #eef1f5;border-bottom:none;border-left:none;border-radius:0 10px 0 0">${logo}</td>
    </tr></table>
    <div style="background:${primary};color:#fff;padding:18px 24px">
      <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.85">${escapeHtml(store.name)}</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px">${partial ? 'Part of your order shipped' : 'Your order shipped'} 📦</div>
    </div>
    <div style="border:1px solid #eef1f5;border-top:none;border-radius:0 0 10px 10px;padding:22px 24px">
      <p style="margin:0 0 14px">Hi ${escapeHtml(order.buyer_name || 'there')}, ${partial ? 'some of your items are on the way' : 'your order is on the way'}!</p>
      ${tracking ? `<div style="background:#f8fafc;border:1px solid #eef1f5;border-radius:8px;padding:12px 14px;margin-bottom:16px">
        <div style="font-size:12px;color:#64748b">${escapeHtml(carrierName || 'Carrier')} tracking</div>
        <div style="font-size:16px;font-weight:800;margin:2px 0 8px">${escapeHtml(tracking)}</div>
        <a href="${escapeHtml(trackLink)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:700">Track package</a>
      </div>` : ''}
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:4px">${partial ? 'Items in this shipment' : 'Items shipped'}</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
      ${partial ? `<p style="font-size:13px;color:#64748b;margin-top:14px">Your remaining ${Number(remainingUnits)} item${Number(remainingUnits) === 1 ? '' : 's'} will ship separately — you'll get another email when they do.</p>` : ''}
      ${orderLink ? `<p style="margin-top:18px"><a href="${escapeHtml(orderLink)}" style="color:${accent}">View your full order</a></p>` : ''}
    </div></div>`;

  return {
    sender: { name: store.name || 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
    to: [{ email: order.buyer_email, name: order.buyer_name || '' }],
    subject: `${partial ? 'Part of your' : 'Your'} ${store.name} order shipped`,
    htmlContent: html,
  };
}

async function one(query, label) {
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`${label}: ${error.message}`);
  if (!data) throw new Error(`${label}: not found`);
  return data;
}

async function currentStaffRecipientIds(admin, store, taggedMembers) {
  const ids = new Set(Array.isArray(taggedMembers) ? taggedMembers.filter(Boolean).map(String) : []);
  let repId = store.rep_id || null;
  let csrId = store.csr_id || null;

  if (store.omg_sale_code) {
    const { data: omg, error } = await admin.from('omg_stores').select('rep_id,csr_id')
      .eq('_omg_sale_code', store.omg_sale_code).maybeSingle();
    if (error) throw new Error(`OMG assignment: ${error.message}`);
    if (omg) {
      if (omg.rep_id) repId = omg.rep_id;
      if (omg.csr_id) csrId = omg.csr_id;
    }
  }
  if (!csrId && repId) {
    const { data: assignments, error } = await admin.from('rep_csr_assignments')
      .select('csr_id,is_primary,is_active').eq('rep_id', repId);
    if (error) throw new Error(`CSR assignment: ${error.message}`);
    const active = (assignments || []).filter((assignment) => assignment.is_active !== false);
    csrId = (active.find((assignment) => assignment.is_primary) || active[0] || {}).csr_id || null;
  }
  for (const id of staffRecipientIds(csrId, repId)) ids.add(id);

  const { data: storeTeam, error: storeTeamError } = await admin.from('user_profiles')
    .select('id').eq('is_active', true).contains('notify_depts', ['store']);
  if (storeTeamError) throw new Error(`Webstore team routing: ${storeTeamError.message}`);
  for (const person of storeTeam || []) ids.add(String(person.id));
  return [...ids];
}

async function loadPayload(admin, row) {
  const order = await one(admin.from('webstore_orders').select('*').eq('id', row.order_id), 'order');
  const store = await one(admin.from('webstores').select('id,name,slug,primary_color,accent_color,logo_url,rep_id,csr_id,omg_sale_code').eq('id', order.store_id), 'store');

  if (row.kind === 'customer_staff_reply') {
    const message = await one(admin.from('messages').select('id,text,tagged_members').eq('id', row.message_id), 'message');
    // Resolve assignments again at send time. A transient routing lookup during
    // the customer's request cannot permanently omit the CSR/rep/team.
    const ids = await currentStaffRecipientIds(admin, store, message.tagged_members);
    let assigned = [];
    if (ids.length) {
      const { data, error } = await admin.from('user_profiles').select('id,email,full_name').in('id', ids);
      if (error) throw new Error(`recipients: ${error.message}`);
      assigned = (data || []).filter((person) => person.email).map((person) => ({ email: person.email, name: person.full_name || '' }));
    }
    return buildCustomerStaffEmail({ order, store, message, recipients: staffEmailRecipients(assigned) });
  }

  if (row.kind === 'shipment_customer_email') {
    const shipment = await one(admin.from('webstore_shipments').select('*').eq('id', row.shipment_id), 'shipment');
    if (shipment.voided_at) return null;
    if (!order.buyer_email) return null;
    const { data: lines, error } = await admin.from('webstore_order_items').select('qty,shipped_qty,is_bundle_parent,line_status').eq('order_id', order.id);
    if (error) throw new Error(`order items: ${error.message}`);
    const remainingUnits = (lines || []).filter((line) => !line.is_bundle_parent && line.line_status !== 'cancelled')
      .reduce((sum, line) => sum + Math.max(0, (Number(line.qty) || 0) - (Number(line.shipped_qty) || 0)), 0);
    return buildShipmentCustomerEmail({ order, store, shipment, remainingUnits });
  }

  throw new Error(`Unsupported notification kind: ${row.kind}`);
}

async function sendBrevoEmail(payload, idempotencyKey) {
  const apiKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY not configured');
  const response = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
      idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  let result = null;
  try { result = await response.json(); } catch (_) { result = null; }
  if (!response.ok) {
    const detail = result && (result.message || result.code) ? `: ${result.message || result.code}` : '';
    throw new Error(`Brevo returned HTTP ${response.status}${detail}`);
  }
  return result && (result.messageId || result.message_id) ? String(result.messageId || result.message_id) : null;
}

async function recordFailure(admin, row, error) {
  const dead = Number(row.attempts) >= MAX_ATTEMPTS;
  const waitMinutes = Math.min(60, Math.max(2, 2 ** Math.max(1, Number(row.attempts) - 1)));
  const patch = {
    status: dead ? 'dead' : 'pending',
    available_at: new Date(Date.now() + waitMinutes * 60000).toISOString(),
    locked_at: null,
    last_error: String((error && error.message) || error || 'Unknown delivery error').slice(0, 2000),
    updated_at: new Date().toISOString(),
  };
  // Never roll a committed `sent` row back to pending if the completion RPC
  // succeeded but its network response was lost.
  const { error: updateError } = await admin.from('webstore_notification_outbox')
    .update(patch).eq('id', row.id).eq('status', 'processing');
  if (updateError) console.error('[webstore-notifications] could not record failure:', updateError.message);
}

async function processOutboxRow(admin, row) {
  try {
    const payload = await loadPayload(admin, row);
    const providerMessageId = payload ? await sendBrevoEmail(payload, row.id) : null;
    const { error } = await admin.rpc('complete_webstore_notification', {
      p_id: row.id,
      p_provider_message_id: providerMessageId,
    });
    if (error) throw new Error(`Could not complete notification: ${error.message}`);
    return { ok: true, id: row.id, kind: row.kind, providerMessageId, skipped: !payload };
  } catch (error) {
    await recordFailure(admin, row, error);
    console.error('[webstore-notifications] delivery failed:', row.id, row.kind, error.message || error);
    return { ok: false, id: row.id, kind: row.kind, error: error.message || String(error) };
  }
}

async function processNotificationByDedupe(admin, dedupeKey) {
  const { data, error } = await admin.rpc('claim_webstore_notification', { p_dedupe_key: dedupeKey });
  if (error) throw new Error(`Could not claim notification: ${error.message}`);
  const row = data && data[0];
  if (!row) return { ok: true, claimed: false };
  return { ...(await processOutboxRow(admin, row)), claimed: true };
}

async function drainNotifications(admin, limit = 20) {
  const { data, error } = await admin.rpc('claim_webstore_notifications', { p_limit: limit });
  if (error) throw new Error(`Could not claim notifications: ${error.message}`);
  const results = [];
  for (const row of data || []) results.push(await processOutboxRow(admin, row));
  return {
    claimed: results.length,
    sent: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}

module.exports = {
  MAX_ATTEMPTS,
  escapeHtml,
  safeHttpUrl,
  staffRecipientIds,
  staffEmailRecipients,
  trackingUrl,
  buildCustomerStaffEmail,
  buildShipmentCustomerEmail,
  currentStaffRecipientIds,
  sendBrevoEmail,
  processOutboxRow,
  processNotificationByDedupe,
  drainNotifications,
};
