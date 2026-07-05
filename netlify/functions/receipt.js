// Full itemized payment receipt for coach-portal invoice payments.
// PUBLIC (the portal is anonymous), but every line of content is built from our own DB + Stripe —
// never from the caller — so this can't be abused as an open email relay. A caller can at most
// (re)print or (re)send a receipt for a payment that genuinely succeeded.
//   GET  ?payment_intent_id=pi_...        -> printable HTML receipt (Download / Save as PDF)
//   POST { payment_intent_id, email }     -> emails that same receipt via Brevo
const stripe = require('stripe');
const { getSupabaseAdmin, corsHeaders } = require('./_shared');

const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Pull the payment + the invoice(s) it covers and shape them for the receipt.
async function loadReceipt(piId) {
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) throw new Error('Stripe secret key not configured');
  const client = stripe(sk);
  const pi = await client.paymentIntents.retrieve(piId, { expand: ['latest_charge'] });
  if (!pi || (pi.status !== 'succeeded' && pi.status !== 'processing')) {
    return { error: 'No completed payment found for this receipt.' };
  }
  const ids = String((pi.metadata && pi.metadata.invoice_id) || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const admin = getSupabaseAdmin();
  let invoices = [];
  if (ids.length) {
    const { data } = await admin.from('invoices')
      .select('id,memo,date,line_items,tax,tax_rate,shipping,total,cc_fee,paid,status,billing_name,billing_address,customer_id')
      .in('id', ids);
    invoices = data || [];
  }
  let customerName = (pi.metadata && pi.metadata.customer_name) || '';
  if (invoices[0] && invoices[0].customer_id) {
    const { data: c } = await admin.from('customers').select('name').eq('id', invoices[0].customer_id).limit(1);
    if (c && c[0]) customerName = invoices[0].billing_name || c[0].name || customerName;
  } else if (invoices[0] && invoices[0].billing_name) {
    customerName = invoices[0].billing_name;
  }
  const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const pmd = charge && charge.payment_method_details;
  const card = pmd && pmd.card;
  const ach = pmd && (pmd.us_bank_account || pmd.ach_debit);
  const method = card ? `${(card.brand || 'Card').replace(/^\w/, (m) => m.toUpperCase())} •••• ${card.last4 || ''}`.trim()
    : ach ? `Bank account •••• ${ach.last4 || ''}`.trim()
      : (pi.status === 'processing' ? 'Bank account (ACH)' : 'Card');
  const created = charge && charge.created ? new Date(charge.created * 1000) : new Date((pi.created || Math.floor(Date.now() / 1000)) * 1000);
  const amountPaid = (pi.amount_received != null ? pi.amount_received : (pi.amount || 0)) / 100;
  return { pi, invoices, customerName, method, date: created, amountPaid, processing: pi.status === 'processing' };
}

