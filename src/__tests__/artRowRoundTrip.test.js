import { _artCols, _loadArtRow } from '../constants';

// Guards the "saved but never loaded back" class of bug, hit three times now:
// mock_links/design_id (fixed in 3d7338f), then stitches and sample_art (loader
// omissions found in the 2026-07 review). Every column the save path writes
// (_artCols) must be mapped by the shared loader, or the value silently reverts
// on reload — and a mixed-key bulk upsert can even wipe the DB value back to its
// column DEFAULT (postgrest sends the union of keys across rows).
describe('art row round-trip', () => {
  test('every saved art column (_artCols) is mapped by _loadArtRow', () => {
    const mappedKeys = Object.keys(_loadArtRow({}));
    const missing = _artCols.filter(c => !mappedKeys.includes(c));
    expect(missing).toEqual([]);
  });

  test('_version rides along for optimistic concurrency', () => {
    expect(_loadArtRow({ _version: 7 })._version).toBe(7);
  });

  test('values survive the round trip unchanged', () => {
    const row = {
      id: 'a1', name: 'Front Logo', deco_type: 'emb', stitches: 12000,
      sample_art: [{ url: 'x.png' }], mock_links: { k: 'v' }, design_id: 'd-9',
      item_mockups: { '0': ['m.png'] }, status: 'approved', archived: false,
      uploaded: true, _version: 3,
    };
    const mapped = _loadArtRow(row);
    expect(mapped.stitches).toBe(12000);
    expect(mapped.sample_art).toEqual([{ url: 'x.png' }]);
    expect(mapped.mock_links).toEqual({ k: 'v' });
    expect(mapped.design_id).toBe('d-9');
  });

  test('null/missing jsonb fields default to safe empties, stitches to null', () => {
    const mapped = _loadArtRow({ id: 'a2', mock_links: null });
    expect(mapped.mock_links).toEqual({});
    expect(mapped.sample_art).toEqual([]);
    expect(mapped.stitches).toBeNull();
    expect(mapped.art_sizes).toEqual({});
  });
});
