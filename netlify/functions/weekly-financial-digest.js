// Weekly financial digest — Monday morning summary of the business, emailed to
// the owner. Mirrors the admin Financials page's Overview tab.
//
// Two data sources, deliberately split:
//   • Billed / AR / order intake are computed HERE, live from Supabase. They need
//     no pricing logic, so the digest is never stale and never wrong.
//   • Margin, order-book value and WIP come from the newest finance_snapshots row
//     (written by the Financials page). Those need the client's pricing engine,
//     which does not run in a Netlify function — duplicating it here would create
//     exactly the hand-synced second copy CLAUDE.md warns about. If the newest
//     snapshot is stale (>14 days) the section is labeled as such rather than
//     presented as current.
//
// Scheduled Mondays 14:00 UTC (~6-7 AM PT) via netlify.toml.
// Env: REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REACT_APP_BREVO_API_KEY,
//      FINANCE_DIGEST_EMAILS (comma list; default Steve), PORTAL_PUBLIC_URL.

const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const money = (n) => '$' + Math.round(num(n)).toLocaleString('en-US');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (f) => (f * 100).toFixed(1) + '%';

// Parse "M/D/YYYY[ time]", "M/D/YY" or "YYYY-MM-DD" to a UTC-safe YYYY-MM-DD string.
function isoDate(v) {
  if (!v) return null;
  const s = String(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  m = s.split(' ')[0].match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += 2000;
  return `${y}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
}
const daysBetween = (a, b) => Math.floor((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000);

exports.handler = async () => {
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoKey = process.env.REACT_APP_BREVO_API_KEY;
  if (!sbUrl || !sbKey) return { statusCode: 500, body: 'Supabase not configured' };
  const hdrs = { apikey: sbKey, Authorization: 'Bearer ' + sbKey };
  const get = async (path) => {
    const r = await fetch(sbUrl + '/rest/v1/' + path, { headers: hdrs });
    if (!r.ok) throw new Error(path.split('?')[0] + ' ' + r.status);
    return r.json();
  };

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const y = now.getUTCFullYear(), mo = now.getUTCMonth() + 1;
  const thisMonth = `${y}-${String(mo).padStart(2, '0')}`;
  const lastYearMonth = `${y - 1}-${String(mo).padStart(2, '0')}`;
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);

  let portalInvs, histInvs, orders, snapRows;
  try {
    [portalInvs, histInvs, orders, snapRows] = await Promise.all([
      get('invoices?select=id,date,total,tax,paid,status,deleted_at&limit=20000'),
      get('customer_invoices?select=id,invoice_date,total,tax,status&limit=20000'),
      get('sales_orders?select=id,created_at,deleted_at,status&limit=20000'),
      get('finance_snapshots?select=*&order=as_of_date.desc&limit=8'),
    ]);
  } catch (e) {
    console.error('[weekly-financial-digest] query failed', e.message);
    return { statusCode: 502, body: 'Query failed: ' + e.message };
  }

  // ── Billed, both streams, deduped by document id (same rule as the portal) ──
  const histIds = new Set((histInvs || []).map((h) => String(h.id)));
  const billed = [];
  for (const h of histInvs || []) {
    if (h.status === 'void') continue;
    const d = isoDate(h.invoice_date); if (!d) continue;
    billed.push({ d, net: num(h.total) - num(h.tax) });
  }
  for (const p of portalInvs || []) {
    if (p.status === 'void' || p.deleted_at || histIds.has(String(p.id))) continue;
    const d = isoDate(p.date); if (!d) continue;
    billed.push({ d, net: num(p.total) - num(p.tax) });
  }
  const sumWhere = (fn) => billed.reduce((a, b) => a + (fn(b.d) ? b.net : 0), 0);
  const week = sumWhere((d) => d > weekAgo && d <= todayIso);
  const mtd = sumWhere((d) => d.slice(0, 7) === thisMonth && d <= todayIso);
  const mtdLy = sumWhere((d) => d.slice(0, 7) === lastYearMonth && +d.slice(8, 10) <= now.getUTCDate());
  const ytd = sumWhere((d) => d.slice(0, 4) === String(y) && d <= todayIso);
  const ytdLy = sumWhere((d) => d.slice(0, 4) === String(y - 1) && (d.slice(5) <= todayIso.slice(5)));

  // ── AR aging, live from portal invoices ──
  const aging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  let arTotal = 0, arCount = 0;
  for (const p of portalInvs || []) {
    if (p.status === 'void' || p.deleted_at) continue;
    const open = num(p.total) - num(p.paid);
    if (open <= 0.005) continue;
    const d = isoDate(p.date); if (!d) continue;
    const age = daysBetween(todayIso, d);
    arTotal += open; arCount++;
    if (age <= 0) aging.current += open;
    else if (age <= 30) aging.d1_30 += open;
    else if (age <= 60) aging.d31_60 += open;
    else if (age <= 90) aging.d61_90 += open;
    else aging.d90plus += open;
  }
  const ar60 = aging.d61_90 + aging.d90plus;

  // ── Order intake, last 7 days ──
  const newOrders = (orders || []).filter((o) => {
    if (o.deleted_at || o.status === 'cancelled' || o.status === 'deleted') return false;
    const d = isoDate(o.created_at);
    return d && d > weekAgo && d <= todayIso;
  }).length;

  // ── Margin / order book — from the newest snapshot, only if fresh ──
  const snap = (snapRows || [])[0];
  const snapAge = snap?.as_of_date ? daysBetween(todayIso, String(snap.as_of_date).slice(0, 10)) : null;
  const snapFresh = snapAge != null && snapAge <= 14;
  const k = snap?.kpis || {};

  const delta = (a, b) => (b > 0 ? ((a / b - 1) * 100) : null);
  const arrow = (d) => (d == null ? '' : `<span style="color:${d >= 0 ? '#059669' : '#dc2626'};font-weight:700">${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}%</span>`);
  const mtdD = delta(mtd, mtdLy), ytdD = delta(ytd, ytdLy);

  // ── Insight lines — each tied to a number, same spirit as the portal feed ──
  const insights = [];
  if (ytdD != null) insights.push(`Billed <b>${ytdD >= 0 ? '+' : ''}${ytdD.toFixed(0)}%</b> versus the same point last year (${money(ytd)} vs ${money(ytdLy)}, net of tax).`);
  if (arTotal > 0 && ar60 / arTotal > 0.10) insights.push(`<b>${money(ar60)}</b> of receivables (${Math.round(ar60 / arTotal * 100)}%) is over 60 days old &mdash; worth a collections pass.`);
  if (aging.d90plus > 10000) insights.push(`<b>${money(aging.d90plus)}</b> is past 90 days and is excluded from cash planning until collected.`);
  if (snapFresh && k.backlogValue) insights.push(`Open order book <b>${money(k.backlogValue)}</b> across ${k.backlogOrders || 0} orders, carrying about ${money(k.backlogGp)} of gross profit not yet earned.`);
  if (snapFresh && k.wip > 0) insights.push(`<b>${money(k.wip)}</b> of cost sits in work not yet invoiced &mdash; it belongs in inventory, not in this month&rsquo;s cost of sales.`);
  if (!snapFresh) insights.push(`Margin and order-book figures are ${snapAge == null ? 'unavailable' : snapAge + ' days old'} &mdash; open the Financials page to refresh them.`);

  const portalUrl = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');
  const link = portalUrl ? portalUrl + '/?pg=financials' : '';
  const tile = (label, value, sub) => `
    <td style="padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;vertical-align:top">
      <div style="font-size:10.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#475569">${label}</div>
      <div style="font-family:Arial,sans-serif;font-size:23px;font-weight:700;color:#192853;line-height:1.2">${value}</div>
      ${sub ? `<div style="font-size:11px;color:#475569;margin-top:2px">${sub}</div>` : ''}
    </td>`;

  const subject = `Weekly financials — ${money(week)} billed last week · ${money(mtd)} MTD`;
  const htmlContent = `
    <div style="font-family:Arial,sans-serif;max-width:660px;margin:0 auto;color:#0f172a">
      <h2 style="margin:0 0 4px">Weekly financial digest</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:16px">
        Week ending ${esc(todayIso)} · billed figures are both invoice streams, net of sales tax.
      </div>
      <table style="border-collapse:separate;border-spacing:6px;width:100%">
        <tr>
          ${tile('Billed last 7 days', money(week), newOrders + ' new orders written')}
          ${tile('Month to date', money(mtd), mtdD == null ? '' : arrow(mtdD) + ' vs last year')}
        </tr>
        <tr>
          ${tile('Year to date', money(ytd), ytdD == null ? '' : arrow(ytdD) + ' vs ' + money(ytdLy))}
          ${tile('Open receivables', money(arTotal), arCount + ' invoices · ' + money(ar60) + ' over 60d')}
        </tr>
        ${snapFresh ? `<tr>
          ${tile('Open order book', money(k.backlogValue), (k.backlogOrders || 0) + ' orders · ' + money(k.backlogGp) + ' GP inside')}
          ${tile('YTD gross margin', k.ytdRev > 0 ? pct(k.ytdGp / k.ytdRev) : '—', money(k.ytdGp) + ' on ' + money(k.ytdRev))}
        </tr>` : ''}
      </table>
      <h3 style="margin:20px 0 6px;font-size:14px">What stands out</h3>
      <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6">
        ${insights.map((i) => `<li>${i}</li>`).join('')}
      </ul>
      ${link ? `<div style="margin-top:20px"><a href="${link}" style="background:#192853;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open Financials →</a></div>` : ''}
      <div style="color:#94a3b8;font-size:11px;margin-top:20px">
        Billed and receivables are computed live. Margin, order book and WIP come from the Financials page's
        last snapshot${snap?.as_of_date ? ' (' + esc(String(snap.as_of_date).slice(0, 10)) + ')' : ''}.
      </div>
    </div>`;

  if (!brevoKey) {
    console.log('[weekly-financial-digest] computed but REACT_APP_BREVO_API_KEY not set');
    return { statusCode: 200, body: 'Computed; email key not configured' };
  }
  const recipients = (process.env.FINANCE_DIGEST_EMAILS || 'steve@nationalsportsapparel.com')
    .split(',').map((e) => e.trim()).filter(Boolean);
  const mail = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'NSA Portal — Financials', email: 'noreply@nationalsportsapparel.com' },
      to: recipients.map((email) => ({ email })),
      subject, htmlContent,
    }),
  });
  if (!mail.ok) {
    const t = await mail.text().catch(() => '');
    console.error('[weekly-financial-digest] Brevo error', mail.status, t.slice(0, 200));
    return { statusCode: 502, body: 'Email send failed ' + mail.status };
  }
  console.log('[weekly-financial-digest] emailed to', recipients.join(', '));
  return { statusCode: 200, body: 'Emailed weekly digest' };
};
