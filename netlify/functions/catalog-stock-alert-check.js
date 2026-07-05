// Scheduled function (see netlify.toml): checks active back-in-stock alerts
// against adidas_inventory and emails coaches via Brevo when their size has
// landed. Alerts are deactivated after notifying — one email per signup.
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

exports.handler = async () => {
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
  const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
  if (!sbUrl || !sbKey || !brevoKey) {
    console.error('[stock-alert-check] missing config');
    return { statusCode: 500, body: 'Not configured' };
  }
  const sb = (path, init) => fetch(`${sbUrl}/rest/v1/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: `Bearer ${sbKey}`, ...(init && init.headers) },
  });

  try {
    const alertsRes = await sb('catalog_stock_alerts?active=eq.true&order=created_at&limit=1000');
    const alerts = await alertsRes.json();
    if (!Array.isArray(alerts) || !alerts.length) return { statusCode: 200, body: 'No active alerts' };

    // Defensively drop any sku that isn't a plain identifier so it can't break
    // out of the PostgREST in.(...) filter below.
    const skus = [...new Set(alerts.map((a) => a.sku))].filter((s) => /^[A-Za-z0-9._-]+$/.test(s));
    if (!skus.length) return { statusCode: 200, body: 'No valid alert skus' };
    const invRes = await sb(`adidas_inventory?sku=in.(${skus.map((s) => `"${s}"`).join(',')})&stock_qty=gt.0&select=sku,size,stock_qty`);
    const inv = await invRes.json();
    const stockBySku = {};
    for (const r of inv) (stockBySku[r.sku] = stockBySku[r.sku] || []).push(r);

    let sent = 0;
    for (const a of alerts) {
      const rows = stockBySku[a.sku] || [];
      const hit = a.size ? rows.find((r) => r.size === a.size) : rows[0];
      if (!hit) continue;

      const label = `${a.style_name || a.sku}${a.color ? ' — ' + a.color : ''}`;
      const link = `${portal}/adidas?style=${encodeURIComponent(a.sku)}`;
      const sizeTxt = a.size ? `size ${esc(a.size)}` : `${rows.length} size${rows.length === 1 ? '' : 's'}`;
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
        body: JSON.stringify({
          sender: { name: 'NSA Catalog', email: 'noreply@nationalsportsapparel.com' },
          to: [{ email: a.email }],
          subject: `Back in stock: ${label}`,
          htmlContent: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto">
              <div style="background:#191919;color:white;padding:18px 22px;border-radius:8px 8px 0 0">
                <h2 style="margin:0;font-size:17px">It's back in stock</h2>
              </div>
              <div style="background:white;padding:20px 22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
                <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 14px">
                  <strong>${esc(label)}</strong> (${esc(a.sku)}) now has ${sizeTxt} available
                  in the adidas warehouse${a.size ? ` (${hit.stock_qty} units)` : ''}.
                </p>
                <a href="${esc(link)}" style="display:inline-block;background:#191919;color:#fff;border-radius:8px;padding:11px 22px;font-weight:700;text-decoration:none;font-size:14px">View it in the catalog</a>
                <p style="font-size:12px;color:#94a3b8;margin-top:16px">Quantities change daily and aren't guaranteed until ordered. This is a one-time alert you signed up for on the National Sports Apparel catalog.</p>
              </div>
            </div>`,
        }),
      });
      if (res.ok) {
        sent++;
        await sb(`catalog_stock_alerts?id=eq.${a.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: false, notified_at: new Date().toISOString() }),
        }).catch(() => {});
      } else {
        console.error('[stock-alert-check] Brevo error for', a.id, res.status, await res.text());
      }
    }
    console.log(`[stock-alert-check] ${alerts.length} active alerts, ${sent} notified`);
    return { statusCode: 200, body: `Notified ${sent}` };
  } catch (e) {
    console.error('[stock-alert-check]', e);
    return { statusCode: 500, body: e.message };
  }
};
