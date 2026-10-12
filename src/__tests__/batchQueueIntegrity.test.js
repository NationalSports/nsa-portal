import { batchEntryLinkState, orphanedBatchEntries, resolveBatchItemIndex, dbRowsLinkEntry } from '../lib/batchQueueIntegrity';

// SO-2444 after the rejected save: five saved lines, queue entry for a sixth that never landed.
const so = {
  id: 'SO-2444', _itemsHydrated: true,
  items: [
    { line_id: 'f4af', sku: 'JX4476', color: 'Black/White', po_lines: [] },
    { line_id: '3c2f', sku: 'JX4481', po_lines: [] },
    { line_id: 'f3c7', sku: 'JX4456', po_lines: [] },
    { line_id: '5152', sku: 'JX4467', po_lines: [] },
    { line_id: '2a6a', sku: 'AT104', color: 'Team Royal Blue/ White', po_lines: [{ po_id: 'PO 60255 CSMBB', batch_queue_id: 'BPO old', status: 'received' }] },
  ],
};
const orphan = { id: 'BPO 1791781708588', so_id: 'SO-2444', po_id: 'PO 60700 CSMBB', created_at: '10/12/2026, 7:08:28 AM', items: [{ sku: 'AT104', color: 'Black/ White', line_id: '7c2f', item_idx: 5, qty: 2 }] };

describe('batchEntryLinkState', () => {
  it('flags the SO-2444 entry whose line never reached the order', () => {
    expect(batchEntryLinkState(orphan, so)).toBe('missing_line');
  });
  it('is ok once the order holds the queued PO line', () => {
    const fixed = { ...so, items: [...so.items, { line_id: '7c2f', sku: 'AT104', po_lines: [{ po_id: 'PO 60700 CSMBB', batch_queue_id: orphan.id, status: 'queued' }] }] };
    expect(batchEntryLinkState(orphan, fixed)).toBe('ok');
  });
  it('is ok when the line exists but its PO line is missing (backstop can attach by id)', () => {
    const lineOnly = { ...so, items: [...so.items, { line_id: '7c2f', sku: 'AT104', po_lines: [] }] };
    expect(batchEntryLinkState(orphan, lineOnly)).toBe('ok');
  });
  it('never guesses when the order is missing or did not load cleanly', () => {
    expect(batchEntryLinkState(orphan, undefined)).toBe('unverified');
    expect(batchEntryLinkState(orphan, { ...so, _itemsHydrated: false })).toBe('unverified');
    expect(batchEntryLinkState(orphan, { ...so, id: 'SO-9' })).toBe('unverified');
  });
  it('leaves legacy entries without line ids alone', () => {
    expect(batchEntryLinkState({ ...orphan, items: [{ sku: 'AT104', item_idx: 4 }] }, so)).toBe('ok');
  });
  it('gives a just-queued entry time for its order save to arrive', () => {
    const queuedAt = Date.parse(orphan.created_at);
    expect(batchEntryLinkState(orphan, so, { now: queuedAt + 30 * 1000 })).toBe('unverified');
    expect(batchEntryLinkState(orphan, so, { now: queuedAt + 3 * 60 * 1000 })).toBe('missing_line');
  });
  it('leaves All School allocations alone', () => {
    expect(batchEntryLinkState({ ...orphan, all_school_allocation_id: 'x' }, so)).toBe('ok');
  });
});

describe('orphanedBatchEntries', () => {
  it('returns only the orphans across a vendor group', () => {
    const ok = { id: 'BPO ok', so_id: 'SO-2444', items: [{ line_id: 'f4af', item_idx: 0 }] };
    expect(orphanedBatchEntries([ok, orphan], [so]).map(b => b.id)).toEqual([orphan.id]);
  });
});

describe('resolveBatchItemIndex', () => {
  it('matches by line id, wherever the line now sits', () => {
    const moved = { items: [so.items[4], ...so.items.slice(0, 4)] };
    expect(resolveBatchItemIndex(moved.items, { line_id: '2a6a', item_idx: 4 })).toBe(0);
  });
  it('never falls back to the index when the line id is gone', () => {
    const six = [...so.items, { line_id: 'other', sku: 'XYZ' }];
    expect(resolveBatchItemIndex(six, { line_id: '7c2f', item_idx: 5 })).toBe(-1);
  });
  it('keeps index matching for legacy entries', () => {
    expect(resolveBatchItemIndex(so.items, { item_idx: 2 })).toBe(2);
    expect(resolveBatchItemIndex(so.items, { item_idx: 9 })).toBe(-1);
  });
});

describe('dbRowsLinkEntry', () => {
  it('reads batch_queue_id from the stored sizes json', () => {
    expect(dbRowsLinkEntry([{ sizes: { M: 2, batch_queue_id: orphan.id } }], orphan.id)).toBe(true);
    expect(dbRowsLinkEntry([{ sizes: { M: 2 } }], orphan.id)).toBe(false);
    expect(dbRowsLinkEntry([], orphan.id)).toBe(false);
  });
});
