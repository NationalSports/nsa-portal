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

// ── Roster scoping ──
// A numbers deco's roster jsonb can carry stale size keys the garment doesn't have —
// "copy numbers from another item" brings the source's whole size curve, and a line's
// sizes can shrink after numbers were entered. The line-item editor only renders slots
// for the garment's own sizes, so stale keys are invisible there, but any consumer that
// iterates roster keys raw shows phantom sizes and duplicated numbers (SO-1588: a
// one-size backpack displayed the tee's S–3X roster on top of its own OSFA numbers).
// Keeps only sizes with qty > 0, each list capped at that size's qty. No usable size
// info → roster returned as-is. Works for names maps too (same per-size-array shape).
export const scopeRosterToSizes = (roster, sizes) => {
  const r = safeObj(roster); const sz = safeObj(sizes);
  const live = Object.entries(sz).filter(([, q]) => safeNum(q) > 0);
  if (!live.length) return r;
  const out = {};
  live.forEach(([s, q]) => { const arr = safeArr(r[s]).slice(0, q); if (arr.length) out[s] = arr; });
  return out;
};

// ── Job-item decoration ownership ──
// A job item records which decoration indexes of its SO line the job produces (deco_idxs).
// Returns null for legacy items without the array — the legacy single deco_idx was written as
// decoIdxs[0] and is NOT exhaustive for multi-deco jobs, so it must not be treated as a scope.
// Null means "unknown coverage": callers fall back to every decoration on the line.
export const jobItemDecoIdxs = (gi) => Array.isArray(gi?.deco_idxs) && gi.deco_idxs.length ? gi.deco_idxs : null;
// Decorations of one kind on a SO line that THIS job actually produces. Keeps a job's
// display (number rosters, spec rows) from bleeding onto sibling jobs that share the
// line — e.g. an art job showing the numbers job's roster.
export const jobItemDecosOfKind = (gi, it, kind) => {
  const dis = jobItemDecoIdxs(gi);
  return safeDecos(it).filter((d, di) => d?.kind === kind && (!dis || dis.includes(di)));
};
// Does this job's artwork fail to resolve to a real art file? True only when the job's declared
// art (art_file_id/_art_ids — a '__tbd' placeholder counts as declaring) includes NO live design
// AND an art decoration the job owns has no live art file behind it. Numbers/names-only jobs and
// jobs with a live declared design are never "unresolved" — a sibling job's TBD deco on a shared
// line must not taint them, and a frozen job whose stale indexes drift onto a foreign deco is
// protected by the declared-art check. archivedIsUnresolved: action guards (marking a job
// complete) treat archived-only art as unresolved because jobLiveArtIds excludes archived files
// and the production-files check would otherwise pass vacuously; passive heals leave archived
// art alone so long-finished jobs aren't resurrected by library cleanup.
export const jobHasUnresolvedArt = (j, o, { archivedIsUnresolved = false } = {}) => {
  const art = safeArt(o);
  const live = (id) => { if (!id || id === '__tbd') return false; const a = art.find(f => f.id === id); return !!a && !(archivedIsUnresolved && a.archived); };
  const declared = ((j?._art_ids && j._art_ids.length ? j._art_ids : [j?.art_file_id]) || []).filter(Boolean);
  if (declared.some(live)) return false;
  return (j?.items || []).some(gi => {
    const it = safeItems(o)[gi.item_idx]; if (!it) return false;
    const dis = jobItemDecoIdxs(gi);
    // Legacy item with unknown coverage on a job that declares no art at all: a TBD deco here
    // belongs to some other job — don't attribute it.
    if (!dis && declared.length === 0) return false;
    return safeDecos(it).some((d, di) => {
      if (dis && !dis.includes(di)) return false;
      return d?.kind === 'art' && !live(d.art_file_id);
    });
  });
};

