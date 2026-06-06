/* eslint-disable */
// Safe accessor helpers — used throughout App.js, OrderEditor, CustDetail, etc.
export const safe = (v, def) => v != null ? v : def;
export const safeArr = (v) => Array.isArray(v) ? v : [];
export const safeObj = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
export const safeNum = (v) => typeof v === 'number' && !isNaN(v) ? v : 0;
export const safeStr = (v) => typeof v === 'string' ? v : '';
export const safeSizes = (it) => safeObj(it?.sizes);
export const safePicks = (it) => safeArr(it?.pick_lines);
export const safePOs = (it) => safeArr(it?.po_lines);
export const safeDecos = (it) => safeArr(it?.decorations);
export const safeItems = (o) => safeArr(o?.items);
export const safeArt = (o) => safeArr(o?.art_files);

// Stable-ish identifier for a sales-order line item, used to track which SO
// lines have been invoiced. Combines sku + color + position so reordering an
// SO with duplicate sku+color rows doesn't collide. Falls back to sku+color
// for legacy invoices that pre-date this key.
export const soLineKey = (it, idx) => (safeStr(it?.sku)||'')+'|'+(safeStr(it?.color)||'')+'|'+(idx==null?'':idx);

// Returns a Map of soLineKey -> total invoiced qty across the given invoices.
// Matches first by exact key, then degrades to sku+color, then to sku alone,
// for items from invoices written before the key existed or that lost their
// color metadata. Deposit invoices bill a percentage of the whole order and
// do NOT lock specific units, so their line qty is intentionally ignored
// here — callers should credit the deposit amount as $ paid instead.
export const buildInvoicedQtyMap = (so, invoicesForSO) => {
  const map = new Map();
  const items = safeItems(so);
  // Pre-seed all keys to 0 so callers can read .get(key) || 0
  items.forEach((it, idx) => map.set(soLineKey(it, idx), 0));
  // Index by sku|color and by sku alone for fallback lookups
  const skuColorBuckets = new Map(); // sku|color -> [idx,...]
  const skuBuckets = new Map();      // sku -> [idx,...]
  items.forEach((it, idx) => {
    const sku = safeStr(it?.sku)||'';
    const k = sku+'|'+(safeStr(it?.color)||'');
    if (!skuColorBuckets.has(k)) skuColorBuckets.set(k, []);
    skuColorBuckets.get(k).push(idx);
    if (!skuBuckets.has(sku)) skuBuckets.set(sku, []);
    skuBuckets.get(sku).push(idx);
  });
  const pourInto = (bucket, q) => {
    if (bucket.length === 0) return;
    if (bucket.length === 1) {
      const k = soLineKey(items[bucket[0]], bucket[0]);
      map.set(k, (map.get(k)||0) + q);
      return;
    }
    // Greedy: pour into the first row with remaining capacity
    let rem = q;
    for (const idx of bucket) {
      if (rem <= 0) break;
      const it = items[idx];
      const cap = Object.values(it?.sizes || {}).reduce((a, v) => a + safeNum(v), 0);
      const k = soLineKey(it, idx);
      const used = map.get(k) || 0;
      const room = Math.max(0, cap - used);
      const take = Math.min(room, rem);
      if (take > 0) { map.set(k, used + take); rem -= take; }
    }
    if (rem > 0) {
      const k = soLineKey(items[bucket[0]], bucket[0]);
      map.set(k, (map.get(k)||0) + rem);
    }
  };
  (invoicesForSO || []).forEach(inv => {
    // Deposits bill a % of the order without locking specific units
    if (inv?.inv_type === 'deposit') return;
    const lines = safeArr(inv?.line_items);
    lines.forEach(li => {
      const q = safeNum(li?.qty);
      if (!q) return;
      if (li?._so_line_key && map.has(li._so_line_key)) {
        map.set(li._so_line_key, map.get(li._so_line_key) + q);
        return;
      }
      // Legacy fallback chain: parse sku/color from explicit fields or the desc
      // ("SKU Name — Color"). Try sku+color, then sku alone.
      const desc = safeStr(li?.desc);
      const sku = safeStr(li?._sku) || desc.split(' ')[0] || '';
      let color = safeStr(li?._color);
      if (!color && desc.includes(' — ')) color = desc.split(' — ').slice(1).join(' — ').trim();
      const bucket = (color && skuColorBuckets.get(sku+'|'+color))
        || skuColorBuckets.get(sku+'|')
        || skuBuckets.get(sku)
        || [];
      pourInto(bucket, q);
    });
  });
  return map;
};

