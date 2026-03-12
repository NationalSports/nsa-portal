// Netlify function: receives coach roster submission and emails CSV to rep via Brevo
exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const { rep_email, rep_name, so, sku, item, coach_name, csv } = body;
    if (!rep_email || !csv) {
      console.log('Missing fields - rep_email:', !!rep_email, 'csv:', !!csv, 'keys:', Object.keys(body));
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Missing required fields: ' + (!rep_email ? 'rep_email ' : '') + (!csv ? 'csv' : '') }) };
    }

    const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
    if (!brevoKey) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: 'Email not configured' }) };

    // Count numbers in CSV
    const lines = csv.split('\n').filter(l => l.trim() && !l.toLowerCase().startsWith('size'));
    const filledCount = lines.filter(l => { const parts = l.split(','); return parts[1] && parts[1].trim(); }).length;

    // Build email HTML
    const htmlContent = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;padding:20px;border-radius:8px 8px 0 0;text-align:center">
          <h2 style="margin:0;font-size:18px">🏈 Roster Submitted by ${coach_name || 'Coach'}</h2>
        </div>
        <div style="background:white;padding:20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
          <p style="color:#475569;font-size:14px;margin-bottom:12px">
            <strong>${coach_name || 'Coach'}</strong> has submitted a roster for:
          </p>
          <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px">
            <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;color:#64748b;width:100px">Order</td><td style="padding:6px 12px">${so || 'N/A'}</td></tr>
            <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;color:#64748b">SKU</td><td style="padding:6px 12px">${sku || 'N/A'}</td></tr>
            <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;color:#64748b">Item</td><td style="padding:6px 12px">${item || 'N/A'}</td></tr>
            <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;color:#64748b">Numbers</td><td style="padding:6px 12px">${filledCount} assigned</td></tr>
          </table>
          <p style="color:#475569;font-size:13px">The roster CSV is attached. Use <strong>Upload Roster</strong> on the numbers decoration to import it.</p>
        </div>
      </div>`;

    // Send via Brevo with CSV attachment
    const csvBase64 = Buffer.from(csv).toString('base64');
    const fileName = `roster_${(so || 'order').replace(/[^a-zA-Z0-9-]/g, '_')}_${(sku || 'item').replace(/[^a-zA-Z0-9-]/g, '_')}.csv`;

    const payload = {
      sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
      to: [{ email: rep_email, name: rep_name || rep_email }],
      subject: `Roster submitted by ${coach_name || 'Coach'} — ${so || 'Order'} / ${sku || 'Item'}`,
      htmlContent,
      attachment: [{ content: csvBase64, name: fileName }]
    };

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (!res.ok) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: result.message || 'Send failed' }) };

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
