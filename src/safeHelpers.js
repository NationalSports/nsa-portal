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

// ── Job-item decoration ownership ──
// A job item records which decoration indexes of its SO line the job produces (deco_idxs,
// legacy single deco_idx). Returns null when the item carries neither (legacy jobs) —
// callers then fall back to every decoration on the line.
export const jobItemDecoIdxs = (gi) => Array.isArray(gi?.deco_idxs) && gi.deco_idxs.length ? gi.deco_idxs : (gi?.deco_idx != null ? [gi.deco_idx] : null);
// Decorations of one kind on a SO line that THIS job actually produces. Keeps a job's
// display (number rosters, spec rows) from bleeding onto sibling jobs that share the
// line — e.g. an art job showing the numbers job's roster.
export const jobItemDecosOfKind = (gi, it, kind) => {
  const dis = jobItemDecoIdxs(gi);
  return safeDecos(it).filter((d, di) => d?.kind === kind && (!dis || dis.includes(di)));
};

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

// ── Mock links ("use the same mockup as that garment") ──
// Default is one mock per garment. A rep/artist can LINK a garment to another garment on
// the job — "JD5725 uses the same mockup as 1370399-001" — so near-identical garments
// (e.g. three black polos with the same logo) need only one mock. Stored on the job's
// primary design (art file) as a map of garment -> source garment:
//   art_file.mock_links = { 'JD5725|Black': '1370399-001|Black', ... }
// The mock itself stays in the SOURCE garment's normal item_mockups bucket — linking
// moves nothing, so unlinking restores per-garment behavior exactly. Links are flattened
// on write (linking to an already-linked garment stores its root source), but the
// resolver still follows chains defensively, with a cycle guard.
export const mockLinksOf = (a) => safeObj(a?.mock_links);
export const mockLinkKeyOf = (sku, color) => (sku || '') + '|' + (color || '');
// Resolve the root source key this garment is linked to, or null when unlinked.
export const resolveMockLink = (anchorArts, sku, color) => {
  const links = {};
  safeArr(anchorArts).forEach(a => Object.assign(links, mockLinksOf(a)));
  let key = mockLinkKeyOf(sku, color);
  if (!links[key]) return null;
  const seen = new Set([key]);
  while (links[key] && !seen.has(links[key])) { key = links[key]; seen.add(key); }
  return key === mockLinkKeyOf(sku, color) ? null : key;
};
// The garments (by key) linked TO this garment, across the anchor art files.
export const mockLinkDependents = (anchorArts, sku, color) => {
  const key = mockLinkKeyOf(sku, color);
  const out = [];
  safeArr(anchorArts).forEach(a => Object.entries(mockLinksOf(a)).forEach(([m, src]) => {
    if (src === key && m !== key && !out.includes(m)) out.push(m);
  }));
  return out;
};
// The mock files of the garment a linked garment points at: the source's per-garment
// bucket (sku|color, falling back to the legacy bare-sku key) across the anchor arts.
export const mockLinkSourceFiles = (anchorArts, sourceKey) => {
  const srcSku = (sourceKey || '').split('|')[0];
  for (const a of safeArr(anchorArts)) {
    const im = a?.item_mockups || {};
    if (safeArr(im[sourceKey]).length > 0) return safeArr(im[sourceKey]);
    if (safeArr(im[srcSku]).length > 0) return safeArr(im[srcSku]);
  }
  return [];
};

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
    // Skip job items whose live SO line no longer exists (deleted or reindexed). The
    // mockup screen drops these too (App.js itemDetails: `if(!it)return null`), so
    // gating on a garment that can't be shown or mocked would deadlock approval.
    if (!it) return;
    const decoArtIds = [...new Set(safeDecos(it)
      .filter(d => d?.kind === 'art' && d?.art_file_id && d.art_file_id !== '__tbd' && jobArtIds.has(d.art_file_id))
      .map(d => d.art_file_id))];
    const useIds = decoArtIds.length > 0
      ? decoArtIds
      : (job?.art_file_id && jobArtIds.has(job.art_file_id) ? [job.art_file_id] : []);
    const artFiles = useIds.map(aid => allArt.find(a => a?.id === aid)).filter(Boolean);
    // Read sku/color from the LIVE SO line, not the job snapshot: a line item's product
    // can be swapped (e.g. A325 → A515) without rebuilding so.jobs, leaving gi.sku stale.
    // The mockup screen keys off it.sku/it.color (App.js itemDetails), so the gate must
    // check the same garment — otherwise it reports a phantom SKU (A325) as missing while
    // the artist sees and mocks the real one (A515).
    const mSku = it?.sku || gi?.sku || '';
    const mColor = it?.color || gi?.color || '';
    // If this garment is linked to another garment's mockup, the SOURCE garment's mock is
    // the single source of truth for it — satisfied once the source has one, missing
    // otherwise (the linked garment's own per-item mock is intentionally ignored while
    // linked). Anchors: the job's primary design plus any art this garment uses.
    const linkAnchors = [allArt.find(a => a?.id === job?.art_file_id), ...artFiles].filter(Boolean);
    const srcKey = resolveMockLink(linkAnchors, mSku, mColor);
    if (srcKey) {
      // Look the source's mocks up across ALL the job's art (the source garment may pull
      // its art from a different file than this garment's anchors).
      const allAnchors = [...new Set([...linkAnchors, ...[...jobArtIds].map(aid => allArt.find(a => a?.id === aid)).filter(Boolean)])];
      if (mockLinkSourceFiles(allAnchors, srcKey).length === 0 && mSku) missing.push(mSku);
      return;
    }
    // Mockups are keyed by `sku|color` to disambiguate items that share a SKU across
    // colors. Older data may use a plain SKU key — accept either.
    const mockKey = mSku + '|' + mColor;
    const perSku = artFiles.flatMap(a => {
      const byKey = safeArr(a?.item_mockups?.[mockKey]);
      return byKey.length > 0 ? byKey : safeArr(a?.item_mockups?.[mSku]);
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
    if (mSku) missing.push(mSku);
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
// if the mock already works). Prior mocks come from this order's own art file (other-garment
// entries) plus `priorByArtKey` — a map of `name||deco_type` -> [{ from, files }] the caller
// builds from the SAME artwork on the customer's OTHER orders. A reused art often arrives as an
// empty clone while the approved mocks live on the prior order (whose art isn't always hydrated
// in memory), so the caller fetches those from the DB and passes them in here.
// Returns one entry per garment, each listing the art file(s) still needing a mock, with the
// prior mocks grouped by where they were approved — so the rep can scroll through and pick:
//   [{ sku, color, name,
//      artFiles:[{ art_file_id, art_name, groups:[{ from, files:[{url,name}] }] }] }]
export const garmentsNeedingMockCheck = (job, so, priorByArtKey = {}) => {
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
    if (!it) return; // live SO line gone (deleted/reindexed) — nothing to mock
    const decoArtIds = [...new Set(safeDecos(it)
      .filter(d => d?.kind === 'art' && d?.art_file_id && d.art_file_id !== '__tbd' && jobArtIds.has(d.art_file_id))
      .map(d => d.art_file_id))];
    const useIds = decoArtIds.length > 0
      ? decoArtIds
      : (job?.art_file_id && jobArtIds.has(job.art_file_id) ? [job.art_file_id] : []);
    const artFilesForItem = useIds.map(aid => allArt.find(a => a?.id === aid)).filter(Boolean);
    if (artFilesForItem.length === 0) return;
    // Live SO line drives sku/color (the job snapshot can go stale on a product swap).
    const mSku = it?.sku || gi?.sku || '';
    const mColor = it?.color || gi?.color || '';
    // A garment linked to another garment's mockup is an explicit decision — its mock
    // comes from the source garment, so there's no reuse ambiguity to double-check.
    const linkAnchors = [allArt.find(a => a?.id === job?.art_file_id), ...artFilesForItem].filter(Boolean);
    if (resolveMockLink(linkAnchors, mSku, mColor)) return;
    const mockKey = mSku + '|' + mColor;
    // A key belongs to THIS garment if it's the exact sku|color, the legacy bare sku, or a
    // color-way sub-key of this garment (sku|color|cwid).
    const isOwnKey = k => k === mockKey || k === mSku || k.startsWith(mockKey + '|');
    // Each art file on the garment that lacks its OWN mock but carries prior mocks from other
    // garments needs a check — list them all, so a garment decorated by two designs (e.g. a
    // front and a back) shows both.
    const artFiles = [];
    artFilesForItem.forEach(a => {
      const im = a?.item_mockups || {};
      const hasOwn = Object.entries(im).some(([k, v]) => isOwnKey(k) && safeArr(v).length > 0);
      if (hasOwn) return;
      // Gather candidate prior mocks, grouped by where they were approved (each group keeps its
      // front/back together), deduped by URL across all sources for this art file.
      const seen = new Set();
      const groups = [];
      const addGroup = (from, arr) => {
        const files = [];
        safeArr(arr).forEach(f => { const u = urlOf(f); if (u && !seen.has(u)) { seen.add(u); files.push({ url: u, name: (typeof f === 'object' && f?.name) || '' }); } });
        if (files.length) groups.push({ from, files });
      };
      // (a) Prior per-garment mocks already on THIS art file (other garments). The shared
      // mockup_files bucket is intentionally NOT offered here — a legacy single-design mock
      // already displays on the job, so surfacing it would just be noise.
      Object.entries(im).forEach(([k, arr]) => { if (!isOwnKey(k)) addGroup(k, arr); });
      // (b) The SAME artwork reused from a prior order — the approved per-garment mocks usually
      // live there, not on this order's (often empty) copy. Supplied by the caller as a map of
      // `name||deco_type` -> [{ from, files }], fetched from the DB since other orders' art is
      // not always hydrated in memory.
      const _ak = (a?.name || '').trim().toLowerCase() + '||' + (a?.deco_type || '');
      ((priorByArtKey && priorByArtKey[_ak]) || []).forEach(grp => addGroup(grp.from, grp.files));
      if (groups.length === 0) return;
      groups.sort((x, y) => y.files.length - x.files.length);
      artFiles.push({ art_file_id: a.id, art_name: a.name || a.title || '', groups });
    });
    if (artFiles.length === 0) return;
    out.push({ sku: mSku, color: mColor, name: it?.name || gi?.name || '', artFiles });
  });
  return out;
};
