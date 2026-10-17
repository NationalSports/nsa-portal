// Momentec image verifier / corrector.
//
// Momentec serves two catalog image shapes: newer records use Images.front and
// Images.back, while older records use Images.imageURL. The catalog often only
// photographs one hero color. Design-level legacy rows may use that hero image,
// but colorway rows only accept URLs that contain their own color code.
//
// Existing live URLs always win. Missing/dead fields try the SKU-derived flat
// image, then the matching catalog field. A timeout/5xx is "unknown" and leaves
// the field untouched. Runs daily after the catalog sync.
//
// Trigger manually:  POST /.netlify/functions/momentec-image-verify-background
// Optional query:    ?brand=Momentec&concurrency=35&dryRun=true&frontMissingOnly=true

const { extractCatalogImages, splitColorwaySku } = require('../_momentecCatalogImages');
const IMG_BASE = 'https://static.momentecbrands.com/product';
const V2_HOST = 'https://api.momentecbrands.com'; // /v2/Style — public catalog read

exports.handler = async (event) => {
  const qs = (event && event.queryStringParameters) || {};
  const brand = qs.brand || 'Momentec';
  const dryRun = /^(?:1|true|yes)$/i.test(String(qs.dryRun || ''));
  const frontMissingOnly = /^(?:1|true|yes)$/i.test(String(qs.frontMissingOnly || ''));
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
      // Catalog/database URLs are already encoded. Encoding them again changes
      // `%20` into `%2520` and can make a valid existing image look missing.
      const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
      return res.status;
    } catch (e) {
      return 0;
    }
  };

  // Cache the raw response by design. Image extraction remains per SKU because
  // a catalog hero photo is only safe for a colorway when its URL names that
  // exact color code.
  const designCache = new Map();
  const styleData = (design) => {
    if (designCache.has(design)) return designCache.get(design);
    const p = (async () => {
      try {
        const res = await fetch(`${V2_HOST}/v2/Style`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ productOrDesignNumber: design }),
        });
        if (!res.ok) return null;
        return await res.json();
      } catch (e) { /* fall through to null */ }
      return null;
    })();
    designCache.set(design, p);
    return p;
  };

  const isLive = (status) => status === 200 || status === 206;
  const isDead = (status) => status === 403 || status === 404;

  const resolveField = async (current, alternatives) => {
    if (current) {
      const status = await probe(current);
      if (isLive(status) || !isDead(status)) return { url: current, preserved: true, unknown: !isLive(status) };
    }
    let unknown = false;
    for (const url of alternatives.filter(Boolean)) {
      if (url === current) continue;
      const status = await probe(url);
      if (isLive(status)) return { url, preserved: false, unknown: false };
      if (!isDead(status)) unknown = true;
    }
    return { url: unknown && current ? current : null, preserved: false, unknown };
  };

  const resolve = async (row) => {
    const currentFront = row.image_front_url || null;
    const currentBack = row.image_back_url || null;
    const ownFronts = candidates(row.sku);
    let front = await resolveField(currentFront, ownFronts);
    let back = await resolveField(currentBack, front.url ? [backFor(front.url)] : []);

    if (!front.url || !back.url) {
      const { design } = splitColorwaySku(row.sku);
      const data = design ? await styleData(design) : null;
      const catalog = extractCatalogImages(data, row.sku);
      if (!front.url && !front.unknown) front = await resolveField(null, [catalog.front]);
      if (!back.url && !back.unknown) back = await resolveField(null, [catalog.back]);
    }

    const patch = {};
    if (!front.unknown && front.url !== currentFront) patch.image_front_url = front.url;
    if (!back.unknown && back.url !== currentBack) patch.image_back_url = back.url;
    return {
      patch,
      front: front.url,
      back: back.url,
      frontPreserved: front.preserved,
      backPreserved: back.preserved,
      unknown: front.unknown || back.unknown,
      viaCatalog: Boolean(front.url && !ownFronts.includes(front.url) && front.url !== currentFront),
    };
  };

  // PATCH only changed image fields. In particular, recovering a front never
  // clears an independently valid back (and vice versa).
  const patchOne = async (id, body) => {
    const r = await sb(`products?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    });
    if (!r.ok) console.error('[momentec-image-verify] patch-one', id, r.status, (await r.text()).slice(0, 150));
  };
  const flush = async (changes) => {
    if (dryRun) return;
    for (let i = 0; i < changes.length; i += 12) {
      await Promise.all(changes.slice(i, i + 12).map((change) => patchOne(change.id, change.patch)));
    }
  };

  const t0 = Date.now();
  let last = '';
  let scanned = 0, fronts_found = 0, backs_found = 0, fronts_preserved = 0, backs_preserved = 0;
  let found_catalog = 0, cleared_front = 0, cleared_back = 0, unknown = 0, planned = 0, written = 0, pages = 0;

  for (;;) {
    if (Date.now() - t0 > TIME_BUDGET_MS) { console.warn('[momentec-image-verify] time budget reached at', last); break; }
    // Keyset pagination by id so writes mid-run can't shift an offset window.
    let path = `products?select=id,sku,image_front_url,image_back_url&brand=eq.${encodeURIComponent(brand)}&is_active=eq.true&order=id.asc&limit=${PAGE}`;
    if (frontMissingOnly) path += '&image_front_url=is.null';
    if (last) path += `&id=gt.${encodeURIComponent(last)}`;
    const r = await sb(path);
    if (!r.ok) { console.error('[momentec-image-verify] select', r.status, (await r.text()).slice(0, 200)); break; }
    const rows = await r.json();
    if (!rows.length) break;
    pages++;
    last = rows[rows.length - 1].id;

    const changes = [];
    for (let i = 0; i < rows.length; i += CONC) {
      const chunk = rows.slice(i, i + CONC);
      const results = await Promise.all(chunk.map(resolve));
      results.forEach((res, j) => {
        scanned++;
        const row = chunk[j];
        if (res.front) fronts_found++;
        if (res.back) backs_found++;
        if (res.frontPreserved) fronts_preserved++;
        if (res.backPreserved) backs_preserved++;
        if (res.viaCatalog) found_catalog++;
        if (res.unknown) unknown++;
        if ('image_front_url' in res.patch && !res.patch.image_front_url && row.image_front_url) cleared_front++;
        if ('image_back_url' in res.patch && !res.patch.image_back_url && row.image_back_url) cleared_back++;
        if (Object.keys(res.patch).length) changes.push({ id: row.id, patch: res.patch });
      });
    }
    await flush(changes);
    planned += changes.length;
    if (!dryRun) written += changes.length;
    if (rows.length < PAGE) break;
  }

  const summary = {
    brand, dry_run: dryRun, front_missing_only: frontMissingOnly, pages, scanned, fronts_found, backs_found,
    fronts_preserved, backs_preserved, found_catalog, cleared_front, cleared_back,
    unknown_left: unknown, rows_planned: planned, rows_written: written,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
  console.log('[momentec-image-verify] done', JSON.stringify(summary));
  return { statusCode: 200, body: JSON.stringify(summary) };
};
