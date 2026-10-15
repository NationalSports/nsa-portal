/**
 * SO-1801: the release wizard re-released split slice JOB-1801-01-C1 over its own id and wrote
 * split_from: null. The parent's next quantity refresh no longer saw the slice and grew back to
 * the full line, re-listing the 5 IS1116 shirts the slice had already printed.
 */
import { releasedSplitLink } from '../lib/artSplitFamily';
import { refreshOpenJobRows } from '../lib/stableJobAssignments';

describe('releasedSplitLink', () => {
  test('keeps parent link and split key suffix for a re-released slice', () => {
    const slice = { id: 'JOB-1801-01-C1', key: 'screen_print::art_af1__split__C1', split_from: 'JOB-1801-01' };
    expect(releasedSplitLink(slice)).toEqual({ keySuffix: '__split__C1', fields: { split_from: 'JOB-1801-01' } });
  });

  test('keeps the open-backorder flag and nested suffixes', () => {
    const slice = { id: 'JOB-1-S-S', key: 'k__split__S__split__S', split_from: 'JOB-1-S', split_open: true };
    expect(releasedSplitLink(slice)).toEqual({ keySuffix: '__split__S__split__S', fields: { split_from: 'JOB-1-S', split_open: true } });
  });

  test('a job that was never split stays unlinked', () => {
    expect(releasedSplitLink({ id: 'JOB-1-01', key: 'screen_print::art_af1' })).toEqual({ keySuffix: '', fields: { split_from: null } });
    expect(releasedSplitLink(null)).toEqual({ keySuffix: '', fields: { split_from: null } });
  });
});

describe('parent refresh with a linked slice (SO-1801 regression)', () => {
  const items = [{ sku: 'IS1116', name: 'Adidas M D4T LS Tee', color: 'Black', sizes: { M: 1, L: 3, XL: 1, '2XL': 1 }, decorations: [] }];
  const parent = { id: 'JOB-1801-01', key: 'released_screen_print_JOB-1801-01', prod_status: 'hold',
    items: [{ item_idx: 0, sku: 'IS1116', deco_idx: 0, deco_idxs: [0], sizes: { '2XL': 1 }, fulSizes: {}, units: 1 }] };
  const sliceBase = { id: 'JOB-1801-01-C1', prod_status: 'completed',
    items: [{ item_idx: 0, sku: 'IS1116', deco_idx: 0, deco_idxs: [0], sizes: { M: 1, L: 3, XL: 1 }, units: 5 }] };

  test('parent keeps only its own share when the slice stays linked', () => {
    const slice = { ...sliceBase, key: 'released_screen_print_JOB-1801-01-C1__split__C1', ...releasedSplitLink({ ...sliceBase, key: 'x__split__C1', split_from: 'JOB-1801-01' }).fields };
    const out = refreshOpenJobRows(parent, items, [parent, slice]);
    expect(out.total_units).toBe(1);
    expect(out.items[0].sizes).toEqual({ '2XL': 1 });
  });

  test('an orphaned slice (the old behavior) lets the parent grow back to the full line', () => {
    const orphan = { ...sliceBase, key: 'released_screen_print_JOB-1801-01-C1', split_from: null };
    const out = refreshOpenJobRows(parent, items, [parent, orphan]);
    expect(out.total_units).toBe(6);
  });
});
