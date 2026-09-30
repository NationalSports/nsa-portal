import { jobItemDecoIdxs, safeArt, safeDecos, safeItems } from '../safeHelpers';

// A garment split gets a design copy with no selected garment mock. The source
// job's art and mock history stay intact, and only the selected line is rewired.
export function splitPriorArtwork(order, splitItems, keepItems, stamp = Date.now()) {
  const items = safeItems(order);
  const artIdsFor = group => {
    const ids = new Set();
    group.forEach(gi => {
      const owned = jobItemDecoIdxs(gi);
      safeDecos(items[gi.item_idx]).forEach((d, di) => {
        if ((!owned || owned.includes(di)) && d.kind === 'art' && d.art_file_id && d.art_file_id !== '__tbd') ids.add(d.art_file_id);
      });
    });
    return ids;
  };
  const keepArtIds = artIdsFor(keepItems);
  const artCopies = new Map();
  const copiedArt = [...artIdsFor(splitItems)].map((id, i) => {
    const source = safeArt(order).find(a => a.id === id);
    if (!source) return null;
    const nextId = 'af' + stamp + '-split-' + i;
    artCopies.set(id, nextId);
    const copy = JSON.parse(JSON.stringify(source));
    return {
      ...copy, id: nextId, reused_from_so: order.id,
      mockup_files: [],
      // Keep artwork previews in files for the review panel. Reused art cannot
      // pass the new garment's mock gate from this general file bucket.
      files: copy.files || [],
      // A film order belongs to the source job. Keep actual artwork files for
      // reference, but require a fresh order confirmation for the split job.
      prod_files: (copy.prod_files || []).filter(file => !file?.dtf_order),
      item_mockups: {}, mock_links: {}, prod_files_attached: false,
      uploaded: new Date().toLocaleDateString(),
    };
  }).filter(Boolean);
  const selectedLines = new Map(splitItems.map(gi => [gi.item_idx, gi]));
  const updatedItems = items.map((line, idx) => {
    const gi = selectedLines.get(idx);
    if (!gi) return line;
    const owned = jobItemDecoIdxs(gi);
    return { ...line, decorations: safeDecos(line).map((d, di) => {
      const nextId = (!owned || owned.includes(di)) && d.kind === 'art' ? artCopies.get(d.art_file_id) : null;
      return nextId ? { ...d, art_file_id: nextId } : d;
    }) };
  });
  return { copiedArt, updatedItems, keepArtIds, artCopies };
}