// Sum of paid-but-non-unit-billing invoice amounts on an SO (deposits today).
// These don't lock specific units but represent $ already collected, so the
// next invoice should credit them against the remaining balance.
export const sumDepositInvoiced = (invoicesForSO) =>
  (invoicesForSO || []).reduce((a, inv) => inv?.inv_type === 'deposit' ? a + safeNum(inv?.total) : a, 0);
export const safeJobs = (o) => safeArr(o?.jobs);
export const safeFirm = (o) => safeArr(o?.firm_dates);

// Returns the list of SKUs on a job that have no mockup attached. Mirrors the
// per-item mockup lookup in OrderEditor: for each item, find the art files this
// item's decorations actually reference (intersected with the job's art set,
// falling back to the job's primary art), then check item_mockups[sku] on those
// art files. If none of the relevant art files carry an entry for the SKU, we
// also accept any general mockup_files/files bucket on those art files as a
// fallback (same logic as the renderer at OrderEditor.js:5480-5482).
// Used to block "Send for Approval" until every SKU has a mockup.
export const skusMissingMockups = (job, so) => {
  const items = safeArr(job?.items);
  if (items.length === 0) return [];
  const allArt = safeArt(so);
  const soItems = safeItems(so);
  // A job's declared _art_ids only carry the FIRST item's art (see buildJobs in
  // OrderEditor). Items beyond the first reference their own art files via their
  // decorations, and that's where their mockups live. Augment the job art set
  // with every art file any item's decorations reference, so the per-item check
  // below looks at the right art file instead of falling back to the job's
  // primary art and falsely reporting a missing mockup. Mirrors the approval
  // renderer at OrderEditor.js:6568.
  const jobArtIds = new Set(safeArr(job?._art_ids).filter(Boolean));
  if (jobArtIds.size === 0 && job?.art_file_id) jobArtIds.add(job.art_file_id);
  items.forEach(gi => {
    const it = soItems[gi?.item_idx];
    if (!it) return;
    safeDecos(it).forEach(d => {
      if (d?.kind === 'art' && d?.art_file_id && d.art_file_id !== '__tbd') jobArtIds.add(d.art_file_id);
    });
  });
  const missing = [];
  items.forEach(gi => {
    const it = soItems[gi?.item_idx];
    const decoArtIds = it ? [...new Set(safeDecos(it)
      .filter(d => d?.kind === 'art' && d?.art_file_id && d.art_file_id !== '__tbd' && jobArtIds.has(d.art_file_id))
      .map(d => d.art_file_id))] : [];
    const useIds = decoArtIds.length > 0
      ? decoArtIds
      : (job?.art_file_id && jobArtIds.has(job.art_file_id) ? [job.art_file_id] : []);
    const artFiles = useIds.map(aid => allArt.find(a => a?.id === aid)).filter(Boolean);
    // Mockups are keyed by `sku|color` to disambiguate items that share a SKU
    // across colors. Older data may use a plain SKU key — accept either.
    const mColor = gi?.color || it?.color || '';
    const mockKey = (gi?.sku || '') + '|' + mColor;
    const perSku = artFiles.flatMap(a => {
      const byKey = safeArr(a?.item_mockups?.[mockKey]);
      return byKey.length > 0 ? byKey : safeArr(a?.item_mockups?.[gi?.sku]);
    });
    if (perSku.length > 0) return;
    // Only fall back to the shared mockup_files/files bucket for art that carries NO
    // per-garment mockups at all (legacy single-design art). Once an art file has
    // per-garment mockups for OTHER garments, this garment needs its own — otherwise a
    // mock approved on a different color/style (reused art) would silently satisfy the
    // gate. garmentsNeedingMockCheck surfaces those so the rep can confirm or redo.
    const general = artFiles.flatMap(a => {
      const hasPerItem = Object.values(a?.item_mockups || {}).some(v => safeArr(v).length > 0);
      if (hasPerItem) return [];
      return safeArr(a?.mockup_files).length > 0 ? safeArr(a?.mockup_files) : safeArr(a?.files);
    });
    if (general.length > 0) return;
    if (gi?.sku) missing.push(gi.sku);
  });
  return missing;
};

