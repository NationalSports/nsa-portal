import { stableStringify, fingerprint, createRowBaseStore, snapshotRow, changedSinceBase, addedSinceBase, mergeStaleJobRow, fileKey } from '../lib/staleRowMerge';

const JOB_FIELDS = ['art_status', 'assigned_artist', 'art_requests', 'notes', 'rep_notes', 'items', 'art_messages'];

// SO-2444-style job: the rep's tab loaded it at v18; the artist then assigned himself and closed
// the request (v19). The rep's copy only differs where the rep actually edited (rep_notes).
const atV18 = {
  id: 'JOB-2444-04', so_id: 'SO-2444', art_status: 'art_requested', assigned_artist: null, notes: null, rep_notes: null,
  art_requests: [{ id: 'AR-1', status: 'requested', artist: null }], items: [{ sku: 'JX4481', units: 25 }],
  art_messages: [{ id: 'AM-1', text: 'hi' }],
};
const atV19 = { ...atV18, assigned_artist: 'tm-evan', art_requests: [{ id: 'AR-1', status: 'completed', artist: 'tm-evan' }], art_status: 'waiting_approval', _version: 19 };
const repCopy = { ...atV18, rep_notes: 'rush — game Friday' };

describe('mergeStaleJobRow', () => {
  const base = snapshotRow(atV18, { fields: JOB_FIELDS });
  it('keeps the artist\'s newer fields and the rep\'s own edit', () => {
    const { row, kept } = mergeStaleJobRow(repCopy, atV19, base);
    expect(row.assigned_artist).toBe('tm-evan');
    expect(row.art_requests).toEqual([{ id: 'AR-1', status: 'completed', artist: 'tm-evan' }]);
    expect(row.art_status).toBe('waiting_approval');
    expect(row.rep_notes).toBe('rush — game Friday');
    expect(kept).toEqual(['rep_notes']);
  });
  it('a stale copy with no edits writes the database row back unchanged', () => {
    const { row, kept } = mergeStaleJobRow({ ...atV18 }, atV19, base);
    expect(kept).toEqual([]);
    JOB_FIELDS.forEach(f => expect(row[f]).toEqual(atV19[f]));
  });
  it('never touches identity', () => {
    const { row } = mergeStaleJobRow({ ...repCopy, so_id: 'SO-2444' }, { ...atV19, so_id: 'SO-OTHER' }, base);
    expect(row.id).toBe('JOB-2444-04');
    expect(row.so_id).toBe('SO-2444');
  });
  it('without a base behaves exactly as before (client row as-is)', () => {
    const { row, kept } = mergeStaleJobRow(repCopy, atV19, null);
    expect(row).toBe(repCopy);
    expect(kept).toBeNull();
  });
  it('treats key order, null and undefined as unchanged', () => {
    const reordered = { ...atV18, art_requests: [{ artist: null, status: 'requested', id: 'AR-1' }], notes: undefined };
    const { kept } = mergeStaleJobRow(reordered, atV19, base);
    expect(kept).toEqual([]);
  });
  it('a field the database row lacks is left to the client', () => {
    const { row } = mergeStaleJobRow({ ...atV18, brand_new_col: 1 }, atV19, base);
    expect(row.brand_new_col).toBe(1);
  });
});

describe('snapshotRow is immune to later in-place mutation', () => {
  it('a nested array pushed after the snapshot counts as a change', () => {
    const live = { ...atV18, art_messages: [...atV18.art_messages] };
    const base = snapshotRow(live, { fields: JOB_FIELDS });
    live.art_messages.push({ id: 'AM-2', text: 'new' });
    expect(changedSinceBase(base, 'art_messages', live.art_messages)).toBe(true);
    expect(changedSinceBase(base, 'notes', live.notes)).toBe(false);
  });
});

describe('createRowBaseStore', () => {
  it('stores by key and version, keeps only the newest versions', () => {
    const s = createRowBaseStore({ keepVersions: 2 });
    s.record('job|SO-1|J', 1, { f: { a: 1 } });
    s.record('job|SO-1|J', 2, { f: { a: 2 } });
    s.record('job|SO-1|J', 3, { f: { a: 3 } });
    expect(s.get('job|SO-1|J', 1)).toBeNull();
    expect(s.get('job|SO-1|J', 3).f.a).toBe(3);
    expect(s.has('job|SO-1|J', 2)).toBe(true);
    expect(s.get('job|SO-1|OTHER', 2)).toBeNull();
  });
  it('ignores missing keys/versions', () => {
    const s = createRowBaseStore();
    s.record('', 1, {}); s.record('k', null, {}); s.record('k', 'x', {});
    expect(s.size).toBe(0);
  });
});

describe('file collections', () => {
  const base = snapshotRow({ prod_files: [{ url: 'a.ai' }, { url: 'b.ai' }] }, { fields: [], fileCollections: ['prod_files'] });
  it('finds only what the client added since its base', () => {
    expect(addedSinceBase([{ url: 'a.ai' }, { url: 'c.ai' }], base.files.prod_files)).toEqual([{ url: 'c.ai' }]);
  });
  it('without base keys returns the list unchanged', () => {
    expect(addedSinceBase([{ url: 'a.ai' }], null)).toEqual([{ url: 'a.ai' }]);
  });
  it('fileKey accepts strings, url or name', () => {
    expect([fileKey('x'), fileKey({ url: 'u' }), fileKey({ name: 'n' }), fileKey(null)]).toEqual(['x', 'u', 'n', '']);
  });
});

describe('fingerprint / stableStringify', () => {
  it('is key-order independent and distinguishes values', () => {
    expect(fingerprint({ a: 1, b: [1, 2] })).toBe(fingerprint({ b: [1, 2], a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
    expect(fingerprint(null)).toBe(fingerprint(undefined));
    expect(stableStringify({ z: undefined, a: 1 })).toBe('{"a":1}');
  });
});
