// Scheduled Netlify function — emails an alert when the automatic server
// backups (public.backup_runs, see migration 20260922230000_backup_every_table)
// are not healthy. The previous backup job failed silently for three months
// (June 19 – Sept 22, 2026) because nothing told anyone; this is that "tell".
//
// Alerts when any of these is true:
//   • backup_runs can't be read (backup system not installed / broken)
//   • no DAILY backup has finished in the last 26 hours
//   • a backup run FAILED in the last 24 hours
//   • a run has been in progress for more than 3 hours (stuck)
// Silent when everything is fine.
//
// Schedule is defined in netlify.toml under [functions."backup-health-alert"].
//
// Environment variables required:
//   REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REACT_APP_BREVO_API_KEY
// Optional:
//   BACKUP_ALERT_EMAIL (default: SYSTEM_HEALTH_ALERT_EMAIL, then steve@nationalsportsapparel.com)
//   PORTAL_PUBLIC_URL  (overrides Netlify-provided URL)

const ALERT_EMAIL = process.env.BACKUP_ALERT_EMAIL || process.env.SYSTEM_HEALTH_ALERT_EMAIL || 'steve@nationalsportsapparel.com';

const HOUR = 3600000;

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Pure decision: given recent backup_runs rows (newest first) or a read error,
// return the list of problems. Empty list = healthy.
function findProblems(runs, readError, now = Date.now()) {
  if (readError) return [`Backup status could not be read: ${readError}. The automatic backup system may not be installed or is broken.`];
  const problems = [];
  const lastDaily = runs.find(r => r.kind === 'daily' && r.status === 'ok');
  const lastDailyAt = lastDaily && Date.parse(lastDaily.finished_at);
  if (!lastDaily || !(now - lastDailyAt < 26 * HOUR)) {
    problems.push(lastDaily
      ? `No daily backup has finished in over 26 hours. The last one finished ${new Date(lastDailyAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT.`
      : 'No daily backup has ever finished.');
  }
  for (const r of runs) {
    if (r.status === 'failed' && now - Date.parse(r.finished_at || r.created_at) < 24 * HOUR) {
      problems.push(`A ${r.kind} backup started ${new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT failed: ${r.last_error || 'no error recorded'}`);
    }
    if (r.status === 'running' && now - Date.parse(r.created_at) > 3 * HOUR) {
      problems.push(`A ${r.kind} backup has been running for over 3 hours (started ${new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT). Latest error: ${r.last_error || 'none'}`);
    }
  }
  return problems;
}

async function loadRuns(sbUrl, sbKey) {
  const r = await fetch(`${sbUrl}/rest/v1/backup_runs?select=kind,status,created_at,finished_at,last_error,total_rows&order=created_at.desc&limit=30`, {
    headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

exports.handler = async () => {
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoKey = process.env.REACT_APP_BREVO_API_KEY;
  const portalUrl = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');

  if (!sbUrl || !sbKey) {
    console.error('[backup-alert] Supabase env vars missing');
    return { statusCode: 500, body: 'Supabase not configured' };
  }
  if (!brevoKey) {
    console.error('[backup-alert] Brevo env var missing');
    return { statusCode: 500, body: 'Brevo not configured' };
  }

  let runs = [];
  let readError = null;
  try { runs = await loadRuns(sbUrl, sbKey); }
  catch (e) { readError = e.message; }

  const problems = findProblems(runs, readError);
  if (!problems.length) {
    console.log('[backup-alert] OK — backups healthy');
    return { statusCode: 200, body: JSON.stringify({ ok: true, problems: 0 }) };
  }

  const dashLink = portalUrl ? `${portalUrl}/?pg=backup` : '#';
  const htmlContent = `<div style="font-family:sans-serif;max-width:680px">
    <h2 style="color:#dc2626;margin-bottom:4px">🚨 NSA Portal — Backups need attention</h2>
    <p style="color:#64748b;margin-top:0">Checked: ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</p>
    <ul>${problems.map(p => `<li style="margin-bottom:8px">${escapeHtml(p)}</li>`).join('')}</ul>
    <p style="margin-top:12px">
      <a href="${dashLink}" style="display:inline-block;padding:8px 14px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:13px">Open Backup &amp; Data →</a>
    </p>
    <p style="font-size:13px;color:#475569">Until this is fixed, click <strong>Export Full Backup</strong> on that page and save the file to Google Drive.</p>
    <hr style="margin-top:32px;border:none;border-top:1px solid #e2e8f0"/>
    <p style="font-size:11px;color:#94a3b8">Sent by the backup-health-alert Netlify scheduled function.</p>
  </div>`;

  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify({
        sender: { name: 'NSA Portal Health Check', email: 'noreply@nationalsportsapparel.com' },
        to: [{ email: ALERT_EMAIL }],
        subject: `🚨 NSA backups need attention — ${problems.length} problem${problems.length === 1 ? '' : 's'}`,
        htmlContent,
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('[backup-alert] Brevo send failed:', r.status, errText);
      return { statusCode: 502, body: `Brevo error: ${errText}` };
    }
  } catch (e) {
    console.error('[backup-alert] Brevo request failed:', e.message);
    return { statusCode: 502, body: `Brevo error: ${e.message}` };
  }
  console.log(`[backup-alert] Emailed ${ALERT_EMAIL} — ${problems.length} problem(s)`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, problems: problems.length, emailed: ALERT_EMAIL }) };
};

module.exports.findProblems = findProblems;
