// Daily supplier-bill anomaly report — the after-the-fact review net now that the
// clean class auto-pushes (owner, 2026-07-21). Two nets, one email:
//
//  1) PUSHED bills from the last ~26h whose parsed data trips an anomaly rule
//     (adidas/UA freight >10% of merchandise, billed price >25% off the order cost,
//     approved overage, document-total mismatch). Flags are recomputed here from
//     applied_bills.raw_meta with the SAME shared rules the client stamps at push
//     time (src/lib/billAnomalies.js) — so rows pushed by older clients report too.
//
//  2) INCOMING Sports Inc documents (si_documents, last ~26h) that already show the
//     adidas/UA freight overcharge before anyone pushes them.
//
// Nothing to report → no email (same never-spam rule as the other digests).
// Triggered daily by bill-anomaly-digest-cron (21:30 UTC ≈ 4:30-5:30 PM ET).
//
// Env: REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REACT_APP_BREVO_API_KEY,
//      BILL_ANOMALY_EMAILS (comma list; default accounting@ + Steve), PORTAL_PUBLIC_URL.

const { billAnomalyFlags, isAdidasUaVendor, FREIGHT_PCT_CAP } = require('../../src/lib/billAnomalies');

const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

exports.handler = async () => {
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoKey = process.env.REACT_APP_BREVO_API_KEY;
  if (!sbUrl || !sbKey) return { statusCode: 500, body: 'Supabase not configured' };
  const hdrs = { apikey: sbKey, Authorization: 'Bearer ' + sbKey };
  const sinceTs = new Date(Date.now() - 26 * 3600 * 1000).toISOString();

  // 1) Pushed bills, last 26h — recompute flags from raw_meta (shared rules).
  const pr = await fetch(sbUrl + '/rest/v1/applied_bills?select=doc_number,vendor,po_number,doc_total,applied_by,applied_at,resolution,raw_meta&applied_at=gt.' + encodeURIComponent(sinceTs), { headers: hdrs });
  if (!pr.ok) return { statusCode: 502, body: 'applied_bills query failed ' + pr.status };
  const pushedRows = await pr.json();
  const pushed = (Array.isArray(pushedRows) ? pushedRows : []).map((r) => ({
    ...r,
    flags: billAnomalyFlags(r.raw_meta || {}),
    auto: !!(r.resolution && r.resolution.auto_pushed),
  })).filter((r) => r.flags.length);

  // 2) Incoming SI docs, last 26h — adidas/UA freight rule only (header data is all we have).
  const ir = await fetch(sbUrl + '/rest/v1/si_documents?select=si_doc_number,supplier_doc_number,po_number,supplier,merchandise_total,freight_amount,doc_total,status&first_seen_at=gt.' + encodeURIComponent(sinceTs), { headers: hdrs });
  const incomingRows = ir.ok ? await ir.json() : [];
  const pushedDocs = new Set(pushed.map((p) => String(p.doc_number || '').trim().toLowerCase()).filter(Boolean));
  const incoming = (Array.isArray(incomingRows) ? incomingRows : []).filter((d) => {
    const merch = num(d.merchandise_total); const fr = num(d.freight_amount);
    if (!isAdidasUaVendor(d.supplier) || merch <= 0 || fr <= FREIGHT_PCT_CAP * merch) return false;
    return !pushedDocs.has(String(d.supplier_doc_number || '').trim().toLowerCase()); // already in section 1
  });

  if (!pushed.length && !incoming.length) return { statusCode: 200, body: 'No anomalies — no email' };
  if (!brevoKey) return { statusCode: 200, body: 'Anomalies found but REACT_APP_BREVO_API_KEY not set' };

  const recipients = (process.env.BILL_ANOMALY_EMAILS || 'accounting@nationalsportsapparel.com,smpeterson327@gmail.com')
    .split(',').map((e) => e.trim()).filter(Boolean);
  const portalUrl = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');
  const link = portalUrl ? portalUrl + '/?pg=imports' : '';

  const pushedHtml = pushed.map((r) => `
    <tr>
      <td style="padding:8px 6px;border-bottom:1px solid #e2e8f0;vertical-align:top">
        <b>${esc(r.vendor || '?')}</b> · ${esc(r.doc_number || '(no doc #)')} · PO ${esc(r.po_number || '?')} · ${money(r.doc_total)}
        ${r.auto ? ' <span style="color:#047857;font-weight:700">⚡ auto-pushed</span>' : ' · pushed by ' + esc(r.applied_by || '?')}
        <div style="color:#92400e;font-size:12px;margin-top:3px">${r.flags.map((f) => '⚠ ' + esc(f.detail)).join('<br>')}</div>
      </td>
    </tr>`).join('');
  const incomingHtml = incoming.map((d) => `
    <tr>
      <td style="padding:8px 6px;border-bottom:1px solid #e2e8f0;vertical-align:top">
        <b>${esc(d.supplier || '?')}</b> · ${esc(d.supplier_doc_number || d.si_doc_number)} · PO ${esc(d.po_number || '?')} · ${money(d.doc_total)}
        <div style="color:#92400e;font-size:12px;margin-top:3px">⚠ Freight ${money(d.freight_amount)} is ${Math.round((num(d.freight_amount) / num(d.merchandise_total)) * 1000) / 10}% of ${money(d.merchandise_total)} merchandise (cap ${FREIGHT_PCT_CAP * 100}%)</div>
      </td>
    </tr>`).join('');

  const n = pushed.length + incoming.length;
  const subject = `Bill anomalies — ${n} to review (${pushed.length} pushed · ${incoming.length} incoming)`;
  const htmlContent = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a">
      <h2 style="margin:0 0 4px">Supplier bill anomaly report</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:16px">Bills from the last day that look out of line — freight over the adidas/UA 10% cap, prices far off the order, approved overages, or totals that don't add up. Pushed bills are already on the orders; review and correct if something's wrong.</div>
      ${pushed.length ? `<h3 style="margin:14px 0 4px;font-size:14px">Pushed — review these (${pushed.length})</h3><table style="width:100%;border-collapse:collapse;font-size:13px">${pushedHtml}</table>` : ''}
      ${incoming.length ? `<h3 style="margin:18px 0 4px;font-size:14px">Incoming from Sports Inc — not pushed yet (${incoming.length})</h3><table style="width:100%;border-collapse:collapse;font-size:13px">${incomingHtml}</table>` : ''}
      ${link ? `<div style="margin-top:20px"><a href="${link}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open bill imports →</a></div>` : ''}
      <div style="color:#94a3b8;font-size:11px;margin-top:20px">Flag rules live in src/lib/billAnomalies.js — the same rules mark ⚠ Review on pushed bill cards in the portal.</div>
    </div>`;

  const mail = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'NSA Portal — Bills', email: 'noreply@nationalsportsapparel.com' },
      to: recipients.map((email) => ({ email })),
      subject,
      htmlContent,
    }),
  });
  if (!mail.ok) {
    const t = await mail.text().catch(() => '');
    console.error('[bill-anomaly-digest] Brevo error', mail.status, t.slice(0, 200));
    return { statusCode: 502, body: 'Email send failed ' + mail.status };
  }
  console.log('[bill-anomaly-digest] emailed', n, 'anomalies to', recipients.join(', '));
  return { statusCode: 200, body: 'Emailed ' + n + ' anomalies' };
};
