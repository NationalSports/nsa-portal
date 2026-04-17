// Scheduled Netlify function — calls public.get_health_report() and emails
// steve@nationalsportsapparel.com if orphan jobs are detected (a regression
// of the save-guard at src/App.js:636-642).
//
// Schedule is defined in netlify.toml under [functions."so-health-alert"].
//
// Environment variables required:
//   REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REACT_APP_BREVO_API_KEY
// Optional:
//   SYSTEM_HEALTH_ALERT_EMAIL  (default: steve@nationalsportsapparel.com)

const ALERT_EMAIL = process.env.SYSTEM_HEALTH_ALERT_EMAIL || 'steve@nationalsportsapparel.com';

exports.handler = async () => {
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoKey = process.env.REACT_APP_BREVO_API_KEY;

  if (!sbUrl || !sbKey) {
    console.error('[health-alert] Supabase env vars missing');
    return { statusCode: 500, body: 'Supabase not configured' };
  }
  if (!brevoKey) {
    console.error('[health-alert] Brevo env var missing');
    return { statusCode: 500, body: 'Brevo not configured' };
  }

  let report;
  try {
    const r = await fetch(`${sbUrl}/rest/v1/rpc/get_health_report`, {
      method: 'POST',
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!r.ok) throw new Error(`RPC ${r.status}: ${await r.text()}`);
    report = await r.json();
  } catch (e) {
    console.error('[health-alert] RPC failed:', e.message);
    return { statusCode: 502, body: `RPC error: ${e.message}` };
  }

  const orphans = report?.orphan_jobs || [];
  const missingDeco = report?.missing_deco_sos || [];

  if (orphans.length === 0) {
    console.log(`[health-alert] OK — 0 orphan jobs, ${missingDeco.length} missing-deco SOs (informational)`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, orphan_count: 0, missing_deco_count: missingDeco.length }) };
  }

  const orphanRows = orphans
    .map(o => `<li><strong>${o.so_id}</strong> — ${o.job_id} (${o.art_name || 'unknown art'})${o.memo ? ` · ${o.memo}` : ''} · <em>${o.so_status}</em></li>`)
    .join('');
  const missingRows = missingDeco.length
    ? '<ul>' + missingDeco.map(m => `<li><strong>${m.so_id}</strong> (${m.status}) — ${m.missing_items}/${m.total_items} items missing decoration${m.memo ? ` · ${m.memo}` : ''}</li>`).join('') + '</ul>'
    : '<p>None ✅</p>';

  const htmlContent = `<div style="font-family:sans-serif;max-width:640px">
    <h2 style="color:#dc2626">🚨 NSA Portal — Orphan Jobs Detected</h2>
    <p style="color:#64748b">Generated: ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</p>
    <p>The save-guard at <code>src/App.js:636-642</code> should prevent this. If this email arrives, a decoration was wiped from an SO while a job still references it — investigate.</p>
    <h3 style="margin-top:24px">Orphan Jobs: ${orphans.length}</h3>
    <ul>${orphanRows}</ul>
    <h3 style="margin-top:24px">Also Flagged — Active SOs Missing Most Decorations: ${missingDeco.length}</h3>
    <p style="font-size:13px;color:#64748b">Informational. SOs in active status with &gt;50% of items missing decorations (excludes items flagged <code>no_deco</code>). A spike here often precedes orphan jobs.</p>
    ${missingRows}
    <hr style="margin-top:32px;border:none;border-top:1px solid #e2e8f0"/>
    <p style="font-size:11px;color:#94a3b8">Sent by so-health-alert Netlify scheduled function. Live dashboard: NSA Portal → Backup &amp; Data → System Health.</p>
  </div>`;

  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': brevoKey,
      },
      body: JSON.stringify({
        sender: { name: 'NSA Portal Health Check', email: 'noreply@nationalsportsapparel.com' },
        to: [{ email: ALERT_EMAIL }],
        subject: `🚨 NSA System Health — ${orphans.length} orphan job${orphans.length === 1 ? '' : 's'} detected`,
        htmlContent,
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('[health-alert] Brevo send failed:', r.status, errText);
      return { statusCode: 502, body: `Brevo error: ${errText}` };
    }
    console.log(`[health-alert] Emailed ${ALERT_EMAIL} — ${orphans.length} orphans, ${missingDeco.length} missing-deco`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, emailed: ALERT_EMAIL, orphan_count: orphans.length, missing_deco_count: missingDeco.length }) };
  } catch (e) {
    console.error('[health-alert] Brevo exception:', e.message);
    return { statusCode: 500, body: e.message };
  }
};
