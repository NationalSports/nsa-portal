import { jobHasLiveDecorations } from '../safeHelpers';

describe('jobHasLiveDecorations', () => {
  const soWithDecos = {
    items: [
      { sku: 'JM4687', decorations: [{ kind: 'art', art_file_id: 'af1', position: 'Front' }] },
      { sku: 'JM4707', decorations: [] },
    ],
  };

  test('true when claimed deco_idxs still resolve', () => {
    const j = {
      id: 'JOB-1',
      _merged: true,
      items: [{ item_idx: 0, deco_idx: 0, deco_idxs: [0], sku: 'JM4687' }],
    };
    expect(jobHasLiveDecorations(j, soWithDecos)).toBe(true);
  });

  test('false when every line decoration was cleared (SO-1057 after manual wipe)', () => {
    const so = {
      items: [
        { sku: 'JM4687', decorations: [] },
        { sku: 'JM4687', decorations: [] },
        { sku: 'JM4707', decorations: [] },
      ],
    };
    const j = {
      id: 'JOB-1057-01',
      _merged: true,
      art_file_id: 'af1774446660368',
      items: [
        { item_idx: 0, deco_idx: 0, deco_idxs: [0], sku: 'JM4687' },
        { item_idx: 1, deco_idx: 0, deco_idxs: [0], sku: 'JM4687' },
        { item_idx: 2, deco_idx: 0, deco_idxs: [0], sku: 'JM4707' },
      ],
    };
    expect(jobHasLiveDecorations(j, so)).toBe(false);
  });

  test('false when job items list is empty', () => {
    expect(jobHasLiveDecorations({ id: 'JOB-x', items: [] }, soWithDecos)).toBe(false);
    expect(jobHasLiveDecorations({ id: 'JOB-x' }, soWithDecos)).toBe(false);
  });

  test('false when claimed item_idx is gone', () => {
    const j = {
      items: [{ item_idx: 9, deco_idx: 0, deco_idxs: [0], sku: 'GONE' }],
    };
    expect(jobHasLiveDecorations(j, soWithDecos)).toBe(false);
  });

  test('false when deco_idxs point past the line deco list', () => {
    const j = {
      items: [{ item_idx: 0, deco_idx: 3, deco_idxs: [3], sku: 'JM4687' }],
    };
    expect(jobHasLiveDecorations(j, soWithDecos)).toBe(false);
  });

  test('legacy items without deco_idxs: any decoration on the line counts', () => {
    const j = {
      items: [{ item_idx: 0, deco_idx: 0, sku: 'JM4687' }],
    };
    expect(jobHasLiveDecorations(j, soWithDecos)).toBe(true);
    expect(jobHasLiveDecorations(j, { items: [{ decorations: [] }] })).toBe(false);
  });

  test('true if at least one claimed pair is still live', () => {
    const so = {
      items: [
        { decorations: [] },
        { decorations: [{ kind: 'numbers', position: 'Back' }] },
      ],
    };
    const j = {
      items: [
        { item_idx: 0, deco_idxs: [0] },
        { item_idx: 1, deco_idxs: [0] },
      ],
    };
    expect(jobHasLiveDecorations(j, so)).toBe(true);
  });
});
