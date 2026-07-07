// Public one-click unsubscribe for marketing email (CAN-SPAM requirement).
//
//   GET /.netlify/functions/marketing-unsubscribe?e=<email>&c=<campaign>&sig=<hmac>
//
// No login: the HMAC signature over the lowercase address (minted by
// marketing-campaign-send via _marketingShared) is the credential, so a
// recipient can only suppress the address their own email link points at.
// Suppression is global (all future campaigns) and takes effect immediately —
// queued-but-unsent emails to the address are cancelled too.

const crypto = require('crypto');
const { getSupabaseAdmin } = require('./_shared');
const { unsubToken, suppressEmail } = require('./_marketingShared');

function page(title, msg) {
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${title}</title></head>` +
    '<body style="margin:0;background:#FAF6EF;font-family:Arial,Helvetica,sans-serif;">' +
    '<div style="max-width:520px;margin:80px auto;padding:0 16px;">' +
    '<div style="background:#16223F;border-radius:8px 8px 0 0;padding:14px 20px;color:#fff;font-weight:bold;letter-spacing:1px;">NATIONAL SPORTS APPAREL' +
    '<span style="display:block;height:3px;background:#B6985A;margin-top:10px;"></span></div>' +
    '<div style="background:#fff;border:1px solid #E7DFD0;border-top:none;border-radius:0 0 8px 8px;padding:28px 20px;color:#2A2F3E;">' +
    `<h2 style="margin:0 0 10px;font-size:20px;color:#16223F;">${title}</h2>` +
    `<p style="margin:0;font-size:14px;line-height:1.6;color:#6B6256;">${msg}</p>` +
    '</div></div></body></html>'
  );
}

const html = (status, body) => ({ statusCode: status, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body });

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const email = String(qs.e || '').trim().toLowerCase();
  const sig = String(qs.sig || '');
  const campaignId = String(qs.c || '') || null;

  if (!email || !sig) return html(400, page('Invalid link', 'This unsubscribe link is missing information. Please use the link from your email.'));

  const expected = unsubToken(email);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return html(403, page('Invalid link', 'This unsubscribe link is not valid. Please use the link from your email.'));
  }

  try {
    const admin = getSupabaseAdmin();
    const res = await suppressEmail(admin, email, 'unsubscribe', campaignId);
    if (!res.ok) throw new Error(res.error);
  } catch (e) {
    return html(500, page('Something went wrong', 'We could not process your request. Please try again, or reply to the email and we will remove you manually.'));
  }

  return html(200, page("You're unsubscribed", `${email} will not receive marketing email from us again. No further action is needed.`));
};
