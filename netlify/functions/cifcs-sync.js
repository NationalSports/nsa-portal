// Staff-triggered sync of the CIFCS public school directory into marketing_contacts.
//
//   POST/GET /.netlify/functions/cifcs-sync?section_id=<n>[&offset=<i>][&limit=<k>]
//
// Staff JWT required (verifyUser). Processes ONE batch of schools per call so each
// invocation stays under Netlify's sync timeout — the UI loops, advancing `offset`
// by the returned `nextOffset` until `done`. Read-only against CIFCS; the only
// table written is marketing_contacts (upsert, idempotent on source+source_ref).
// Nothing is emailed here — this is Phase 1 (ingest only).
//
// cifcshome.org sits behind CloudFront + a Laravel origin that sets an XSRF/session
// cookie and intermittently 405s bot-like requests from datacenter IPs (works fine
// from a browser, fails from serverless). So each call mimics a real browser
// session: a Chrome UA + Accept/Referer headers, the cookie the directory page
// hands out forwarded onto the /details XHRs, and transient blocks (403/405/429/5xx)
// retried with backoff.

const { verifyUser, getSupabaseAdmin, corsHeaders } = require('./_shared');
const cifcs = require('../../src/lib/cifcs');

const DEFAULT_LIMIT = 10;   // schools per call; keeps a batch comfortably under the timeout
const MAX_LIMIT = 40;
const FETCH_TIMEOUT_MS = 15000;
const POLITE_DELAY_MS = 200; // be gentle on the origin between schools
const MAX_RETRIES = 3;
const TRANSIENT = new Set([403, 405, 408, 425, 429, 500, 502, 503, 504]);
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function headersFor({ json, referer, cookie }) {
  const h = {
    'user-agent': BROWSER_UA,
    accept: json ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
  };
  if (json) h['x-requested-with'] = 'XMLHttpRequest';
  if (referer) h.referer = referer;
  if (cookie) h.cookie = cookie;
  return h;
}

async function rawGet(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { method: 'GET', redirect: 'follow', headers: headersFor(opts), signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// GET with retry/backoff on transient blocks. Returns an un-consumed ok Response, or throws.
async function getWithRetry(url, opts) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt) await sleep(400 * Math.pow(2, attempt - 1)); // 400, 800, 1600ms
    try {
      const res = await rawGet(url, opts);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
      try { await res.text(); } catch (_) { /* drain the failed body */ }
      if (!TRANSIENT.has(res.status)) throw lastErr;
    } catch (e) {
      lastErr = e.name === 'AbortError' ? new Error('timeout') : e;
    }
  }
  throw lastErr;
}

function extractCookies(res) {
  try {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    const jar = list.length ? list : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    return jar.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  } catch (_) {
    return '';
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  const v = await verifyUser(event);
  if (!v.ok) {
    return { statusCode: v.status, headers: corsHeaders(), body: JSON.stringify({ error: v.error }) };
  }

  const qs = event.queryStringParameters || {};
  const sectionId = parseInt(qs.section_id, 10);
  const sectionNm = cifcs.sectionName(sectionId);
  if (!sectionId || !sectionNm) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Unknown or missing section_id' }) };
  }
  const offset = Math.max(0, parseInt(qs.offset, 10) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(qs.limit, 10) || DEFAULT_LIMIT));

  let admin;
  try { admin = getSupabaseAdmin(); }
  catch (e) { return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: e.message }) }; }

  const dirUrl = cifcs.directoryUrl(sectionId);
  try {
    // 1. Directory page → school list + a fresh XSRF/session cookie for the XHRs.
    const dirRes = await getWithRetry(dirUrl, { json: false });
    const cookie = extractCookies(dirRes);
    const html = await dirRes.text();
    const schools = cifcs.parseSchoolListFromHtml(html);
    const total = schools.length;
    const slice = schools.slice(offset, offset + limit);

    let contactsUpserted = 0;
    let schoolsWithData = 0;
    const errors = [];

    // 2. For each school in this batch: fetch details (as the widget would) → normalize → upsert.
    for (const s of slice) {
      try {
        const res = await getWithRetry(cifcs.schoolDetailUrl(s.id), { json: true, referer: dirUrl, cookie });
        const detail = await res.json();
        const rows = cifcs.normalizeSchoolDetail(detail, { sectionId, sectionName: sectionNm, schoolId: s.id });
        if (rows.length) {
          const nowIso = new Date().toISOString();
          const payload = rows.map((r) => ({ ...r, last_synced_at: nowIso }));
          const { error } = await admin
            .from('marketing_contacts')
            .upsert(payload, { onConflict: 'source,source_ref' });
          if (error) throw new Error(error.message);
          contactsUpserted += rows.length;
          schoolsWithData++;
        }
      } catch (e) {
        errors.push(`${s.name || 'school'} (#${s.id}): ${e.message}`);
      }
      await sleep(POLITE_DELAY_MS);
    }

    const processedThrough = offset + slice.length;
    const done = processedThrough >= total;

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        section_id: sectionId,
        section_name: sectionNm,
        total,
        offset,
        batch: slice.length,
        nextOffset: done ? null : processedThrough,
        done,
        schoolsWithData,
        contactsUpserted,
        errorCount: errors.length,
        errors: errors.slice(0, 20),
      }),
    };
  } catch (e) {
    // Only the directory fetch reaches here (per-school errors are collected above).
    return {
      statusCode: 502,
      headers: corsHeaders(),
      body: JSON.stringify({ error: `CIFCS directory fetch failed: ${e.message}`, retriable: true }),
    };
  }
};
