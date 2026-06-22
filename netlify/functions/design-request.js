// Receives a custom DESIGN request from the public uniform-builder page:
//   - Momentec FreeStyle: the builder hands the design to /cart.html (cartData in
//     localStorage); that page POSTs the captured payload here.
//   - adidas / other: the customer pastes their builder "Share" link.
// Stores the request in catalog_order_requests (service role — the table's brand
// column was always meant to cover Momentec/other catalogs) and emails the rep so
// they can open the design in the dealer tool and build the order. Reply-to is the
// customer. Mirrors catalog-order-request.js (same Supabase + Brevo plumbing).
const REP_EMAIL = process.env.DESIGN_REQUEST_EMAIL || process.env.CATALOG_ORDER_EMAIL || 'steve@nationalsportsapparel.com';
const BRANDS = { momentec: 'Momentec FreeStyle', adidas: 'adidas', other: 'Custom' };
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const brandKey = ['momentec', 'adidas', 'other'].includes(body.brand) ? body.brand : 'other';
    const name = String(body.name || '').trim().slice(0, 120);
    const email = String(body.email || '').trim().slice(0, 200);
    const phone = String(body.phone || '').trim().slice(0, 40);
    const team = String(body.team || '').trim().slice(0, 160);
    const sport = String(body.sport || '').trim().slice(0, 60);
    const notes = String(body.notes || '').trim().slice(0, 2000);
    const designUrl = String(body.design_url || '').trim().slice(0, 1000);
    const imageUrl = String(body.image_url || '').trim().slice(0, 1000);
    // Raw builder hand-off (Momentec cartData) — kept verbatim for staff reference.
    let payload = body.payload;
    if (payload && typeof payload !== 'string') { try { payload = JSON.stringify(payload); } catch { payload = null; } }
    if (typeof payload === 'string') payload = payload.slice(0, 20000); else payload = null;

    const validUrl = /^https?:\/\//i.test(designUrl);
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Name and a valid email are required' }) };
    }
    if (!validUrl && !payload) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'A design link or a captured design is required' }) };
    }

    const brandLabel = BRANDS[brandKey];
    // catalog_order_requests.lines is NOT NULL — store the design as one structured line.
    const lines = [{ kind: 'design', brand: brandKey, sport: sport || null, design_url: validUrl ? designUrl : null, image_url: imageUrl || null, payload: payload || null }];
    const fullNotes = [sport ? `Sport: ${sport}` : '', validUrl ? `Design link: ${designUrl}` : '', notes].filter(Boolean).join('\n');

    // 1) Store the request (the portal turns it into an estimate/order)
    const sbUrl = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    let requestId = null;
    if (sbUrl && sbKey) {
      const resp = await fetch(`${sbUrl}/rest/v1/catalog_order_requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: `Bearer ${sbKey}`, Prefer: 'return=representation' },
        body: JSON.stringify({ brand: brandKey, coach_name: name, coach_email: email, coach_phone: phone || null, team_name: team || null, notes: fullNotes || null, lines }),
      });
      if (resp.ok) { const rows = await resp.json(); requestId = rows && rows[0] && rows[0].id; }
      else console.error('[design-request] Supabase insert failed:', resp.status, await resp.text());
    }

    // 2) Email the rep
    const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
    const portalUrl = (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
    let emailed = false;
    if (brevoKey) {
      const cta = requestId ? `<div style="text-align:center;margin:6px 0 18px"><a href="${portalUrl}/?catreq=${encodeURIComponent(requestId)}" style="display:inline-block;background:#191919;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:8px">Open this request in the portal &rarr;</a></div>` : '';
      const designBlock = `
        ${validUrl ? `<p style="margin:8px 0"><strong>Design link:</strong> <a href="${esc(designUrl)}">${esc(designUrl)}</a></p>` : ''}
        ${imageUrl ? `<p style="margin:8px 0"><img src="${esc(imageUrl)}" alt="design preview" style="max-width:340px;border:1px solid #e2e8f0;border-radius:8px"></p>` : ''}
        ${payload ? `<details style="margin-top:8px"><summary style="cursor:pointer;color:#64748b;font-size:12px">Captured builder data</summary><pre style="white-space:pre-wrap;font-size:11px;background:#f8fafc;padding:10px;border-radius:6px;max-height:280px;overflow:auto">${esc(payload)}</pre></details>` : ''}`;
      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:680px;margin:0 auto">
          <div style="background:#191919;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0"><h2 style="margin:0;font-size:17px">New ${esc(brandLabel)} design request — ${esc(name)}${team ? ' · ' + esc(team) : ''}</h2></div>
          <div style="background:#fff;padding:20px 22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
            <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px">
              <tr><td style="padding:5px 10px;background:#f8fafc;font-weight:600;color:#64748b;width:110px">Brand</td><td style="padding:5px 10px">${esc(brandLabel)}</td></tr>
              <tr><td style="padding:5px 10px;background:#f8fafc;font-weight:600;color:#64748b">Name</td><td style="padding:5px 10px">${esc(name)}</td></tr>
              <tr><td style="padding:5px 10px;background:#f8fafc;font-weight:600;color:#64748b">Email</td><td style="padding:5px 10px"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
              ${phone ? `<tr><td style="padding:5px 10px;background:#f8fafc;font-weight:600;color:#64748b">Phone</td><td style="padding:5px 10px">${esc(phone)}</td></tr>` : ''}
              ${team ? `<tr><td style="padding:5px 10px;background:#f8fafc;font-weight:600;color:#64748b">Team / Org</td><td style="padding:5px 10px">${esc(team)}</td></tr>` : ''}
              ${sport ? `<tr><td style="padding:5px 10px;background:#f8fafc;font-weight:600;color:#64748b">Sport</td><td style="padding:5px 10px">${esc(sport)}</td></tr>` : ''}
              ${notes ? `<tr><td style="padding:5px 10px;background:#f8fafc;font-weight:600;color:#64748b">Notes</td><td style="padding:5px 10px">${esc(notes).replace(/\n/g, '<br>')}</td></tr>` : ''}
              ${requestId ? `<tr><td style="padding:5px 10px;background:#f8fafc;font-weight:600;color:#64748b">Request ID</td><td style="padding:5px 10px;font-family:monospace;font-size:12px">${esc(requestId)}</td></tr>` : ''}
            </table>
            ${cta}
            ${designBlock}
            <p style="color:#64748b;font-size:12px;margin-top:14px">Reply to this email to reach the customer directly.</p>
          </div>
        </div>`;
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
        body: JSON.stringify({ sender: { name: 'NSA Uniform Builder', email: 'noreply@nationalsportsapparel.com' }, to: [{ email: REP_EMAIL }], replyTo: { email, name }, subject: `Design request: ${name}${team ? ' (' + team + ')' : ''} — ${brandLabel}`, htmlContent: html }),
      });
      emailed = res.ok;
      if (!emailed) console.error('[design-request] Brevo error:', res.status, await res.text());

      if (emailed && requestId && sbUrl && sbKey) {
        await fetch(`${sbUrl}/rest/v1/catalog_order_requests?id=eq.${requestId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: `Bearer ${sbKey}` }, body: JSON.stringify({ emailed: true }),
        }).catch(() => {});
      }

      // 3) Confirmation to the customer (best-effort)
      try {
        await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
          body: JSON.stringify({ sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' }, to: [{ email, name }], replyTo: { email: REP_EMAIL }, subject: 'We got your design — we’ll be in touch', htmlContent: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:620px;margin:0 auto"><div style="background:#191919;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0"><h2 style="margin:0;font-size:17px">Thanks, ${esc(name)} — your design is in</h2></div><div style="background:#fff;padding:20px 22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;font-size:14px;color:#334155;line-height:1.6">Your National Sports Apparel rep has your ${esc(brandLabel)} design${team ? ` for <strong>${esc(team)}</strong>` : ''} and will follow up with pricing and next steps.${validUrl ? `<br><br><a href="${esc(designUrl)}">View your design</a>` : ''}<p style="font-size:12px;color:#94a3b8;margin-top:14px">Reply to this email with any changes or questions.</p></div></div>` }),
        });
      } catch (e) { console.error('[design-request] customer confirmation failed:', e.message); }
    }

    if (!requestId && !emailed) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: 'Could not save or send the request' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id: requestId, emailed }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
