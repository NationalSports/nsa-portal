// Post (or update) the business's reply to a Google review — the write half
// of the Marketing Command Center's Reviews panel.
//
// PENDING SECRETS: requires the Google Business Profile OAuth trio
// (GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN — see
// docs/MARKETING_DASHBOARD.md for the one-time consent setup). Until those
// are set this returns {ok:false, reason:'missing_key'} and the UI keeps the
// Reply button disabled. Google requires a real profile owner/manager OAuth
// for review replies — a service account does not work.
//
// This is an OUTWARD-FACING write (the reply is public on Google under the
// business's name), so it is deliberately human-in-the-loop only: the UI
// posts exactly the text Steve confirmed in the reply box. Staff-gated; no
// internal/cron path — nothing replies automatically.
const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');

async function gbpAccessToken() {
  const params = new URLSearchParams({
    client_id: process.env.GBP_CLIENT_ID,
    client_secret: process.env.GBP_CLIENT_SECRET,
    refresh_token: process.env.GBP_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error('gbp token ' + res.status);
  const data = await res.json();
  if (!data.access_token) throw new Error('gbp token: no access_token');
  return data.access_token;
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const auth = await verifyUser(event);
  if (!auth.ok) return { statusCode: auth.status, headers, body: JSON.stringify({ error: auth.error }) };

  if (!process.env.GBP_CLIENT_ID || !process.env.GBP_CLIENT_SECRET || !process.env.GBP_REFRESH_TOKEN) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, reason: 'missing_key' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { /* ignore */ }
  // reviewName is the full GBP resource name captured by marketing-sync
  // (accounts/{a}/locations/{l}/reviews/{r}) — validate the shape so this
  // endpoint can only ever write review replies, nothing else.
  const reviewName = String(body.reviewName || '').trim();
  const text = String(body.text || '').trim();
  if (!/^accounts\/[^/]+\/locations\/[^/]+\/reviews\/[^/]+$/.test(reviewName)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid reviewName' }) };
  }
  if (!text || text.length > 4000) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'reply text required (max 4000 chars)' }) };
  }

  try {
    const token = await gbpAccessToken();
    const res = await fetch('https://mybusiness.googleapis.com/v4/' + reviewName + '/reply', {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ comment: text }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('gbp reply ' + res.status + ' ' + t.slice(0, 200));
    }
    // Reflect the reply into the stored snapshot so the UI is consistent on
    // refetch without waiting for the next daily sync. Best-effort — the
    // reply itself already succeeded on Google.
    try {
      const admin = getSupabaseAdmin();
      const { data: row } = await admin.from('marketing_data').select('data').eq('source', 'google').maybeSingle();
      if (row && row.data && Array.isArray(row.data.reviews)) {
        const reviews = row.data.reviews.map((r) => r.id === reviewName
          ? { ...r, reply: { text, updateTime: new Date().toISOString() } }
          : r);
        await admin.from('marketing_data')
          .update({ data: { ...row.data, reviews } })
          .eq('source', 'google');
      }
    } catch (e) { console.warn('[marketing-gbp-reply] snapshot update failed:', e.message); }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('[marketing-gbp-reply]', e.message);
    return { statusCode: 502, headers, body: JSON.stringify({ ok: false, error: String(e.message || e).slice(0, 300) }) };
  }
};
