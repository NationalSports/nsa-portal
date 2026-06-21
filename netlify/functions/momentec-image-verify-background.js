// Momentec image verifier / corrector.
//
// The Momentec catalog sync derives each product image straight from the SKU as
// {IMG_BASE}/{dz}_{color}_front.jpg WITHOUT checking the file exists. Momentec's
// CDN is inconsistent: most apparel really is at `_front.jpg`, but a chunk of
// styles (belts/accessories like FBC73M) only exist at the plain `.jpg` URL, and
// many (sublimation "ALL-OVER PATTERN"/"ARGYLE" lines, some hard goods) have no
// photo at all — the API returns `_NoPicture.jpg` for those and the CDN answers
// HTTP 403. The blind `_front` guess therefore (a) 403s for the plain-`.jpg`
// styles and (b) leaves real-but-missing styles pointing at a broken image.
// Either way the non-null-but-dead URL defeats every "no image" guard: the
// Featured Styles "No image" count and the LiveLook imageless-hide both treat it
// as imaged and render a broken/"coming soon" card.
//
// This function fixes image_front_url to the truth, per colorway:
//   1. try {dz}_{color}_front.jpg   (most apparel)
//   2. else try {dz}_{color}.jpg    (FBC73M-style accessories)
//   3. else NULL it                 (genuinely no photo)
// Only a definitive 403/404 on BOTH candidates nulls a row; timeouts/5xx leave
// it untouched so a CDN hiccup can't wipe a good image. image_back_url follows
// the chosen front (`_back.jpg` for the _front pattern, none for plain `.jpg`).
//
// It scans every active Momentec product (not just non-null ones) so it also
// repairs rows an earlier blind pass cleared. Idempotent and self-healing — if
// Momentec later publishes a photo the next run picks it up. Runs daily right
// after the catalog sync (momentec-image-verify-cron).
//
// Trigger manually:  POST /.netlify/functions/momentec-image-verify-background
// Optional query:    ?brand=Momentec&concurrency=35

const IMG_BASE = 'https://static.momentecbrands.com/product';

exports.handler = async (event) => {
  const qs = (event && event.queryStringParameters) || {};
  const brand = qs.brand || 'Momentec';
  const CONC = Math.min(60, Math.max(1, parseInt(qs.concurrency, 10) || 35));
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

  // Candidate front-image URLs for a colorway SKU "{dz}.{color}", in priority
  // order. The CDN joins design+color with "_" (the SKU uses ".").
  const candidates = (sku) => {
    const i = String(sku || '').indexOf('.');
    if (i < 0) return [];
    const base = sku.slice(0, i) + '_' + sku.slice(i + 1); // FBC73M.NAV -> FBC73M_NAV
    return [`${IMG_BASE}/${base}_front.jpg`, `${IMG_BASE}/${base}.jpg`];
  };
  const backFor = (front) => (front && front.endsWith('_front.jpg') ? front.replace(/_front\.jpg$/, '_back.jpg') : null);

  // Ranged GET so we don't pull whole JPEGs: live objects answer 200/206,
  // missing ones 403/404. Anything else is "unknown".
  const probe = async (url) => {
    try {
      const res = await fetch(encodeURI(url), { method: 'GET', headers: { Range: 'bytes=0-0' } });
      return res.status;
    } catch (e) {
      return 0;
    }
  };

  // Resolve the correct front URL for a row. Returns:
  //   { kind: 'found', url } | { kind: 'dead' } | { kind: 'unknown' }
  const resolve = async (sku) => {
    let sawUnknown = false;
    for (const c of candidates(sku)) {
      const s = await probe(c);
      if (s === 200 || s === 206) return { kind: 'found', url: c };
      if (s === 403 || s === 404) continue;
      sawUnknown = true; // transient — don't trust a null decision
      break;
    }
    return { kind: sawUnknown ? 'unknown' : 'dead' };
  };

  const upsert = async (rows) => {
    for (let i = 0; i < rows.length; i += 500) {
      const r = await sb('products?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows.slice(i, i + 500)),
      });
      if (!r.ok) console.error('[momentec-image-verify] upsert', r.status, (await r.text()).slice(0, 200));
    }
  };

  const t0 = Date.now();
  let last = '';
  let scanned = 0, found_front = 0, found_plain = 0, nulled = 0, unknown = 0, written = 0, pages = 0;

  for (;;) {
    if (Date.now() - t0 > TIME_BUDGET_MS) { console.warn('[momentec-image-verify] time budget reached at', last); break; }
    // Keyset pagination by id so writes mid-run can't shift an offset window.
    let path = `products?select=id,sku,image_front_url&brand=eq.${encodeURIComponent(brand)}&is_active=eq.true&order=id.asc&limit=${PAGE}`;
    if (last) path += `&id=gt.${encodeURIComponent(last)}`;
    const r = await sb(path);
    if (!r.ok) { console.error('[momentec-image-verify] select', r.status, (await r.text()).slice(0, 200)); break; }
    const rows = await r.json();
    if (!rows.length) break;
    pages++;
    last = rows[rows.length - 1].id;

    const changed = [];
    for (let i = 0; i < rows.length; i += CONC) {
      const chunk = rows.slice(i, i + CONC);
      const results = await Promise.all(chunk.map((row) => resolve(row.sku)));
      results.forEach((res, j) => {
        scanned++;
        const row = chunk[j];
        const cur = row.image_front_url || null;
        if (res.kind === 'unknown') { unknown++; return; }
        const desiredFront = res.kind === 'found' ? res.url : null;
        if (res.kind === 'found') { if (res.url.endsWith('_front.jpg')) found_front++; else found_plain++; }
        else nulled++;
        if (cur !== desiredFront) {
          changed.push({ id: row.id, image_front_url: desiredFront, image_back_url: backFor(desiredFront) });
        }
      });
    }
    if (changed.length) { await upsert(changed); written += changed.length; }
    if (rows.length < PAGE) break;
  }

  const summary = { brand, pages, scanned, found_front, found_plain, nulled, unknown_left: unknown, rows_written: written, seconds: Math.round((Date.now() - t0) / 1000) };
  console.log('[momentec-image-verify] done', JSON.stringify(summary));
  return { statusCode: 200, body: JSON.stringify(summary) };
};
