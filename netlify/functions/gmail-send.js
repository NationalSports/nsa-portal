// Sends a portal email through Google (Gmail API) instead of Brevo.
//
// Why: several school districts' mail filters reject everything Brevo sends, so invoices and
// estimates to those coaches never arrive. Mail from Google's own servers gets through. The
// browser's sendBrevoEmail() routes a send here when a recipient's domain has rejected us before
// (see src/lib/emailRouting.js); everything else still goes through Brevo.
//
// Takes the same JSON body the Brevo proxy does ({sender,to,cc,bcc,replyTo,subject,htmlContent,
// textContent,attachment:[{name,content}]}). Two ways to send, best first:
//   1. As the rep, from their own @nationalsportsapparel.com mailbox — needs Google Workspace
//      domain-wide delegation: GMAIL_SEND_AS_REPS=true plus GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY,
//      with the service account's client ID allowed the gmail.send scope in the Workspace admin
//      console (Security → API controls → Domain-wide delegation).
//   2. Otherwise (or if 1 fails), from the shared sales@ mailbox the AI inbox already uses,
//      shown as "<Rep> | National Sports Apparel", with Reply-To and a Bcc copy to the rep so
//      the coach's reply still lands with them.
// Returns {messageId:'gmail:<id>', via:'rep'|'sales'}. The 'gmail:' prefix tells the portal's
// delivery poller not to look this message up in Brevo.

const { corsHeaders, verifyUser } = require('./_shared');
const { sendPortalEmail } = require('./_emailRouter');

const MAX_BODY_BYTES = 6 * 1024 * 1024;
const json = (statusCode, body) => ({ statusCode, headers: corsHeaders(), body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (Buffer.byteLength(event.body || '', 'utf8') > MAX_BODY_BYTES) return json(413, { error: 'Email is too large to send' });

  // Staff-only, same as the Brevo proxy — unauthenticated this would be an open relay.
  const v = await verifyUser(event);
  if (!v.ok) return json(v.status, { error: v.error });

  let p;
  try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  try {
    const { status, ...out } = await sendPortalEmail(v.admin, p);
    return json(status, out);
  } catch (e) { return json(503, { error: e.message }); }
};
