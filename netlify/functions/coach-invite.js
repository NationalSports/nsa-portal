// Netlify function: emails a coach their catalog invite when staff create a
// coach account in the portal. Sends via Brevo; the coach clicks through to
// /adidas and signs in with the magic link (their email is pre-filled).
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const email = String(body.email || '').trim();
    const name = String(body.name || '').trim();
    const team = String(body.team || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Valid email required' }) };
    }
    const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
    if (!brevoKey) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, emailed: false, error: 'Email not configured' }) };

    const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
    const link = `${portal}/adidas?signin=${encodeURIComponent(email)}`;
    const hello = name ? `Hi ${esc(name.split(' ')[0])},` : 'Hi Coach,';

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify({
        sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
        to: [{ email, name: name || email }],
        subject: 'Your National Sports Apparel team catalog access',
        htmlContent: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto">
            <div style="background:#191919;color:white;padding:20px 22px;border-radius:8px 8px 0 0">
              <h2 style="margin:0;font-size:18px">Your adidas team catalog is ready</h2>
            </div>
            <div style="background:white;padding:22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
              <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 14px">
                ${hello}
              </p>
              <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 16px">
                National Sports Apparel set up your access to our live adidas team catalog${team ? ` for <strong>${esc(team)}</strong>` : ''}.
                You'll see real-time availability, build orders by size, and — because you're signed in — <strong>your team's pricing</strong>.
              </p>
              <a href="${esc(link)}" style="display:inline-block;background:#191919;color:#fff;border-radius:8px;padding:12px 26px;font-weight:700;text-decoration:none;font-size:15px">Open my catalog &amp; sign in</a>
              <p style="font-size:12.5px;color:#64748b;line-height:1.6;margin:18px 0 0">
                Tap the button, then "Coach sign in" — we'll email you a one-tap link (no password to remember).
                Sign in with this same address (<strong>${esc(email)}</strong>) so we recognize you.
              </p>
              <p style="font-size:11.5px;color:#94a3b8;margin-top:16px">Questions? Just reply to this email and your rep will help.</p>
            </div>
          </div>`,
      }),
    });
    if (!res.ok) {
      console.error('[coach-invite] Brevo error:', res.status, await res.text());
      return { statusCode: 200, headers, body: JSON.stringify({ ok: false, emailed: false, error: 'Send failed' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, emailed: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
