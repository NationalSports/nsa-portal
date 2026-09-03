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

// ── PO-line fulfilled units for one size ──
// Drop-ship PO lines never get a warehouse check-in (the vendor ships direct to the
// customer), so their `received` map stays empty forever and receipt-only fulfillment
// counters hold the SO at partial for life (SO-1727: 71% with every warehouse line in).
// Credit a drop-ship line's billed quantities as fulfilled — the vendor bill is the
// ship signal, the same rule the inbound-tracking board uses to call a drop-ship PO
// "shipped". max (not +) so a drop-ship line that somehow also got checked in manually
// can never count the same units twice. Mirrored in businessLogic.js (test mirror of
// calcSOStatus) and lib/opsRecap.js (standalone CommonJS for the Netlify digest).
export const poLineFulfilledQty = (pk, sz) => {
  const rcvd = safeNum((pk?.received || {})[sz]);
  return pk?.drop_ship ? Math.max(rcvd, safeNum((pk?.billed || {})[sz])) : rcvd;
};

export const normalizePoPaymentMethod = (value) => {
  const method = String(value || '').trim().toLowerCase();
  return method === 'wire' || method === 'cash' ? method : 'credit_card';
};
export const poPaymentMethodLabel = (value) => ({ credit_card: 'Credit card', wire: 'Wire', cash: 'Cash' })[normalizePoPaymentMethod(value)];

