// Netlify function: receives a coach's order request from the public catalog
// page (/adidas), stores it in catalog_order_requests (service role — RLS is
// locked because rows carry coach contact info), and emails the rep via Brevo
// with the line list + a CSV attachment. Reply-to is the coach so the rep can
// answer directly.
const MAX_LINES = 300;
const REP_EMAIL = process.env.CATALOG_ORDER_EMAIL || 'steve@nationalsportsapparel.com';

const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const coach_name = String(body.coach_name || '').trim().slice(0, 120);
    const coach_email = String(body.coach_email || '').trim().slice(0, 200);
    const coach_phone = String(body.coach_phone || '').trim().slice(0, 40);
    const team_name = String(body.team_name || '').trim().slice(0, 160);
    const notes = String(body.notes || '').trim().slice(0, 2000);
    const brand = String(body.brand || 'adidas').trim().slice(0, 40);
    const rawLines = Array.isArray(body.lines) ? body.lines.slice(0, MAX_LINES) : [];

    if (!coach_name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(coach_email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Name and a valid email are required' }) };
    }
    const lines = rawLines
      .map((l) => ({
        sku: String(l.sku || '').slice(0, 40),
        name: String(l.name || '').slice(0, 160),
        color: String(l.color || '').slice(0, 120),
        size: String(l.size || '').slice(0, 20),
        qty: Math.max(1, Math.min(9999, parseInt(l.qty) || 0)),
        price: Math.max(0, Number(l.price) || 0),
        inbound: l.inbound ? String(l.inbound).slice(0, 12) : null,
      }))
      .filter((l) => l.sku && l.size);
    if (!lines.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'No items in the request' }) };
    }

    // 1. Store the structured request (the portal can turn this into an estimate)
    const sbUrl = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    let requestId = null;
    if (sbUrl && sbKey) {
      const resp = await fetch(`${sbUrl}/rest/v1/catalog_order_requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: `Bearer ${sbKey}`, Prefer: 'return=representation' },
        body: JSON.stringify({ brand, coach_name, coach_email, coach_phone: coach_phone || null, team_name: team_name || null, notes: notes || null, lines }),
      });
      if (resp.ok) {
        const rows = await resp.json();
        requestId = rows && rows[0] && rows[0].id;
      } else {
        console.error('[catalog-order-request] Supabase insert failed:', resp.status, await resp.text());
      }
    }

    // 2. Email the rep
    const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
    if (!brevoKey) {
      // Request is stored; surface a soft failure so the coach still gets confirmation
      return { statusCode: requestId ? 200 : 500, headers, body: JSON.stringify({ ok: !!requestId, id: requestId, emailed: false }) };
    }

    const totalUnits = lines.reduce((a, l) => a + l.qty, 0);
    const estTotal = lines.reduce((a, l) => a + l.qty * l.price, 0);
    const rowsHtml = lines.map((l) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eef1f5;font-family:monospace">${esc(l.sku)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eef1f5">${esc(l.name)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eef1f5">${esc(l.color)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eef1f5;text-align:center">${esc(l.size)}${l.inbound ? `<div style="font-size:11px;color:#b45309">inbound ${esc(l.inbound)}</div>` : ''}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eef1f5;text-align:center;font-weight:700">${l.qty}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eef1f5;text-align:right">${l.price ? '$' + (l.price * l.qty).toFixed(2) : '—'}</td>
      </tr>`).join('');

    const htmlContent = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:680px;margin:0 auto">
        <div style="background:#191919;color:white;padding:18px 22px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;font-size:17px">New ${esc(brand)} order request — ${esc(coach_name)}${team_name ? ' · ' + esc(team_name) : ''}</h2>
        </div>
        <div style="background:white;padding:20px 22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
          <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px">
            <tr><td style="padding:5px 10px;background:#f8fafc;font-weight:600;color:#64748b;width:110px">Coach</td><td style="padding:5px 10px">${esc(coach_name)}</td></tr>
            <tr><td style="padding:5px 10px;background:#f8fafc;font-weight:600;color:#64748b">Email</td><td style="padding:5px 10px"><a href="mailto:${esc(coach_email)}">${esc(coach_email)}</a></td></tr>
            ${coach_phone ? `<tr><td style="padding:5px 10px;background:#f8fafc;font-weight:600;color:#64748b">Phone</td><td style="padding:5px 10px">${esc(coach_phone)}</td></tr>` : ''}
            ${team_name ? `<tr><td style="padding:5px 10px;background:#f8fafc;font-weight:600;color:#64748b">Team / Org</td><td style="padding:5px 10px">${esc(team_name)}</td></tr>` : ''}
            ${notes ? `<tr><td style="padding:5px 10px;background:#f8fafc;font-weight:600;color:#64748b">Notes</td><td style="padding:5px 10px">${esc(notes)}</td></tr>` : ''}
            ${requestId ? `<tr><td style="padding:5px 10px;background:#f8fafc;font-weight:600;color:#64748b">Request ID</td><td style="padding:5px 10px;font-family:monospace;font-size:12px">${esc(requestId)}</td></tr>` : ''}
          </table>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr style="background:#f8fafc;color:#64748b;font-weight:600;text-align:left">
              <th style="padding:6px 10px">SKU</th><th style="padding:6px 10px">Item</th><th style="padding:6px 10px">Color</th>
              <th style="padding:6px 10px;text-align:center">Size</th><th style="padding:6px 10px;text-align:center">Qty</th><th style="padding:6px 10px;text-align:right">Retail</th>
            </tr>
            ${rowsHtml}
            <tr>
              <td colspan="4" style="padding:8px 10px;font-weight:700;text-align:right">Total</td>
              <td style="padding:8px 10px;text-align:center;font-weight:700">${totalUnits}</td>
              <td style="padding:8px 10px;text-align:right;font-weight:700">${estTotal ? '$' + estTotal.toFixed(2) : '—'}</td>
            </tr>
          </table>
          <p style="color:#64748b;font-size:12px;margin-top:14px">Retail totals are list price for reference only. The CSV is attached for import. Reply to this email to reach the coach directly.</p>
        </div>
      </div>`;

    const csv = ['sku,item,color,size,qty,retail_price,inbound']
      .concat(lines.map((l) => [l.sku, l.name, l.color, l.size, l.qty, l.price || '', l.inbound || ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')))
      .join('\n');

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify({
        sender: { name: 'NSA Catalog', email: 'noreply@nationalsportsapparel.com' },
        to: [{ email: REP_EMAIL }],
        replyTo: { email: coach_email, name: coach_name },
        subject: `Order request: ${coach_name}${team_name ? ' (' + team_name + ')' : ''} — ${lines.length} line${lines.length === 1 ? '' : 's'}, ${totalUnits} units`,
        htmlContent,
        attachment: [{ content: Buffer.from(csv).toString('base64'), name: `order_request_${(team_name || coach_name).replace(/[^a-zA-Z0-9-]/g, '_')}.csv` }],
      }),
    });
    const emailed = res.ok;
    if (!emailed) console.error('[catalog-order-request] Brevo error:', res.status, await res.text());

    if (emailed && requestId && sbUrl && sbKey) {
      await fetch(`${sbUrl}/rest/v1/catalog_order_requests?id=eq.${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: `Bearer ${sbKey}` },
        body: JSON.stringify({ emailed: true }),
      }).catch(() => {});
    }

    if (!requestId && !emailed) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: 'Could not save or send the request' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id: requestId, emailed }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