function buildHtml(r, forEmail) {
  const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
  const logo = `${portal}/NEW%20NSA%20Logo%20on%20white.png`;
  const dateStr = r.date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let grand = 0;
  const invBlocks = (r.invoices || []).map((inv) => {
    const items = Array.isArray(inv.line_items) ? inv.line_items : [];
    const tax = Number(inv.tax) || 0, shipping = Number(inv.shipping) || 0, fee = Number(inv.cc_fee) || 0, total = Number(inv.total) || 0;
    const subtotal = Math.round((total - tax - shipping - fee) * 100) / 100;
    grand += total;
    const rows = items.map((it) => {
      const qty = Number(it.qty) || 0; const amt = Number(it.amount) || 0; const rate = Number(it.rate) || 0;
      const name = esc(it.desc || it._name || it._sku || 'Item');
      return `<tr><td style="padding:6px 0;border-bottom:1px solid #eef1f5">${qty ? qty + ' &times; ' : ''}${name}</td><td style="padding:6px 0;border-bottom:1px solid #eef1f5;text-align:right;white-space:nowrap;color:#64748b">${money(rate)}</td><td style="padding:6px 0;border-bottom:1px solid #eef1f5;text-align:right;white-space:nowrap;font-weight:600">${money(amt)}</td></tr>`;
    }).join('');
    return `<div style="margin-top:18px">
      <div style="font-weight:700;color:#0b1220;font-size:14px">Invoice ${esc(inv.id)}${inv.memo ? ` &mdash; ${esc(inv.memo)}` : ''}</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px">
        <tr><th style="text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px;padding-bottom:4px">Item</th><th style="text-align:right;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px">Rate</th><th style="text-align:right;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px">Amount</th></tr>
        ${rows}
        <tr><td></td><td style="padding:6px 0 0;text-align:right;color:#475569">Subtotal</td><td style="padding:6px 0 0;text-align:right">${money(subtotal)}</td></tr>
        ${tax > 0 ? `<tr><td></td><td style="padding:2px 0;text-align:right;color:#475569">Tax${inv.tax_rate ? ` (${(Number(inv.tax_rate) * 100).toFixed(2).replace(/\.?0+$/, '')}%)` : ''}</td><td style="padding:2px 0;text-align:right">${money(tax)}</td></tr>` : ''}
        ${shipping > 0 ? `<tr><td></td><td style="padding:2px 0;text-align:right;color:#475569">Shipping</td><td style="padding:2px 0;text-align:right">${money(shipping)}</td></tr>` : ''}
        ${fee > 0 ? `<tr><td></td><td style="padding:2px 0;text-align:right;color:#d97706">Card processing fee</td><td style="padding:2px 0;text-align:right;color:#d97706">${money(fee)}</td></tr>` : ''}
        <tr><td></td><td style="padding:8px 0 0;text-align:right;font-weight:800">Invoice total</td><td style="padding:8px 0 0;text-align:right;font-weight:800">${money(total)}</td></tr>
      </table></div>`;
  }).join('');
  const paidAmt = r.amountPaid || grand;
  const badge = r.processing
    ? `<span style="background:#fef3c7;color:#92400e;padding:3px 12px;border-radius:999px;font-size:12px;font-weight:800">PAYMENT PROCESSING</span>`
    : `<span style="background:#dcfce7;color:#166534;padding:3px 12px;border-radius:999px;font-size:12px;font-weight:800">PAID</span>`;
  const body = `<div style="font-family:'Source Sans 3',-apple-system,Segoe UI,Roboto,sans-serif;color:#2A2F3E;max-width:600px;margin:0 auto">
    <table width="100%" style="border-collapse:collapse"><tr>
      <td align="left" style="vertical-align:middle"><img src="${logo}" alt="National Sports Apparel" height="40" style="height:40px;display:block;border:none"></td>
      <td align="right" style="vertical-align:middle"><div style="font-size:20px;font-weight:800;color:#0b1220">Payment Receipt</div><div style="font-size:12px;color:#64748b">${dateStr}</div></td>
    </tr></table>
    <div style="border-top:3px solid #0b1f3a;margin:12px 0 0"></div>
    <table width="100%" style="border-collapse:collapse;font-size:13px;margin-top:12px">
      <tr>
        <td style="vertical-align:top"><div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Billed to</div><div style="font-weight:700;margin-top:2px">${esc(r.customerName || 'Customer')}</div>${r.invoices[0] && r.invoices[0].billing_address ? `<div style="color:#475569;white-space:pre-line;margin-top:2px">${esc(r.invoices[0].billing_address)}</div>` : ''}</td>
        <td style="vertical-align:top;text-align:right">${badge}<div style="font-size:12px;color:#64748b;margin-top:6px">Receipt #${esc((r.pi.id || '').replace('pi_', '').slice(-10).toUpperCase())}</div></td>
      </tr>
    </table>
    ${invBlocks}
    <div style="margin-top:18px;background:${r.processing ? '#fffbeb' : '#f0fdf4'};border:1px solid ${r.processing ? '#fde68a' : '#bbf7d0'};border-radius:10px;padding:14px 16px">
      <table width="100%" style="border-collapse:collapse;font-size:14px">
        <tr><td style="color:${r.processing ? '#92400e' : '#166534'};font-weight:700">${r.processing ? 'Amount submitted' : 'Amount paid'}</td><td style="text-align:right;font-weight:800;font-size:18px;color:${r.processing ? '#92400e' : '#166534'}">${money(paidAmt)}</td></tr>
        <tr><td style="color:#475569;padding-top:4px">Payment method</td><td style="text-align:right;padding-top:4px">${esc(r.method)}</td></tr>
        <tr><td style="color:#475569">Date</td><td style="text-align:right">${dateStr}</td></tr>
      </table>
      ${r.processing ? `<div style="font-size:12px;color:#92400e;margin-top:8px">Bank payments take a few business days to clear. We'll email you again if anything changes.</div>` : ''}
    </div>
    <p style="font-size:12px;color:#94a3b8;margin-top:18px;text-align:center;line-height:1.5">Thank you for your business!<br>National Sports Apparel &middot; 2238 N. Glassell St., Suite E, Orange, CA 92865 &middot; nationalsportsapparel.com</p>
  </div>`;
  if (forEmail) return body;
  // Standalone printable page for download / save-as-PDF.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment Receipt &mdash; National Sports Apparel</title></head>
  <body style="margin:0;background:#f1f5f9;padding:24px">
    <div style="max-width:640px;margin:0 auto">
      <div style="text-align:right;margin-bottom:10px"><button onclick="window.print()" style="background:#1e3a5f;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:700;cursor:pointer">&#128196; Print / Save as PDF</button></div>
      <div style="background:#fff;border-radius:12px;padding:26px;box-shadow:0 2px 12px rgba(0,0,0,.08)">${body}</div>
    </div>
  </body></html>`;
}

// Exported for local rendering tests (Netlify only ever invokes `handler`).
exports.buildHtml = buildHtml;
exports.loadReceipt = loadReceipt;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  try {
    if (event.httpMethod === 'GET') {
      const piId = (event.queryStringParameters || {}).payment_intent_id;
      if (!piId) return { statusCode: 400, headers: { 'Content-Type': 'text/plain' }, body: 'payment_intent_id required' };
      const r = await loadReceipt(piId);
      if (r.error) return { statusCode: 404, headers: { 'Content-Type': 'text/plain' }, body: r.error };
      return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: buildHtml(r, false) };
    }
    if (event.httpMethod === 'POST') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch (e) { /* leave empty */ }
      const { payment_intent_id, email } = body;
      if (!payment_intent_id || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'A valid payment_intent_id and email are required.' }) };
      }
      const r = await loadReceipt(payment_intent_id);
      if (r.error) return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ error: r.error }) };
      const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
      if (!brevoKey) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Email is not configured (BREVO_API_KEY missing).' }) };
      const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
        body: JSON.stringify({
          sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
          to: [{ email }],
          subject: 'Your National Sports Apparel payment receipt',
          htmlContent: buildHtml(r, true),
        }),
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        console.error('[receipt] Brevo send failed:', resp.status, t);
        return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: 'The receipt email could not be sent. Please try again.' }) };
      }
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true }) };
    }
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (e) {
    console.error('[receipt] error:', e.message);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Could not generate the receipt.' }) };
  }
};
