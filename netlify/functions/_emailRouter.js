const { buildEmailBlockRegistry, checkEmailRecipients } = require('../../src/lib/emailRouting');
const { applyRoutingOverrides } = require('./_emailRoutingOverrides');
const { sendViaGmail } = require('./_gmailSend');

// Read all pages, including art history. A partial/failed read must never silently
// select Brevo. Reuse this snapshot within one sweep, never across invocations.
async function loadEmailRegistry(admin) {
  const lists = await Promise.all(['estimates', 'sales_orders', 'invoices', 'so_jobs'].map(async (table) => {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await admin.from(table).select('id,sent_history')
        .not('sent_history', 'is', null).not('sent_history', 'eq', '[]').order('id').range(offset, offset + 499);
      if (error || !Array.isArray(data)) throw new Error('Could not check email delivery history. Nothing was sent; please try again.');
      rows.push(...data);
      if (data.length < 500) return rows;
    }
  }));
  return applyRoutingOverrides(buildEmailBlockRegistry(lists));
}
async function sendPortalEmail(admin, payload, registry) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { status: 400, error: 'Invalid email payload' };
  const list = (v) => Array.isArray(v) ? v : v ? [v] : [];
  const route = checkEmailRecipients([...list(payload.to), ...list(payload.cc), ...list(payload.bcc)], registry || await loadEmailRegistry(admin));
  if (route.suppressed.length) return { status: 422, error: 'Not sent: ' + route.suppressed.join(', ') + ' opted out or reported spam. Do not resend through another provider.' };
  if (route.review.length) return { status: 422, error: 'Not sent: ' + route.review.join(', ') + ' is suppressed by Brevo without a known reason. Ask an administrator to review the Brevo event before resending.' };
  if (route.dead.length) return { status: 422, error: 'Not sent: ' + route.dead.join(', ') + ' is an invalid mailbox. Correct the contact address before sending again.' };
  if (route.gmail.length) {
    if ((payload.attachment || []).some((a) => !a || a.url || !a.content)) return { status: 422, error: 'This recipient needs Gmail. Download the linked attachment and upload it as a file, or remove it and send again. Nothing was sent through Brevo.' };
    return sendViaGmail(admin, payload);
  }
  const apiKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!apiKey) return { status: 503, error: 'BREVO_API_KEY not configured' };
  let response;
  try { response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': apiKey }, body: JSON.stringify(payload),
  }); } catch (_) { return { status: 502, uncertain: true, error: 'The provider did not confirm the send. Check the sending account before retrying; the email may already have been sent.' }; }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { status: response.status, error: data.message || data.error || 'Brevo send failed' };
  return { status: response.status || 200, messageId: data.messageId, via: 'brevo' };
}
module.exports = { loadEmailRegistry, sendPortalEmail };
