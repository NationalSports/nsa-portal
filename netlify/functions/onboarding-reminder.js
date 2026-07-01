// Scheduled (daily) nudge for new hires who were invited but haven't finished.
// Sends a branded reminder to anyone whose invite is still invited/in_progress,
// not expired, last reminded 3+ days ago, and reminded fewer than 3 times.
// Scheduled via netlify.toml ([functions."onboarding-reminder"].schedule).
const { getSupabaseAdmin } = require('./_shared');
const { brandedEmail } = require('./_onboardingEmail');

const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function welcomeLink(token) {
  const base = (process.env.ONBOARDING_WELCOME_URL || 'https://www.nationalsportsapparel.com/welcome').replace(/\/+$/, '');
  return `${base}?token=${encodeURIComponent(token)}`;
}

async function sendReminder(invite) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
  if (!brevoKey) return false;
  const hello = invite.full_name ? `Hi ${esc(invite.full_name.split(' ')[0])},` : 'Hello,';
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
      to: [{ email: invite.personal_email, name: invite.full_name || invite.personal_email }],
      subject: 'Reminder: finish your National Sports Apparel new-hire paperwork',
      htmlContent: brandedEmail({
        preheader: 'A few minutes to finish your onboarding.',
        heading: 'Just a Friendly Reminder',
        bodyHtml:
          `<p style="margin:0 0 12px;">${hello}</p>` +
          `<p style="margin:0;">We still need your new-hire paperwork before your first day. It only takes about 15 minutes, and your progress is saved — you can pick up right where you left off.</p>`,
        ctaText: 'Finish My Paperwork',
        ctaUrl: esc(welcomeLink(invite.token)),
        note: `This secure link is just for you (<strong>${esc(invite.personal_email)}</strong>). If you've already finished, you can ignore this. Questions? Just reply.`,
      }),
    }),
  });
  return res.ok;
}

exports.handler = async () => {
  let admin;
  try { admin = getSupabaseAdmin(); } catch (e) { return { statusCode: 500, body: e.message }; }
  const now = Date.now();
  const threeDaysAgo = new Date(now - 3 * 86400000).toISOString();
  const twoDaysAgo = new Date(now - 2 * 86400000).toISOString();
  const nowIso = new Date(now).toISOString();

  // Candidates: not done/void, not expired, invited 2+ days ago, < 3 reminders,
  // and either never reminded or last reminded 3+ days ago.
  const { data: invites, error } = await admin
    .from('onboarding_invites')
    .select('id, token, full_name, personal_email, status, expires_at, invited_at, last_reminded_at, reminder_count')
    .in('status', ['invited', 'in_progress'])
    .gt('expires_at', nowIso)
    .lt('invited_at', twoDaysAgo)
    .lt('reminder_count', 3)
    .or(`last_reminded_at.is.null,last_reminded_at.lt.${threeDaysAgo}`);
  if (error) return { statusCode: 500, body: error.message };

  let sent = 0;
  for (const inv of (invites || [])) {
    try {
      const ok = await sendReminder(inv);
      if (ok) {
        sent++;
        await admin.from('onboarding_invites').update({ last_reminded_at: nowIso, reminder_count: (inv.reminder_count || 0) + 1 }).eq('id', inv.id);
        await admin.from('onboarding_events').insert([{ invite_id: inv.id, kind: 'reminder_sent', meta: { n: (inv.reminder_count || 0) + 1 } }]);
      }
    } catch { /* skip one, continue */ }
  }
  return { statusCode: 200, body: `Reminders sent: ${sent} of ${(invites || []).length} candidates` };
};