// One-off costs entered while creating a garment PO (card fee, rush charge, etc.).
// A PO can span several SO item rows, but the cost belongs to the PO as a whole. The
// creator stores it on one canonical po_line; deduping by PO number also protects the
// money path if an older edit/copy ever mirrors the metadata onto every line.
export const manualPoCostRows = (o) => {
  const rows = []; const seen = new Set(); const methods = new Map();
  const keyFor = (po, itemIdx, poIdx) => {
    const poId = String(po?.po_id || '').trim();
    return poId ? poId.replace(/\s+/g, ' ').toLowerCase() : ('line:' + itemIdx + ':' + poIdx);
  };
  safeItems(o).forEach((it, itemIdx) => safePOs(it).forEach((po, poIdx) => {
    const key = keyFor(po, itemIdx, poIdx);
    if (po?._payment_method && !methods.has(key)) methods.set(key, normalizePoPaymentMethod(po._payment_method));
  }));
  safeItems(o).forEach((it, itemIdx) => safePOs(it).forEach((po, poIdx) => {
    const amount = safeNum(po?._manual_cost);
    if (!(amount > 0)) return;
    const poId = String(po?.po_id || '').trim();
    const key = keyFor(po, itemIdx, poIdx);
    if (seen.has(key)) return;
    seen.add(key);
    const paymentMethod = methods.get(key) || (po?._payment_method ? normalizePoPaymentMethod(po._payment_method) : '');
    rows.push({ po_id: poId, amount, note: String(po?._manual_cost_note || '').trim(), vendor: po?.vendor || '', payment_method: paymentMethod, payment_label: paymentMethod ? poPaymentMethodLabel(paymentMethod) : '' });
  }));
  return rows;
};
export const manualPoCostTotal = (o) => manualPoCostRows(o).reduce((sum, row) => sum + row.amount, 0);

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
// Promote an unresolved art slot owned by a job to a real art-file id. Art Dashboard uploads
// can begin on the reserved `__tbd` placeholder; once the first proof exists, both the job and
// its decoration must point at a normal id or the line-item picker/approval guard will continue
// to read it as Art TBD. Scope by the job's deco indexes so sibling designs are untouched.
export const attachJobArtToUnresolvedDecos = (items, job, artFileId) => {
  if (!artFileId || artFileId === '__tbd') return safeArr(items);
  const owned = new Map();
  safeArr(job?.items).forEach(gi => {
    if (gi?.item_idx == null) return;
    const dis = jobItemDecoIdxs(gi);
    const cur = owned.get(gi.item_idx);
    if (cur === null || dis === null) owned.set(gi.item_idx, null);
    else owned.set(gi.item_idx, new Set([...(cur || []), ...dis]));
  });
  return safeArr(items).map((it, ii) => {
    if (!owned.has(ii)) return it;
    const dis = owned.get(ii); let changed = false;
    const decorations = safeDecos(it).map((d, di) => {
      if (d?.kind !== 'art' || (dis && !dis.has(di)) || (d.art_file_id && d.art_file_id !== '__tbd')) return d;
      changed = true;
      return {...d, art_file_id: artFileId, art_tbd_type: null, tbd_colors: null, tbd_stitches: null, tbd_dtf_size: null};
    });
    return changed ? {...it, decorations} : it;
  });
};
// The set of art files a job owns across its garments. Seeded from the job's declared art
// (_art_ids / art_file_id) and augmented with the art files referenced by the decorations the
// job actually owns (jobItemDecoIdxs). Scoping to owned decos is load-bearing: on an art-split
// line each sibling job owns ONE of the line's art decorations, so scanning EVERY deco pulls in
// the sibling designs' art files. That over-broad set then (a) leaks a sibling design's mock into
// this job's display and (b) — because the SO-page "×" passes this set as the mock-removal scope
// (removeMockFromArtFiles artFileIds) — lets a removal under one design wipe the shared sku|color
// mock off the sibling designs on the same garment, reverting their Check Mock (SO-1023: clearing
// the Attack Everything mock on JX4452 emptied the 2 Col / Friars jobs' JX4452 mocks). Mirrors the
// job-art gathering already in skusMissingMockups / garmentsNeedingMockCheck so the four can't drift.
export const jobArtFileIds = (job, soItems) => {
  const ids = new Set(safeArr(job?._art_ids).filter(Boolean));
  if (ids.size === 0 && job?.art_file_id) ids.add(job.art_file_id);
  safeArr(job?.items).forEach(gi => {
    const it = safeArr(soItems)[gi?.item_idx];
    if (!it) return;
    const dis = jobItemDecoIdxs(gi);
    safeDecos(it).forEach((d, di) => {
      if (dis && !dis.includes(di)) return;
      if (d?.kind === 'art' && d?.art_file_id && d.art_file_id !== '__tbd') ids.add(d.art_file_id);
    });
  });
  return ids;
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

// A job that reads 'needs_art' while it already carries an ACTIVE artist request
// (requested / in_progress) is self-contradictory: needs_art means "no request is out," so the
// two states can't both be true. Worse, the state is self-perpetuating — syncJobs' rebuild path
// inherits a matched job's art_requests (inheritJobWorkflowFields) while re-deriving art_status,
// and when the existing status is needs_art it stays needs_art. So a job that once slipped into
// this state (a merge/family worst-case downgrade, a partial save, a since-fixed release path)
// never recovers on its own: the rep sees "Needs Art" AND "Art Requested" at once, and every
// re-submit entry point is gated on needs_art-with-no-request, leaving the job stuck (SO-1707).
// Promote it to art_requested to match the live request. Skip when the art itself is unresolved
// (TBD / deleted design): there the artist was never actually asked to produce anything, so
// needs_art is correct and _healUnresolvedArt's downgrade must win.
export const healOrphanArtRequest = (j, o) => {
  if (!j || j.art_status !== 'needs_art') return j;
  const hasActiveReq = (j.art_requests || []).some(
    (r) => r && (r.status === 'requested' || r.status === 'in_progress'),
  );
  if (!hasActiveReq || jobHasUnresolvedArt(j, o)) return j;
  return { ...j, art_status: 'art_requested' };
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

// Do two jobs decorate any of the SAME physical garments? Sharing an item_idx isn't
// enough: an art-split partitions one SO line's units between designs (each job's entry
// carries the family's split_group with its own disjoint split_sizes), so same-family
// slices are separate batches of garments — one design's job must not be displayed or
// gated as a "sibling on the same garments" of the other. Any other shared line
// (multi-position decoration, a numbers/names job over the whole line, or slices from
// two DIFFERENT split families whose units can overlap) still counts as shared.
// Matching keys on split_group alone, NOT the _artSplit marker: split_group is only ever
// written onto a job item by the split-aware builder or the released-job heal, so equal
// truthy split_group ⇒ same family — while _artSplit gets dropped by the job-wizard
// release whitelists, and jobs persisted through that path (or before the marker existed)
// would otherwise read as falsely coupled again.
export const jobsShareGarments = (a, b) => {
  const byIdx = {};
  safeArr(b?.items).forEach(gi => { if (gi && gi.item_idx != null) byIdx[gi.item_idx] = gi; });
  return safeArr(a?.items).some(gi => {
    if (!gi || gi.item_idx == null) return false;
    const other = byIdx[gi.item_idx];
    if (!other) return false;
    if (gi.split_group && gi.split_group === other.split_group) return false;
    return true;
  });
};

// Per-size shipped tally across a sales order's shipments: sku|color -> {size: qty}.
// Feed the result to jobShippedUnits — jobs need per-size resolution, not line totals,
// because art-split slices own only a size subset of their line.
export const shippedSizesByLine = (shipments) => {
  const m = {};
  safeArr(shipments).forEach(shp => {
    // Warehouse -> decorator transfers are real outbound packages (and real freight cost),
    // but they are not customer fulfillment. Counting them here would make the later decorated
    // job look shipped before the decorator has even started it.
    if (shp?.fulfillment === false || shp?.shipment_scope === 'deco_transfer') return;
    safeArr(shp?.items).forEach(it => {
    if (!it) return;
    const key = (it.sku || '') + '|' + (it.color || '');
    const tgt = m[key] || (m[key] = {});
    Object.entries(it.sizes || {}).forEach(([sz, v]) => { tgt[sz] = (tgt[sz] || 0) + safeNum(v); });
    });
  });
  return m;
};

// Remaining customer-fulfillment quantities on an SO, one row per order line. Uses a running
// per-size claim so duplicate sku/color lines cannot both consume the same shipment. This is the
// source for the warehouse's manual/override shipment picker, including closed orders that never
// entered Ready to Ship because their workflow state drifted.
export const unshippedOrderItems = (so) => {
  const shipped = shippedSizesByLine(so?._shipments);
  const claimed = {};
  const rows = [];
  safeItems(so).forEach((it, itemIdx) => {
    const key = safeStr(it?.sku) + '|' + safeStr(it?.color);
    const used = claimed[key] || (claimed[key] = {});
    const sizes = {};
    Object.entries(safeSizes(it)).forEach(([sz, v]) => {
      const ordered = safeNum(v);
      if (ordered <= 0) return;
      const credit = Math.min(ordered, Math.max(0, safeNum(shipped[key]?.[sz]) - safeNum(used[sz])));
      used[sz] = safeNum(used[sz]) + credit;
      const remaining = ordered - credit;
      if (remaining > 0) sizes[sz] = remaining;
    });
    const qty = Object.values(sizes).reduce((a, v) => a + safeNum(v), 0);
    if (qty > 0) rows.push({ sku: it?.sku || '', name: it?.name || '', color: it?.color || '', sizes, itemIdx, qty });
  });
  return rows;
};

// ── Units pulled from the warehouse but not yet shipped ──
// "Does this order still have shipping to do?" cannot be answered from jobs alone: a no-deco /
// blanks line never creates a job, so a closed blanks order with a pulled-but-unshipped box looks
// finished and drops out of the warehouse queues (which is where packages and their costs are
// created). Counts pulled units per sku|color against what the shipment records already cover,
// with a running tally so two lines sharing a sku|color don't each subtract the full shipped qty
// (mirrors buildWarehouseData's soShipConsumed).
// Drop-ship lines never get pulled — the vendor ships direct — so they contribute 0 and can never
// hold a closed order in the queue forever.
export const unshippedPulledUnits = (so) => {
  const shipped = shippedSizesByLine(so?._shipments);
  const used = {};
  let open = 0;
  safeItems(so).forEach((it) => {
    const szKeys = Object.keys(safeSizes(it));
    const pulled = safePicks(it).filter((pk) => pk?.status === 'pulled')
      .reduce((a, pk) => a + szKeys.reduce((b, sz) => b + safeNum(pk[sz]), 0), 0);
    if (pulled <= 0) return;
    const key = safeStr(it?.sku) + '|' + safeStr(it?.color);
    const shippedQty = Object.values(shipped[key] || {}).reduce((a, v) => a + safeNum(v), 0);
    const already = used[key] || 0;
    const credit = Math.min(pulled, Math.max(0, shippedQty - already));
    used[key] = already + credit;
    open += pulled - credit;
  });
  return open;
};

// True when a sales order still has warehouse work worth showing, whatever its status says.
// A closed SO is normally hidden from the warehouse queues; these are the two ways one can still
// owe a shipment — a job that has not shipped, or pulled units no shipment record covers.
export const soHasOpenShipWork = (so) =>
  safeJobs(so).some((j) => j.prod_status !== 'shipped' && j.prod_status !== 'draft')
  || unshippedPulledUnits(so) > 0;

// How many of THIS job's units have shipped? Crediting a job with its line's whole
// sku|color shipped count over-credits art-split slices: sibling designs partition the
// same line, so design A's shipped box would read as covering design B too — flipping B
// to prod_status 'shipped' while B's actual garments sit unshipped, and dropping B from
// the warehouse's ready-to-ship queues. A split slice (split_group + its own sizes)
// counts only its per-size share of the line's shipped units; when same-family slices
// share a size, jobs earlier in the list claim shipped units first (mirroring
// allocateJobFulfillment / the released-heal's sibBefore apportioning). Whole-line items
// keep the full-line count, matching the pre-split behavior.
// Resolved per size and per job-item (keyed by the job's items[] index) so the warehouse's
// per-job Ready-to-Ship rows can subtract exactly what shipped for THAT job's garments.
// jobShippedUnits is the sum of this map — one apportioning rule, no second copy to sync.
export const jobShippedSizes = (job, allJobs, shippedSizes) => {
  const jobs = safeArr(allJobs);
  const jobIdx = jobs.findIndex(j2 => j2 && job && j2.id === job.id);
  const before = jobIdx > 0 ? jobs.slice(0, jobIdx) : [];
  const out = {};
  safeArr(job?.items).forEach((gi, gidx) => {
    if (!gi) return;
    const shipped = (shippedSizes || {})[(gi.sku || '') + '|' + (gi.color || '')];
    if (!shipped) return;
    const row = out[gidx] || (out[gidx] = {});
    const share = gi.split_group && gi.sizes && Object.keys(gi.sizes).length > 0 ? gi.sizes : null;
    if (!share) { Object.entries(shipped).forEach(([sz, v]) => { row[sz] = (row[sz] || 0) + safeNum(v); }); return; }
    Object.entries(share).forEach(([sz, want]) => {
      const w = safeNum(want);
      if (w <= 0) return;
      let avail = safeNum(shipped[sz]);
      before.forEach(j2 => safeArr(j2?.items).forEach(g2 => {
        if (g2 && g2.item_idx === gi.item_idx && g2.split_group === gi.split_group && g2.sizes) avail -= safeNum(g2.sizes[sz]);
      }));
      row[sz] = (row[sz] || 0) + Math.max(0, Math.min(w, avail));
    });
  });
  return out;
};
export const jobShippedUnits = (job, allJobs, shippedSizes) =>
  Object.values(jobShippedSizes(job, allJobs, shippedSizes))
    .reduce((a, row) => a + Object.values(row).reduce((b, v) => b + safeNum(v), 0), 0);

// Advance production jobs after an override shipment without letting an internal/decorator
// transfer masquerade as delivery to the customer. Explicit job selections are the warehouse's
// override; otherwise a completed job advances only when this order's customer-fulfillment
// shipments cover every one of its units.
export const jobsAfterShipment = (so, shipments, explicitlyShippedJobIds = [], customerFulfillment = true) => {
  const jobs = safeJobs(so);
  if (!customerFulfillment) return jobs;
  const explicit = new Set(safeArr(explicitlyShippedJobIds).filter(Boolean));
  const coverage = shippedSizesByLine(shipments);
  return jobs.map(job => {
    if (explicit.has(job?.id)) return { ...job, prod_status: 'shipped' };
    if (job?.prod_status !== 'completed') return job;
    return jobShippedUnits(job, jobs, coverage) >= safeNum(job?.total_units)
      ? { ...job, prod_status: 'shipped' }
      : job;
  });
};

// Freight is stored under both names for compatibility with older warehouse/reporting code.
// Use the larger existing value when a legacy order's mirrors drifted so recording a new label
// can never reduce an already-accounted shipping cost.
export const nextShippingCost = (so, addedCost) =>
  Math.max(safeNum(so?._shipping_cost), safeNum(so?._shipstation_cost)) + safeNum(addedCost);

// Stable-ish identifier for a sales-order line item, used to track which SO
// lines have been invoiced. Combines sku + color + position so reordering an
// SO with duplicate sku+color rows doesn't collide. Falls back to sku+color
// for legacy invoices that pre-date this key.
export const soLineKey = (it, idx) => (safeStr(it?.sku)||'')+'|'+(safeStr(it?.color)||'')+'|'+(idx==null?'':idx);

// Identity key for matching a client item line against a so_items DB row. sku+color is the only
// pair both sides always carry: row ids are re-minted on every save (the engine's insert-new /
// delete-old swap) and item_index shifts whenever a middle line is removed. Lower-cased so a
// casing difference between the editor's copy and the stored row can't read as a different line.
// Single definition on purpose — the engine's save guards and the editor's delete handler both
// key off this, and a drift between them would silently disarm the guards.
export const soItemKey = (it) => ((safeStr(it?.sku)||'')+'|'+(safeStr(it?.color)||'')).toLowerCase();

// ── Provisional PO numbers ──
// The Create-PO form DISPLAYS a number before any PO owns it: one is drawn from the sequence when
// the form opens, and it only becomes a real PO when Create is clicked. Reps copy that number to
// paste into the vendor's own order site — that is what the 📋 button next to it is for — so a form
// abandoned after a copy leaves the vendor holding a PO number this portal never created. Their
// invoice then references a PO that does not exist and matches nothing: PO 23801 JMHF on SO-1615
// ($144.78) and PO 26702 LAF on SO-1664 ($432.86), both Augusta bills still unapplied weeks later,
// each one number above the PO that actually was created (23800 / 26701).
// True when the order carries no product PO line and no deco PO with this id — i.e. the number was
// handed out but never issued. Trimmed on both sides; a blank id is never "missing" (nothing to warn
// about). Deliberately id-only: the vendor and items don't matter, the number's existence does.
export const poIdMissingFromOrder = (o, poId) => {
  const id = safeStr(poId).trim();
  if (!id) return false;
  const onLine = safeItems(o).some((it) => safePOs(it).some((p) => safeStr(p?.po_id).trim() === id));
  if (onLine) return false;
  return !safeArr(o?.deco_pos).some((dp) => safeStr(dp?.po_id).trim() === id);
};

// Returns a Map of soLineKey -> total invoiced qty across the given invoices.
// Matches first by exact key, then by a durable prior-key alias retained when
// an invoiced line changes SKU, then degrades to sku+color or sku alone for
// items from invoices written before the key existed or that lost their color
// metadata. Deposit invoices bill a percentage of the whole order and
// do NOT lock specific units, so their line qty is intentionally ignored
// here — callers should credit the deposit amount as $ paid instead.
// Core reconciliation of "how much of each SO line has already been invoiced".
// Returns the per-line qty map AND the invoice lines that matched no SO line at all
// (`orphans`) — see invoicedLineOrphans below for why those matter.
const _reconcileInvoicedQty = (so, invoicesForSO) => {
  const map = new Map();
  const orphans = [];
  const items = safeItems(so);
  // Pre-seed all keys to 0 so callers can read .get(key) || 0
  items.forEach((it, idx) => map.set(soLineKey(it, idx), 0));
  // Index by sku|color and by sku alone for fallback lookups
  const skuColorBuckets = new Map(); // sku|color -> [idx,...]
  const skuBuckets = new Map();      // sku -> [idx,...]
  const aliasBuckets = new Map();    // prior sku|color|idx -> [current idx,...]
  items.forEach((it, idx) => {
    const sku = safeStr(it?.sku)||'';
    const k = sku+'|'+(safeStr(it?.color)||'');
    if (!skuColorBuckets.has(k)) skuColorBuckets.set(k, []);
    skuColorBuckets.get(k).push(idx);
    if (!skuBuckets.has(sku)) skuBuckets.set(sku, []);
    skuBuckets.get(sku).push(idx);
    safeArr(it?.invoice_line_keys).forEach(alias => {
      const key = safeStr(alias);
      if (!key || key === soLineKey(it, idx)) return;
      if (!aliasBuckets.has(key)) aliasBuckets.set(key, []);
      if (!aliasBuckets.get(key).includes(idx)) aliasBuckets.get(key).push(idx);
    });
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
      if (li?._so_line_key && aliasBuckets.has(li._so_line_key)) {
        pourInto(aliasBuckets.get(li._so_line_key), q);
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
      // Nothing on the SO carries this sku any more — the line was billed and then the
      // order was edited out from under it. Record it instead of dropping it on the
      // floor; pourInto() would silently discard the qty (empty bucket = early return),
      // which is how SO-1804 ended up showing "Ready to Invoice" with $130 of paid,
      // billed goods invisible to the remaining-to-invoice math.
      if (bucket.length === 0) {
        orphans.push({
          invoice_id: safeStr(inv?.id),
          inv_type: safeStr(inv?.inv_type),
          sku, color, desc,
          qty: q,
          amount: safeNum(li?.amount),
        });
        return;
      }
      pourInto(bucket, q);
    });
  });
  return { map, orphans };
};

export const buildInvoicedQtyMap = (so, invoicesForSO) =>
  _reconcileInvoicedQty(so, invoicesForSO).map;

// Detect quantities that were invoiced after the Create Invoice modal loaded.
// The modal calculates its remaining quantities from the client's invoice snapshot;
// comparing that snapshot with a just-fetched server snapshot prevents a stale tab
// from billing the same SO units again. Only selected lines are returned so a new
// invoice for an unrelated line does not block legitimate partial invoicing.
export const staleInvoiceQtyConflicts = (so, localInvoices, liveInvoices, itemIdxs) => {
  const localMap = buildInvoicedQtyMap(so, localInvoices);
  const liveMap = buildInvoicedQtyMap(so, liveInvoices);
  const items = safeItems(so);
  const idxs = Array.isArray(itemIdxs) ? itemIdxs : items.map((_, idx) => idx);
  return idxs.reduce((conflicts, idx) => {
    const item = items[idx];
    if (!item) return conflicts;
    const key = soLineKey(item, idx);
    const localQty = safeNum(localMap.get(key));
    const liveQty = safeNum(liveMap.get(key));
    if (liveQty > localQty + 0.0001) conflicts.push({ idx, key, item, localQty, liveQty, delta: liveQty - localQty });
    return conflicts;
  }, []);
};

// Invoice lines already billed against this SO that no longer match any line ON the SO.
// A non-empty result means the order was edited after it was invoiced: those goods were
// charged (and possibly paid) but are no longer part of the order, so every "remaining to
// invoice" figure silently excludes them. Never auto-credit this — whether a removed line
// was a swap (nothing more owed) or a genuine reduction (a refund) is a human call. Surface
// it so the rep sees the divergence before billing again.
export const invoicedLineOrphans = (so, invoicesForSO) =>
  _reconcileInvoicedQty(so, invoicesForSO).orphans;

// Match each invoice line back to its SO item so callers can re-attach whatever only the SO
// knows — the size breakdown, decoration/number detail. Try the stored line key first, then
// SKU, then a description prefix (mirrors the on-screen invoice view); matched SO items are
// consumed so duplicate SKUs map 1:1. Returns one SO index per line (-1 when unmatched).
export const matchInvoiceLinesToSo = (lineItems, soItems) => {
  const items = safeArr(soItems);
  const soByKey = {}; items.forEach((it, idx) => { soByKey[soLineKey(it, idx)] = idx });
  const usedSo = new Set();
  return safeArr(lineItems).map(li => {
    if (li?._so_line_key != null && soByKey[li._so_line_key] != null && !usedSo.has(soByKey[li._so_line_key])) { const i = soByKey[li._so_line_key]; usedSo.add(i); return i }
    let i = li?._sku ? items.findIndex((it, ix) => !usedSo.has(ix) && it?.sku === li._sku) : -1;
    if (i < 0) i = items.findIndex((it, ix) => !usedSo.has(ix) && it?.sku && safeStr(li?.desc).startsWith(it.sku));
    if (i >= 0) { usedSo.add(i); return i }
    return -1;
  });
};

// Total units on one SO line (sized lines by their size boxes, unsized ones by est_qty).
export const soLineQty = (it) => {
  const sq = Object.values(safeSizes(it)).reduce((a, v) => a + safeNum(v), 0);
  return sq > 0 ? sq : safeNum(it?.est_qty);
};

// ── Scope a sales order's items to what ONE invoice actually bills ──
// Every invoice document (portal PDF, emailed PDF, order-editor review, coach portal)
// walks the SALES ORDER, because that's where the size breakdown and decoration detail
// live. Walking it raw prints the whole order on a partial invoice: INV-63640 billed 94
// hoodies for $3,487.52 and printed all 8 lines of SO-1101 with a $14,117.45 subtotal.
// Returns:
//   items      — the SO items this invoice bills, in SO order, each carrying
//                `_invQty` (units billed here) and `_invSizes` (the SO size map when the
//                whole line is billed, else null — the invoice never records WHICH sizes
//                were billed, so a short line prints no breakdown rather than one that
//                doesn't add up). Pricing must still be looked up at the SO line's own
//                quantity, so `_soQty` carries it, and `_soIdx` keeps the line's original
//                position in the SO for callers that key off it.
//   extraLines — invoice lines with no SO match (hand-added lines, NetSuite imports).
//                Callers render these as plain rows so the document's subtotal still
//                reconciles to the invoice.
// Deposits bill a percentage of the entire order, so they keep every line. So does an
// invoice with no stored line_items (legacy rows) — there's nothing to scope by.
export const scopeSoItemsToInvoice = (inv, soItems) => {
  const items = safeArr(soItems);
  const lines = safeArr(inv?.line_items);
  const all = () => items.map((it, idx) => ({ ...it, _soIdx: idx, _invQty: soLineQty(it), _soQty: soLineQty(it), _invSizes: safeSizes(it) })).filter(it => it._invQty > 0);
  if (!items.length) return { items: [], extraLines: lines };
  if (inv?.inv_type === 'deposit' || !lines.length) return { items: all(), extraLines: [] };
  const idxByLine = matchInvoiceLinesToSo(lines, items);
  const qtyByIdx = new Map(); const extraLines = [];
  lines.forEach((li, i) => {
    const idx = idxByLine[i];
    if (idx < 0) { extraLines.push(li); return }
    qtyByIdx.set(idx, (qtyByIdx.get(idx) || 0) + safeNum(li?.qty));
  });
  const scoped = items.map((it, idx) => {
    const q = qtyByIdx.get(idx);
    if (!(q > 0)) return null;
    const soQty = soLineQty(it);
    return { ...it, _soIdx: idx, _invQty: q, _soQty: soQty, _invSizes: q === soQty ? safeSizes(it) : null };
  }).filter(Boolean);
  // Every line matched to a zero-qty / missing SO item: fall back to the full order rather
  // than printing an invoice with no items at all.
  if (!scoped.length && !extraLines.length) return { items: all(), extraLines: [] };
  return { items: scoped, extraLines };
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

// Financial closure and physical fulfillment are independent. A final invoice makes the SO's
// status "complete", but an unpulled pick line is still live warehouse work and must keep the
// order in the warehouse data set.
export const hasOpenItemFulfillment = (o) => safeItems(o).some(it =>
  safePicks(it).some(pk => pk?.status !== 'pulled')
);

// Manual stock corrections are intentionally narrower than Inventory-page access. Admins can
// adjust stock, as can explicitly designated warehouse leads; the warehouse role by itself stays
// read-only so adding one lead does not silently grant the control to every warehouse account.
export const canAdjustInventory = (user, warehouseLeadIds = []) => !!user && (
  user.role === 'admin' ||
  user.role === 'super_admin' ||
  warehouseLeadIds.includes(user.id)
);
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

// ── Which SKU a garment's mockups key on ──
// Lines the rep types by hand — customer-supplied blanks and one-off custom products — all
// carry the SAME placeholder SKU ('CUST-SUPPLIED' / 'CUSTOM', occasionally blank), because
// there is no catalog product behind them. Keying their mockups on `sku|color` therefore
// collapses EVERY custom garment of one color into a single bucket: on SO-2063 the red long
// sleeve and the red short sleeve both read `CUST-SUPPLIED|Red`, so the mockup uploaded for
// one showed on the other, the midlayer hoody showed the women's crew, and the approval gate
// counted all four as mocked. Their real identity is the line NAME — the rep types the style
// number there ("6014457-600 - Long Sleeve") — so a placeholder-SKU line keys on its name.
// Catalog garments (a real SKU) are untouched: same key as before, byte for byte.
const PLACEHOLDER_SKU = /^(?:cust[-_ ]?supplied|custom|tbd|n\/a|none)?$/i;
export const isPlaceholderSku = (sku) => PLACEHOLDER_SKU.test(safeStr(sku).trim());
export const mockSkuOf = (it) => {
  if (!isPlaceholderSku(it?.sku)) return it?.sku;
  // '|' separates key segments, so a name carrying one would forge a sub-key.
  const nm = safeStr(it?.name).trim().replace(/\|/g, '/');
  return nm || it?.sku;
};
// A garment line's mock bucket key. THE key builder — every surface that reads, writes or
// links per-garment mockups goes through it so the rep view, the artist modal, the coach
// portal, the floor sheet and the approval gate can't drift onto different keys.
export const garmentMockKey = (it) => mockLinkKeyOf(mockSkuOf(it), it?.color);
// The bucket a placeholder-SKU garment's mockups may STILL sit under: everything written
// before the key above existed shares `CUST-SUPPLIED|<color>` with its siblings. Null for a
// garment whose key never changed (a real SKU), i.e. nothing to fall back to.
export const legacyMockKeyOf = (it) => {
  const k = mockLinkKeyOf(it?.sku, it?.color);
  return k === garmentMockKey(it) ? null : k;
};
// Read one garment's mock bucket out of an art file's item_mockups: its own key, else the
// legacy shared bucket (`sub` selects a slot sub-key such as '|numbers'). The fallback keeps
// pre-fix orders rendering exactly as they do today — wrongly shared on the few colliding
// ones — until either the rep re-uploads (which writes the garment's own key and wins here)
// or the buckets are split. It never makes an order worse than it is now.
export const itemMockFiles = (mocks, it, sub) => {
  const m = safeObj(mocks);
  const ownKey = garmentMockKey(it) + (sub || '');
  const own = safeArr(m[ownKey]);
  // Presence is intentional even when the bucket is empty: removing the last file leaves []
  // behind. Falling through in that state would resurrect the pre-fix shared mockup the user
  // just removed and could let it satisfy the approval gate again. Only orders that have never
  // written this garment's own key should read the legacy shared bucket.
  if (Object.prototype.hasOwnProperty.call(m, ownKey)) return own;
  const lk = legacyMockKeyOf(it);
  const legacyKey = lk && (lk + (sub || ''));
  if (legacyKey && Object.prototype.hasOwnProperty.call(m, legacyKey)) return safeArr(m[legacyKey]);
  // The oldest orders used a bare SKU bucket. It was only ever a primary/front bucket, never
  // a color-way, numbers or names sub-slot. Keep that final compatibility read centralized here
  // so every caller honors the empty-own-bucket tombstone above.
  if (!sub && it?.sku != null && Object.prototype.hasOwnProperty.call(m, it.sku)) return safeArr(m[it.sku]);
  return own;
};
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
// Apply ONE garment -> source link on the art file `artId`: chains are flattened (linking
// to an already-linked garment stores its root) and anything that pointed AT the member is
// re-pointed at the new root, so the map never grows a hop. sourceKey null = unlink.
// Pure: returns a NEW array only when the map actually changed, else the same reference.
// Extracted from the three hand-synced setMockLink handlers (SO page x2, Art Dashboard) so
// the group writer below can't drift from single-click linking.
export const applyMockLink = (artFiles, artId, memberKey, sourceKey) => {
  const arr = safeArr(artFiles);
  if (!artId || !memberKey || memberKey === sourceKey) return arr;
  let changed = false;
  const out = arr.map(a => {
    if (!a || a.id !== artId) return a;
    const before = mockLinksOf(a);
    const links = { ...before };
    let root = sourceKey;
    const seen = new Set([memberKey]);
    while (root && links[root] && !seen.has(root)) { seen.add(root); root = links[root]; }
    if (root === memberKey) root = sourceKey === memberKey ? null : sourceKey;
    if (root) links[memberKey] = root; else delete links[memberKey];
    Object.keys(links).forEach(k => {
      if (links[k] === memberKey) links[k] = root || memberKey;
      if (links[k] === k) delete links[k];
    });
    const keys = Object.keys(links);
    if (keys.length === Object.keys(before).length && keys.every(k => before[k] === links[k])) return a;
    changed = true;
    return { ...a, mock_links: links };
  });
  return changed ? out : arr;
};
// Squash several garments onto ONE mockup in a single write: the FIRST key is the source
// (it keeps its own mock), every later key links to it. Used by the art-request modal so a
// near-identical group is grouped BEFORE the artist starts and only one mock gets built.
// Nothing is moved or deleted — unchecking/unlinking restores per-garment behavior exactly.
export const squashMockLinks = (artFiles, artId, memberKeys) => {
  const keys = [...new Set(safeArr(memberKeys).filter(Boolean))];
  if (keys.length < 2) return safeArr(artFiles);
  return keys.slice(1).reduce((acc, k) => applyMockLink(acc, artId, k, keys[0]), safeArr(artFiles));
};

// Replace the grouping for a known set of garments. Editable pickers use this form so
// unchecking garments really removes an older link before the current group is applied.
export const replaceMockLinkGroup = (artFiles, artId, candidateKeys, memberKeys) => {
  const candidates = new Set(safeArr(candidateKeys).filter(Boolean));
  let out = safeArr(artFiles);
  candidates.forEach(k => { out = applyMockLink(out, artId, k, null); });
  return squashMockLinks(out, artId, memberKeys);
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
const _ART_TRACKED_ARRAY_FIELDS = ['files', 'mockup_files', 'prod_files', 'sample_art', 'web_logos'];
const _ART_TRACKED_FIELDS = [..._ART_TRACKED_ARRAY_FIELDS, 'item_mockups', 'mock_links', 'preview_url', 'web_logo_url'];
const _artMutationUrl = (f) => (typeof f === 'string' ? f : (f && (f.url || f.name)) || '');
const _uniqTruthy = (arr) => [...new Set(safeArr(arr).filter(Boolean))];
// Stamp explicit art removals/asset replacements as client-only one-save intent. A conflict merge otherwise
// has no safe way to distinguish “the rep removed this” from “this stale tab never loaded it”, so it must union
// arrays and would resurrect deleted mockups/files. Existing markers are reconciled so undo-before-save works.
export const markArtFieldEdit = (art, field, value) => {
  if (!art) return art;
  const next = { ...art, [field]: value };
  const edited = new Set(safeArr(art._artEditedFields)); edited.add(field);
  next._artEditedFields = [...edited];
  const deletes = { ...(art._artDeletes || {}) };
  if (_ART_TRACKED_ARRAY_FIELDS.includes(field)) {
    const live = new Set(safeArr(value).map(_artMutationUrl).filter(Boolean));
    const removed = safeArr(art[field]).map(_artMutationUrl).filter(u => u && !live.has(u));
    const prior = safeArr(deletes[field]).filter(u => !live.has(u));
    const gone = _uniqTruthy([...prior, ...removed]);
    if (gone.length) deletes[field] = gone; else delete deletes[field];
  } else if (field === 'item_mockups') {
    const priorMap = art.item_mockups || {}; const liveMap = value || {}; const dm = { ...(deletes.item_mockups || {}) };
    new Set([...Object.keys(priorMap), ...Object.keys(liveMap), ...Object.keys(dm)]).forEach(k => {
      const live = new Set(safeArr(liveMap[k]).map(_artMutationUrl).filter(Boolean));
      const removed = safeArr(priorMap[k]).map(_artMutationUrl).filter(u => u && !live.has(u));
      const gone = _uniqTruthy([...safeArr(dm[k]).filter(u => !live.has(u)), ...removed]);
      if (gone.length) dm[k] = gone; else delete dm[k];
    });
    if (Object.keys(dm).length) deletes.item_mockups = dm; else delete deletes.item_mockups;
  } else if (field === 'mock_links') {
    const live = value || {};
    const removed = Object.keys(art.mock_links || {}).filter(k => !(k in live));
    const gone = _uniqTruthy([...safeArr(deletes.mock_links).filter(k => !(k in live)), ...removed]);
    if (gone.length) deletes.mock_links = gone; else delete deletes.mock_links;
  }
  if (Object.keys(deletes).length) next._artDeletes = deletes; else delete next._artDeletes;
  return next;
};
// File-upload/reuse helpers often construct a whole art_files array rather than calling uArt. Diff the fields
// whose conflict semantics need explicit intent and carry the same markers into that immediate save.
export const markArtChanges = (before, after) => {
  const prev = new Map(safeArr(before).filter(Boolean).map(a => [a.id, a]));
  return safeArr(after).map(a => {
    const old = a && prev.get(a.id); if (!old) return a;
    let next = { ...a };
    if (old._artDeletes && !next._artDeletes) next._artDeletes = old._artDeletes;
    if (old._artEditedFields && !next._artEditedFields) next._artEditedFields = old._artEditedFields;
    _ART_TRACKED_FIELDS.forEach(f => {
      let changed = old[f] !== a[f];
      if (changed && (typeof old[f] === 'object' || typeof a[f] === 'object')) {
        try { changed = JSON.stringify(old[f]) !== JSON.stringify(a[f]); } catch (_) { changed = true; }
      }
      if (changed) next = markArtFieldEdit({ ...next, [f]: old[f] }, f, a[f]);
    });
    return next;
  });
};
// Strip a mockup image (by URL) from art files, scoped to ONE garment on the art files a job owns.
// The SO-page "×" lives on a single garment's mock card inside a single job's panel, so a removal
// must only clear THAT garment's mock keys on the art files the job owns. The old order-wide strip
// removed the url from EVERY art file and EVERY item_mockups key — and because confirming a reused
// mock copies the SAME url onto several garments, removing one garment's mock silently wiped the
// identical image off sibling garments/jobs that reused it, reverting their Check Mock (SO-1023:
// clearing a mock under the Attack Everything job emptied the Friars job's KV2196 / JX4452 mocks).
// scope = { sku, color, artFileIds }. artFileIds null/omitted => every art file; sku null/omitted
// => every item_mockups key (both preserve the legacy order-wide behavior for callers that pass no
// scope). mockup_files (the design-level bucket, not garment-keyed) is stripped within the scoped
// art files only. Source art (files / prod_files) is never touched.
export const removeMockFromArtFiles = (artFiles, url, scope = {}) => {
  if (!url) return safeArr(artFiles);
  const urlOf = (f) => (typeof f === 'string' ? f : (f && f.url) || '');
  const strip = (arr) => safeArr(arr).filter((f) => urlOf(f) !== url);
  const ids = Array.isArray(scope.artFileIds) ? new Set(scope.artFileIds.filter(Boolean)) : null;
  // `scope.item` is the garment LINE (preferred — placeholder-SKU lines key on their name via
  // garmentMockKey); `scope.sku`/`scope.color` remain accepted for callers that have only those.
  const mk = scope.item ? garmentMockKey(scope.item) : (scope.sku != null ? scope.sku + '|' + (scope.color || '') : null);
  const legacy = scope.item ? legacyMockKeyOf(scope.item) : null;
  const rawSku = scope.item ? scope.item.sku : scope.sku;
  const ownKey = (k) => mk == null || k === mk || k === rawSku || k.startsWith(mk + '|')
    || (!!legacy && (k === legacy || k.startsWith(legacy + '|')));
  return safeArr(artFiles).map((a) => {
    if (!a) return a;
    if (ids && !ids.has(a.id)) return a;
    const im = { ...(a.item_mockups || {}) };
    let changed = false;
    Object.keys(im).forEach((k) => {
      if (!ownKey(k)) return;
      const before = im[k] || [];
      const after = strip(before);
      if (after.length !== before.length) { im[k] = after; changed = true; }
    });
    const mf = strip(a.mockup_files);
    if (mf.length !== safeArr(a.mockup_files).length) changed = true;
    if (!changed) return a;
    return { ...a, item_mockups: im, mockup_files: mf };
  });
};

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
  'Cannot ' + action + ' — no garment mockup yet for: ' + missing.join(', ') + '. A sew-out proof isn\'t enough: reuse an approved mock, link one ("use the same mockup as…"), or send to the artist for a mockup.';

// Companion message for the reversible color-way gate (skusMissingRevColorWays) — enforced
// at the same rep surfaces as the mock gate (Approve Artwork / Send to Coach / openCoachSend).
export const missingRevColorWaysMsg = (action, missing) =>
  'Cannot ' + action + ' — reversible color ways not set for: ' + missing.join(', ') + '. Define both color ways on the art file, then pick Side A and Side B on the decoration — the decorator needs the reverse side\'s inks (not just the mockup).';

// ── Colorway image bridging (Momentec & other big-catalog API vendors) ──
// The Momentec catalog (vendor v8) is excluded from the capped in-memory `prod`, and its
// order lines are usually saved at STYLE level — sku '705A', product_id null, color as
// free text ("Vegas Gold") — while the actual per-colorway photo lives on the
// '{style}.{color}' product row (id 'mt-{style}-{color}', image_front_url set by the
// momentec-image-verify job). So the SO/art image resolver, which matches a product only
// by id/exact-sku, lands on the imageless style-level parent row and shows a placeholder.
// These pure helpers bridge the two: given a set of colorway rows fetched on demand, a
// style-level line item resolves its correct-color image (exact color first, then any
// imaged colorway of that style as a generic garment thumbnail).
const _mtColorKey = (styleSku, color) =>
  `${String(styleSku || '').trim().toLowerCase()}|${String(color || '').trim().toLowerCase()}`;
// '*' can never appear in a real color name, so it's a safe "any colorway of this style" key.
const _MT_ANY = '*';

// Build a { 'style|color': {front, back} } lookup from fetched colorway product rows.
// Accepts either DB column names (image_front_url/image_back_url) or the in-memory
// mirror names (image_url/back_image_url). Rows with no front image are skipped.
export const buildColorwayImageMap = (rows) => {
  const map = {};
  safeArr(rows).forEach((r) => {
    const style = String((r && r.sku) || '').split('.')[0];
    const front = (r && (r.image_front_url || r.image_url)) || null;
    if (!style || !front) return;
    const back = (r && (r.image_back_url || r.back_image_url)) || null;
    const exact = _mtColorKey(style, r && r.color);
    if (!map[exact]) map[exact] = { front, back };
    const any = _mtColorKey(style, _MT_ANY);
    if (!map[any]) map[any] = { front, back }; // first imaged colorway wins as the generic
  });
  return map;
};

// Resolve a line item's { front, back } image from a colorway map, or null. Only bridges
// STYLE-level skus (no '.') — a colorway-level sku already matches its own product row.
export const lookupColorwayImage = (map, item) => {
  if (!map || !item) return null;
  const sku = String(item.sku || '').trim();
  if (!sku || sku.includes('.')) return null;
  return map[_mtColorKey(sku, item.color)] || map[_mtColorKey(sku, _MT_ANY)] || null;
};

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
  const oldKey = garmentMockKey(srcItem);
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

/**
 * How many mockups a garment has in its numbers / names slots — the proof of the BACK.
 * Keys follow mockSlotKeys: `sku|color|numbers` / `|names`, plus the `_<n>` / `_b` variants.
 * Counted per kind so a surface can say WHICH side has no proof on file.
 */
export const nnMockCounts = (artFiles, it) => {
  const base = garmentMockKey(it);
  const legacy = legacyMockKeyOf(it);
  let numbers = 0; let names = 0;
  safeArr(artFiles).forEach((a) => {
    const m = safeObj(a?.item_mockups);
    const anyOwn = Object.keys(m).some((k) => k.startsWith(base + '|') && safeArr(m[k]).length > 0);
    const pfx = (anyOwn || !legacy) ? base : legacy;
    Object.keys(m).forEach((k) => {
      if (!k.startsWith(pfx + '|')) return;
      const n = safeArr(m[k]).filter(Boolean).length;
      if (!n) return;
      if (/\|numbers(_\d+)?(_b)?$/.test(k)) numbers += n;
      else if (/\|names(_\d+)?(_b)?$/.test(k)) names += n;
    });
  });
  return { numbers, names };
};

/**
 * The mockup files one slot should DISPLAY.
 *
 * Slot keys are positional: the first art decoration on a garment owns the bare `sku|color` key
 * and every later one gets a discriminated key (`|<colorWayId>` / `|d1`). That position depends on
 * how many decorations the JOB claims — so a design that used to run on its own job stored its
 * mock under the bare key (it was that job's primary slot), and folding several designs onto one
 * job demotes it to a discriminated key it has nothing under. The slot then renders as an empty
 * upload box and invites a duplicate re-upload, while the job sheet — which reads through a
 * fallback chain (_prodJobItemMocks) — still shows the mock. SO-1840's CUI Basketball and Talon
 * both sit under `JW6602|Black` for exactly this reason.
 *
 * So an ART slot with nothing under its own key falls back to the bare-key read, but ONLY when its
 * art file is not shared with another slot on this garment: a shared file is precisely what the
 * discriminator exists to separate (reversible Side A/B, per-color-way mocks), and falling back
 * there would show one side's image in both boxes.
 *
 * Numbers and names never fall back. Their slots hang off the job's primary artwork, so a fallback
 * would put the garment's FRONT mockup in the back-proof box — worse than showing it empty.
 *
 * `it` is the garment LINE (sku, color, name) — garmentMockKey, not the raw SKU, decides the base
 * key, so customer-supplied lines don't all read one another's bucket.
 */
export const slotMockFiles = (slot, slots, it) => {
  const art = slot?.artFile;
  const mocks = safeObj(art?.item_mockups);
  const bareRead = () => itemMockFiles(mocks, it);
  if (slot?.primary) return bareRead();
  // Sub-key slots read through the same legacy fallback: the sub-key part (`|<cwid>`, `|numbers`)
  // hangs off whichever base the mock was written under.
  const base = garmentMockKey(it);
  const own = safeStr(slot?.key).startsWith(base)
    ? itemMockFiles(mocks, it, safeStr(slot.key).slice(base.length))
    : safeArr(mocks[slot?.key]);
  if (own.length > 0 || slot?.kind !== 'art' || !art) return own;
  const shared = safeArr(slots).some((s) => s && s !== slot && s.artFile && s.artFile.id === art.id);
  return shared ? own : bareRead();
};

// ── Approval-proof fallback for reused / pre-digitized art ──
// A displayable "proof" file: something a rep/coach can actually look at (image or PDF).
// Production formats (.dst/.emb/.ai/.eps) never count.
export const displayableProofFile = (f) =>
  /\.(png|jpe?g|webp|gif|pdf)(\?|#|$)/i.test(typeof f === 'string' ? f : (f && (f.name || f.url)) || '');
// DISPLAY-ONLY fallback: the files shown in a mockup slot when an art file carries NO per-garment mocks at
// all: the general mockup_files/files bucket (legacy single-design art), else the
// digitizer's displayable sew-out proof in prod_files (reused library art). This ladder is
// what the OrderEditor/CoachPortal approval views render — every mockup display surface
// (incl. the Art Dashboard slots) must use it so a reused art never renders as "no mockup"
// on one screen while another screen shows proof. NOTE: display only — the sew-out proof
// does NOT satisfy the approval gate (skusMissingMockups requires a real garment mockup;
// jobs are required to have one) and never appears on floor documents (_prodJobGenericMocks).
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
// falling back to the job's primary art only when the item owns an art decoration),
// then check item_mockups[sku] on those
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
  // Scope to the decorations THIS job item owns (deco_idxs) — on an art-split line pulling in the
  // sibling designs' art would let their mockups satisfy (or mis-report) this design's gate. Shared
  // with the OrderEditor mock panels via jobArtFileIds so the two can't drift.
  const jobArtIds = jobArtFileIds(job, soItems);
  const missing = [];
  items.forEach(gi => {
    const it = soItems[gi?.item_idx];
    // Skip job items whose live SO line no longer exists (deleted or reindexed). The
    // mockup screen drops these too (App.js itemDetails: `if(!it)return null`), so
    // gating on a garment that can't be shown or mocked would deadlock approval.
    if (!it) return;
    const dis = jobItemDecoIdxs(gi);
    const ownedArtDecos = safeDecos(it)
      .filter((d, di) => (!dis || dis.includes(di)) && d?.kind === 'art');
    // A combined job can own only numbers/names on this garment while its primary art belongs
    // to other garments in the same job. Such an item has no art mock to approve and must never
    // inherit that primary art's old garment mocks (SO-1777: JZ2525 numbers vs yellow logo).
    if (ownedArtDecos.length === 0) return;
    const decoArtIds = [...new Set(ownedArtDecos
      .filter(d => d?.art_file_id && d.art_file_id !== '__tbd' && jobArtIds.has(d.art_file_id))
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
    const mLine = it || gi || {};
    // What the rep is told is missing. Every customer-supplied line reads 'CUST-SUPPLIED',
    // so name those by their line name — otherwise the message repeats one useless word.
    const mLabel = mockSkuOf(mLine) || '';
    const mSku = it?.sku || gi?.sku || '';
    const mColor = it?.color || gi?.color || '';
    // If this garment is linked to another garment's mockup, the SOURCE garment's mock is
    // the single source of truth for it — satisfied once the source has one, missing
    // otherwise (the linked garment's own per-item mock is intentionally ignored while
    // linked). Anchors: the job's primary design plus any art this garment uses.
    const linkAnchors = [allArt.find(a => a?.id === job?.art_file_id), ...artFiles].filter(Boolean);
    const srcKey = resolveMockLink(linkAnchors, mockSkuOf(mLine), mColor);
    if (srcKey) {
      // Look the source's mocks up across ALL the job's art (the source garment may pull
      // its art from a different file than this garment's anchors).
      const allAnchors = [...new Set([...linkAnchors, ...[...jobArtIds].map(aid => allArt.find(a => a?.id === aid)).filter(Boolean)])];
      if (mockLinkSourceFiles(allAnchors, srcKey).length === 0 && mLabel) missing.push(mLabel);
      return;
    }
    // Mockups are keyed by `sku|color` to disambiguate items that share a SKU across
    // colors — through garmentMockKey, so customer-supplied lines (which ALL carry the SKU
    // 'CUST-SUPPLIED') get one bucket each instead of one per color. Keyed on the raw SKU,
    // one garment's mockup satisfied this gate for every other custom garment of that color
    // and unmocked garments went to the coach (SO-2063). Older data may use a plain SKU key
    // or the legacy shared bucket — accept either.
    const perSku = artFiles.flatMap(a => {
      return itemMockFiles(a?.item_mockups, mLine);
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
      const mockKey = garmentMockKey(mLine);
      const missSlots = mockSlotKeys(mockKey, safeDecos(it))
        .filter(s => s.reversible && !s.primary && (!_idxs || _idxs.includes(s.di)))
        .filter(s => {
          const sub = safeStr(s.key).startsWith(mockKey) ? safeStr(s.key).slice(mockKey.length) : '';
          return !anchors.some(a => itemMockFiles(a?.item_mockups, mLine, sub).length > 0);
        });
      if (missSlots.length > 0 && mLabel) {
        missing.push(mLabel + ' (' + missSlots.map(s => (s.kind === 'art' ? 'art' : s.kind) + (s.side ? ' Side ' + s.side : '')).join(', ') + ')');
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
    // POLICY: the digitizer's sew-out proof in prod_files does NOT satisfy the mockup
    // gate. Jobs are required to carry a real garment mockup before Approve / Send to
    // Coach — a sew-out is often a recolor, and one reaching a coach as "the mockup"
    // is exactly what happened on SO-1661. The waiting_approval panel gives proof-only
    // art its two compliant paths (reuse an approved prior mock, or send to the artist
    // for a new one); the proof remains a labeled DISPLAY fallback (artProofFallback)
    // so approval screens still show what exists — it just can't pass the gate.
    if (mLabel) missing.push(mLabel);
  });
  return missing;
};

// Reversible art decorations must have BOTH ink color ways picked (Side A + Side B)
// before a proof is approved or sent. Mockups alone don't tell the decorator the
// reverse side's inks — on SO-1469 the white-side colors existed only inside the
// mockup JPGs and the decorator had to email asking for them. Same job/deco scoping
// as skusMissingMockups; returns ['506CR (Side A CW, Side B CW)'] style entries.
// DTF art is exempt (full-color print — ColorWaysEditor doesn't require CWs there).
export const skusMissingRevColorWays = (job, so) => {
  const items = safeArr(job?.items);
  if (items.length === 0) return [];
  const allArt = safeArt(so);
  const soItems = safeItems(so);
  const jobArtIds = jobArtFileIds(job, soItems);
  const missing = [];
  items.forEach(gi => {
    const it = soItems[gi?.item_idx];
    if (!it) return;
    const dis = jobItemDecoIdxs(gi);
    const mSku = it?.sku || gi?.sku || '';
    if (!mSku) return;
    const probs = [];
    safeDecos(it).forEach((d, di) => {
      if (dis && !dis.includes(di)) return;
      if (!d || d.kind !== 'art' || !d.reversible) return;
      if (!d.art_file_id || d.art_file_id === '__tbd' || !jobArtIds.has(d.art_file_id)) return;
      const af = allArt.find(a => a?.id === d.art_file_id);
      if ((af?.deco_type || d.type) === 'dtf') return;
      const cws = safeArr(af?.color_ways);
      if (cws.length < 2) { probs.push((af?.name ? '"' + af.name + '"' : 'art file') + ' needs 2 color ways'); return; }
      // A picked id must resolve to a live color way — a deleted CW leaves a dangling id.
      if (!(d.color_way_id && cws.some(c => c?.id === d.color_way_id))) probs.push('Side A CW');
      if (!(d.color_way_id_b && cws.some(c => c?.id === d.color_way_id_b))) probs.push('Side B CW');
    });
    if (probs.length > 0) missing.push(mSku + ' (' + [...new Set(probs)].join(', ') + ')');
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
  // Every art file this job's items reference, scoped to the decorations the job owns (an art-split
  // garment carries one art deco per design; swallowing the siblings would gate on the WRONG
  // design's mocks — SO-1131). Shared with skusMissingMockups / the OrderEditor mock panels via
  // jobArtFileIds so the set can't drift.
  const jobArtIds = jobArtFileIds(job, soItems);
  const urlOf = f => typeof f === 'string' ? f : (f?.url || '');
  const out = [];
  items.forEach(gi => {
    const it = soItems[gi?.item_idx];
    if (!it) return; // live SO line gone (deleted/reindexed) — nothing to mock
    const dis = jobItemDecoIdxs(gi);
    const ownedArtDecos = safeDecos(it)
      .filter((d, di) => (!dis || dis.includes(di)) && d?.kind === 'art');
    // Do not fall back to the job's primary design for a numbers/names-only slice. The job may
    // legitimately combine that slice with art on other garments, but there is no art mock to
    // confirm on this one (SO-1777).
    if (ownedArtDecos.length === 0) return;
    const decoArtIds = [...new Set(ownedArtDecos
      .filter(d => d?.art_file_id && d.art_file_id !== '__tbd' && jobArtIds.has(d.art_file_id))
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
    if (resolveMockLink(linkAnchors, mockSkuOf(it), mColor)) return;
    const mockKey = garmentMockKey(it);
    // A key belongs to THIS garment if it's the exact sku|color, the legacy bare sku, the
    // legacy shared placeholder bucket it may still sit in, or a color-way sub-key of this
    // garment (sku|color|cwid).
    const legacyKey = legacyMockKeyOf(it);
    const isOwnKey = k => k === mockKey || k === mSku || k.startsWith(mockKey + '|')
      || (!!legacyKey && (k === legacyKey || k.startsWith(legacyKey + '|')));
    // Each art file on the garment that lacks its OWN mock but carries prior mocks from other
    // garments needs a check — list them all, so a garment decorated by two designs (e.g. a
    // front and a back) shows both.
    const artFiles = [];
    artFilesForItem.forEach(a => {
      const im = a?.item_mockups || {};
      const hasOwn = Object.entries(im).some(([k, v]) => isOwnKey(k) && safeArr(v).length > 0);
      if (hasOwn) return;
      // A real general mock in the shared mockup_files/files bucket stands in for every garment,
      // satisfies the approval gate (skusMissingMockups accepts it), and is already shown/approved
      // on this order — so the garment is NOT missing one: don't nag "Check Mock" just because the
      // SAME design was later mocked per-garment on another order (SO-1023). BUT the digitizer's
      // sew-out proof in prod_files does NOT satisfy the gate (skusMissingMockups rejects it —
      // SO-1661): reused art carrying only a proof still needs a real garment mockup, so surface any
      // prior approved mock here (from priorByArtKey / this order's other-garment keys) — the whole
      // point of "reuse previous artwork" is to offer that ACTUAL mockup for confirm-or-redo instead
      // of leaving the rep with just the raw proof and a "send to artist" button. proof_dismissed
      // clears the general mock too. A per-item mock for a sibling garment makes the general bucket
      // ambiguous (wrong-colorway class), so it stops standing in and this garment falls through to
      // flag below (mirrors artProofFallback, which returns [] the moment ANY per-item mock exists).
      if (!a?.proof_dismissed) {
        const hasPerItem = Object.values(im).some(v => safeArr(v).length > 0);
        const genMock = (safeArr(a?.mockup_files).length > 0 ? safeArr(a.mockup_files) : safeArr(a?.files)).filter(displayableProofFile);
        if (!hasPerItem && genMock.length > 0) return;
      }
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