// True when at least one (item_idx, deco_idx) pair this job claims still resolves to a live
// decoration on the SO. Used to retire frozen (_merged / released / split) jobs after a rep
// clears every line decoration — without this, syncJobs keeps the frozen snapshot forever
// (SO-1057: JOB-1057-01 stayed after all art was deleted from the lines because _merged=true).
// Empty items[] → false (nothing to produce). Missing item or missing deco index → that pair
// does not count. Legacy items without deco_idxs: any decoration on the line counts as live.
export const jobHasLiveDecorations = (j, o) => {
  const items = safeItems(o);
  const pairs = j?.items || [];
  if (!pairs.length) return false;
  return pairs.some(gi => {
    const it = items[gi.item_idx];
    if (!it) return false;
    const decos = safeDecos(it);
    if (!decos.length) return false;
    const dis = jobItemDecoIdxs(gi);
    if (!dis) return true; // legacy unknown coverage — line still has decorations
    return dis.some(di => decos[di] != null);
  });
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
      // Non-positive line quantities are invalid, not credits — a negative entry here
      // would inflate "remaining to invoice" and enable over-invoicing.
      if (!(q > 0)) return;
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

// Final + $0 invoice create: skip minting a redundant $0 invoice only when prior
// invoices/deposits already cover the balance. Never-invoiced $0 orders (FREE PROMO
// with no billable deco, etc.) still need a $0 invoice for AR/audit + promo paid-spend.
// Promo-funds orders (promo_applied) always create the $0 invoice when requested.
export const shouldSkipZeroFinalInvoice = ({ invType, invTotal, isPromoOrder, priorInvs, depositApplied }) => {
  if (invType !== 'final') return false;
  if (safeNum(invTotal) !== 0) return false;
  if (isPromoOrder) return false;
  const prior = priorInvs || [];
  const priorCoverage = prior.length > 0 || safeNum(depositApplied) > 0
    || prior.reduce((a, inv) => a + safeNum(inv?.total), 0) > 0;
  return priorCoverage;
};

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

// ── Mocks follow the garment when its identity changes ──
// Per-garment mockups and mock links are keyed `sku|color`, so an IN-PLACE sku or color
// edit on a line item silently orphans them: the mock stays under the old garment's key
// and the approval gate reports the garment unmocked (SO-1480: a JM5228→KD5416 stock
// swap stranded the Royal/White mock under the departed SKU). Re-key every art file's
// item_mockups — the exact `sku|color` key, slot-suffixed keys (`sku|color|numbers`,
// `sku|color|<cw>`), and the legacy bare-sku key — plus mock_links (both member keys and
// link targets) from the old garment key to the new one. Colliding buckets merge, deduped
// by url. Entry-level `sku` tags are updated to match. Pure: returns a NEW array only
// when something changed, else the same reference (callers can skip a save on no-op).
// Callers must ensure no OTHER live line still uses the old sku|color before moving —
// two identical lines share one key by design.
// opts.moveBareSku (default true): the legacy bare-sku bucket serves EVERY color of that
// SKU, so callers must pass false when another live line still carries the old SKU in a
// different color — moving the bare bucket would steal that line's legacy fallback.
export const rekeyGarmentMocks = (artFiles, fromSku, fromColor, toSku, toColor, opts) => {
  const moveBareSku = !opts || opts.moveBareSku !== false;
  const fromKey = mockLinkKeyOf(fromSku, fromColor);
  const toKey = mockLinkKeyOf(toSku, toColor);
  if (fromKey === toKey) return artFiles;
  const mapKey = (k) => {
    if (k === fromKey) return toKey;
    if (k.startsWith(fromKey + '|')) return toKey + k.slice(fromKey.length);
    if (moveBareSku && fromSku && k === fromSku) return toSku || k; // legacy bare-sku bucket
    return k;
  };
  const entryUrl = (f) => (typeof f === 'string' ? f : (f && (f.url || f.name)) || '');
  let anyChanged = false;
  const next = safeArr(artFiles).map((a) => {
    if (!a) return a;
    let changed = false;
    // item_mockups: move matching buckets to the new key, merging on collision.
    const im = a.item_mockups || {};
    const nim = {};
    Object.entries(im).forEach(([k, v]) => {
      const nk = mapKey(k);
      const arr = safeArr(v).map((f) => (f && typeof f === 'object' && f.sku === fromSku && toSku) ? { ...f, sku: toSku } : f);
      if (nk !== k || arr.some((f, i) => f !== v[i])) changed = true;
      if (nim[nk]) {
        const have = new Set(nim[nk].map(entryUrl));
        nim[nk] = [...nim[nk], ...arr.filter((f) => !have.has(entryUrl(f)))];
      } else nim[nk] = arr;
    });
    // mock_links: re-key both the member keys and the link targets; drop self-links.
    const ml = mockLinksOf(a);
    const nml = {};
    Object.entries(ml).forEach(([k, v]) => {
      const nk = mapKey(k); const nv = mapKey(String(v || ''));
      if (nk !== k || nv !== v) changed = true;
      if (nk !== nv) nml[nk] = nv;
      else changed = true; // self-link created by the rename — drop it
    });
    if (!changed) return a;
    anyChanged = true;
    return { ...a, item_mockups: nim, ...(Object.keys(ml).length ? { mock_links: nml } : {}) };
  });
  return anyChanged ? next : artFiles;
};

// Legacy ink_colors placeholder lines ('Color 1'…'Color 5') are a COUNT artifact — the
// Art-TBD pricing dropdown writes them so screen-print pricing can count colors before
// the design exists, and they survive on the row after the art becomes real. They are
// not ink names: spec displays must skip them so the chips fall through to the art's
// real color-way inks instead of rendering blank "Color 1/2/3" swatches (SO-1496).
// Pricing keeps counting the raw lines — only displays should use this.
// Shared by the deco-spec renderers in OrderEditor (two copies) and CoachPortal.
export const realInkLines = (s) => String(s || '').split(/[,\n]/).map((c) => c.trim()).filter(Boolean).filter((c) => !/^color\s*\d+$/i.test(c));

// One shared message for the per-garment mock gate. The gate itself (skusMissingMockups)
// is enforced at six surfaces — OrderEditor's Approve Artwork / Send-to-Coach button /
// openCoachSend / Skip-Artist release, CoachPortal's Approve, CustDetail's preview
// Approve — which need surface-specific delivery (nf toast vs alert) but must agree on
// what the rep is told to do about it.
export const missingMockupsMsg = (action, missing) =>
  'Cannot ' + action + ' — no mockup yet for: ' + missing.join(', ') + '. Upload a mockup or link one ("use the same mockup as…") first.';

// ── Auto-link a copy-swapped garment to its source's mockup ──
// The style-swap flows clone a line to a NEW sku ("copy decorations from JM5228 →
// KD5416") rather than editing in place, so rekeyGarmentMocks can't apply (the source
// line may legitimately stay). Instead, link the new garment to the source garment's
// mock via the system's own mock_links mechanism — visible as "uses the same mockup
// as …" and un-linkable in the UI. Only links when the COLOR matches exactly: a
// different color must never inherit a mock silently (the wrong-colorway class the
// 2026-07 audits closed elsewhere). Skips garments that already have their own mock
// or an existing link. Pure: returns the same reference when nothing changed.
export const linkSwappedGarmentMock = (artFiles, srcItem, newSku, newColor) => {
  if (!srcItem || (srcItem.color || '') !== (newColor || '')) return artFiles;
  const oldKey = mockLinkKeyOf(srcItem.sku, srcItem.color);
  const newKey = mockLinkKeyOf(newSku, newColor);
  if (oldKey === newKey || !newSku) return artFiles;
  const artIds = [...new Set(safeDecos(srcItem)
    .filter((d) => d?.kind === 'art' && d?.art_file_id && d.art_file_id !== '__tbd')
    .map((d) => d.art_file_id))];
  if (!artIds.length) return artFiles;
  let anyChanged = false;
  const next = safeArr(artFiles).map((a) => {
    if (!a || !artIds.includes(a.id)) return a;
    const im = a.item_mockups || {};
    const srcHasMock = safeArr(im[oldKey]).length > 0 || safeArr(im[srcItem.sku]).length > 0;
    if (!srcHasMock) return a;
    if (safeArr(im[newKey]).length > 0) return a; // new garment already has its own mock
    const links = { ...mockLinksOf(a) };
    if (links[newKey]) return a; // already linked
    // Flatten to the root source, mirroring setMockLinkOE's write behavior.
    let root = oldKey; const seen = new Set([newKey]);
    while (links[root] && !seen.has(root)) { seen.add(root); root = links[root]; }
    if (root === newKey) return a;
    links[newKey] = root;
    anyChanged = true;
    return { ...a, mock_links: links };
  });
  return anyChanged ? next : artFiles;
};

// SINGLE SOURCE OF TRUTH for per-garment mockup slot keys. A garment gets one mockup
// slot per decoration; reversible decorations get TWO (Side A / Side B — a reversible
// garment prints on both color ways). Slot keys extend the garment's `sku|color` base:
//   • first art deco, Side A → bare base key (backward-compatible, drives the approval gate)
//   • other art slots        → base|<color_way_id>  (falling back to base|d<i> / base|d<i>_1)
//   • numbers / names        → base|numbers, base|numbers_b, base|names_1, …
// Accepts raw SO decorations (color_way_id) or the enriched view models the mockup
// screens build (colorWayId). Returns [{key, primary, kind, idx, di, side, reversible}]
// where idx counts within the deco's kind and di is the index in the ORIGINAL decos
// array (so callers can scope slots to a job via deco_idxs). The renderers in App.js
// (rep art-detail grid + artist modal) and the approval gate below must all agree on
// these keys — that's why this lives here.
export const mockSlotKeys = (base, decos) => {
  const slots = [];
  let ai = 0, ni = 0, mi = 0;
  safeArr(decos).forEach((d, di) => {
    if (!d || typeof d !== 'object') return;
    const rev = !!d.reversible;
    if (d.kind === 'art') {
      const cwA = d.color_way_id !== undefined ? d.color_way_id : d.colorWayId;
      const cwB = d.color_way_id_b !== undefined ? d.color_way_id_b : d.colorWayIdB;
      const sides = rev ? [{ cw: cwA, side: 'A' }, { cw: cwB, side: 'B' }] : [{ cw: cwA, side: rev ? 'A' : '' }];
      sides.forEach((s, si) => {
        const first = ai === 0 && si === 0;
        const disc = first ? '' : (s.cw || ('d' + ai + (si ? ('_' + si) : '')));
        slots.push({ key: base + (disc ? ('|' + disc) : ''), primary: first, kind: 'art', idx: ai, di, side: s.side, reversible: rev });
      });
      ai++;
    } else if (d.kind === 'numbers') {
      (rev ? ['', '_b'] : ['']).forEach((sfx, si) =>
        slots.push({ key: base + '|numbers' + (ni ? ('_' + ni) : '') + sfx, primary: false, kind: 'numbers', idx: ni, di, side: rev ? (si ? 'B' : 'A') : '', reversible: rev }));
      ni++;
    } else if (d.kind === 'names') {
      (rev ? ['', '_b'] : ['']).forEach((sfx, si) =>
        slots.push({ key: base + '|names' + (mi ? ('_' + mi) : '') + sfx, primary: false, kind: 'names', idx: mi, di, side: rev ? (si ? 'B' : 'A') : '', reversible: rev }));
      mi++;
    }
  });
  return slots;
};

// ── Approval-proof fallback for reused / pre-digitized art ──
// A displayable "proof" file: something a rep/coach can actually look at (image or PDF).
// Production formats (.dst/.emb/.ai/.eps) never count.
export const displayableProofFile = (f) =>
  /\.(png|jpe?g|webp|gif|pdf)(\?|#|$)/i.test(typeof f === 'string' ? f : (f && (f.name || f.url)) || '');
// The files that stand in for a mockup when an art file carries NO per-garment mocks at
// all: the general mockup_files/files bucket (legacy single-design art), else the
// digitizer's displayable sew-out proof in prod_files (reused library art). This is the
// same ladder skusMissingMockups accepts and the OrderEditor/CoachPortal approval views
// render — every mockup display surface (incl. the Art Dashboard slots) must use it so a
// reused art never renders as "no mockup" on one screen while another screen shows proof.
// Returns [] the moment the art has ANY per-garment mock — per-item mocks make the
// general/proof buckets ambiguous (wrong-colorway class), so they stop standing in.
export const artProofFallback = (a) => {
  // A rep/artist can explicitly clear the sew-out proof from a garment slot when it isn't a
  // usable stand-in (wrong colorway, needs a real mockup). proof_dismissed makes the prod-file
  // proof stop standing in for a mockup on every surface — this display fallback AND the
  // approval gate (skusMissingMockups) — so the slot reverts to an empty upload zone. It's a
  // non-destructive display flag: the prod files themselves (incl. .dst/.emb machine files) stay.
  if (a?.proof_dismissed) return [];
  const hasPerItem = Object.values(a?.item_mockups || {}).some(v => safeArr(v).length > 0);
  if (hasPerItem) return [];
  const gen = (safeArr(a?.mockup_files).length > 0 ? safeArr(a.mockup_files) : safeArr(a?.files)).filter(displayableProofFile);
  return gen.length > 0 ? gen : safeArr(a?.prod_files).filter(displayableProofFile);
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
    if (perSku.length > 0) {
      // Primary mock present — additionally require every slot a REVERSIBLE decoration
      // creates (Side B art, both numbers/names sides). A reversible garment approved
      // with only one color way mocked is exactly the SO-1116 rejection. Scoped to
      // reversible decos this job owns (deco_idxs), and only for garments already on
      // the per-item workflow — legacy jobs whose mocks live in the general
      // mockup_files bucket (handled below) are left alone.
      const _idxs = jobItemDecoIdxs(gi);
      const anchors = [...new Set([...artFiles, ...[...jobArtIds].map(aid => allArt.find(a => a?.id === aid)).filter(Boolean)])];
      const missSlots = mockSlotKeys(mockKey, safeDecos(it))
        .filter(s => s.reversible && !s.primary && (!_idxs || _idxs.includes(s.di)))
        .filter(s => !anchors.some(a => safeArr(a?.item_mockups?.[s.key]).length > 0));
      if (missSlots.length > 0 && mSku) {
        missing.push(mSku + ' (' + missSlots.map(s => (s.kind === 'art' ? 'art' : s.kind) + (s.side ? ' Side ' + s.side : '')).join(', ') + ')');
      }
      return;
    }
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
    // Reused/pre-digitized art with no mockups anywhere: the digitizer's sew-out proof (a
    // displayable image/PDF sitting in prod_files) is what the approval views now show, so it
    // satisfies the gate the same way — matches the prod-files display fallback in
    // OrderEditor/CoachPortal. Non-displayable production files (.dst/.emb/.ai) never count.
    const prodProof = artFiles.flatMap(a => {
      // Respect an explicit proof dismissal (see artProofFallback): a cleared proof no longer
      // satisfies the gate, so approval requires a real mockup — keeping the gate consistent with
      // what every display surface now shows for this art (an empty upload slot).
      if (a?.proof_dismissed) return [];
      const hasPerItem = Object.values(a?.item_mockups || {}).some(v => safeArr(v).length > 0);
      if (hasPerItem) return [];
      return safeArr(a?.prod_files).filter(displayableProofFile);
    });
    if (prodProof.length > 0) return;
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
      // Legacy single-design art carries ONE mock in the shared mockup_files bucket (or a
      // displayable sew-out proof in prod_files) that stands in for every garment — the same
      // fallback skusMissingMockups accepts and every mock-display surface renders. That mock is
      // already shown and approved on this order, so the garment is NOT missing one: don't nag
      // "Check Mock" just because the SAME design was later mocked per-garment on another order
      // (which arrives via priorByArtKey / this order's other-garment keys). Without this, a
      // fully-approved legacy mock kept re-surfacing "Check Mock" that normal approval could never
      // clear — there was nothing per-item to write. artProofFallback returns [] the moment the
      // art has ANY per-item mock, so genuinely reused art (per-item mocks for siblings, none for
      // this garment) still falls through and flags below.
      if (artProofFallback(a).length > 0) return;
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
