import { shouldAdoptServerCopy, adoptServerCopy, childVersionSig, childRowsNewer } from '../lib/editorServerAdopt';

// SO-2444, 2026-10-12: tab open overnight at v126 already holding the artist's merged art
// change, server at v132. The first edit must not be built on the stranded v126 base.
const tab = {
  id: 'SO-2444', _version: 126,
  items: [{ line_id: 'f4af', sku: 'JX4476', color: 'Black/White', sizes: { M: 8 } }],
  art_files: [{ id: 'af1', prod_files: [{ name: '11in Bulldog Basketball Seps.ai' }] }],
  _hydratedPoIds: ['PO 59442 CSMBB'], _hydratedPickIds: ['IF-1175'], _hydratedArtIds: ['af1'],
  _deletedItemKeys: ['OLD|Red'], _deletedPoIds: ['PO 1 X'],
};
const server = {
  id: 'SO-2444', _version: 132,
  items: [{ line_id: 'f4af', sku: 'JX4476', color: 'Black/White', sizes: { M: 8 } }],
  art_files: [{ id: 'af1', prod_files: [{ name: '11in Bulldog Basketball Seps.ai' }] }],
  _hydratedPoIds: ['PO 59442 CSMBB', 'PO 60255 CSMBB'], _hydratedPickIds: ['IF-1217'],
};

describe('shouldAdoptServerCopy', () => {
  it('adopts a newer server copy into a clean editor (the SO-2444 overnight tab)', () => {
    expect(shouldAdoptServerCopy(tab, server, {})).toBe(true);
  });
  it('never adopts over unsaved work', () => {
    expect(shouldAdoptServerCopy(tab, server, { dirty: true })).toBe(false);
    expect(shouldAdoptServerCopy(tab, server, { pendingSizing: true })).toBe(false);
    expect(shouldAdoptServerCopy(tab, server, { saving: true })).toBe(false);
  });
  it('ignores equal, older or missing server versions', () => {
    expect(shouldAdoptServerCopy(tab, { ...server, _version: 126 }, {})).toBe(false);
    expect(shouldAdoptServerCopy(tab, { ...server, _version: 120 }, {})).toBe(false);
    expect(shouldAdoptServerCopy(tab, { ...server, _version: null }, {})).toBe(false);
  });
  it('leaves a never-saved local order alone', () => {
    expect(shouldAdoptServerCopy({ ...tab, _version: undefined }, server, {})).toBe(false);
  });
  it('never crosses documents', () => {
    expect(shouldAdoptServerCopy(tab, { ...server, id: 'SO-2445' }, {})).toBe(false);
  });
  it('compares numerically, not as strings', () => {
    expect(shouldAdoptServerCopy({ ...tab, _version: '99' }, { ...server, _version: '100' }, {})).toBe(true);
  });
});

describe('adoptServerCopy', () => {
  const next = adoptServerCopy(tab, server);
  it('takes the server content and version', () => {
    expect(next._version).toBe(132);
    expect(next.items).toBe(server.items);
  });
  it('keeps this session\'s deletion tombstones', () => {
    expect(next._deletedItemKeys).toEqual(['OLD|Red']);
    expect(next._deletedPoIds).toEqual(['PO 1 X']);
  });
  it('unions hydrated-id guards instead of shrinking them', () => {
    expect(next._hydratedPoIds.sort()).toEqual(['PO 59442 CSMBB', 'PO 60255 CSMBB']);
    expect(next._hydratedPickIds.sort()).toEqual(['IF-1175', 'IF-1217']);
    expect(next._hydratedArtIds).toEqual(['af1']);
  });
  it('does not mutate either input', () => {
    expect(tab._version).toBe(126);
    expect(server._deletedItemKeys).toBeUndefined();
  });
});

describe('job/artwork rows newer at the same order version', () => {
  const local = { id: 'SO-2444', _version: 137, jobs: [{ id: 'JOB-2444-04', _version: 18 }, { id: 'JOB-NEW' }], art_files: [{ id: 'af1', _version: 29 }] };
  it('adopts when a shared job or art row is newer', () => {
    expect(shouldAdoptServerCopy(local, { ...local, jobs: [{ id: 'JOB-2444-04', _version: 19 }] }, {})).toBe(true);
    expect(shouldAdoptServerCopy(local, { ...local, art_files: [{ id: 'af1', _version: 30 }] }, {})).toBe(true);
  });
  it('never over unsaved work, and never from an older order version', () => {
    const newer = { ...local, jobs: [{ id: 'JOB-2444-04', _version: 19 }] };
    expect(shouldAdoptServerCopy(local, newer, { dirty: true })).toBe(false);
    expect(shouldAdoptServerCopy(local, { ...newer, _version: 136 }, {})).toBe(false);
  });
  it('ignores rows only one side has and rows without versions', () => {
    expect(childRowsNewer(local, { ...local, jobs: [{ id: 'JOB-NEW', _version: 1 }, { id: 'JOB-OTHER', _version: 5 }] })).toBe(false);
    expect(childRowsNewer(local, { ...local, jobs: [{ id: 'JOB-2444-04' }] })).toBe(false);
  });
  it('childVersionSig changes with any row version and ignores order', () => {
    const a = childVersionSig(local);
    expect(childVersionSig({ ...local, jobs: [...local.jobs].reverse() })).toBe(a);
    expect(childVersionSig({ ...local, art_files: [{ id: 'af1', _version: 30 }] })).not.toBe(a);
    expect(childVersionSig({})).toBe('|');
  });
});
