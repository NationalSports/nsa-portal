// Marketing Command Center sync — pulls each online-presence source into
// Supabase (marketing_data snapshot + marketing_history append), for the
// portal /marketing page to read.
//
// Sources (each independent; one failing never blocks the others):
//   seo    — nsa-website's public seo/data.json (the weekly SEO-autopilot
//            output; that pipeline is the source of truth — we only read it).
//   brevo  — recent email campaigns + open/click rollup (BREVO_API_KEY,
//            already configured for the transactional senders).
//   yelp   — rating + recent reviews (YELP_API_KEY + YELP_BUSINESS_ID).
//   google — reviews. Full path: Google Business Profile OAuth (GBP_CLIENT_ID
//            /GBP_CLIENT_SECRET/GBP_REFRESH_TOKEN) → all reviews with reply
//            state + review ids the Reply button needs. Fallback fast path:
//            Places API (GOOGLE_PLACES_API_KEY + NSA_PLACE_ID) → rating,
//            count, up to 5 recent reviews, read-only.
//
// A source whose credentials aren't set reports {skipped:'missing_key'} — the
// UI shows "awaiting setup" for it. Nothing here throws for a missing key, so
// this runs safely from day one with only the seo + brevo sources live.
//
// Invocation: staff (portal "Sync now" button, bearer JWT) or internal
// (marketing-sync-cron scheduled wrapper, x-internal-secret) — same
// verifyUserOrInternal gate the vendor sync proxies use. Optional body
// {sources:['seo',...]} limits the run to named sources.
const { corsHeaders, getSupabaseAdmin, verifyUserOrInternal } = require('./_shared');

const SEO_DATA_URL = 'https://nationalsportsapparel.com/seo/data.json';

async function fetchJson(url, opts, label) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(label + ' ' + res.status + ' ' + t.slice(0, 180));
  }
  return res.json();
}

// ── seo ── no credentials; verbatim copy of the autopilot's data.json.
async function syncSeo() {
  const data = await fetchJson(SEO_DATA_URL + '?t=' + Date.now(), {}, 'seo data.json');
  if (!data || typeof data !== 'object' || !data.audit) throw new Error('seo data.json: unexpected shape');
  return data;
}

// ── brevo ── recent campaigns + a rollup. Transactional senders elsewhere in
// this repo already use BREVO_API_KEY, so no new credential is needed.
async function syncBrevo() {
  const key = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!key) return { skipped: 'missing_key' };
  const resp = await fetchJson(
    'https://api.brevo.com/v3/emailCampaigns?statistics=globalStats&status=sent&limit=10&sort=desc',
    { headers: { 'api-key': key, accept: 'application/json' } },
    'brevo campaigns'
  );
  const campaigns = (resp.campaigns || []).map((c) => {
    const g = (c.statistics && c.statistics.globalStats) || {};
    const sent = Number(g.sent) || 0;
    const delivered = Number(g.delivered) || 0;
    const uniqueOpens = Number(g.uniqueViews) || 0;
    const uniqueClicks = Number(g.uniqueClicks) || 0;
    return {
      id: c.id,
      name: c.name || '',
      subject: c.subject || '',
      sentDate: c.sentDate || '',
      stats: {
        sent,
        delivered,
        uniqueOpens,
        opens: Number(g.viewed) || 0,
        uniqueClicks,
        clicks: Number(g.clickers) || 0,
        bounces: (Number(g.softBounces) || 0) + (Number(g.hardBounces) || 0),
        unsubscriptions: Number(g.unsubscriptions) || 0,
        openRate: delivered ? Math.round((uniqueOpens / delivered) * 1000) / 10 : 0,
        clickRate: delivered ? Math.round((uniqueClicks / delivered) * 1000) / 10 : 0,
      },
    };
  });
  const ninetyDaysAgo = Date.now() - 90 * 24 * 3600 * 1000;
  const recent = campaigns.filter((c) => c.sentDate && new Date(c.sentDate).getTime() >= ninetyDaysAgo);
  const withDelivery = recent.filter((c) => c.stats.delivered > 0);
  const avg = (arr, f) => (arr.length ? Math.round((arr.reduce((a, c) => a + f(c), 0) / arr.length) * 10) / 10 : 0);
  return {
    campaigns,
    rollup: {
      count90d: recent.length,
      sent90d: recent.reduce((a, c) => a + c.stats.sent, 0),
      avgOpenRate: avg(withDelivery, (c) => c.stats.openRate),
      avgClickRate: avg(withDelivery, (c) => c.stats.clickRate),
    },
  };
}

// ── yelp ── rating + recent reviews via Yelp Fusion.
async function syncYelp() {
  const key = process.env.YELP_API_KEY;
  const biz = process.env.YELP_BUSINESS_ID;
  if (!key || !biz) return { skipped: 'missing_key' };
  const headers = { Authorization: 'Bearer ' + key, accept: 'application/json' };
  const base = 'https://api.yelp.com/v3/businesses/' + encodeURIComponent(biz);
  const info = await fetchJson(base, { headers }, 'yelp business');
  let reviews = [];
  try {
    const rv = await fetchJson(base + '/reviews?limit=3&sort_by=newest', { headers }, 'yelp reviews');
    reviews = (rv.reviews || []).map((r) => ({
      text: r.text || '',
      rating: r.rating,
      user: (r.user && r.user.name) || '',
      time_created: r.time_created || '',
      url: r.url || '',
    }));
  } catch (e) {
    // Reviews endpoint needs a paid/approved tier on some accounts — rating
    // + count alone are still worth showing.
    console.warn('[marketing-sync] yelp reviews unavailable:', e.message);
  }
  return { rating: info.rating, review_count: info.review_count, url: info.url || '', reviews };
}

