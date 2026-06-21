// Momentec image verifier.
//
// The Momentec catalog sync (momentec-sync-background) derives each product's
// image_front_url / image_back_url straight from the SKU
// (https://static.momentecbrands.com/product/{dz}_{color}_front.jpg) WITHOUT
// checking the file exists. The Momentec CDN only has photos for a subset of
// styles — roughly 40% of the rows point at objects that return HTTP 403
// (S3 "AccessDenied"/NoSuchKey). Those non-null-but-dead URLs render as broken
// images and, worse, defeat every "no image" guard in the app: the Featured
// Styles editor counts them as having an image, and the LiveLook catalog's
// imageless-hide treats them as imaged and shows a "coming soon" card.
//
// This function probes every Momentec product image and NULLs the ones that are
// missing, so image_front_url is truthy only when a real photo exists. It runs
// daily right after the sync (momentec-image-verify-cron) and is idempotent —
// already-nulled rows drop out of the working set, and if Momentec later adds a
// photo the next sync re-derives the URL and this keeps it (200 ⇒ left alone).
//
// Trigger manually:  POST /.netlify/functions/momentec-image-verify-background
// Optional query:    ?brand=Momentec&concurrency=40

const IMG_HOST = 'static.momentecbrands.com';

exports.handler = async (event) => {
  const qs = (event && event.queryStringParameters) || {};
  const brand = qs.brand || 'Momentec';
  const CONC = Math.min(60, Math.max(1, parseInt(qs.concurrency, 10) || 40));
  const PAGE = 1000;
  const TIME_BUDGET_MS = 13 * 60 * 1000; // background fns get ~15 min

  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) {
    console.error('[momentec-image-verify] missing REACT_APP_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return { statusCode: 500, body: 'Not configured' };
  }
  const sb = (path, init) => fetch(sbUrl + '/rest/v1/' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: 'Bearer ' + sbKey, ...(init && init.headers) },
  });

  // Probe one image. A ranged GET avoids downloading the whole JPEG: live
  // objects answer 200/206, missing ones 403/404. Anything else (timeout, 5xx,
  // 429) is "unknown" — we leave those rows untouched rather than risk nulling a
  // good image because the CDN hiccuped.
  const probe = async (url) => {
    try {
      const res = await fetch(encodeURI(url), { method: 'GET', headers: { Range: 'bytes=0-0' } });
      return res.status;
    } catch (e) {
      return 0;
    }
  };

  const t0 = Date.now();
  let last = '';
  let scanned = 0, dead = 0, kept = 0, unknown = 0, pages = 0;

  for (;;) {
    if (Date.now() - t0 > TIME_BUDGET_MS) { console.warn('[momentec-image-verify] time budget reached'); break; }
    // Keyset pagination by id so nulling rows mid-run can't shift an offset and
    // skip records — already-cleared rows leave the not-null filter behind us.
    let path = `products?select=id,image_front_url&brand=eq.${encodeURIComponent(brand)}&is_active=eq.true&image_front_url=not.is.null&order=id.asc&limit=${PAGE}`;
    if (last) path += `&id=gt.${encodeURIComponent(last)}`;
    const r = await sb(path);
    if (!r.ok) { console.error('[momentec-image-verify] select', r.status, (await r.text()).slice(0, 200)); break; }
    const rows = await r.json();
    if (!rows.length) break;
    pages++;
    last = rows[rows.length - 1].id;

    const deadIds = [];
    for (let i = 0; i < rows.length; i += CONC) {
      const chunk = rows.slice(i, i + CONC);
      const codes = await Promise.all(chunk.map((x) => probe(x.image_front_url)));
      codes.forEach((c, j) => {
        scanned++;
        if (c === 403 || c === 404) { deadIds.push(chunk[j].id); dead++; }
        else if (c === 200 || c === 206) kept++;
        else unknown++;
      });
    }

    // Clear the whole image set for missing styles (a missing front means the
    // SKU's photo set isn't on the CDN; the back is gone too).
    for (let i = 0; i < deadIds.length; i += 200) {
      const ids = deadIds.slice(i, i + 200).map((id) => encodeURIComponent(id)).join(',');
      const u = await sb(`products?id=in.(${ids})`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ image_front_url: null, image_back_url: null }),
      });
      if (!u.ok) console.error('[momentec-image-verify] patch', u.status, (await u.text()).slice(0, 200));
    }
    if (rows.length < PAGE) break;
  }

  const summary = { host: IMG_HOST, brand, pages, scanned, dead_cleared: dead, kept, unknown_left: unknown, seconds: Math.round((Date.now() - t0) / 1000) };
  console.log('[momentec-image-verify] done', JSON.stringify(summary));
  return { statusCode: 200, body: JSON.stringify(summary) };
};
