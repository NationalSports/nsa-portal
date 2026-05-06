// Scheduled Netlify function — calls public.get_health_report() and emails
// steve@nationalsportsapparel.com if orphan jobs are detected (a regression
// of the save-guard at src/App.js:636-642).
//
// Schedule is defined in netlify.toml under [functions."so-health-alert"].
//
// Each row in the email links back to the portal:
//   • SO-#### links to /?so=SO-####          (deep-links to the SO editor)
//   • The header links to /?pg=backup#system-health  (the dashboard card,
//     where rows can be dismissed as "not a problem" or fixed in place)
//
// The portal origin is taken from process.env.URL (Netlify-provided) and can
// be overridden with PORTAL_PUBLIC_URL.
//
// Environment variables required:
//   REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REACT_APP_BREVO_API_KEY
// Optional:
//   SYSTEM_HEALTH_ALERT_EMAIL  (default: steve@nationalsportsapparel.com)
//   PORTAL_PUBLIC_URL          (overrides Netlify-provided URL)

const ALERT_EMAIL = process.env.SYSTEM_HEALTH_ALERT_EMAIL || 'steve@nationalsportsapparel.com';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function verdictBadge(v) {
  if (v === 'system_loss')
    return '<span style="display:inline-block;padding:1px 7px;border-radius:10px;background:#fee2e2;color:#991b1b;font-size:11px;font-weight:600">CONFIRMED DATA LOSS</span>';
  if (v === 'user_removed')
    return '<span style="display:inline-block;padding:1px 7px;border-radius:10px;background:#fef3c7;color:#92400e;font-size:11px;font-weight:600">PERSON-REMOVED</span>';
  return '<span style="display:inline-block;padding:1px 7px;border-radius:10px;background:#e2e8f0;color:#475569;font-size:11px;font-weight:600">NO AUDIT TRAIL</span>';
}

