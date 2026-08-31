// Staff-only notification sent after a standalone manual cost has been persisted.
// The browser supplies only the SO/PO identifiers. Cost details are read back from
// Supabase and the poster is resolved from the verified staff JWT, so neither the
// amount nor the "posted by" identity can be invented by the client email payload.
const { verifyUser } = require('./_shared');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const ALERT_EMAIL = 'steve@nationalsportsapparel.com';
const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const money = (value) => Number(value || 0).toFixed(2);
const paymentLabel = (value) => ({ credit_card: 'Credit card', wire: 'Wire', cash: 'Cash' }[String(value || '').toLowerCase()] || 'Credit card');
const cleanId = (value) => String(value || '').trim().slice(0, 120);

function buildEmail({ so, customer, po, member }) {
  const meta = po.sizes || {};
  const amount = Number(meta._manual_cost || 0);
  const method = paymentLabel(meta._payment_method);
  const posterName = member?.name || 'Unknown staff member';
  const posterEmail = member?.email || '';
  const vendor = po.vendor || 'Manual purchase';
  const note = meta._manual_cost_note || po.memo || '';
  const postedAt = meta._manual_cost_created_at || po.created_at || '';
  const orderUrl = 'https://connect.nationalsportsapparel.com/?pg=orders&so=' + encodeURIComponent(so.id);
  const subject = `Manual cost posted by ${posterName} — ${so.id} · $${money(amount)}`;
  const poster = posterName + (posterEmail ? ` (${posterEmail})` : '');
  const textContent = [
    `A manual cost was posted to ${so.id}.`,
    `Amount: $${money(amount)}`,
    `Paid by: ${method}`,
    `Vendor / payee: ${vendor}`,
    `PO reference: ${po.po_id}`,
    `Posted by: ${poster}`,
    customer?.name ? `Customer: ${customer.name}` : '',
    so.memo ? `Order memo: ${so.memo}` : '',
    note ? `Cost note: ${note}` : '',
    postedAt ? `Posted at: ${postedAt}` : '',
    `Open order: ${orderUrl}`,
  ].filter(Boolean).join('\n');
  const row = (label, value) => `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-weight:700;vertical-align:top">${esc(label)}</td><td style="padding:6px 0;color:#0f172a">${esc(value)}</td></tr>`;
  const htmlContent = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a;max-width:640px">'
    + `<h2 style="margin:0 0 8px;color:#0f766e">Manual cost posted to ${esc(so.id)}</h2>`
    + `<p style="margin:0 0 14px;color:#475569">${esc(posterName)} recorded a job cost that is included in the order Costs tab and commission COGS.</p>`
    + '<table role="presentation" cellspacing="0" cellpadding="0" border="0">'
    + row('Amount', `$${money(amount)}`)
    + row('Paid by', method)
    + row('Vendor / payee', vendor)
    + row('PO reference', po.po_id)
    + row('Posted by', poster)
    + (customer?.name ? row('Customer', customer.name) : '')
    + (so.memo ? row('Order memo', so.memo) : '')
    + (note ? row('Cost note', note) : '')
    + (postedAt ? row('Posted at', postedAt) : '')
    + '</table>'
    + `<p style="margin:18px 0 0"><a href="${orderUrl}" style="display:inline-block;padding:10px 16px;background:#0891b2;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">Open ${esc(so.id)}</a></p>`
    + '</div>';
  return { subject, textContent, htmlContent };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  const verified = await verifyUser(event);
  if (!verified.ok) return { statusCode: verified.status, headers: JSON_HEADERS, body: JSON.stringify({ error: verified.error }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }
  const soId = cleanId(body.so_id);
  const poId = cleanId(body.po_id);
  if (!soId || !poId) return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'so_id and po_id are required' }) };

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'BREVO_API_KEY is not configured' }) };

  try {
    const admin = verified.admin;
    const { data: items, error: itemError } = await admin.from('so_items').select('id').eq('so_id', soId);
    if (itemError) throw itemError;
    const itemIds = (items || []).map((item) => item.id).filter(Boolean);
    if (!itemIds.length) return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Saved sales-order items were not found' }) };

    const { data: poRows, error: poError } = await admin.from('so_item_po_lines').select('po_id,vendor,memo,created_at,sizes').in('so_item_id', itemIds).eq('po_id', poId);
    if (poError) throw poError;
    const po = (poRows || []).find((row) => row?.sizes?.po_type === 'manual_cost' && Number(row?.sizes?._manual_cost || 0) > 0);
    if (!po) return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The persisted manual cost was not found' }) };
    if (String(po.sizes?._manual_cost_created_by_id || '') !== String(verified.teamMemberId || '')) {
      return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The signed-in user does not match the saved cost poster' }) };
    }

    const [{ data: so, error: soError }, { data: member, error: memberError }] = await Promise.all([
      admin.from('sales_orders').select('id,customer_id,memo').eq('id', soId).maybeSingle(),
      admin.from('team_members').select('id,name,email').eq('id', verified.teamMemberId).maybeSingle(),
    ]);
    if (soError) throw soError;
    if (memberError) throw memberError;
    if (!so || !member) return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Sales order or poster was not found' }) };
    let customer = null;
    if (so.customer_id) {
      const customerResult = await admin.from('customers').select('id,name').eq('id', so.customer_id).maybeSingle();
      if (!customerResult.error) customer = customerResult.data;
    }

    const email = buildEmail({ so, customer, po, member });
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        sender: { name: 'NSA Portal', email: 'noreply@nationalsportsapparel.com' },
        to: [{ email: ALERT_EMAIL, name: 'Steve Peterson' }],
        subject: email.subject,
        htmlContent: email.htmlContent,
        textContent: email.textContent,
        ...(member.email ? { replyTo: { email: member.email, name: member.name || undefined } } : {}),
      }),
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: responseBody.message || responseBody.error || `Email send failed (${response.status})` }) };
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true, notified: ALERT_EMAIL, messageId: responseBody.messageId || null }) };
  } catch (error) {
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};

exports._internals = { ALERT_EMAIL, buildEmail, paymentLabel };
