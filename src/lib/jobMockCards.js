import { safeArr, safeArt, safeItems, safeDecos, garmentMockKey, mockSlotKeys, jobItemDecoIdxs, garmentMockCandidates } from '../safeHelpers';

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
      return { ...slot, artFile, artId: artFile?.id, label: slot.kind === 'art' ? artFile?.name || 'Artwork' : slot.kind === 'numbers' ? 'Numbers' : 'Names', sub: [d.position, slot.side && 'Side ' + slot.side].filter(Boolean).join(' · ') };
    });
    const slots = allSlots.filter(s => s.artId && (!owned || owned.includes(s.di))).filter(s => {
      const key = s.artId + '|' + s.key;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).map(s => {
      const a = s.artFile;
      const priorKey = (a.name || '').trim().toLowerCase() + '||' + (a.deco_type || '');
      const prior = [...safeArr(priorMocks[priorKey])].sort((x, y) => Number(y.from === garmentMockKey(item)) - Number(x.from === garmentMockKey(item)));
      const candidates = garmentMockCandidates({ files: [...garmentMockCandidates(a), ...prior.flatMap(g => safeArr(g.files))] });
      return { ...s, candidates };
    });
    return slots.length ? [{ item, slots, allSlots: allSlots.map(s => slots.find(ownedSlot => ownedSlot.key === s.key && ownedSlot.artId === s.artId) || s) }] : [];
  });
}
