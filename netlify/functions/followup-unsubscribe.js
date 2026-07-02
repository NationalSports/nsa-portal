// One-click opt-out for automated follow-up emails (linked from every followup-sweep email and
// advertised via the List-Unsubscribe header). Verifies the per-document HMAC token, flips
// follow_up_auto off, and confirms with a small HTML page. Supports POST for RFC 8058 one-click
// unsubscribe (mail clients call it without rendering anything).
//
// No login: the recipient is a customer, not a portal user. The token only authorizes switching
// OFF follow-ups for the single document it was minted for — worst case for a leaked link is
// that a reminder stops, which the rep can re-arm by re-sending.

const { getSupabaseAdmin } = require('./_shared');
const { FOLLOWUP_TABLES, unsubToken } = require('./_followupShared');

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;background:#f8fafc;margin:0;padding:40px 16px">
<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;text-align:center">
<div style="font-size:18px;font-weight:800;color:#0b1f3a;margin-bottom:16px">National Sports Apparel</div>
<div style="font-size:15px;color:#1a1a1a;line-height:1.6">${body}</div>
</div></body></html>`;

exports.handler = async (event) => {
  const html = (statusCode, title, body) => ({ statusCode, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: page(title, body) });
  const q = event.queryStringParameters || {};
  const table = String(q.t || '');
  const id = String(q.id || '');
  const sig = String(q.sig || '');
  if (!FOLLOWUP_TABLES.has(table) || !id || !sig || sig !== unsubToken(table, id)) {
    return html(400, 'Invalid link', 'This unsubscribe link is invalid or has expired. Reply to the original email and we’ll take care of it.');
  }
  let admin;
  try { admin = getSupabaseAdmin(); } catch (e) { return html(500, 'Error', 'Something went wrong on our end — please reply to the original email instead.'); }
  const { error } = await admin.from(table).update({ follow_up_auto: false, follow_up_at: null }).eq('id', id);
  if (error) {
    console.error('[followup-unsubscribe]', table, id, error.message);
    return html(500, 'Error', 'Something went wrong on our end — please reply to the original email instead.');
  }
  return html(200, 'Unsubscribed', 'You’re all set — automated reminders for this document have been turned off.<br/><br/>Your rep is still available; just reply to any of our emails.');
};
