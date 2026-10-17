// One place for "a scheduled job failed" emails (2026-10-17 accounting audit, item 4).
//
// The three supplier-bill crons (Sports Inc mirror, S&S mirror, bill-anomaly digest) used to
// fail with an HTTP 502 and a console line only. Nobody reads Netlify's function console, and
// the digests send no email when there is nothing new, so a dead feed looked exactly like a
// quiet day. This helper sends one plain email per failure to accounting + Steve. It never
// throws: an alert that cannot be sent is logged, and the caller's own failure return stands.
//
// Env: REACT_APP_BREVO_API_KEY (or BREVO_API_KEY); CRON_ALERT_EMAILS (comma list; falls back
// to BILL_ANOMALY_EMAILS, then accounting@ + steve@).

const DEFAULT_RECIPIENTS = 'accounting@nationalsportsapparel.com,steve@nationalsportsapparel.com';

const recipients = () => String(process.env.CRON_ALERT_EMAILS || process.env.BILL_ANOMALY_EMAILS || DEFAULT_RECIPIENTS)
  .split(',').map((e) => e.trim()).filter(Boolean);

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// job: short human name ("Sports Inc bill feed"); detail: what failed, one or two sentences;
// consequence: what is NOT happening while it stays broken (so the reader knows the stakes).
async function alertCronFailure(job, detail, consequence) {
  const brevoKey = process.env.REACT_APP_BREVO_API_KEY || process.env.BREVO_API_KEY;
  const line = '[cron-alert] ' + job + ' failed: ' + detail;
  if (!brevoKey) { console.error(line + ' (no Brevo key — alert email not sent)'); return false; }
  const when = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const subject = 'Portal job failed: ' + job;
  const htmlContent = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
      <h2 style="margin:0 0 4px;color:#b91c1c">${esc(job)} did not finish</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:16px">${esc(when)}</div>
      <p style="font-size:14px"><b>What failed:</b> ${esc(detail)}</p>
      ${consequence ? `<p style="font-size:14px"><b>While this is broken:</b> ${esc(consequence)}</p>` : ''}
      <p style="font-size:13px;color:#64748b">The job runs again on its normal schedule. If this email repeats, the feed needs attention (an expired API key is the usual cause).</p>
    </div>`;
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify({
        sender: { name: 'NSA Portal — job monitor', email: 'noreply@nationalsportsapparel.com' },
        to: recipients().map((email) => ({ email })),
        subject,
        htmlContent,
      }),
    });
    if (!r.ok) { console.error(line + ' (Brevo ' + r.status + ')'); return false; }
    console.error(line + ' (alert emailed)');
    return true;
  } catch (e) {
    console.error(line + ' (alert send threw: ' + (e && e.message) + ')');
    return false;
  }
}

// Wrap a scheduled handler so an exception or a non-2xx return emails once and still returns
// the original status to Netlify. `consequence` is the same for every failure of that job.
function withCronAlert(job, consequence, handler) {
  return async (...args) => {
    let res;
    try {
      res = await handler(...args);
    } catch (e) {
      await alertCronFailure(job, (e && e.message) || String(e), consequence);
      return { statusCode: 500, body: job + ' failed: ' + ((e && e.message) || String(e)) };
    }
    const code = res && Number(res.statusCode);
    if (code && (code < 200 || code >= 300)) await alertCronFailure(job, String(res.body || ('HTTP ' + code)), consequence);
    return res;
  };
}

module.exports = { alertCronFailure, withCronAlert, recipients };
