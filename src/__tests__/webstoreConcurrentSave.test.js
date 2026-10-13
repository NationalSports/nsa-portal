import fs from 'fs';
import path from 'path';
import { storeFieldEqual, storeValueEqual, webstoreDirtyPatch, webstoreSaveConflicts } from '../Webstores';

describe('webstore settings concurrent saves', () => {
  const loaded = {
    id: 'store-1',
    updated_at: '2026-10-13T06:00:00.000Z',
    primary_color: null,
    store_art: [{ id: 'old-art' }],
    hero_blurb: 'Old blurb',
  };

  test('writes only form fields whose value actually changed', () => {
    const fullForm = {
      ...loaded,
      primary_color: null,
      store_art: [{ id: 'old-art' }],
      hero_blurb: 'New blurb',
    };

    expect(webstoreDirtyPatch(loaded, fullForm, new Set(['primary_color', 'store_art', 'hero_blurb'])))
      .toEqual({ hero_blurb: 'New blurb' });
  });

  test('merges unrelated concurrent changes without treating them as conflicts', () => {
    const latest = {
      ...loaded,
      updated_at: '2026-10-13T06:30:00.000Z',
      primary_color: '#123456',
      store_art: [...loaded.store_art, { id: 'new-art' }],
    };
    const patch = { hero_blurb: 'New blurb' };

    expect(webstoreSaveConflicts(loaded, latest, patch)).toEqual([]);
    expect({ ...latest, ...patch }).toMatchObject({
      primary_color: '#123456',
      store_art: [{ id: 'old-art' }, { id: 'new-art' }],
      hero_blurb: 'New blurb',
    });
  });

  test('blocks a stale save when the same field changed elsewhere', () => {
    const latest = { ...loaded, primary_color: '#123456' };

    expect(webstoreSaveConflicts(loaded, latest, { primary_color: '#abcdef' }))
      .toEqual(['primary_color']);
  });

  test('compares JSON values structurally and timestamps by instant', () => {
    expect(storeValueEqual({ b: 2, a: [{ y: 2, x: 1 }] }, { a: [{ x: 1, y: 2 }], b: 2 })).toBe(true);
    expect(storeFieldEqual('close_at', '2026-10-14T06:59:00.000Z', '2026-10-13T23:59:00-07:00')).toBe(true);
  });

  test('production save reloads before its partial update and guards the write revision', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'Webstores.js'), 'utf8');
    const saveStart = source.indexOf('const saveStore = useCallback');
    const saveEnd = source.indexOf('// ── "Create from OMG"', saveStart);
    const saveSource = source.slice(saveStart, saveEnd);

    expect(saveSource.indexOf(".select('*').eq('id', existingId).single()"))
      .toBeLessThan(saveSource.indexOf(".update(nextPatch).eq('id', existingId)"));
    expect(saveSource).toContain("query.eq('updated_at', latest.updated_at)");
    expect(saveSource).toContain('webstoreSaveConflicts(originalStore, latest, form)');
  });
});
