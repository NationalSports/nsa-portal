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
    // Signed-in coach accounts send their linked portal customer — the rep
    // inbox then skips email matching entirely.
    const customer_id = body.customer_id ? String(body.customer_id).trim().slice(0, 64) : null;
    const rawLines = Array.isArray(body.lines) ? body.lines.slice(0, MAX_LINES) : [];

    if (!coach_name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(coach_email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Name and a valid email are required' }) };
    }
    const DECOS = ['Screen print', 'Embroidery', 'Heat press'];
    const lines = rawLines
      .map((l) => ({
        sku: String(l.sku || '').slice(0, 40),
        name: String(l.name || '').slice(0, 160),
        color: String(l.color || '').slice(0, 120),
        size: String(l.size || '').slice(0, 20),
        qty: Math.max(1, Math.min(9999, parseInt(l.qty) || 0)),
        price: Math.max(0, Number(l.price) || 0),
        inbound: l.inbound ? String(l.inbound).slice(0, 12) : null,
        decoration: DECOS.includes(l.decoration) ? l.decoration : null,
      }))
      .filter((l) => l.sku && l.size);
    if (!lines.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'No items in the request' }) };
    }

    // Optional coach-attached images (logo / mockup / reference). Email-only —
    // they're downscaled in the browser, attached to the rep email, not stored.
    const MAX_IMAGES = 6;
    let imgBudget = 7000000; // base64 chars (~5 MB) total across all images
    const imgAttachments = [];
    for (const im of (Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [])) {
      const name = String((im && im.name) || 'image').replace(/[\r\n]+/g, ' ').slice(0, 80);
      const content = typeof (im && im.content) === 'string' ? im.content : '';
      if (!content || content.length > imgBudget) continue;
      imgBudget -= content.length;
      imgAttachments.push({ content, name });
    }

    // 1. Store the structured request (the portal can turn this into an estimate)
    const sbUrl = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
    // Resolve the coach's team and its assigned rep up front. The storefront only
    // forwards customer_id for a live signed-in session, so a guest cart or a
    // lapsed sign-in arrives blank — but the coach's email is in coach_accounts,
    // which is the reliable link. With the team known we route the alert to the
    // one rep who owns the account instead of the shared catalog inbox.
    let resolvedCustomerId = customer_id;
    let repEmail = null;
    if (sbUrl && sbKey) {
      try {
        if (!resolvedCustomerId && coach_email) {
          const r = await fetch(`${sbUrl}/rest/v1/coach_accounts?select=customer_id&status=eq.active&email=ilike.${encodeURIComponent(coach_email)}&limit=1`, { headers: sbHeaders });
          if (r.ok) { const rows = await r.json(); if (rows && rows[0] && rows[0].customer_id) resolvedCustomerId = rows[0].customer_id; }
        }
        if (resolvedCustomerId) {
          const rc = await fetch(`${sbUrl}/rest/v1/customers?select=primary_rep_id&id=eq.${encodeURIComponent(resolvedCustomerId)}&limit=1`, { headers: sbHeaders });
          const crows = rc.ok ? await rc.json() : [];
          const repId = crows && crows[0] ? crows[0].primary_rep_id : null;
          if (repId) {
            const rt = await fetch(`${sbUrl}/rest/v1/team_members?select=email,is_active&id=eq.${encodeURIComponent(repId)}&limit=1`, { headers: sbHeaders });
            const trows = rt.ok ? await rt.json() : [];
            if (trows && trows[0] && trows[0].email && trows[0].is_active !== false) repEmail = trows[0].email;
          }
        }
      } catch (e) { console.error('[catalog-order-request] customer/rep resolution failed:', e.message); }
    }
    let requestId = null;
    if (sbUrl && sbKey) {
      const resp = await fetch(`${sbUrl}/rest/v1/catalog_order_requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: `Bearer ${sbKey}`, Prefer: 'return=representation' },
        body: JSON.stringify({ brand, coach_name, coach_email, coach_phone: coach_phone || null, team_name: team_name || null, notes: notes || null, customer_id: resolvedCustomerId, lines }),
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
    // Collapse to one row per SKU: every size's qty (and any inbound flag) shows
    // as a compact run in the Size column; Qty + Retail are the SKU totals.
    const SIZE_ORDER = ['3XS', '2XS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', '4XL', '5XL', '6XL', 'ST', 'MT', 'LT', 'XLT', '2XLT', '3XLT', 'OSFA', 'ONE SIZE', 'OS', 'NS'];
    const sizeRank = (s) => { const i = SIZE_ORDER.indexOf(String(s || '').trim().toUpperCase()); return i === -1 ? 900 : i; };
    const groups = [];
    const groupIdx = {};
    lines.forEach((l) => {
      if (groupIdx[l.sku] == null) { groupIdx[l.sku] = groups.length; groups.push({ sku: l.sku, name: l.name, color: l.color, decoration: l.decoration, lines: [] }); }
      groups[groupIdx[l.sku]].lines.push(l);
    });
    groups.forEach((g) => g.lines.sort((a, b) => sizeRank(a.size) - sizeRank(b.size) || String(a.size).localeCompare(String(b.size))));
    const rowsHtml = groups.map((g) => {
      const qty = g.lines.reduce((a, l) => a + l.qty, 0);
      const retail = g.lines.reduce((a, l) => a + l.qty * l.price, 0);
      const sizeRun = g.lines.map((l) => `<span style="display:inline-block;white-space:nowrap;margin:0 12px 3px 0">${esc(l.size)}&nbsp;<strong>${l.qty}</strong>${l.inbound ? `<span style="color:#b45309;font-size:11px"> · inbound ${esc(l.inbound)}</span>` : ''}</span>`).join('');
      return `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eef1f5;font-family:monospace;vertical-align:top">${esc(g.sku)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eef1f5;vertical-align:top">${esc(g.name)}${g.decoration ? `<div style="font-size:11px;color:#2563eb;font-weight:600">+ ${esc(g.decoration)}</div>` : ''}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eef1f5;vertical-align:top">${esc(g.color)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eef1f5">${sizeRun}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eef1f5;text-align:center;font-weight:700;vertical-align:top">${qty}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eef1f5;text-align:right;vertical-align:top">${retail ? '$' + retail.toFixed(2) : '—'}</td>
      </tr>`;
    }).join('');

    const portalUrl = (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
    // Deep link straight to the rep's Estimate Requests inbox, focused on this
    // request — one click there drops these lines into a draft estimate at the
    // team's pricing. Only shown when the request was saved (we have its id).
    const ctaHtml = requestId ? `
      <div style="text-align:center;margin:2px 0 18px">
        <a href="${portalUrl}/?catreq=${encodeURIComponent(requestId)}" style="display:inline-block;background:#191919;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:8px">Create estimate from this request →</a>
        <div style="color:#94a3b8;font-size:11px;margin-top:7px">Opens the portal with these ${groups.length} item${groups.length === 1 ? '' : 's'} (${totalUnits} units) ready to drop into a draft estimate at the team's pricing.</div>
      </div>` : '';

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
          ${imgAttachments.length ? `<p style="color:#334155;font-size:13px;margin:0 0 12px">📎 <strong>${imgAttachments.length} image${imgAttachments.length === 1 ? '' : 's'}</strong> attached by the coach (logo / mockup / reference) — see this email's attachments.</p>` : ''}
          ${ctaHtml}
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr style="background:#f8fafc;color:#64748b;font-weight:600;text-align:left">
              <th style="padding:6px 10px">SKU</th><th style="padding:6px 10px">Item</th><th style="padding:6px 10px">Color</th>
              <th style="padding:6px 10px">Size</th><th style="padding:6px 10px;text-align:center">Qty</th><th style="padding:6px 10px;text-align:right">Retail</th>
            </tr>
            ${rowsHtml}
            <tr>
              <td colspan="4" style="padding:8px 10px;font-weight:700;text-align:right">Total</td>
              <td style="padding:8px 10px;text-align:center;font-weight:700">${totalUnits}</td>
              <td style="padding:8px 10px;text-align:right;font-weight:700">${estTotal ? '$' + estTotal.toFixed(2) : '—'}</td>
            </tr>
          </table>
          <p style="color:#64748b;font-size:12px;margin-top:14px">Use <strong>Create estimate from this request</strong> above to pull these lines into a draft estimate at the team's pricing — or import the attached CSV. Retail totals are list price for reference only. Reply to this email to reach the coach directly.</p>
        </div>
      </div>`;

    const csv = ['sku,item,color,size,qty,retail_price,inbound,decoration']
      .concat(lines.map((l) => [l.sku, l.name, l.color, l.size, l.qty, l.price || '', l.inbound || '', l.decoration || ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')))
      .join('\n');

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify({
        sender: { name: 'NSA Catalog', email: 'noreply@nationalsportsapparel.com' },
        // Route to the account's assigned rep when we resolved one; otherwise the
        // shared catalog inbox so an unmatched request still reaches someone.
        to: [{ email: repEmail || REP_EMAIL }],
        replyTo: { email: coach_email, name: coach_name },
        subject: `Order request: ${coach_name}${team_name ? ' (' + team_name + ')' : ''} — ${lines.length} line${lines.length === 1 ? '' : 's'}, ${totalUnits} units`,
        htmlContent,
        attachment: [{ content: Buffer.from(csv).toString('base64'), name: `order_request_${(team_name || coach_name).replace(/[^a-zA-Z0-9-]/g, '_')}.csv` }, ...imgAttachments],
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

    // 3. Confirmation copy to the coach (best-effort — never fails the request)
    try {
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
        body: JSON.stringify({
          sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
          to: [{ email: coach_email, name: coach_name }],
          replyTo: { email: REP_EMAIL },
          subject: `We got your order request — ${lines.length} item${lines.length === 1 ? '' : 's'}, ${totalUnits} units`,
          htmlContent: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:680px;margin:0 auto">
              <div style="background:#191919;color:white;padding:18px 22px;border-radius:8px 8px 0 0">
                <h2 style="margin:0;font-size:17px">Thanks, ${esc(coach_name)} — your request is in</h2>
              </div>
              <div style="background:white;padding:20px 22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
                <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 14px">
                  Your National Sports Apparel rep has your list${team_name ? ` for <strong>${esc(team_name)}</strong>` : ''} and will
                  follow up with a formal estimate at your team pricing. Here's what you sent:
                </p>
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                  <tr style="background:#f8fafc;color:#64748b;font-weight:600;text-align:left">
                    <th style="padding:6px 10px">SKU</th><th style="padding:6px 10px">Item</th><th style="padding:6px 10px">Color</th>
                    <th style="padding:6px 10px">Size</th><th style="padding:6px 10px;text-align:center">Qty</th><th style="padding:6px 10px;text-align:right">Retail</th>
                  </tr>
                  ${rowsHtml}
                  <tr>
                    <td colspan="4" style="padding:8px 10px;font-weight:700;text-align:right">Total</td>
                    <td style="padding:8px 10px;text-align:center;font-weight:700">${totalUnits}</td>
                    <td style="padding:8px 10px;text-align:right;font-weight:700">${estTotal ? '$' + estTotal.toFixed(2) : '—'}</td>
                  </tr>
                </table>
                <p style="font-size:12px;color:#94a3b8;margin-top:14px">
                  Retail prices are list-price reference only — your estimate will show your team pricing.
                  Reply to this email to reach your rep with changes or questions.
                </p>
              </div>
            </div>`,
        }),
      });
    } catch (e) {
      console.error('[catalog-order-request] coach confirmation failed:', e.message);
    }

    if (!requestId && !emailed) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: 'Could not save or send the request' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id: requestId, emailed }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
