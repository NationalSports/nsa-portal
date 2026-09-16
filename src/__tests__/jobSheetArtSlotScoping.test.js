// A production job sheet must show ONLY the designs that job runs.
//
// SO-2121 / JOB-2121-03 (Fresno Pacific Athletics): the AT106 tee line carries two art
// decorations — the 8in Tall FPU logo that JOB-03 prints, and an "FPU Soccer Creed" design
// that belongs to a different job on the same line. The Decoration Spec table was already
// scoped by the job's deco_idxs (jobItemDecosOfKind), but the mockup collector and the art-file
// collector swept EVERY art decoration on the line, so the printed sheet showed the Soccer Creed
// mockup and listed its .ai under Production Files next to the FPU logo the press was running.
//
// jobItemArtSlots is the shared rule: this job's art decorations, each still carrying the
// positional slot index (ai) its mockup was keyed under by mockSlotKeys.
import { jobItemArtSlots, mockSlotKeys, garmentMockKey } from '../safeHelpers';

// The real SO-2121 shape: one garment line, two art decorations, one job per design.
const item = {
  sku: 'AT106', color: 'Team Navy Blue', name: "Adidas Men's Fresh T-Shirt",
  decorations: [
    { kind: 'art', position: 'Front', art_file_id: 'af-fpu', color_way_id: 'cw-white' },
    { kind: 'art', position: 'Front', art_file_id: 'af-creed', color_way_id: 'cw-orange' },
  ],
};
const jobFpu = { item_idx: 0, deco_idxs: [0] };
const jobCreed = { item_idx: 0, deco_idxs: [1] };

describe('jobItemArtSlots — job-scoped art decorations', () => {
  test('a job sees only its own art decoration', () => {
    expect(jobItemArtSlots(jobFpu, item).map((s) => s.d.art_file_id)).toEqual(['af-fpu']);
    expect(jobItemArtSlots(jobCreed, item).map((s) => s.d.art_file_id)).toEqual(['af-creed']);
  });

  test('slot index survives the scoping — the second design still reads its own slot key', () => {
    // Numbered across the LINE, not across the job's slice: scoping to the second decoration
    // must not renumber it to 0 and make it read the first design's bare mockup key.
    const [slot] = jobItemArtSlots(jobCreed, item);
    expect(slot.ai).toBe(1);
    expect(slot.di).toBe(1);
    const base = garmentMockKey(item);
    const key = base + (slot.ai === 0 ? '' : '|' + (slot.d.color_way_id || 'd' + slot.ai));
    // Same key the editor wrote the mockup under.
    expect(mockSlotKeys(base, item.decorations).find((s) => s.di === 1).key).toBe(key);
    expect(key).not.toBe(base);
  });

  test('a job with no deco_idxs still covers every art decoration on the line', () => {
    // Unknown coverage (legacy jobs) must keep working, not go blank.
    expect(jobItemArtSlots({ item_idx: 0 }, item).map((s) => s.ai)).toEqual([0, 1]);
    expect(jobItemArtSlots({ item_idx: 0, deco_idxs: [] }, item).map((s) => s.ai)).toEqual([0, 1]);
  });

  test('non-art and unresolved (__tbd) decorations are left out and consume no slot index', () => {
    const mixed = {
      sku: 'AT106', color: 'Team Navy Blue',
      decorations: [
        { kind: 'numbers', position: 'Back' },
        { kind: 'art', position: 'Front', art_file_id: '__tbd' },
        { kind: 'art', position: 'Front', art_file_id: 'af-fpu' },
        { kind: 'art', position: 'Back', art_file_id: 'af-creed' },
      ],
    };
    const slots = jobItemArtSlots({ item_idx: 0 }, mixed);
    expect(slots.map((s) => [s.d.art_file_id, s.ai, s.di])).toEqual([['af-fpu', 0, 2], ['af-creed', 1, 3]]);
  });

  test('missing / malformed rows do not throw', () => {
    expect(jobItemArtSlots({ item_idx: 0 }, null)).toEqual([]);
    expect(jobItemArtSlots(null, { decorations: [null, { kind: 'art', art_file_id: 'a' }] })
      .map((s) => s.d.art_file_id)).toEqual(['a']);
  });
});
