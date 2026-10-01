import { PRIOR_ART_REVIEW, startPriorArtReview, reviewChangedArtwork } from './priorArtReview';

// Outside-decoration art flow (opt-in).
//
// A decoration routed to an OUTSIDE decorator normally gets no job at all — the vendor
// produces it. A rep can opt a decoration into the art flow (d.outside_art === true) so
// its design still goes through Request Art → mockup → customer approval → production
// files, exactly like in-house work. That workflow lives on an "outside art" job:
//
//   • key starts with OUTSIDE_ART_KEY_PREFIX and prod_status is 'outside'
//   • it is ART work only — never floor work — so every production / status / invoicing
//     reader skips it through productionJobs()
//   • it is built by buildOutsideArtJobs, OUTSIDE the in-house syncJobs pipeline, so none
//     of that pipeline's frozen/split/merge rules ever see it
//
// Old outside decorations have no outside_art stamp, so existing orders and jobs are
// untouched. ES module like lib/orderLineIdentity (CommonJS businessLogic requires it). The
// unbundled Netlify digests can't load ESM, so opsRecap and teamshop-orders inline the
// prod_status==='outside' half of isOutsideArtJob — keep those two copies in sync.

export const OUTSIDE_ART_KEY_PREFIX = 'outside_art:';
export const OUTSIDE_ART_PROD_STATUS = 'outside';

export const isOutsideArtJob = (j) => !!j && (j.prod_status === OUTSIDE_ART_PROD_STATUS || String(j.key || '').startsWith(OUTSIDE_ART_KEY_PREFIX));

// The jobs our floor actually produces. Use this anywhere jobs drive production boards,
// order status, shipping, invoicing or digests.
export const productionJobs = (jobs) => (Array.isArray(jobs) ? jobs : []).filter((j) => !isOutsideArtJob(j));

export const isRoutedOutside = (d) => !!d && (d.fulfillment === 'outside' || !!d.deco_po_id);

// Only designs (kind 'art') go through the art flow, and only when the rep opted in.
export const wantsOutsideArt = (d) => !!d && d.kind === 'art' && d.outside_art === true && isRoutedOutside(d);

const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const itemUnits = (it) => {
  const sz = it && it.sizes && typeof it.sizes === 'object' ? it.sizes : {};
  const t = Object.entries(sz).reduce((a, [k, v]) => (/^(drop_ship|unit_cost|_)/i.test(k) ? a : a + Math.max(0, num(v))), 0);
  return t > 0 ? t : num(it && it.est_qty);
};

// The outside decorator a job's garments go to (display only — not persisted on the job).
export const outsideArtVendor = (o, j) => {
  for (const gi of arr(j && j.items)) {
    const it = arr(o && o.items)[gi.item_idx];
    for (const di of arr(gi.deco_idxs)) { const d = arr(it && it.decorations)[di]; if (d && d.vendor) return d.vendor; }
  }
  const dp = arr(o && o.deco_pos).find((p) => p && !p.topstar_service && p.vendor);
  return dp ? dp.vendor : '';
};

