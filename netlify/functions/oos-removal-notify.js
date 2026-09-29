// Emails a sales order's rep when a rep/buyer removes an out-of-stock vendor line from
// the API order + PO. The browser supplies which line was removed (that PO line no longer
// exists after removal, so it cannot be read back); everything about WHO gets the email is
// resolved server-side: the recipient is the order's rep from Supabase, and the "removed
// by" identity comes from the verified staff JWT, never from the request body.
const { verifyUser } = require('./_shared');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const FALLBACK_EMAIL = 'steve@nationalsportsapparel.com';
const APP_URL = 'https://connect.nationalsportsapparel.com';
const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const clean = (value, max = 120) => String(value == null ? '' : value).trim().slice(0, max);

function buildEmail({ so, customer, poId, vendorName, item, qty, removedBy }) {
  const orderUrl = `${APP_URL}/?pg=orders&so=${encodeURIComponent(so.id)}`;
  const account = customer?.name || so.customer_id || 'Unknown account';
  const vendor = vendorName || 'the vendor';
  const subject = `Out of stock, removed from ${poId} — ${so.id}${item ? ' · ' + item : ''}`;
  const qtyText = qty ? ` (qty ${qty})` : '';
  const textContent = [
    `${item || 'An item'}${qtyText} is OUT OF STOCK at ${vendor} and was removed from the order, so it will NOT be ordered.`,
    '',
    `Item: ${item || '—'}${qtyText}`,
    `Sales order: ${so.id}`,
    `Former PO: ${poId}`,
    `Account: ${account}`,
    `Vendor: ${vendor}`,
    ...(removedBy ? [`Removed by: ${removedBy}`] : []),
    '',
    'The item is still on the sales order. Please adjust it or source it elsewhere.',
    `Open the order: ${orderUrl}`,
  ].join('\n');
  const row = (label, value) => `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-weight:700;vertical-align:top">${esc(label)}</td><td style="padding:6px 0;color:#0f172a">${esc(value)}</td></tr>`;
  const htmlContent = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a;max-width:640px">'
    + `<h2 style="margin:0 0 8px;color:#c2410c">Out of stock — removed from ${esc(poId)}</h2>`
    + `<p style="margin:0 0 14px;color:#475569"><strong>${esc(item || 'An item')}${esc(qtyText)}</strong> is out of stock at ${esc(vendor)} and was removed from the order, so it will <strong>not</strong> be ordered. The item is still on your sales order — please adjust it or source it elsewhere.</p>`
    + '<table role="presentation" cellspacing="0" cellpadding="0" border="0">'
    + row('Item', item ? item + qtyText : '—')
    + row('Sales order', so.id)
    + row('Former PO', poId)
    + row('Account', account)
    + row('Vendor', vendor)
    + (removedBy ? row('Removed by', removedBy) : '')
    + '</table>'
    + `<p style="margin:18px 0 0"><a href="${orderUrl}" style="display:inline-block;padding:10px 16px;background:#0891b2;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">Open ${esc(so.id)}</a></p>`
    + '</div>';
  return { subject, textContent, htmlContent, orderUrl };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  const verified = await verifyUser(event);
  if (!verified.ok) return { statusCode: verified.status, headers: JSON_HEADERS, body: JSON.stringify({ error: verified.error }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }
  const soId = clean(body.so_id);
  const poId = clean(body.po_id);
  if (!soId || !poId) return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'so_id and po_id are required' }) };
  const item = [body.style, body.color, body.size].map((v) => clean(v, 60)).filter(Boolean).join(' · ');
  const qty = Math.max(0, Math.floor(Number(body.quantity) || 0));
  const vendorName = clean(body.vendor_name, 80);

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'BREVO_API_KEY is not configured' }) };

  try {
    const admin = verified.admin;
    const [{ data: so, error: soError }, { data: member, error: memberError }] = await Promise.all([
      admin.from('sales_orders').select('id,customer_id,created_by').eq('id', soId).maybeSingle(),
      admin.from('team_members').select('id,name,email').eq('id', verified.teamMemberId).maybeSingle(),
    ]);
    if (soError) throw soError;
    if (memberError) throw memberError;
    if (!so) return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Sales order was not found' }) };

    let customer = null;
    if (so.customer_id) {
      const customerResult = await admin.from('customers').select('id,name,primary_rep_id').eq('id', so.customer_id).maybeSingle();
      if (!customerResult.error) customer = customerResult.data;
    }
    // Same rule as the SO message tag (buildOutOfStockRemovalMessage): account rep, else SO creator.
    const repId = customer?.primary_rep_id || so.created_by || '';
    let rep = null;
    if (repId) {
      if (member && String(repId) === String(member.id)) rep = member;
      else {
        const repResult = await admin.from('team_members').select('id,name,email').eq('id', repId).maybeSingle();
        if (!repResult.error) rep = repResult.data;
      }
    }
    // Never drop the alert silently: a rep with no email on file falls back to the office inbox.
    const toEmail = rep?.email || FALLBACK_EMAIL;
    const toName = rep?.email ? (rep.name || undefined) : 'Steve Peterson';

    const email = buildEmail({ so, customer, poId, vendorName, item, qty, removedBy: member?.name || '' });
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        sender: { name: 'NSA Portal', email: 'noreply@nationalsportsapparel.com' },
        to: [{ email: toEmail, ...(toName ? { name: toName } : {}) }],
        subject: email.subject,
        htmlContent: email.htmlContent,
        textContent: email.textContent,
        ...(member?.email ? { replyTo: { email: member.email, name: member.name || undefined } } : {}),
      }),
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: responseBody.message || responseBody.error || `Email send failed (${response.status})` }) };
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true, notified: toEmail, usedFallback: !rep?.email, messageId: responseBody.messageId || null }) };
  } catch (error) {
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};

exports._internals = { FALLBACK_EMAIL, buildEmail };
