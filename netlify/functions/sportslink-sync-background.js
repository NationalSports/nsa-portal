const { resolveSender } = require('./_emailSender');
// Daily mirror of active Sports Inc (SportsLink) documents into the si_documents queue.
//
// Pulls every active document on/after the portal cutover, classifies EDI vs scanned, and
// upserts header fields WITHOUT clobbering human decisions: status / resolved_* / matched_* /
// discrepancy are intentionally omitted from the payload, so an upsert on an existing row
// leaves an approval (or "outside portal" mark) untouched, while new rows arrive as 'new'.
// PO matching, the bill-vs-portal diff and approvals happen in the browser (Sports Inc tab).
//
// Triggered daily by sportslink-sync-cron; can also be POSTed manually.
//
// Env: SPORTSLINK_API_KEY, REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      REACT_APP_BREVO_API_KEY (digest, optional), SPORTSLINK_SINCE_DATE (default 2026-04-01),
//      SPORTSLINK_DIGEST_EMAIL (default accounting@nationalsportsapparel.com),
//      SPORTSLINK_API_BASE_URL (default https://api.sportsinc.com/), PORTAL_PUBLIC_URL.

// Suppliers Sports Inc delivers over EDI (real line items). Mirror of SI_EDI_SUPPLIERS in
// src/sportsLink.js — kept here because Netlify functions are CommonJS. Source: National
// Sports' Athletic Suppliers EDI/OCR list.
const EDI_SUPPLIERS = new Set([
  'AGRON INC', 'ALL STAR SPTG GOODS PRODUCTS', 'ASICS AMERICA CORPORATION',
  'AUGUSTA SPORTSWEAR ASI', 'BADGER SPORTSWEAR', 'BADGER FOR UNDER ARMOUR', 'BOWNET',
  'CHAMPION SPORTS', 'MIKEN', 'MIZUNO USA INC', 'MUELLER SPORTS MEDICINE INC',
  'OUTDOOR CAP CO INC A', 'POWERS MANUFACTURING CO', 'POWERS MANUFACTURING UA',
  'RAWLINGS SPORTING GOODS CO INC', 'RICHARDSON CAP CO', 'SANMAR', 'SCHUTT SPORTS',
  'ADIDAS US TEAM SERVICES', 'TWIN CITY KNITTING CO', 'WILSON SPORTING GOODS CO',
]);
const supKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const round2 = (n) => Math.round(n * 100) / 100;
const dateOnly = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

