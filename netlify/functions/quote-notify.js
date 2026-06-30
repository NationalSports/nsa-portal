// Notifies the owning rep that a (public, token-linked) quote request form was
// submitted. Deliberately content-locked: the caller supplies ONLY a quote
// request id — recipient, subject, and body are all built server-side from DB
// rows, so this can stay unauthenticated without becoming an email relay
// (unlike brevo-proxy, which is now staff-only).
const { createClient } = require('@supabase/supabase-js');

const HEADERS = { 'Content-Type': 'application/json' };

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'POST only' }) };

  const url = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!url || !key) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Supabase not configured' }) };
  if (!brevoKey) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'BREVO_API_KEY not configured' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
  const qrId = String(body.quoteRequestId || '').trim();
  if (!qrId) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'quoteRequestId required' }) };

  const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    const { data: qrs, error: qrErr } = await sb.from('quote_requests').select('*').eq('id', qrId).limit(1);
    if (qrErr) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: qrErr.message }) };
    const qr = qrs && qrs[0];
    if (!qr) return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Quote request not found' }) };
    // Only a freshly submitted form notifies — re-posting an id can't spam the rep.
    if (qr.status !== 'submitted') return { statusCode: 409, headers: HEADERS, body: JSON.stringify({ error: 'Quote request is not in submitted state' }) };
    if (qr.rep_notified_at) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, already: true }) };

    const [{ data: items }, { data: reps }, { data: custs }] = await Promise.all([
      sb.from('quote_request_items').select('*').eq('quote_request_id', qr.id).order('sort_order'),
      sb.from('team_members').select('email,name').eq('id', qr.created_by).limit(1),
      qr.customer_id ? sb.from('customers').select('name').eq('id', qr.customer_id).limit(1) : Promise.resolve({ data: [] }),
    ]);
    const rep = reps && reps[0];
    if (!rep || !rep.email) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, skipped: 'no rep email' }) };
    const custName = (custs && custs[0] && custs[0].name) || 'Customer';

    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const itemSummary = (items || []).map((it, i) => {
      const sizes = Object.entries(it.sizes || {}).filter(([, v]) => v > 0).map(([s, v]) => s + ':' + v).join(', ');
      return `${i + 1}. ${esc(it.sku || it.description)} — ${esc(it.color || 'no color')} — ${sizes || ('Qty: ' + (it.total_qty || 'TBD'))}`;
    }).join('<br/>');
    const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');
    const html = `<h2>Quote Request from ${esc(custName)}</h2>
      <p><strong>${esc(qr.contact_name || 'Customer')}</strong> has submitted their quote request.</p>
      <h3>Items:</h3><p>${itemSummary || '(no items)'}</p>
      ${qr.notes ? `<p><strong>Notes:</strong> ${esc(qr.notes)}</p>` : ''}
      <p><a href="${portal}">Open NSA Portal to review</a></p>`;

    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify({
        sender: { name: 'NSA Quote System', email: 'noreply@nationalsportsapparel.com' },
        to: [{ email: rep.email, name: rep.name || '' }],
        subject: 'Quote Request Submitted — ' + custName,
        htmlContent: html,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      console.error('[quote-notify] Brevo send failed:', t);
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Email send failed' }) };
    }
    // Best-effort dedupe marker; if the column doesn't exist yet the send still
    // only repeats while the request remains in 'submitted' (rep-only, low risk).
    await sb.from('quote_requests').update({ rep_notified_at: new Date().toISOString() }).eq('id', qr.id).then((r) => { if (r.error) console.warn('[quote-notify] rep_notified_at not persisted:', r.error.message); });
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('[quote-notify] failed:', e);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
