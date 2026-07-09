// Netlify function: a coach submits a finished roster-order SESSION (the new
// per-team kit ordering system, distinct from the legacy numbers-CSV
// roster-submit.js). Marks the session `submitted` with the service role
// (bypassing RLS) and emails the customer's rep a summary via Brevo so they know
// to build the order. No-op-safe if service creds or Brevo are absent — the
// client still flips status optimistically.
const { createClient } = require('@supabase/supabase-js');
const { resolveSender } = require('./_emailSender');
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
    const coachEmail = String(body.coach_email || '').trim();
    if (!sessionId) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'session_id required' }) };

    const admin = getSupabaseAdmin();
    if (!admin) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'service-creds-missing' }) };

    // Flip status → submitted, but only from open/draft (don't clobber a later state).
    const { data: sess } = await admin.from('roster_order_sessions')
      .select('id,name,season,customer_id,status').eq('id', sessionId).maybeSingle();
    if (!sess) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'session-not-found' }) };
    if (['open', 'draft'].includes(sess.status)) {
      await admin.from('roster_order_sessions').update({ status: 'submitted' }).eq('id', sessionId);
    }

    // Summary: teams, players, locked-team count (coach-done signal).
    const { data: teams } = await admin.from('roster_teams').select('id,locked').eq('session_id', sessionId);
    const teamIds = (teams || []).map((t) => t.id);
    let playerCount = 0;
    if (teamIds.length) {
      const { count } = await admin.from('roster_players').select('id', { count: 'exact', head: true }).in('team_id', teamIds);
      playerCount = count || 0;
    }
    const teamsLabel = (teams || []).length;
    const lockedCount = (teams || []).filter((t) => t.locked).length;

    // Resolve customer + rep email.
    const { data: cust } = await admin.from('customers').select('name,primary_rep_id').eq('id', customerId || sess.customer_id).maybeSingle();
    let repEmail = '', repName = '';
    if (cust?.primary_rep_id) {
      const { data: rep } = await admin.from('team_members').select('name,email').eq('id', cust.primary_rep_id).maybeSingle();
      repEmail = rep?.email || ''; repName = rep?.name || '';
    }

    const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
    if (!brevoKey || !repEmail) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, submitted: true, emailed: false, error: !repEmail ? 'no-rep-email' : 'email-not-configured' }) };
    }

    const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
    const hello = repName ? `Hi ${esc(repName.split(' ')[0])},` : 'Hi,';
    const custName = cust?.name || 'A customer';

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify({
        sender: resolveSender({ name: 'National Sports Apparel' }),
        to: [{ email: repEmail, name: repName || repEmail }],
        ...(coachEmail ? { replyTo: { email: coachEmail } } : {}),
        subject: `Roster submitted: ${sess.name} — ${custName}`,
        htmlContent: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto">
            <div style="background:#0b1f3a;color:white;padding:20px 22px;border-radius:8px 8px 0 0">
              <h2 style="margin:0;font-size:18px">📋 Roster submitted</h2>
            </div>
            <div style="background:white;padding:22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
              <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 14px">${hello}</p>
              <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 16px">
                <strong>${esc(custName)}</strong> submitted the roster order <strong>${esc(sess.name)}</strong>${sess.season ? ` (${esc(sess.season)})` : ''}.
              </p>
              <table style="border-collapse:collapse;margin:0 0 16px;font-size:14px;color:#334155">
                <tr><td style="padding:3px 16px 3px 0;color:#64748b">Teams</td><td style="font-weight:700">${teamsLabel}</td></tr>
                <tr><td style="padding:3px 16px 3px 0;color:#64748b">Players</td><td style="font-weight:700">${playerCount}</td></tr>
                <tr><td style="padding:3px 16px 3px 0;color:#64748b">Rosters locked</td><td style="font-weight:700">${lockedCount} of ${teamsLabel}</td></tr>
              </table>
              <p style="font-size:13px;color:#64748b;line-height:1.6;margin:0 0 16px">
                Open <strong>${esc(custName)} &rarr; Roster</strong> in the portal to review sizes vs. inventory and build the estimate.
              </p>
              <a href="${esc(portal)}" style="display:inline-block;background:#0b1f3a;color:#fff;border-radius:8px;padding:11px 24px;font-weight:700;text-decoration:none;font-size:14px">Open the portal</a>
            </div>
          </div>`,
      }),
    });
    if (!res.ok) {
      console.error('[roster-order-submit] Brevo error:', res.status, await res.text());
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, submitted: true, emailed: false, error: 'send-failed' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, submitted: true, emailed: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
