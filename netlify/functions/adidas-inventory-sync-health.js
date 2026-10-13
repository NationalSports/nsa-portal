// Scheduled health check for both writers to adidas_inventory.
// Alerts when a source has no error-free run in 24 hours, its full-catalog
// cycle is older than eight days, or the DB guard rejected rows in 24 hours.
//
// Env: REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      BREVO_API_KEY (or REACT_APP_BREVO_API_KEY)
// Optional: ADIDAS_SYNC_ALERT_EMAILS (comma-separated; defaults to Steve)

const SOURCES = ['api-materials', 'ss_activewear'];
const DAY_MS = 24 * 60 * 60 * 1000;
const COVERAGE_LIMIT_MS = 8 * DAY_MS;
const timeoutSignal = (ms) => (
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined
);

const escapeHtml = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const age = (date, nowMs) => {
  if (!date) return 'never';
  const hours = Math.floor((nowMs - Date.parse(date)) / (60 * 60 * 1000));
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
};

exports.handler = async () => {
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!sbUrl || !sbKey) {
    console.error('[adidas-sync-health] Supabase configuration missing');
    return { statusCode: 500, body: 'Supabase not configured' };
  }
  if (!brevoKey) {
    console.error('[adidas-sync-health] Brevo configuration missing');
    return { statusCode: 500, body: 'Brevo not configured' };
  }

  const nowMs = Date.now();
  const dayAgo = new Date(nowMs - DAY_MS).toISOString();
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  const get = async (path) => {
    const signal = timeoutSignal(20_000);
    const response = await fetch(`${sbUrl}/rest/v1/${path}`, {
      headers,
      ...(signal ? { signal } : {}),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${path.split('?')[0]} -> ${response.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : [];
  };

  let states;
  let runs;
  let drops;
  try {
    [states, runs, drops] = await Promise.all([
      get('adidas_inventory_sync_state?select=source,cycle_started_at,last_progress_at,last_cycle_completed_at,locked_until'),
      get('adidas_inventory_sync_runs?select=source,status,styles_total,styles_processed,inventory_rows,error_count,cycle_completed,started_at,finished_at&order=started_at.desc&limit=100'),
      get(`adidas_inventory_guard_drops?select=source,reason,drop_count,last_seen_at,sample_sku,sample_size&last_seen_at=gte.${encodeURIComponent(dayAgo)}&order=last_seen_at.desc`),
    ]);
  } catch (error) {
    console.error('[adidas-sync-health] query failed', error);
    return { statusCode: 502, body: error.message };
  }

  const stateBySource = Object.fromEntries((states || []).map((state) => [state.source, state]));
  const findings = [];
  const summaries = [];
  for (const source of SOURCES) {
    const sourceRuns = (runs || []).filter((run) => run.source === source);
    const latest = sourceRuns[0] || null;
    const latestSuccess = sourceRuns.find((run) =>
      ['success', 'completed'].includes(run.status)
      && Number(run.error_count || 0) === 0
      && run.finished_at
    ) || null;
    const state = stateBySource[source] || {};
    const lastSuccessAt = latestSuccess?.finished_at || null;
    const coverageAt = state.last_cycle_completed_at || null;
    const lockIsActive = state.locked_until && Date.parse(state.locked_until) > nowMs;
    const progressIsRecent = state.last_progress_at
      && nowMs - Date.parse(state.last_progress_at) <= 20 * 60 * 1000;
    const abandonedRun = sourceRuns.find((run) =>
      run.status === 'running'
      && run.started_at
      && nowMs - Date.parse(run.started_at) > 20 * 60 * 1000
      && !lockIsActive
      && !progressIsRecent
    );
    const cycleTooOld = coverageAt
      ? nowMs - Date.parse(coverageAt) > COVERAGE_LIMIT_MS
      : state.cycle_started_at && nowMs - Date.parse(state.cycle_started_at) > COVERAGE_LIMIT_MS;

    if (!lastSuccessAt || nowMs - Date.parse(lastSuccessAt) > DAY_MS) {
      findings.push({
        source,
        issue: `No successful run in 24h (last success: ${age(lastSuccessAt, nowMs)})`,
      });
    }
    if (cycleTooOld) {
      findings.push({
        source,
        issue: `Full-catalog coverage is behind (last completed cycle: ${age(coverageAt, nowMs)})`,
      });
    }
    if (abandonedRun) {
      findings.push({
        source,
        issue: `Run has remained in progress past its 20-minute lock TTL (started ${age(abandonedRun.started_at, nowMs)})`,
      });
    }

    const sourceDrops = (drops || []).filter((drop) => drop.source === source);
    const rejectedRows = sourceDrops.reduce((sum, drop) => sum + Number(drop.drop_count || 0), 0);
    if (rejectedRows) {
      findings.push({
        source,
        issue: `${rejectedRows.toLocaleString()} inventory row(s) rejected by the size guard in 24h`,
      });
    }
    summaries.push({
      source,
      latest_status: latest?.status || null,
      last_success_at: lastSuccessAt,
      last_cycle_completed_at: coverageAt,
      rejected_rows_24h: rejectedRows,
    });
  }

  if (!findings.length) {
    console.log('[adidas-sync-health] OK', JSON.stringify(summaries));
    return { statusCode: 200, body: JSON.stringify({ ok: true, sources: summaries }) };
  }

  const recipients = (process.env.ADIDAS_SYNC_ALERT_EMAILS || 'steve@nationalsportsapparel.com')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
  const rows = findings.map((finding) =>
    `<tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><code>${escapeHtml(finding.source)}</code></td>`
    + `<td style="padding:8px;border-bottom:1px solid #e2e8f0">${escapeHtml(finding.issue)}</td></tr>`
  ).join('');
  const detail = summaries.map((summary) =>
    `<li><code>${escapeHtml(summary.source)}</code>: latest run ${escapeHtml(summary.latest_status || 'none')}; `
    + `last success ${escapeHtml(age(summary.last_success_at, nowMs))}; full cycle `
    + `${escapeHtml(age(summary.last_cycle_completed_at, nowMs))}</li>`
  ).join('');
  const htmlContent = `<div style="font-family:Arial,sans-serif;max-width:680px;color:#0f172a">
    <h2 style="color:#b91c1c">Adidas inventory sync needs attention</h2>
    <table style="border-collapse:collapse;width:100%"><thead><tr>
      <th style="text-align:left;padding:8px;border-bottom:2px solid #cbd5e1">Source</th>
      <th style="text-align:left;padding:8px;border-bottom:2px solid #cbd5e1">Problem</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <h3 style="font-size:14px;margin-top:20px">Current state</h3><ul>${detail}</ul>
    <p style="font-size:12px;color:#64748b">For <code>api-materials</code>, re-open the logged-in Adidas CLICK tab,
    select account 0000270384, and resume the checkpointed skill if authentication is required.
    Run details are in <code>adidas_inventory_sync_runs</code>; rejected size rows are in
    <code>adidas_inventory_guard_drops</code>.</p>
  </div>`;

  const emailSignal = timeoutSignal(20_000);
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': brevoKey,
    },
    body: JSON.stringify({
      sender: { name: 'NSA Portal — Inventory Health', email: 'noreply@nationalsportsapparel.com' },
      to: recipients.map((email) => ({ email })),
      subject: `Adidas inventory sync alert — ${findings.length} issue${findings.length === 1 ? '' : 's'}`,
      htmlContent,
    }),
    ...(emailSignal ? { signal: emailSignal } : {}),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error('[adidas-sync-health] Brevo failed', response.status, text.slice(0, 300));
    return { statusCode: 502, body: `Brevo failed (${response.status})` };
  }

  console.error('[adidas-sync-health] ALERT SENT', JSON.stringify({ recipients, findings }));
  return { statusCode: 200, body: JSON.stringify({ ok: false, alerted: true, findings }) };
};

exports._test = { age };
