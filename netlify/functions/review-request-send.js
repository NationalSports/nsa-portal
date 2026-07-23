// Review-request email — the Marketing Command Center's "ask a happy customer
// for a Google review" send. Reps/Steve pick the customer on the /marketing
// page right when an order ships; this sends a short, warm, NSA-branded email
// with one big button to the review page.
//
// Guardrails:
//  - Staff-gated (verifyUser) — this emails a real customer.
//  - 90-day repeat guard per address (logged in marketing_history under
//    source 'review_request'); pass {force:true} to override deliberately.
//  - Review link: GOOGLE_REVIEW_URL env var if set (the direct
//    search.google.com/local/writereview?placeid=... link once NSA_PLACE_ID
//    exists), else the site's review funnel page. One env var flips every
//    future send to the direct link — no redeploy of content needed.
//
// Send log rows double as the dashboard's "recent requests" list:
//   marketing_history(source='review_request', data:{to,coachName,orderRef,sentBy})
const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');

const REVIEW_URL_FALLBACK = 'https://nationalsportsapparel.com/review.html';
const REPEAT_GUARD_DAYS = 90;

const NAVY = '#192853';
const RED = '#962C32';

function buildEmailHtml({ coachName, repName, orderRef, reviewUrl }) {
  const hi = coachName ? `Hi ${coachName},` : 'Hi Coach,';
  const orderLine = orderRef
    ? `Your order <strong style="color:${NAVY};">${orderRef}</strong> is on its way — we hope the team loves it.`
    : `Your order is on its way — we hope the team loves it.`;
  const signoff = repName || 'The National Sports Apparel team';
  // Email-client-safe: table layout, inline styles, system font fallbacks
  // (webfonts are stripped by most clients), absolute URLs only.
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(15,23,42,.08);">
        <tr>
          <td style="background-color:${NAVY};padding:28px 32px;text-align:center;">
            <div style="font-family:Arial Black,Arial,Helvetica,sans-serif;font-size:22px;font-weight:900;letter-spacing:.5px;color:#ffffff;text-transform:uppercase;">National Sports Apparel</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#c7d2fe;letter-spacing:2px;text-transform:uppercase;margin-top:6px;">California's Largest Independent Team Dealer</div>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px 8px;font-family:Arial,Helvetica,sans-serif;color:#334155;font-size:15px;line-height:1.65;">
            <p style="margin:0 0 14px;">${hi}</p>
            <p style="margin:0 0 14px;">${orderLine}</p>
            <p style="margin:0 0 14px;">We're a family-run shop, and reviews from coaches like you are how other programs find us. If we earned it, would you take 60 seconds to share your experience?</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:12px 40px 8px;">
            <div style="font-size:26px;letter-spacing:4px;color:#f59e0b;line-height:1;">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:14px 40px 6px;">
            <a href="${reviewUrl}" target="_blank"
               style="display:inline-block;background-color:${RED};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;text-decoration:none;padding:15px 42px;border-radius:8px;">
              Leave us a review
            </a>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:6px 40px 26px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#94a3b8;">
            Takes about a minute — every review helps a local team find their dealer.
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 30px;font-family:Arial,Helvetica,sans-serif;color:#334155;font-size:15px;line-height:1.65;">
            <p style="margin:0;">Thanks for being part of our team,<br><strong style="color:${NAVY};">${signoff}</strong></p>
          </td>
        </tr>
        <tr>
          <td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 32px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#94a3b8;line-height:1.7;">
            National Sports Apparel &bull; Orange, CA<br>
            <a href="tel:+17142798777" style="color:#64748b;text-decoration:none;">(714) 279-8777</a> &bull;
            <a href="mailto:hello@nationalsportsapparel.com" style="color:#64748b;text-decoration:none;">hello@nationalsportsapparel.com</a><br>
            <a href="https://nationalsportsapparel.com" style="color:#64748b;">nationalsportsapparel.com</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const auth = await verifyUser(event);
  if (!auth.ok) return { statusCode: auth.status, headers, body: JSON.stringify({ error: auth.error }) };

  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, reason: 'missing_api_key' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { /* ignore */ }
  const to = String(body.to || '').trim().toLowerCase();
  const coachName = String(body.coachName || '').trim().slice(0, 80);
  const repName = String(body.repName || '').trim().slice(0, 80);
  const orderRef = String(body.orderRef || '').trim().slice(0, 40);
  const force = !!body.force;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'valid "to" email required' }) };
  }

  const admin = getSupabaseAdmin();

  // Repeat guard: same address asked within the window → refuse unless forced.
  if (!force) {
    const cutoff = new Date(Date.now() - REPEAT_GUARD_DAYS * 24 * 3600 * 1000).toISOString();
    const { data: prior, error: gErr } = await admin
      .from('marketing_history')
      .select('id, fetched_at')
      .eq('source', 'review_request')
      .gte('fetched_at', cutoff)
      .contains('data', { to })
      .limit(1);
    if (gErr) console.warn('[review-request-send] repeat-guard query failed (send continues):', gErr.message);
    if (prior && prior.length) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: false, reason: 'recently_sent', lastSent: prior[0].fetched_at }),
      };
    }
  }

  const reviewUrl = process.env.GOOGLE_REVIEW_URL || REVIEW_URL_FALLBACK;
  const html = buildEmailHtml({ coachName, repName, orderRef, reviewUrl });

  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: repName ? `${repName} — National Sports Apparel` : 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
      replyTo: { email: 'hello@nationalsportsapparel.com', name: 'National Sports Apparel' },
      to: [{ email: to, name: coachName || undefined }],
      subject: coachName ? `${coachName}, how did we do?` : 'How did we do?',
      htmlContent: html,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    console.error('[review-request-send] Brevo send failed:', t.slice(0, 300));
    return { statusCode: 502, headers, body: JSON.stringify({ ok: false, error: 'Email send failed' }) };
  }

  // Log the send — feeds the dashboard's recent-requests list + the repeat guard.
  const { error: logErr } = await admin.from('marketing_history').insert({
    source: 'review_request',
    data: { to, coachName, orderRef, sentBy: repName || auth.userId },
  });
  if (logErr) console.warn('[review-request-send] send log failed:', logErr.message);

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};
