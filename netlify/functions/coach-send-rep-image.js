// Netlify function: a coach sends photos (logo, a design they like, a sizing
// question) straight to their NSA rep from the Team Portal iOS app.
//
// Link-gated like the rest of the coach portal — the app is anon and posts its
// ?portal=<alpha_tag>, which we re-verify server-side (same as portal-action.js
// / roster-write.js) before resolving the team's assigned rep. Images are
// downscaled in the browser, attached to the rep email, and NOT stored — the
// exact pattern catalog-order-request.js already uses for coach-attached images.
const { getSupabaseAdmin: _getSupabaseAdmin } = require('./_shared');

function getSupabaseAdmin() {
  try { return _getSupabaseAdmin(); } catch { return null; }
}
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Where to send when the team has no assigned rep on file.
const FALLBACK_REP = process.env.COACH_REP_EMAIL || process.env.CATALOG_ORDER_EMAIL || 'hello@nationalsportsapparel.com';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Bad JSON' }); }

  const alphaTag = String(body.alpha_tag || body.portal || '').trim();
  const note = String(body.note || '').trim().slice(0, 1200);
  if (!alphaTag) return json(400, { ok: false, error: 'alpha_tag required' });

  // Collect + bound the attachments (max 6, ~5 MB total base64) — same budget
  // as catalog-order-request.js.
  const MAX_IMAGES = 6;
  let imgBudget = 7000000;
  const attachments = [];
  for (const im of (Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [])) {
    const name = String((im && im.name) || 'photo.jpg').replace(/[\r\n]+/g, ' ').slice(0, 80);
    const content = typeof (im && im.content) === 'string' ? im.content : '';
    if (!content || content.length > imgBudget) continue;
    imgBudget -= content.length;
    attachments.push({ content, name });
  }
  if (!attachments.length) return json(400, { ok: false, error: 'No photos to send' });

  const admin = getSupabaseAdmin();
  if (!admin) return json(503, { ok: false, error: 'service-creds-missing' });

  // Verify the tag → team, and resolve the team's assigned rep.
  const { data: customer, error: custErr } = await admin
    .from('customers').select('id,name,primary_rep_id').ilike('alpha_tag', alphaTag).maybeSingle();
  if (custErr) return json(500, { ok: false, error: custErr.message });
  if (!customer) return json(404, { ok: false, error: 'Unknown team' });

  let repEmail = null;
  let repName = '';
  if (customer.primary_rep_id) {
    const { data: rep } = await admin
      .from('team_members').select('email,name,is_active').eq('id', customer.primary_rep_id).maybeSingle();
    if (rep && rep.email && rep.is_active !== false) { repEmail = rep.email; repName = rep.name || ''; }
  }
  const toEmail = repEmail || FALLBACK_REP;

  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
  if (!brevoKey) return json(503, { ok: false, error: 'email-not-configured' });

  const teamName = customer.name || alphaTag;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto">
      <div style="background:#192853;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:17px">Photo${attachments.length > 1 ? 's' : ''} from ${esc(teamName)}</h2>
        <div style="opacity:.8;font-size:12px;margin-top:2px">Sent from the Team Portal app</div>
      </div>
      <div style="background:#fff;padding:20px 22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;font-size:14px;color:#334155;line-height:1.6">
        <p style="margin:0 0 10px"><strong>${esc(teamName)}</strong> sent ${attachments.length} photo${attachments.length > 1 ? 's' : ''}${repName ? ' to you' : ''} — attached to this email.</p>
        ${note ? `<div style="margin:10px 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #962C32;border-radius:4px"><strong>Note:</strong><br>${esc(note).replace(/\n/g, '<br>')}</div>` : ''}
        <p style="color:#64748b;font-size:12px;margin-top:14px">Team tag: <code>${esc(alphaTag)}</code></p>
      </div>
    </div>`;

  let emailed = false;
  let emailError = null;
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify({
        sender: { name: 'NSA Team Portal', email: 'noreply@nationalsportsapparel.com' },
        to: [{ email: toEmail, name: repName || undefined }],
        subject: `Photos from ${teamName} — Team Portal app`,
        htmlContent: html,
        attachment: attachments,
      }),
    });
    emailed = res.ok;
    if (!emailed) emailError = 'Brevo ' + res.status + ': ' + (await res.text());
  } catch (e) { emailError = e.message; }

  if (!emailed) { console.error('[coach-send-rep-image] email failed:', emailError); return json(502, { ok: false, error: 'send failed' }); }
  return json(200, { ok: true, emailed: true });
};
