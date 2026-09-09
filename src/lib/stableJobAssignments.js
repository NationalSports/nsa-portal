// Job membership follows artwork; submission state belongs to the job, not its quantity.
const disOf = row => Array.isArray(row?.deco_idxs) && row.deco_idxs.length
  ? row.deco_idxs : row?.deco_idx != null ? [row.deco_idx] : [];
const artIds = job => [...new Set((job?._art_ids?.length ? job._art_ids : [job?.art_file_id]).filter(id => id && id !== '__tbd'))];
const num = value => Math.max(0, Number(value) || 0);
const quiet = job => ['', 'draft', 'hold', 'ready'].includes(job.prod_status || '')
  && !job.decorated_at && !job.packed_at && !job.completed_at && !job.run1_done && !job.run2_done;
const sum = sizes => Object.values(sizes || {}).reduce((n, v) => n + num(v), 0);

// Split Art rewrites the decoration array. Recover its new indexes from the declared art
// before the positional heal can adopt a sibling design and its size allocation.
export function remapFrozenJobDecoIndexes(job, items) {
  const declared = new Set(artIds(job));
  if (!declared.size) return job;
  const survivingArt = (job.items || []).some(row => (items[row.item_idx]?.decorations || [])
    .some(d => d?.kind === 'art' && declared.has(d.art_file_id)));
  let changed = false;
  const rows = (job.items || []).map(row => {
    const decos = items[row.item_idx]?.decorations;
    if (!Array.isArray(decos)) return row;
    const old = disOf(row);
    if (old.length && old.every(di => decos[di] && (decos[di].kind !== 'art' || declared.has(decos[di].art_file_id)))) return row;
    const matches = decos.map((d, di) => d?.kind === 'art' && declared.has(d.art_file_id) ? di : null).filter(di => di != null);
    if (!matches.length) {
      const replaced = old.length && old.every(di => decos[di]?.kind === 'art' && decos[di].art_file_id
        && decos[di].art_file_id !== '__tbd' && !declared.has(decos[di].art_file_id));
      if (survivingArt && replaced) { changed = true; return null; }
      return row; // complete replacement / incomplete hydration: existing heal handles it
    }
    const kept = old.filter(di => decos[di] && decos[di].kind !== 'art');
    const next = [...new Set([...matches, ...kept])].sort((a, b) => a - b);
    if (JSON.stringify(next) === JSON.stringify(old)) return row;
    changed = true;
    return { ...row, deco_idx: next[0], deco_idxs: next };
  });
  return changed ? { ...job, items: rows.filter(Boolean) } : job;
}

// Changing one garment must leave the other garments' request and job id intact.
export function detachChangedArtRow(job, itemIdx) {
  const items = (job.items || []).filter(row => row.item_idx !== itemIdx);
  if (!items.length) return null;
  const total = items.reduce((n, row) => n + num(row.units), 0);
  const fulfilled = items.reduce((n, row) => n + Math.min(num(row.units), num(row.fulfilled)), 0);
  return { ...job, items, total_units: total, fulfilled_units: fulfilled,
    item_status: fulfilled >= total && total > 0 ? 'items_received' : fulfilled > 0 ? 'partially_received' : 'need_to_order' };
}

// An art split cannot allocate sizes the line no longer contains. Earlier designs claim first.
export function liveArtSplitSizes(item, decoIdx) {
  const decos = item.decorations || [];
  const deco = decos[decoIdx];
  if (!deco?.split_group || !deco.split_sizes) return null;
  const remaining = Object.fromEntries(Object.entries(item.sizes || {}).map(([sz, q]) => [sz, num(q)]));
  for (let di = 0; di <= decoIdx; di += 1) {
    const d = decos[di];
    if (d?.split_group !== deco.split_group || !d.split_sizes) continue;
    const allocation = {};
    Object.entries(d.split_sizes).forEach(([sz, q]) => {
      const take = Math.min(num(q), num(remaining[sz]));
      if (take > 0) allocation[sz] = take;
      remaining[sz] = num(remaining[sz]) - take;
    });
    if (di === decoIdx) return allocation;
  }
  return {};
}