exports.handler = async () => {
  const apiKey = process.env.SPORTSLINK_API_KEY;
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const since = process.env.SPORTSLINK_SINCE_DATE || '2026-04-01';
  if (!apiKey) return { statusCode: 500, body: 'SPORTSLINK_API_KEY not set' };
  if (!sbUrl || !sbKey) return { statusCode: 500, body: 'Supabase not configured' };
  const base = (process.env.SPORTSLINK_API_BASE_URL || 'https://api.sportsinc.com/').replace(/\/+$/, '') + '/';

  // 1) Pull all active documents since the cutover (paged in 500s; the API rejects
  //    pageSize >= 1000 — "Page Size must be less than 1000").
  let page = 1, docs = [], guard = 0;
  while (guard++ < 60) {
    const qs = new URLSearchParams({
      active: 'true', lines: 'true', siDocStartDate: since,
      page: String(page), pageSize: '500', orderBy: 'SIDocDate', orderByDescending: 'true',
    });
    const r = await fetch(base + 'dealers/documents/?' + qs.toString(), {
      headers: { 'X-API-KEY': apiKey, Accept: 'application/json', 'User-Agent': 'NSA-Portal/1.0' },
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('[sportslink-sync] API error', r.status, t.slice(0, 200));
      return { statusCode: 502, body: 'Sports Inc API ' + r.status };
    }
    const data = await r.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    docs = docs.concat(items);
    if (data?.hasNextPage !== true) break;
    page++;
  }

  // 2) Map to queue rows. Header fields + classification only — NOT the human-decision fields.
  const rows = docs.map((d) => {
    const lines = Array.isArray(d.lines) ? d.lines : [];
    const usable = lines.some((l) => String(l.supplierItemNumber || '').trim() && (num(l.quantityShipped) || 0) > 0);
    const freightNet = (num(d.freightAmount) || 0) - (num(d.freightAllowance) || 0);
    return {
      si_doc_number: d.siDocNumber,
      supplier_doc_number: String(d.supplierDocNumber || '').trim() || null,
      po_number: String(d.poNumber || '').trim() || null,
      supplier: String(d.supplier || '').trim() || null,
      si_doc_date: dateOnly(d.siDocDate),
      supplier_doc_date: dateOnly(d.supplierDocDate),
      ship_date: dateOnly(d.shipDate),
      due_date: dateOnly(d.dueDate),
      tracking_number: String(d.trackingNumber || '').trim() || null,
      merchandise_total: num(d.merchandiseTotal),
      freight_amount: freightNet > 0 ? round2(freightNet) : num(d.freightAmount),
      si_upcharge: round2((num(d.siUpcharge) || 0) + (num(d.svcHandleCharge) || 0)),
      doc_total: num(d.docTotal),
      is_credit: !!d.isCredit,
      supplier_method: EDI_SUPPLIERS.has(supKey(d.supplier)) ? 'EDI' : 'OCR',
      source_type: usable ? 'edi' : 'scanned',
      raw: d,
      si_historical: false,
      updated_at: new Date().toISOString(),
    };
  }).filter((r) => r.si_doc_number != null);

  // 3) Upsert in chunks (merge-duplicates). Omitted columns keep existing values on conflict,
  //    so approvals/marks are preserved; new rows default to status 'new' for browser triage.
  let upserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const r = await fetch(sbUrl + '/rest/v1/si_documents?on_conflict=si_doc_number', {
      method: 'POST',
      headers: {
        apikey: sbKey, Authorization: 'Bearer ' + sbKey, 'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('[sportslink-sync] upsert error', r.status, t.slice(0, 300));
      return { statusCode: 502, body: 'Upsert failed ' + r.status };
    }
    upserted += chunk.length;
  }
  console.log('[sportslink-sync] upserted', upserted, 'documents since', since);

  // 4) Daily digest of NEW arrivals (best-effort; skipped if nothing new, so it never spams).
  try { await sendDigest(sbUrl, sbKey); } catch (e) { console.error('[sportslink-sync] digest', e.message); }

  return { statusCode: 200, body: 'Synced ' + upserted + ' Sports Inc documents since ' + since };
};

async function sendDigest(sbUrl, sbKey) {
  const brevoKey = process.env.REACT_APP_BREVO_API_KEY;
  const to = process.env.SPORTSLINK_DIGEST_EMAIL || 'accounting@nationalsportsapparel.com';
  if (!brevoKey) return;
  // New since the last run = first_seen_at within ~23h (preserved on conflict, set on insert).
  const sinceTs = new Date(Date.now() - 23 * 3600 * 1000).toISOString();
  const r = await fetch(sbUrl + '/rest/v1/si_documents?select=source_type,doc_total,is_credit,supplier,po_number&first_seen_at=gt.' + encodeURIComponent(sinceTs), {
    headers: { apikey: sbKey, Authorization: 'Bearer ' + sbKey },
  });
  if (!r.ok) return;
  const fresh = await r.json();
  if (!Array.isArray(fresh) || !fresh.length) return; // nothing new → no email

  // Old-system POs (no space after "PO") are pre-portal → Outside of Portal, not the approve flow.
  const isOld = (po) => /^D?PO\d/i.test(String(po || '').trim());
  const portalDocs = fresh.filter((x) => !isOld(x.po_number));
  const oldDocs = fresh.filter((x) => isOld(x.po_number));
  const edi = portalDocs.filter((x) => x.source_type === 'edi');
  const scanned = portalDocs.filter((x) => x.source_type !== 'edi');
  const total = fresh.reduce((a, x) => a + (Number(x.doc_total) || 0), 0);
  const credits = fresh.filter((x) => x.is_credit).length;
  const portalUrl = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');
  const link = portalUrl ? portalUrl + '/?pg=imports#sports-inc' : '';

  const subject = `Sports Inc import — ${fresh.length} new bill${fresh.length === 1 ? '' : 's'} (${money(total)})`;
  const htmlContent = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
      <h2 style="margin:0 0 4px">Sports Inc — daily import</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:16px">${fresh.length} new document${fresh.length === 1 ? '' : 's'} landed in the queue.</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0">🟢 <b>${edi.length}</b> EDI — ready to match &amp; approve</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0">🟡 <b>${scanned.length}</b> scanned — grab the PDF from Sports Inc</td></tr>
        ${oldDocs.length ? `<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0">🔵 <b>${oldDocs.length}</b> old-system PO — Outside of Portal (NetSuite/QB)</td></tr>` : ''}
        ${credits ? `<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0">↩️ <b>${credits}</b> credit memo${credits === 1 ? '' : 's'}</td></tr>` : ''}
        <tr><td style="padding:8px 0"><b>${money(total)}</b> total</td></tr>
      </table>
      ${link ? `<div style="margin-top:20px"><a href="${link}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open the Sports Inc queue →</a></div>` : ''}
      <div style="color:#94a3b8;font-size:11px;margin-top:20px">Nothing is applied automatically — these wait for your review and approval.</div>
    </div>`;

  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: resolveSender({ name: 'NSA Portal — Sports Inc' }),
      to: [{ email: to }],
      subject,
      htmlContent,
    }),
  });
}