exports.handler = async () => {
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoKey = process.env.REACT_APP_BREVO_API_KEY;
  const portalUrl = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');

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
  const systemLoss24h = report?.lost_art_jobs_24h_system || 0;
  const userRemoved24h = report?.lost_art_jobs_24h_user || 0;

  // Only the orphans + missing-deco SOs whose audit log shows a system-actor
  // delete are "actionable" persistence regressions. Send the email iff there
  // is at least one of those, OR there were system-actor deletes anywhere in
  // the last 24h. Skip pure no-audit / user-removed noise.
  const orphanSystemLoss = orphans.filter(o => o.verdict === 'system_loss');
  const missingDecoSystemLoss = missingDeco.filter(m => m.verdict === 'system_loss');
  const actionable = orphanSystemLoss.length + missingDecoSystemLoss.length + systemLoss24h;

  if (actionable === 0) {
    console.log(
      `[health-alert] OK — 0 confirmed data-loss events. ` +
      `(orphans=${orphans.length}, missing_deco=${missingDeco.length}, ` +
      `lost_24h system=${systemLoss24h} user=${userRemoved24h})`
    );
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        actionable: 0,
        orphan_count: orphans.length,
        missing_deco_count: missingDeco.length,
      }),
    };
  }

  const soLink = id => portalUrl
    ? `<a href="${portalUrl}/?so=${encodeURIComponent(id)}" style="color:#1d4ed8;font-weight:600;text-decoration:none">${escapeHtml(id)}</a>`
    : `<strong>${escapeHtml(id)}</strong>`;
  const dashLink = portalUrl
    ? `${portalUrl}/?pg=backup#system-health`
    : '#';

  const renderOrphans = list => list
    .map(o => {
      const who = o.deleted_by_name ? ` by ${escapeHtml(o.deleted_by_name)}` : '';
      const when = o.deco_deleted_at ? ` · ${new Date(o.deco_deleted_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}` : '';
      const memo = o.memo ? ` · ${escapeHtml(o.memo)}` : '';
      return `<li style="margin-bottom:6px">${verdictBadge(o.verdict)} ${soLink(o.so_id)} — ${escapeHtml(o.job_id)} (${escapeHtml(o.art_name || 'unknown art')})${memo} · <em>${escapeHtml(o.so_status)}</em>${when}${who}</li>`;
    })
    .join('');

  const renderMissing = list => list
    .map(m => {
      const who = m.deleted_by_name ? ` by ${escapeHtml(m.deleted_by_name)}` : '';
      const when = m.deco_deleted_at ? ` · ${new Date(m.deco_deleted_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}` : '';
      const memo = m.memo ? ` · ${escapeHtml(m.memo)}` : '';
      return `<li style="margin-bottom:6px">${verdictBadge(m.verdict)} ${soLink(m.so_id)} (${escapeHtml(m.status)}) — ${m.missing_items}/${m.total_items} items missing decoration${memo}${when}${who}</li>`;
    })
    .join('');

  const orphanSystemHtml = orphanSystemLoss.length
    ? `<h3 style="margin-top:24px;color:#991b1b">🔴 Confirmed data loss — orphan jobs: ${orphanSystemLoss.length}</h3>
       <p style="font-size:13px;color:#64748b">Decoration was DELETEd from this SO with no authenticated user (system / unknown actor) — exactly the persistence regression the save-guard was meant to prevent. Investigate.</p>
       <ul>${renderOrphans(orphanSystemLoss)}</ul>`
    : '';

  const orphanOtherList = orphans.filter(o => o.verdict !== 'system_loss');
  const orphanOtherHtml = orphanOtherList.length
    ? `<h3 style="margin-top:24px;color:#92400e">🟡 Orphan jobs without confirmed system loss: ${orphanOtherList.length}</h3>
       <p style="font-size:13px;color:#64748b">A person removed the decoration but the linked job was not cleaned up, or no audit-log entry was found. Worth a look but lower priority.</p>
       <ul>${renderOrphans(orphanOtherList)}</ul>`
    : '';

  const missingHtml = missingDecoSystemLoss.length
    ? `<h3 style="margin-top:24px;color:#991b1b">🔴 Active SOs with confirmed deco deletion: ${missingDecoSystemLoss.length}</h3>
       <p style="font-size:13px;color:#64748b">Active-status SO is missing decorations on most items AND audit_log shows a system-actor delete on this SO in the last 30 days.</p>
       <ul>${renderMissing(missingDecoSystemLoss)}</ul>`
    : '';

  const lostSummary = `<div style="margin-top:24px;padding:12px;background:#f8fafc;border-radius:8px;border-left:4px solid ${systemLoss24h > 0 ? '#dc2626' : '#16a34a'}">
    <div style="font-weight:700;font-size:13px;color:#0f172a">Last 24h — Lost Art &amp; Jobs</div>
    <div style="font-size:12px;color:#475569;margin-top:4px">
      <strong style="color:${systemLoss24h > 0 ? '#dc2626' : '#16a34a'}">${systemLoss24h}</strong> system / unknown actor &nbsp;·&nbsp;
      <strong style="color:#92400e">${userRemoved24h}</strong> by a person
    </div>
    <div style="font-size:11px;color:#64748b;margin-top:4px">From <code>audit_log</code> — DELETEs on <code>so_item_decorations</code> (kind=art) and <code>so_jobs</code>.</div>
  </div>`;

  const htmlContent = `<div style="font-family:sans-serif;max-width:680px">
    <h2 style="color:#dc2626;margin-bottom:4px">🚨 NSA Portal — System Health Alert</h2>
    <p style="color:#64748b;margin-top:0">Generated: ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</p>
    <p style="margin-top:12px">
      <a href="${dashLink}" style="display:inline-block;padding:8px 14px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:13px">Open System Health dashboard →</a>
    </p>
    <p style="font-size:13px;color:#475569">From the dashboard you can <strong>fix</strong> the SO (click the SO link in any row) or <strong>mark a row as "not a problem"</strong> — that hides it from this email going forward.</p>
    ${orphanSystemHtml}
    ${missingHtml}
    ${orphanOtherHtml}
    ${lostSummary}
    <hr style="margin-top:32px;border:none;border-top:1px solid #e2e8f0"/>
    <p style="font-size:11px;color:#94a3b8">Sent by so-health-alert Netlify scheduled function. The save-guard at <code>src/App.js:636-642</code> should prevent the "confirmed data loss" rows above. If they appear, a decoration was wiped from an SO while a job still referenced it — investigate.</p>
  </div>`;

  const subjectBits = [];
  if (orphanSystemLoss.length) subjectBits.push(`${orphanSystemLoss.length} confirmed data-loss orphan${orphanSystemLoss.length === 1 ? '' : 's'}`);
  if (missingDecoSystemLoss.length) subjectBits.push(`${missingDecoSystemLoss.length} SO${missingDecoSystemLoss.length === 1 ? '' : 's'} w/ deco deletion`);
  if (!subjectBits.length && systemLoss24h) subjectBits.push(`${systemLoss24h} system delete${systemLoss24h === 1 ? '' : 's'} 24h`);
  const subject = `🚨 NSA System Health — ${subjectBits.join(' · ')}`;

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
        subject,
        htmlContent,
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('[health-alert] Brevo send failed:', r.status, errText);
      return { statusCode: 502, body: `Brevo error: ${errText}` };
    }
    console.log(
      `[health-alert] Emailed ${ALERT_EMAIL} — ` +
      `orphan_system_loss=${orphanSystemLoss.length}, ` +
      `missing_system_loss=${missingDecoSystemLoss.length}, ` +
      `lost_24h system=${systemLoss24h} user=${userRemoved24h}`
    );
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        emailed: ALERT_EMAIL,
        orphan_system_loss: orphanSystemLoss.length,
        missing_system_loss: missingDecoSystemLoss.length,
        lost_24h_system: systemLoss24h,
        lost_24h_user: userRemoved24h,
      }),
    };
  } catch (e) {
    console.error('[health-alert] Brevo exception:', e.message);
    return { statusCode: 500, body: e.message };
  }
};
