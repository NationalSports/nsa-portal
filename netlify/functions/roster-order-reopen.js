// Netlify function: staff reopened a submitted roster-order session (something
// needs fixing before the order can be built). Emails every coach assigned to
// the session's teams — plus the account-level coaches — so the "your rep needs
// changes" loop is closed instead of the roster silently flipping back to Open.
// Service role for reads (bypasses RLS); Brevo for the send. No-op-safe when
// creds are absent.
const { createClient } = require('@supabase/supabase-js');
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function getSupabaseAdmin() {
  const url = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const sessionId = String(body.session_id || '').trim();
    const customerId = String(body.customer_id || '').trim();
    const note = String(body.note || '').trim();
    if (!sessionId) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'session_id required' }) };

    const admin = getSupabaseAdmin();
    if (!admin) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'service-creds-missing' }) };
    const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
    if (!brevoKey) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'email-not-configured' }) };

    const { data: sess } = await admin.from('roster_order_sessions')
      .select('id,name,season,customer_id').eq('id', sessionId).maybeSingle();
    if (!sess) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'session-not-found' }) };

    const { data: cust } = await admin.from('customers').select('name,alpha_tag').eq('id', customerId || sess.customer_id).maybeSingle();

    // Recipients: coaches on the session's teams + account-level coach access.
    const recipients = new Map(); // email -> name
    const { data: teams } = await admin.from('roster_teams').select('id').eq('session_id', sessionId);
    const teamIds = (teams || []).map((t) => t.id);
    if (teamIds.length) {
      const { data: tc } = await admin.from('roster_team_coaches')
        .select('coach_accounts(email,name)').in('team_id', teamIds);
      (tc || []).forEach((r) => { const e = r.coach_accounts?.email; if (e) recipients.set(e.toLowerCase(), r.coach_accounts?.name || ''); });
    }
    const { data: acc } = await admin.from('coach_customer_access')
      .select('coach_accounts(email,name)').eq('customer_id', customerId || sess.customer_id);
    (acc || []).forEach((r) => { const e = r.coach_accounts?.email; if (e && !recipients.has(e.toLowerCase())) recipients.set(e.toLowerCase(), r.coach_accounts?.name || ''); });

    if (!recipients.size) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, emailed: 0, error: 'no-coach-emails' }) };

    const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
    const link = cust?.alpha_tag ? `${portal}/?portal=${encodeURIComponent(cust.alpha_tag)}` : portal;

    let emailed = 0;
    for (const [email, name] of recipients) {
      const hello = name ? `Hi ${esc(name.split(' ')[0])},` : 'Hi Coach,';
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
        body: JSON.stringify({
          sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
          to: [{ email, name: name || email }],
          subject: `Action needed: ${sess.name} roster reopened`,
          htmlContent: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto">
              <div style="background:#b45309;color:white;padding:18px 22px;border-radius:8px 8px 0 0">
                <h2 style="margin:0;font-size:17px">✏️ Your roster needs a change</h2>
              </div>
              <div style="background:white;padding:22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
                <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 14px">${hello}</p>
                <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 14px">
                  Your rep reopened the roster order <strong>${esc(sess.name)}</strong>${sess.season ? ` (${esc(sess.season)})` : ''} for <strong>${esc(cust?.name || 'your club')}</strong> — something needs fixing before the order can be built.
                </p>
                ${note ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;margin:0 0 16px;font-size:14px;color:#78350f"><strong>From your rep:</strong> ${esc(note)}</div>` : ''}
                <a href="${esc(link)}" style="display:inline-block;background:#0b1f3a;color:#fff;border-radius:8px;padding:11px 24px;font-weight:700;text-decoration:none;font-size:14px">Open my roster</a>
                <p style="font-size:12px;color:#94a3b8;margin:16px 0 0">Make the updates, then submit the order again when it's ready.</p>
              </div>
            </div>`,
        }),
      });
      if (res.ok) emailed++;
      else console.error('[roster-order-reopen] Brevo error', res.status, await res.text());
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, emailed }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
