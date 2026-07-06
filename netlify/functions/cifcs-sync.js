// Staff-triggered sync of the CIFCS public school directory into marketing_contacts.
//
//   POST/GET /.netlify/functions/cifcs-sync?section_id=<n>[&offset=<i>][&limit=<k>]
//
// Staff JWT required (verifyUser). Processes ONE batch of schools per call so each
// invocation stays well under Netlify's sync timeout — the UI loops, advancing
// `offset` by the returned `nextOffset` until `done`, showing progress. Read-only
// against CIFCS; the only table written is marketing_contacts (upsert, idempotent
// on source+source_ref). Nothing is emailed here — this is Phase 1 (ingest only).

const { verifyUser, getSupabaseAdmin, corsHeaders } = require('./_shared');
const cifcs = require('../../src/lib/cifcs');

const DEFAULT_LIMIT = 15;   // schools per call; ~0.4s each keeps a batch under ~8s
const MAX_LIMIT = 40;
const FETCH_TIMEOUT_MS = 15000;
const POLITE_DELAY_MS = 100; // be gentle on the undocumented widget
const UA = 'Mozilla/5.0 (compatible; NSA-Portal/1.0; +https://nationalsportsapparel.com)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, accept) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      // The /details endpoint is an AJAX route that 403s without this header.
      headers: { 'user-agent': UA, accept, 'x-requested-with': 'XMLHttpRequest' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return accept.includes('json') ? res.json() : res.text();
  } finally {
    clearTimeout(t);
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
    return { statusCode: 400, headers: corsHeaders(),
      body: JSON.stringify({ error: 'Unknown or missing section_id' }) };
  }
  const offset = Math.max(0, parseInt(qs.offset, 10) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(qs.limit, 10) || DEFAULT_LIMIT));

  let admin;
  try { admin = getSupabaseAdmin(); }
  catch (e) { return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: e.message }) }; }

  try {
    // 1. Enumerate the section's schools (stable within a sync; cheap to re-fetch).
    const html = await fetchWithTimeout(cifcs.directoryUrl(sectionId), 'text/html');
    const schools = cifcs.parseSchoolListFromHtml(html);
    const total = schools.length;
    const slice = schools.slice(offset, offset + limit);

    let contactsUpserted = 0;
    let schoolsWithData = 0;
    const errors = [];

    // 2. For each school in this batch: fetch details → normalize → upsert.
    for (const s of slice) {
      try {
        const detail = await fetchWithTimeout(cifcs.schoolDetailUrl(s.id), 'application/json');
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
    return { statusCode: 502, headers: corsHeaders(),
      body: JSON.stringify({ error: `CIFCS sync failed: ${e.message}` }) };
  }
};
