// Daily mirror of S&S Activewear orders into the ss_documents queue.
//
// S&S comes through Sports Inc only as a scanned/header-only doc (no usable lines), so
// instead of waiting on that OCR we pull the bill straight from S&S's own /Orders feed:
//   GET https://api.ssactivewear.com/V2/orders/?All=True&lines=true   (last 3 months)
// `yourSku` echoes OUR OWN SKU back on every line, so the bill matches our Sales Orders
// exactly. This mirrors the browser adapter in src/ssOrders.js (kept in sync by hand
// because Netlify functions are CommonJS and can't import the ESM src module).
//
// Header fields + the raw order are upserted (dedup key = order_number). status /
// resolved_* / applied_* / notes are intentionally OMITTED from the payload, so an upsert
// on an existing row leaves a human decision untouched while new rows arrive as 'new'.
// PO matching, review and the push to Billed tracking happen in the browser (Import &
// Review → Pull from S&S). Nothing is applied automatically.
//
// Triggered daily by ss-orders-sync-cron; can also be POSTed manually.
//
// Env: SS_ACCOUNT_NUMBER, SS_API_KEY, REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      REACT_APP_BREVO_API_KEY (digest, optional),
//      SS_DIGEST_EMAIL (default accounting@nationalsportsapparel.com),
//      SS_ORDERS_BASE_URL (default https://api.ssactivewear.com/V2), PORTAL_PUBLIC_URL.

const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const round2 = (n) => Math.round(n * 100) / 100;
const intOrNull = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
const dateOnly = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// S&S returns camelCase or PascalCase for the same field depending on endpoint — read defensively.
const pick = (o, ...keys) => { if (!o) return undefined; for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; return undefined; };

// One S&S order → an ss_documents row. Mirrors mapSsOrderToBill (src/ssOrders.js): bill the
// SHIPPED qty only, sum shipped line extensions for the merchandise total, order_number is
// the stable dedup key (invoice_number appears only after invoicing).
const mapOrderToRow = (o) => {
  const rawLines = pick(o, 'lines', 'Lines', 'OrderLines') || [];
  const lines = Array.isArray(rawLines) ? rawLines : [];
  let merchandise = 0, usable = false;
  for (const ln of lines) {
    const qty = num(pick(ln, 'qtyShipped', 'QtyShipped')) || 0;
    if (qty <= 0) continue; // unshipped/backordered lines aren't billed
    const price = num(pick(ln, 'price', 'Price', 'customerPrice', 'CustomerPrice')) || 0;
    const sku = String(pick(ln, 'yourSku', 'YourSku') || pick(ln, 'sku', 'Sku') || '').trim();
    merchandise += qty * price;
    if (sku) usable = true;
  }
  const docTotal = num(pick(o, 'total', 'Total'));
  const freight = num(pick(o, 'shipping', 'Shipping', 'freight', 'Freight'));
  return {
    order_number: String(pick(o, 'orderNumber', 'OrderNumber') || '').trim(),
    invoice_number: String(pick(o, 'invoiceNumber', 'InvoiceNumber') || '').trim() || null,
    po_number: String(pick(o, 'poNumber', 'PoNumber', 'PONumber') || '').trim() || null,
    supplier: 'S&S Activewear',
    order_date: dateOnly(pick(o, 'orderDate', 'OrderDate')),
    ship_date: dateOnly(pick(o, 'shipDate', 'ShipDate')),
    invoice_date: dateOnly(pick(o, 'invoiceDate', 'InvoiceDate')),
    merchandise_total: round2(merchandise),
    freight: freight != null && freight > 0 ? round2(freight) : freight,
    doc_total: docTotal,
    total_pieces: intOrNull(pick(o, 'totalPieces', 'TotalPieces')),
    is_credit: (docTotal || 0) < 0,
    has_usable_lines: usable,
    raw: o,
    updated_at: new Date().toISOString(),
  };
};