// Refresh quantities in both directions while keeping all art/submittal fields intact.
// Only actual job splits freeze per-size shares; a plain saved sizes map is not a split.
export function refreshOpenJobRows(job, items, allJobs) {
  if (!quiet(job)) return job;
  const family = new Set([job.id]);
  let grew = true;
  while (grew) { grew = false; (allJobs || []).forEach(j => {
    if (j.split_from && family.has(j.split_from) && !family.has(j.id)) { family.add(j.id); grew = true; }
  }); }
  const manualSplit = !!job.split_from || family.size > 1;
  const byGarment = new Map();
  (job.items || []).forEach(row => {
    const key = row.item_idx + '::' + (row.sku || '');
    const previous = byGarment.get(key);
    if (!previous) byGarment.set(key, row);
    else byGarment.set(key, { ...previous, deco_idxs: [...new Set([...disOf(previous), ...disOf(row)])] });
  });
  const sourceRows = job._merged ? [...byGarment.values()] : (job.items || []);
  const rows = sourceRows.map(row => {
    const item = items[row.item_idx];
    if (!item) return row;
    const dis = disOf(row);
    const splitSizes = dis.length === 1 ? liveArtSplitSizes(item, dis[0]) : null;
    const lineSizes = { ...(item.sizes || {}) };
    if (!sum(lineSizes) && num(item.est_qty)) lineSizes.QTY = num(item.est_qty);
    const manualSizes = manualSplit && row.sizes;
    const sizes = manualSizes || (splitSizes !== null ? splitSizes : lineSizes);
    const fulSizes = {};
    Object.entries(sizes).forEach(([sz, quantity]) => {
      let available = (item.po_lines || []).reduce((n, p) => n + num(p.received?.[sz]), 0)
        + (item.pick_lines || []).filter(p => p.status === 'pulled').reduce((n, p) => n + num(p[sz]), 0);
      if (manualSizes && row.fulSizes) available = num(row.fulSizes[sz]);
      else if (splitSizes !== null) {
        const deco = item.decorations[dis[0]];
        item.decorations.forEach((d, di) => {
          if (di < dis[0] && d?.split_group === deco.split_group) available -= num(liveArtSplitSizes(item, di)?.[sz]);
        });
      }
      fulSizes[sz] = Math.min(num(quantity), Math.max(0, available));
    });
    const next = { ...row, ...(item.line_id ? { line_id: item.line_id } : {}), sku: item.sku, name: item.name || row.name, color: item.color || '',
      units: sum(sizes), fulfilled: sum(fulSizes) };
    if (splitSizes !== null || manualSplit && row.sizes) { next.sizes = { ...sizes }; next.fulSizes = fulSizes; }
    else { delete next.sizes; delete next.fulSizes; }
    if (splitSizes !== null) { next._artSplit = true; next.split_group = item.decorations[dis[0]].split_group; }
    else { delete next._artSplit; delete next.split_group; }
    return next;
  });
  const total = rows.reduce((n, row) => n + num(row.units), 0);
  const fulfilled = rows.reduce((n, row) => n + Math.min(num(row.units), num(row.fulfilled)), 0);
  return { ...job, items: rows, total_units: total, fulfilled_units: fulfilled,
    item_status: fulfilled >= total && total > 0 ? 'items_received' : fulfilled > 0 ? 'partially_received' : 'need_to_order' };
}

// Attach rebuilt, unsubmitted work to exactly one open submitted job with the SAME art
// set and methods. Never consume a split family, a manual hold, or another job's workflow.
export function attachSameArtAdditions(builtJobs, frozenJobs, sourceJobs, liveItems = []) {
  const familyIds = new Set();
  (sourceJobs || []).forEach(j => { if (j.split_from) { familyIds.add(j.id); familyIds.add(j.split_from); } });
  const signature = j => JSON.stringify([artIds(j).sort(), [...new Set(j.deco_types?.length ? j.deco_types : [j.deco_type])].sort(),
    [...new Set((j.items || []).flatMap(r => disOf(r).map(di => liveItems[r.item_idx]?.decorations?.[di])
      .filter(d => d && d.kind !== 'art').map(d => [d.kind, d.num_method || d.name_method || '', d.position || ''].join('@'))))].sort()]);
  let frozen = [...frozenJobs];
  const remaining = [];
  builtJobs.forEach(built => {
    const claims = new Set((built.items || []).flatMap(r => disOf(r).map(di => r.item_idx + '::' + di)));
    const donors = (sourceJobs || []).filter(j => (j.items || []).some(r => disOf(r).some(di => claims.has(r.item_idx + '::' + di))));
    const hasWorkflow = j => (j.art_requests || []).length || (j.art_messages || []).length
      || (j.sent_history || []).length || (j.rejections || []).length || j.sent_to_coach_at || j.coach_approved_at
      || j.coach_rejected || j.assigned_artist || j.rep_notes;
    const blocked = donors.some(j => familyIds.has(j.id) || j.split_from || j.auto_group_off || j.key?.includes('__hold') || !quiet(j) || hasWorkflow(j));
    const candidates = frozen.map((j, idx) => ({ j, idx })).filter(({ j }) =>
      artIds(j).length && quiet(j) && !j.split_from && !familyIds.has(j.id) && !j.auto_group_off
      && signature(j) === signature(built));
    if (blocked || candidates.length !== 1) { remaining.push(built); return; }
    const { j, idx } = candidates[0];
    frozen[idx] = { ...j, items: [...j.items, ...built.items] };
  });
  return { builtJobs: remaining, frozenJobs: frozen };
}