// ── google ── GBP OAuth full path when configured, else Places read-only.
async function gbpAccessToken() {
  const params = new URLSearchParams({
    client_id: process.env.GBP_CLIENT_ID,
    client_secret: process.env.GBP_CLIENT_SECRET,
    refresh_token: process.env.GBP_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const data = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  }, 'gbp token');
  if (!data.access_token) throw new Error('gbp token: no access_token');
  return data.access_token;
}

const GBP_STARS = { STAR_RATING_UNSPECIFIED: null, ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

async function syncGoogleGbp() {
  const token = await gbpAccessToken();
  const auth = { headers: { Authorization: 'Bearer ' + token } };
  const accounts = await fetchJson('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', auth, 'gbp accounts');
  const account = (accounts.accounts || [])[0];
  if (!account) throw new Error('gbp: no accounts visible to this token');
  const locs = await fetchJson(
    'https://mybusinessbusinessinformation.googleapis.com/v1/' + account.name + '/locations?readMask=name,title',
    auth, 'gbp locations'
  );
  const location = (locs.locations || [])[0];
  if (!location) throw new Error('gbp: no locations on account ' + account.name);
  // Reviews still live on the v4 My Business API: accounts/{id}/locations/{id}/reviews
  const path = account.name + '/' + location.name;
  const rv = await fetchJson('https://mybusiness.googleapis.com/v4/' + path + '/reviews', auth, 'gbp reviews');
  const reviews = (rv.reviews || []).map((r) => ({
    id: r.name || '', // full resource name — what gbp-reply needs
    author: (r.reviewer && r.reviewer.displayName) || 'Anonymous',
    stars: GBP_STARS[r.starRating] ?? null,
    text: r.comment || '',
    createTime: r.createTime || '',
    reply: r.reviewReply ? { text: r.reviewReply.comment || '', updateTime: r.reviewReply.updateTime || '' } : null,
  }));
  return {
    provider: 'gbp',
    canReply: true,
    rating: rv.averageRating ?? null,
    total: rv.totalReviewCount ?? reviews.length,
    reviews,
  };
}

async function syncGooglePlaces() {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.NSA_PLACE_ID;
  if (!key || !placeId) return { skipped: 'missing_key' };
  const url = 'https://maps.googleapis.com/maps/api/place/details/json?place_id='
    + encodeURIComponent(placeId) + '&fields=rating,user_ratings_total,reviews,url&key=' + key;
  const data = await fetchJson(url, {}, 'places details');
  if (data.status !== 'OK') throw new Error('places: ' + data.status + ' ' + (data.error_message || ''));
  const r = data.result || {};
  return {
    provider: 'places',
    canReply: false,
    rating: r.rating ?? null,
    total: r.user_ratings_total ?? null,
    url: r.url || '',
    reviews: (r.reviews || []).map((v) => ({
      id: '', // Places reviews carry no GBP resource name — no reply possible
      author: v.author_name || 'Anonymous',
      stars: v.rating ?? null,
      text: v.text || '',
      createTime: v.time ? new Date(v.time * 1000).toISOString() : '',
      reply: null,
    })),
  };
}

async function syncGoogle() {
  if (process.env.GBP_CLIENT_ID && process.env.GBP_CLIENT_SECRET && process.env.GBP_REFRESH_TOKEN) {
    return syncGoogleGbp();
  }
  return syncGooglePlaces();
}

const SOURCES = { seo: syncSeo, brevo: syncBrevo, yelp: syncYelp, google: syncGoogle };

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const auth = await verifyUserOrInternal(event);
  if (!auth.ok) return { statusCode: auth.status, headers, body: JSON.stringify({ error: auth.error }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { /* ignore */ }
  const wanted = Array.isArray(body.sources) && body.sources.length
    ? body.sources.filter((s) => SOURCES[s])
    : Object.keys(SOURCES);

  const admin = getSupabaseAdmin();
  const results = {};
  for (const source of wanted) {
    try {
      const data = await SOURCES[source]();
      if (data && data.skipped) { results[source] = data; continue; }
      const fetchedAt = new Date().toISOString();
      const { error: upErr } = await admin.from('marketing_data')
        .upsert({ source, data, fetched_at: fetchedAt }, { onConflict: 'source' });
      if (upErr) throw new Error('upsert: ' + upErr.message);
      // History is best-effort — the snapshot row is the load-bearing write.
      const { error: histErr } = await admin.from('marketing_history')
        .insert({ source, data, fetched_at: fetchedAt });
      if (histErr) console.warn('[marketing-sync] history insert failed for', source, histErr.message);
      results[source] = { ok: true, fetched_at: fetchedAt };
    } catch (e) {
      console.error('[marketing-sync]', source, 'failed:', e.message);
      results[source] = { ok: false, error: String(e.message || e).slice(0, 300) };
    }
  }

  const anyOk = Object.values(results).some((r) => r.ok);
  return { statusCode: 200, headers, body: JSON.stringify({ ok: anyOk, results }) };
};
