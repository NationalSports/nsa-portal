import { safeArr, safeArt, safeItems, safeDecos, garmentMockKey, mockSlotKeys, jobItemDecoIdxs, garmentMockCandidates, itemMockFiles } from '../safeHelpers';

// Shared by job detail and both Art Dashboard dialogs. Read all SO artwork,
// not just artwork currently assigned to the selected job.
export function garmentSlotCandidates(slot, item, arts, prior = []) {
  const a = slot.artFile || {};
  const sameGarment = slot.kind === 'art' && !slot.side ? safeArr(arts).filter(other => other.id !== a.id).flatMap(other =>
    safeArr(other.item_mockups?.[garmentMockKey(item)]).map(f => ({ ...(typeof f === 'string' ? { url: f } : f), source_art_name: other.name || 'Other artwork', requires_mock_review: true }))
  ) : [];
  return garmentMockCandidates({ files: [
    ...itemMockFiles(a.item_mockups, item), ...sameGarment,
    ...prior.flatMap(g => safeArr(g.files)), ...garmentMockCandidates(a),
  ] });
}

// Build keys before filtering by job: a split job's second design must not write
// into the first design's slot. Previous-order images are suggestions, never mocks.
export function jobMockCardGroups(job, order, priorMocks = {}) {
  const arts = safeArt(order);
  const seen = new Set();
  return safeArr(job.items).flatMap(gi => {
    const item = safeItems(order)[gi.item_idx];
    if (!item) return [];
    const decos = safeDecos(item);
    const owned = jobItemDecoIdxs(gi);
    const anchor = arts.find(a => a.id === job.art_file_id);
    const allSlots = mockSlotKeys(garmentMockKey(item), decos).map(slot => {
      const d = decos[slot.di];
      const artFile = slot.kind === 'art' ? arts.find(a => a.id === d.art_file_id) : anchor;
      const cwId = slot.kind === 'art' ? ((slot.side === 'B' ? d.color_way_id_b : d.color_way_id) || null) : null;
      return { ...slot, artFile, artId: artFile?.id, cwId, label: slot.kind === 'art' ? artFile?.name || 'Artwork' : slot.kind === 'numbers' ? 'Numbers' : 'Names', sub: [d.position, slot.side && 'Side ' + slot.side].filter(Boolean).join(' · ') };
    });
    const slots = allSlots.filter(s => s.artId && (!owned || owned.includes(s.di))).filter(s => {
      const key = s.artId + '|' + s.key;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).map(s => {
      const a = s.artFile;
      const priorKey = (a.name || '').trim().toLowerCase() + '||' + (a.deco_type || '');
      const prior = [...safeArr(priorMocks[priorKey])].sort((x, y) => Number(y.from === garmentMockKey(item)) - Number(x.from === garmentMockKey(item)));
      // A store garment proof may still live on the original art after the rep
      // assigns digitized/replacement artwork. Offer the exact garment's images
      // before sew-out references, but never count them as the new art's mock.
      // No bare-SKU fallback across art: another color must not be suggested here.
      const candidates = garmentSlotCandidates(s, item, arts, prior);
      return { ...s, candidates };
    });
    return slots.length ? [{ gi, item, slots, allSlots: allSlots.map(s => slots.find(ownedSlot => ownedSlot.key === s.key && ownedSlot.artId === s.artId) || s) }] : [];
  });
}
