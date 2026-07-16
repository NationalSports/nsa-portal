// Scheduled Netlify function — on the 1st of each month, emails
// steve@nationalsportsapparel.com a reminder to review the PREVIOUS month's
// commissions, with a button that deep-links straight to that month's
// Commissions → Admin Dashboard tab (?pg=commissions&comm=adminDash&month=YYYY-MM,
// applied by the deep-link effect in src/App.js).
//
// Deliberately a review reminder, not a computed report: the full commission
// math (payouts, draws, loans, 90-day splits) lives in the browser dashboard,
// so this stays a thin link and never risks drifting out of sync. Steve clicks
// in, reviews live numbers, and can Send Report to accounting from there.
//
// Schedule is defined in netlify.toml under [functions."commission-report-reminder"].
//
// Manual test (sends to an override address instead of Steve, so the real
// recipient isn't pinged while verifying):
//   GET /.netlify/functions/commission-report-reminder?test=you@example.com
//
// Environment variables required:
//   REACT_APP_BREVO_API_KEY
// Optional:
//   COMMISSION_REPORT_EMAIL  (default: steve@nationalsportsapparel.com)
//   PORTAL_PUBLIC_URL        (overrides Netlify-provided URL)

const REPORT_EMAIL = process.env.COMMISSION_REPORT_EMAIL || 'steve@nationalsportsapparel.com';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Previous calendar month relative to "now" in Pacific time (the function fires
// early on the 1st, so anchor to PT to avoid a UTC rollover picking the wrong month).
function previousMonthPT(now) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric' }).formatToParts(now);
  let y = Number(parts.find(p => p.type === 'year').value);
  let m = Number(parts.find(p => p.type === 'month').value); // 1-12
  m -= 1;
  if (m === 0) { m = 12; y -= 1; }
  return { key: `${y}-${String(m).padStart(2, '0')}`, label: `${MONTHS[m - 1]} ${y}` };
}

exports.handler = async (event) => {
  const brevoKey = process.env.REACT_APP_BREVO_API_KEY;
  const portalUrl = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');

  if (!brevoKey) {
    console.error('[comm-report-reminder] Brevo env var missing');
    return { statusCode: 500, body: 'Brevo not configured' };
  }

  // Optional test override: only honor a syntactically valid email so a stray
  // ?test= can't misdirect the send.
  const testTo = event?.queryStringParameters?.test;
  const recipient = testTo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(testTo) ? testTo : REPORT_EMAIL;

  const { key: monthKey, label: monthLabel } = previousMonthPT(new Date());
  const link = portalUrl
    ? `${portalUrl}/?pg=commissions&comm=adminDash&month=${encodeURIComponent(monthKey)}`
    : '#';

  const htmlContent = `<div style="font-family:sans-serif;max-width:640px;color:#0f172a">
    <h2 style="margin-bottom:4px">👑 Commissions ready to review — ${monthLabel}</h2>
    <p style="color:#64748b;margin-top:0;font-size:13px">A new month has started. Here's the shortcut to review last month's commissions before they're paid.</p>
    <p style="margin:20px 0">
      <a href="${link}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">Open ${monthLabel} Admin Dashboard →</a>
    </p>
    <p style="font-size:13px;color:#475569">The dashboard opens straight to <strong>${monthLabel}</strong>: per-rep GP, verification flags, the job-cost editor, and payouts. When it looks right, use <strong>✉ Send Report</strong> there to send the summary + CSV to accounting.</p>
    <hr style="margin-top:28px;border:none;border-top:1px solid #e2e8f0"/>
    <p style="font-size:11px;color:#94a3b8">Sent monthly by the commission-report-reminder Netlify scheduled function. To change the recipient or timing, edit <code>COMMISSION_REPORT_EMAIL</code> / the schedule in <code>netlify.toml</code>.</p>
  </div>`;

  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify({
        sender: { name: 'NSA Portal Commissions', email: 'noreply@nationalsportsapparel.com' },
        to: [{ email: recipient }],
        subject: `👑 Review ${monthLabel} commissions`,
        htmlContent,
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('[comm-report-reminder] Brevo send failed:', r.status, errText);
      return { statusCode: 502, body: `Brevo error: ${errText}` };
    }
    console.log(`[comm-report-reminder] Emailed ${recipient} — review reminder for ${monthKey}`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, emailed: recipient, month: monthKey }) };
  } catch (e) {
    console.error('[comm-report-reminder] Brevo exception:', e.message);
    return { statusCode: 500, body: e.message };
  }
};
