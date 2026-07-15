// Scheduled function (see netlify.toml): once a day, nag coaches whose roster
// deadline is approaching and whose team still isn't locked. Emails each coach
// the teams they still owe sizes for, then stamps the session so it only nags
// once per session as the deadline nears (deadline_reminded_at). Safe no-op if
// service creds or Brevo are absent.
const { createClient } = require('@supabase/supabase-js');
const { resolveSender } = require('./_emailSender');
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const REMIND_WINDOW_DAYS = 3; // start nagging this many days out

exports.handler = async () => {
  const url = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
  if (!url || !key) { console.error('[roster-deadline-reminders] missing supabase creds'); return { statusCode: 500, body: 'Not configured' }; }
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() + REMIND_WINDOW_DAYS);
  const iso = (d) => d.toISOString().slice(0, 10);

  try {
    // Sessions with a deadline inside the window, still open, not yet reminded.
    const { data: sessions } = await admin.from('roster_order_sessions')
      .select('id,name,season,deadline,customer_id')
      .in('status', ['open', 'draft'])
      .not('deadline', 'is', null)
      .is('deadline_reminded_at', null)
      .gte('deadline', iso(today))
      .lte('deadline', iso(cutoff));
    if (!sessions || !sessions.length) return { statusCode: 200, body: 'No sessions due' };

    // Cache customer names.
    const custIds = [...new Set(sessions.map((s) => s.customer_id).filter(Boolean))];
    const custName = {};
    if (custIds.length) {
      const { data: custs } = await admin.from('customers').select('id,name').in('id', custIds);
      (custs || []).forEach((c) => { custName[c.id] = c.name; });
    }

    let emailed = 0;
    for (const sess of sessions) {
      // Unlocked teams still owe sizes.
      const { data: teams } = await admin.from('roster_teams').select('id,name,locked').eq('session_id', sess.id);
      const unlocked = (teams || []).filter((t) => !t.locked);
      if (unlocked.length && brevoKey) {
        const { data: tc } = await admin.from('roster_team_coaches')
          .select('team_id, coach_accounts(email,name)')
          .in('team_id', unlocked.map((t) => t.id));
        // Group unlocked team names per coach email.
        const byCoach = {};
        (tc || []).forEach((r) => {
          const email = r.coach_accounts?.email;
          if (!email) return;
          const teamName = (unlocked.find((t) => t.id === r.team_id) || {}).name || 'your team';
          const entry = byCoach[email] || (byCoach[email] = { name: r.coach_accounts?.name || '', teams: [] });
          if (!entry.teams.includes(teamName)) entry.teams.push(teamName);
        });

        for (const [email, info] of Object.entries(byCoach)) {
          const hello = info.name ? `Hi ${esc(info.name.split(' ')[0])},` : 'Hi Coach,';
          const cName = custName[sess.customer_id] || 'your club';
          const teamsHtml = info.teams.map((t) => `<li style="margin:2px 0">${esc(t)}</li>`).join('');
          const res = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
            body: JSON.stringify({
              sender: resolveSender({ name: 'National Sports Apparel' }),
              to: [{ email, name: info.name || email }],
              subject: `Reminder: ${sess.name} sizes due ${sess.deadline}`,
              htmlContent: `
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto">
                  <div style="background:#b45309;color:white;padding:18px 22px;border-radius:8px 8px 0 0">
                    <h2 style="margin:0;font-size:17px">⏰ Roster due ${esc(sess.deadline)}</h2>
                  </div>
                  <div style="background:white;padding:22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
                    <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 14px">${hello}</p>
                    <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 12px">
                      The roster order <strong>${esc(sess.name)}</strong> for <strong>${esc(cName)}</strong> is due <strong>${esc(sess.deadline)}</strong>. These teams still need player sizes:
                    </p>
                    <ul style="font-size:14px;color:#334155;margin:0 0 16px;padding-left:20px">${teamsHtml}</ul>
                    <a href="${esc(portal)}" style="display:inline-block;background:#0b1f3a;color:#fff;border-radius:8px;padding:11px 24px;font-weight:700;text-decoration:none;font-size:14px">Open my portal</a>
                    <p style="font-size:12px;color:#94a3b8;margin:16px 0 0">Already done? Lock your roster in the portal and you'll stop getting reminders.</p>
                  </div>
                </div>`,
            }),
          });
          if (res.ok) emailed++;
          else console.error('[roster-deadline-reminders] Brevo error', res.status, await res.text());
        }
      }
      // Stamp so we don't nag again for this session.
      await admin.from('roster_order_sessions').update({ deadline_reminded_at: new Date().toISOString() }).eq('id', sess.id);
    }
    return { statusCode: 200, body: `Reminded ${emailed} coach(es) across ${sessions.length} session(s)` };
  } catch (e) {
    console.error('[roster-deadline-reminders]', e);
    return { statusCode: 500, body: e.message };
  }
};
