// AI draft of a Google-review reply for the Marketing Command Center.
//
// Steve reviews/edits every draft before posting — nothing auto-posts. The
// "Draft with AI" button on a review calls this; the returned text fills an
// editable reply box whose Post button calls marketing-gbp-reply.
//
// Same shape as ai-clean-description: staff-gated, ANTHROPIC_API_KEY (already
// configured in Netlify), graceful no-op without the key. Sonnet rather than
// Haiku — these are short but customer-facing, posted publicly under the
// business's name.
const { corsHeaders, verifyUser } = require('./_shared');

const MODEL = process.env.MARKETING_REPLY_MODEL || 'claude-sonnet-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const SYSTEM = [
  'You draft replies to Google reviews on behalf of National Sports Apparel (NSA), a family-run team sports apparel dealer in Orange, California serving school and club programs.',
  'Voice: warm, professional, coach-to-coach. Concise — 2 to 4 sentences. Sign off exactly: "— The National Sports Apparel team".',
  'Positive reviews: thank them specifically, reference something they actually mentioned, invite them back.',
  'Negative or critical reviews: acknowledge the experience, apologize sincerely, and take it offline with a real contact: "please reach us at (714) 279-8777 or hello@nationalsportsapparel.com so we can make it right". Never argue, never make excuses.',
  'Never fabricate facts, names, order details, discounts, or promises. Never offer compensation. Keep it truthful and human.',
  'Output ONLY the reply text, plain text, no quotes, no preamble.',
].join('\n');

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const auth = await verifyUser(event);
  if (!auth.ok) return { statusCode: auth.status, headers, body: JSON.stringify({ error: auth.error }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, reason: 'missing_api_key' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { /* ignore */ }
  const reviewText = String(body.reviewText || '').trim().slice(0, 4000);
  const starRating = Number(body.starRating) || null;
  const reviewerName = String(body.reviewerName || '').trim().slice(0, 120);
  if (!reviewText && !starRating) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'reviewText or starRating required' }) };
  }

  const user = [
    'Draft a reply to this Google review.',
    'Reviewer: ' + (reviewerName || '(name not shown)'),
    'Stars: ' + (starRating ? starRating + '/5' : '(not shown)'),
    'Review text:',
    reviewText || '(no text — star rating only)',
  ].join('\n');

  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error('anthropic ' + resp.status + ' ' + t.slice(0, 200));
    }
    const data = await resp.json();
    const draft = (data.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();
    if (!draft) throw new Error('empty draft');
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, draft }) };
  } catch (e) {
    console.error('[marketing-draft-reply]', e.message);
    return { statusCode: 502, headers, body: JSON.stringify({ ok: false, error: String(e.message || e).slice(0, 300) }) };
  }
};