exports.handler = async () => {
  const account = process.env.SS_ACCOUNT_NUMBER;
  const apiKey = process.env.SS_API_KEY;
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!account || !apiKey) return { statusCode: 500, body: 'SS_ACCOUNT_NUMBER / SS_API_KEY not set' };
  if (!sbUrl || !sbKey) return { statusCode: 500, body: 'Supabase not configured' };
  const base = (process.env.SS_ORDERS_BASE_URL || 'https://api.ssactivewear.com/V2').replace(/\/+$/, '');
  const auth = Buffer.from(`${account}:${apiKey}`).toString('base64');

  // 1) Pull all orders from the last 3 months (?All=True), with line detail.
  let orders;
  try {
    const r = await fetch(base + '/orders/?All=True&lines=true&mediatype=json', {
      headers: {
        Authorization: 'Basic ' + auth,
        Accept: 'application/json',
        // S&S's firewall 403s the Node runtime's default User-Agent — a real UA is required.
        'User-Agent': 'NSA-Portal/1.0 (nationalsportsapparel.com)',
      },
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('[ss-orders-sync] API error', r.status, t.slice(0, 200));
      return { statusCode: 502, body: 'S&S API ' + r.status };
    }
    const data = await r.json();
    orders = Array.isArray(data) ? data : (data ? [data] : []);
  } catch (e) {
    console.error('[ss-orders-sync] fetch failed', e.message);
    return { statusCode: 502, body: 'S&S fetch failed: ' + e.message };
  }

  // 2) Map to queue rows (header + raw only — never the human-decision fields).
  const rows = orders.map(mapOrderToRow).filter((row) => row.order_number);
  if (!rows.length) {
    console.log('[ss-orders-sync] no orders returned');
    return { statusCode: 200, body: 'No S&S orders in the last 3 months' };
  }

  // 3) Upsert in chunks (merge-duplicates). Omitted columns keep existing values on conflict,
  //    so a review/apply mark is preserved; new rows default to status 'new'.
  let upserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const r = await fetch(sbUrl + '/rest/v1/ss_documents?on_conflict=order_number', {
      method: 'POST',
      headers: {
        apikey: sbKey, Authorization: 'Bearer ' + sbKey, 'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('[ss-orders-sync] upsert error', r.status, t.slice(0, 300));
      return { statusCode: 502, body: 'Upsert failed ' + r.status };
    }
    upserted += chunk.length;
  }
  console.log('[ss-orders-sync] upserted', upserted, 'S&S orders');

  // 4) Daily digest of NEW arrivals (best-effort; skipped if nothing new, so it never spams).
  try { await sendDigest(sbUrl, sbKey); } catch (e) { console.error('[ss-orders-sync] digest', e.message); }

  return { statusCode: 200, body: 'Synced ' + upserted + ' S&S orders' };
};

async function sendDigest(sbUrl, sbKey) {
  const brevoKey = process.env.REACT_APP_BREVO_API_KEY;
  const to = process.env.SS_DIGEST_EMAIL || 'accounting@nationalsportsapparel.com';
  if (!brevoKey) return;
  // New since the last run = first_seen_at within ~23h (set on insert, preserved on conflict).
  const sinceTs = new Date(Date.now() - 23 * 3600 * 1000).toISOString();
  const r = await fetch(sbUrl + '/rest/v1/ss_documents?select=has_usable_lines,doc_total,is_credit,po_number&first_seen_at=gt.' + encodeURIComponent(sinceTs), {
    headers: { apikey: sbKey, Authorization: 'Bearer ' + sbKey },
  });
  if (!r.ok) return;
  const fresh = await r.json();
  if (!Array.isArray(fresh) || !fresh.length) return; // nothing new → no email

  const ready = fresh.filter((x) => x.has_usable_lines).length;
  const pending = fresh.length - ready;
  const total = fresh.reduce((a, x) => a + (Number(x.doc_total) || 0), 0);
  const credits = fresh.filter((x) => x.is_credit).length;
  const portalUrl = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');
  const link = portalUrl ? portalUrl + '/?pg=import' : '';

  const subject = `S&S Activewear — ${fresh.length} new order${fresh.length === 1 ? '' : 's'} (${money(total)})`;
  const htmlContent = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
      <h2 style="margin:0 0 4px">S&amp;S Activewear — daily import</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:16px">${fresh.length} new order${fresh.length === 1 ? '' : 's'} landed in the queue.</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0">🟢 <b>${ready}</b> shipped — ready to match &amp; push (yourSku = exact match)</td></tr>
        ${pending ? `<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0">🟡 <b>${pending}</b> not yet shipped — nothing to bill yet</td></tr>` : ''}
        ${credits ? `<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0">↩️ <b>${credits}</b> return/credit${credits === 1 ? '' : 's'}</td></tr>` : ''}
        <tr><td style="padding:8px 0"><b>${money(total)}</b> total</td></tr>
      </table>
      ${link ? `<div style="margin-top:20px"><a href="${link}" style="background:#0891b2;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open Import &amp; Review →</a></div>` : ''}
      <div style="color:#94a3b8;font-size:11px;margin-top:20px">Nothing is applied automatically — these wait for your review and push in the portal.</div>
    </div>`;

  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'NSA Portal — S&S Activewear', email: 'noreply@nationalsportsapparel.com' },
      to: [{ email: to }],
      subject,
      htmlContent,
    }),
  });
}