// Build the outside-art jobs for an order: one job per design (art file), covering every
// garment that carries it. Workflow fields (art requests, artist, coach approval, messages,
// _version) carry over from the previous job with the same key; structure is re-derived.
//   artStatusOf(artFile, fallbackDecoType) — constants.artStatusForFile
//   reservedIds — every job id already used on the order, so new ids never collide
//   isStoreOrder — store pulls are pre-approved by the sale (same rule as in-house jobs)
export function buildOutsideArtJobs(o, prevJobs, { artStatusOf, reservedIds, isStoreOrder = false } = {}) {
  const arts = arr(o && o.art_files);
  const groups = new Map();
  arr(o && o.items).forEach((it, ii) => {
    if (!it || it.no_deco) return;
    arr(it.decorations).forEach((d, di) => {
      if (!wantsOutsideArt(d)) return;
      const hasArt = d.art_file_id && d.art_file_id !== '__tbd';
      const key = OUTSIDE_ART_KEY_PREFIX + (hasArt ? 'art_' + d.art_file_id : 'unassigned@' + String(d.position || ''));
      if (!groups.has(key)) groups.set(key, { key, artFileId: hasArt ? d.art_file_id : null, decoType: d.deco_type || null, positions: new Set(), rows: new Map() });
      const g = groups.get(key);
      g.positions.add(String(d.position || ''));
      let row = g.rows.get(ii);
      if (!row) {
        const u = itemUnits(it);
        row = { item_idx: ii, ...(it.line_id ? { line_id: it.line_id } : {}), deco_idx: di, deco_idxs: [], sku: it.sku || '—', name: String(it.name || '') || 'Unknown', color: String(it.color || ''), units: u, fulfilled: 0 };
        g.rows.set(ii, row);
      }
      row.deco_idxs.push(di);
    });
  });
  const previous = arr(prevJobs).filter(isOutsideArtJob);
  const prevByKey = new Map(previous.map(j => [j.key, j]));
  // Match replacements only when the complete decoration claim is unchanged and
  // unambiguous. A split or merge must never copy one job's approval to another.
  const claims = rows => JSON.stringify(arr(rows).flatMap(row =>
    arr(row.deco_idxs).length ? row.deco_idxs.map(di => [row.line_id || `index:${row.item_idx}:${row.sku}:${row.color}`, di])
      : [[row.line_id || `index:${row.item_idx}:${row.sku}:${row.color}`, row.deco_idx]]
  ).map(x => JSON.stringify(x)).sort());
  const unmatchedGroups = [...groups.values()].filter(g => !prevByKey.has(g.key));
  const retired = previous.filter(j => !groups.has(j.key));
  const replacementFor = g => {
    const signature = claims([...g.rows.values()]);
    const matches = retired.filter(j => claims(j.items) === signature);
    return matches.length === 1 && unmatchedGroups.filter(other => claims([...other.rows.values()]) === signature).length === 1 ? matches[0] : null;
  };
  const reserved = new Set([...(reservedIds || []), ...arr(prevJobs).map(j => j.id).filter(Boolean)]);
  const owned = new Set(previous.map(j => j.id));
  const used = new Set([...(reservedIds || []).filter(id => !owned.has(id)), ...arr(prevJobs).filter(j => !isOutsideArtJob(j)).map(j => j.id)]);
  const soNum = String((o && o.id) || '').replace('SO-', '') || '0';
  let n = 1;
  const mint = () => { let id; do { id = 'JOB-' + soNum + '-X' + String(n++).padStart(2, '0'); } while (reserved.has(id) || used.has(id)); used.add(id); return id; };
  return [...groups.values()].map((g) => {
    const ex = prevByKey.get(g.key) || replacementFor(g);
    const changedArt = !!ex && ex.key !== g.key;
    const artF = g.artFileId ? arts.find((a) => a.id === g.artFileId) : null;
    const derived = artF && artStatusOf ? artStatusOf(artF, g.decoType) : 'needs_art';
    // Same rules as the in-house builder: a brand-new job whose design is ALREADY approved
    // (reused art) waits for the rep to confirm it for this order; human-advanced states are
    // kept; an unassigned / missing design always reads needs_art.
    const fresh = !ex && !isStoreOrder && derived !== 'needs_art' && derived !== 'waiting_approval' ? PRIOR_ART_REVIEW : derived;
    const artStatus = !artF ? 'needs_art' : (ex && ex.art_status && ex.art_status !== 'needs_art' ? ex.art_status : fresh);
    let id = ex && ex.id;
    if (id && !used.has(id)) used.add(id); else if (!id || used.has(id)) id = mint();
    const items = [...g.rows.values()];
    const deco = (artF && artF.deco_type) || g.decoType || 'screen_print';
    let workflow = ex || {};
    let nextArtStatus = artStatus;
    if (changedArt) {
      const reset = { ...startPriorArtReview(ex), art_status: fresh,
        art_requests: ex.art_requests || [], art_messages: ex.art_messages || [],
        _coach_cleared: true, _art_moved: true };
      workflow = reviewChangedArtwork(ex, reset, artF ? [artF] : []) || reset;
      nextArtStatus = workflow.art_status;
    }
    return {
      ...workflow,
      id,
      key: g.key,
      art_file_id: g.artFileId,
      _art_ids: g.artFileId ? [g.artFileId] : [],
      art_name: (ex && ex._name_locked && ex.art_name) || (artF ? artF.name || 'Unnamed art' : 'Unassigned Art (' + [...g.positions].filter(Boolean).join(', ') + ')'),
      deco_type: deco,
      deco_types: [deco],
      positions: [...g.positions].filter(Boolean).join(', '),
      items,
      total_units: items.reduce((a, r) => a + r.units, 0),
      fulfilled_units: 0,
      art_status: nextArtStatus,
      item_status: (ex && ex.item_status) || 'need_to_order',
      prod_status: OUTSIDE_ART_PROD_STATUS,
      created_at: (ex && ex.created_at) || new Date().toLocaleDateString(),
    };
  });
}