// Mockups are stored per garment, keyed by `sku|color` (e.g. "A2009|White"), with an
// extra `|color_way_id` sub-key when one garment carries multiple color ways. So a mock
// approved on a Royal tee lives under "<tee-sku>|Royal" and never appears on a White
// hoodie. When previously-approved art is reused on a DIFFERENT color/style, the new
// garment therefore has no mock of its own — but the art still carries the approved mock
// from the original garment. This finds those garments so the rep can eyeball the prior
// mock and either keep it for this garment or send for a new one (no need for the artist
// if the mock already works). Returns
//   [{ sku, color, name, from, art_file_id, mocks:[{url,name}], otherCount }]
// where `mocks` are the prior mock files from the single most-relevant source garment.
export const garmentsNeedingMockCheck = (job, so) => {
  const items = safeArr(job?.items);
  if (items.length === 0) return [];
  const allArt = safeArt(so);
  const soItems = safeItems(so);
  // Mirror skusMissingMockups: gather every art file this job's items reference, since a
  // job's _art_ids only carry the first item's art.
  const jobArtIds = new Set(safeArr(job?._art_ids).filter(Boolean));
  if (jobArtIds.size === 0 && job?.art_file_id) jobArtIds.add(job.art_file_id);
  items.forEach(gi => {
    const it = soItems[gi?.item_idx];
    if (!it) return;
    safeDecos(it).forEach(d => { if (d?.kind === 'art' && d?.art_file_id && d.art_file_id !== '__tbd') jobArtIds.add(d.art_file_id); });
  });
  const urlOf = f => typeof f === 'string' ? f : (f?.url || '');
  const out = [];
  items.forEach(gi => {
    const it = soItems[gi?.item_idx];
    const decoArtIds = it ? [...new Set(safeDecos(it)
      .filter(d => d?.kind === 'art' && d?.art_file_id && d.art_file_id !== '__tbd' && jobArtIds.has(d.art_file_id))
      .map(d => d.art_file_id))] : [];
    const useIds = decoArtIds.length > 0
      ? decoArtIds
      : (job?.art_file_id && jobArtIds.has(job.art_file_id) ? [job.art_file_id] : []);
    const artFiles = useIds.map(aid => allArt.find(a => a?.id === aid)).filter(Boolean);
    if (artFiles.length === 0) return;
    const mColor = gi?.color || it?.color || '';
    const mockKey = (gi?.sku || '') + '|' + mColor;
    // A key belongs to THIS garment if it's the exact sku|color, the legacy bare sku, or a
    // color-way sub-key of this garment (sku|color|cwid).
    const isOwnKey = k => k === mockKey || k === gi?.sku || k.startsWith(mockKey + '|');
    const hasOwn = artFiles.some(a =>
      Object.entries(a?.item_mockups || {}).some(([k, v]) => isOwnKey(k) && safeArr(v).length > 0));
    if (hasOwn) return;
    // Collect prior mockups grouped by the (other) garment key they were approved on.
    const groups = [];
    artFiles.forEach(a => {
      Object.entries(a?.item_mockups || {}).forEach(([k, arr]) => {
        if (isOwnKey(k) || !safeArr(arr).length) return;
        const seen = new Set();
        const files = [];
        arr.forEach(f => { const u = urlOf(f); if (u && !seen.has(u)) { seen.add(u); files.push({ url: u, name: (typeof f === 'object' && f?.name) || '' }); } });
        if (files.length) groups.push({ from: k, art_file_id: a.id, files });
      });
    });
    if (groups.length === 0) return;
    groups.sort((a, b) => b.files.length - a.files.length);
    const best = groups[0];
    out.push({ sku: gi?.sku || '', color: mColor, name: gi?.name || it?.name || '', from: best.from, art_file_id: best.art_file_id, mocks: best.files, otherCount: groups.length - 1 });
  });
  return out;
};
