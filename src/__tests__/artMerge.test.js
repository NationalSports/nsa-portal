// Regression tests for the art-file superset merge — the data-loss guard that fixes the artist's
// "I have to upload images twice" / "data keeps disappearing" reports. The reconciliation engine
// (poll + realtime reloadAll) must never drop a file the user just added to an existing art group
// when a server read lands a beat behind the upload.
import { mergeArtGroupFiles, mergeArtFileSuperset } from '../utils';

describe('mergeArtGroupFiles', () => {
  test('keeps a local file the incoming (stale) copy is missing', () => {
    const ext = { id: 'a1', status: 'approved', mockup_files: [{ url: 'A' }] };
    const loc = { id: 'a1', status: 'needs_approval', mockup_files: [{ url: 'A' }, { url: 'B' }] };
    const m = mergeArtGroupFiles(ext, loc);
    expect(m.mockup_files.map(f => f.url)).toEqual(['A', 'B']); // B (just uploaded) preserved
    expect(m.status).toBe('approved'); // incoming scalar fields still win
  });

  test('unions prod_files and files too, dedupes by url, supports string entries', () => {
    const ext = { id: 'a1', prod_files: ['P1'], files: [{ url: 'F1' }] };
    const loc = { id: 'a1', prod_files: ['P1', 'P2'], files: [{ url: 'F1' }, { url: 'F2' }] };
    const m = mergeArtGroupFiles(ext, loc);
    expect(m.prod_files).toEqual(['P1', 'P2']);
    expect(m.files.map(f => f.url)).toEqual(['F1', 'F2']);
  });

  test('unions item_mockups per key', () => {
    const ext = { id: 'a1', item_mockups: { 'sku|red': [{ url: 'M1' }] } };
    const loc = { id: 'a1', item_mockups: { 'sku|red': [{ url: 'M1' }, { url: 'M2' }], 'sku|blue': [{ url: 'M3' }] } };
    const m = mergeArtGroupFiles(ext, loc);
    expect(m.item_mockups['sku|red'].map(f => f.url)).toEqual(['M1', 'M2']);
    expect(m.item_mockups['sku|blue'].map(f => f.url)).toEqual(['M3']);
  });

  test('returns the incoming ref unchanged when local adds nothing (no spurious re-render)', () => {
    const ext = { id: 'a1', mockup_files: [{ url: 'A' }] };
    const loc = { id: 'a1', mockup_files: [{ url: 'A' }] };
    expect(mergeArtGroupFiles(ext, loc)).toBe(ext);
  });
});

describe('mergeArtFileSuperset', () => {
  test('keeps a local-only art group the incoming snapshot is missing', () => {
    const ext = [{ id: 'a1', mockup_files: [{ url: 'A' }] }];
    const loc = [{ id: 'a1', mockup_files: [{ url: 'A' }] }, { id: 'a2', mockup_files: [{ url: 'B' }] }];
    const m = mergeArtFileSuperset(ext, loc);
    expect(m.map(g => g.id).sort()).toEqual(['a1', 'a2']);
  });

  test('superset-merges files within a shared group AND keeps local-only groups', () => {
    const ext = [{ id: 'a1', status: 'approved', mockup_files: [{ url: 'A' }] }];
    const loc = [
      { id: 'a1', status: 'needs_approval', mockup_files: [{ url: 'A' }, { url: 'B' }] },
      { id: 'a2', mockup_files: [{ url: 'C' }] },
    ];
    const m = mergeArtFileSuperset(ext, loc);
    const a1 = m.find(g => g.id === 'a1');
    expect(a1.mockup_files.map(f => f.url)).toEqual(['A', 'B']);
    expect(a1.status).toBe('approved');
    expect(m.find(g => g.id === 'a2')).toBeTruthy();
  });

  test('incoming empty / local non-empty returns the local copy (no revert to empty)', () => {
    const loc = [{ id: 'a1', mockup_files: [{ url: 'A' }] }];
    expect(mergeArtFileSuperset([], loc)).toBe(loc);
    expect(mergeArtFileSuperset(undefined, loc)).toBe(loc);
  });

  test('local empty returns the incoming array unchanged', () => {
    const ext = [{ id: 'a1', mockup_files: [{ url: 'A' }] }];
    expect(mergeArtFileSuperset(ext, [])).toBe(ext);
  });

  test('returns the incoming ref unchanged when nothing is added', () => {
    const ext = [{ id: 'a1', mockup_files: [{ url: 'A' }] }];
    const loc = [{ id: 'a1', mockup_files: [{ url: 'A' }] }];
    expect(mergeArtFileSuperset(ext, loc)).toBe(ext);
  });
});
