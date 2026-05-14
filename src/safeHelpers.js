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
  const jobArtIds = new Set(safeArr(job?._art_ids).filter(Boolean));
  if (jobArtIds.size === 0 && job?.art_file_id) jobArtIds.add(job.art_file_id);
  const allArt = safeArt(so);
  const soItems = safeItems(so);
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
    const perSku = artFiles.flatMap(a => safeArr(a?.item_mockups?.[gi?.sku]));
    if (perSku.length > 0) return;
    const general = artFiles.flatMap(a => safeArr(a?.mockup_files).length > 0 ? safeArr(a?.mockup_files) : safeArr(a?.files));
    if (general.length > 0) return;
    if (gi?.sku) missing.push(gi.sku);
  });
  return missing;
};
