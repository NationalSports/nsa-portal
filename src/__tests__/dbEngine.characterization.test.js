/* Characterization tests for src/lib/dbEngine.js — the persistence/sync engine
 * extracted byte-identically from App.js (decomposition step 1).
 *
 * These pin the engine's behavioral contracts as they exist TODAY, so later
 * decomposition steps (and ordinary feature work) can't silently change them.
 * They are not aspirational: every expectation was derived from the current
 * implementation. If one of these fails, either a contract was deliberately
 * changed (update the test with the same care as the code) or something broke.
 *
 * The module is safe to import under jest: with no REACT_APP_SUPABASE_URL the
 * client init is skipped and `supabase` stays null; everything tested here is
 * pure logic over its arguments + module state.
 */
import {
  _diffCmp, _soDiffCmp, _estDiffCmp, _prodDiffCmp,
  _sanitizeArtRow, _unionArtFiles, _mergeArtConflict, _resolveArtRows,
  _matchRestoreItem, _queuedEntitySave, _isNetErr, _retryNet,
  _lsSet, _setOnCacheFullChange, _setLsQuotaWarned,
  _markRecentlyPulled, _isRecentlyPulled,
  _markEstStatusChange, _recentEstStatusChange,
  _mergeAssignedTodos, _dbSavePendingIds, _dbSaveFailedIds,
  _bgSync, _bgSyncInc, _bgSyncDec,
} from '../lib/dbEngine';

// ── Diff engine: what counts as "changed" ────────────────────────────
describe('diff comparators (phantom-save guards)', () => {
  test('_diffCmp ignores _version and updated_at, sees real changes', () => {
    const a = { id: 'X', memo: 'hi', _version: 3, updated_at: 'yesterday' };
    const b = { id: 'X', memo: 'hi', _version: 9, updated_at: 'today' };
    expect(_diffCmp(a)).toBe(_diffCmp(b));
    expect(_diffCmp(a)).not.toBe(_diffCmp({ ...a, memo: 'edited' }));
  });

  test('_soDiffCmp ignores per-item session scalars but sees item content', () => {
    const so = (extra) => ({
      id: 'SO-1', memo: 'm', _version: 1, updated_at: 't',
      items: [{ sku: 'TEE', sizes: { M: 2 }, decorations: [{ kind: 'art' }], pick_lines: [], po_lines: [], ...extra }],
    });
    // recomputed-every-load scalars (not in _itemCols) never count as changes
    expect(_soDiffCmp(so({ _sizeCosts: { M: 4 } }))).toBe(_soDiffCmp(so({ _sizeCosts: { M: 9 } })));
    // real item content still counts
    expect(_soDiffCmp(so({}))).not.toBe(_soDiffCmp({ ...so({}), items: [{ sku: 'TEE', sizes: { M: 3 }, decorations: [], pick_lines: [], po_lines: [] }] }));
    // decorations / pick / po lines are compared whole
    expect(_soDiffCmp(so({ pick_lines: [{ M: 1 }] }))).not.toBe(_soDiffCmp(so({ pick_lines: [] })));
  });

  test('_estDiffCmp compares only persisted estimate columns', () => {
    const est = { id: 'EST-1', memo: 'm', _session_only_junk: 1, items: [], art_files: [] };
    expect(_estDiffCmp(est)).toBe(_estDiffCmp({ ...est, _session_only_junk: 2 }));
    expect(_estDiffCmp(est)).not.toBe(_estDiffCmp({ ...est, memo: 'changed' }));
  });

  test('_prodDiffCmp mirrors the product save: session fields ignored, image_url folds', () => {
    const p = { id: 'p1', sku: 'A', name: 'Tee', _ss_live: { x: 1 }, _sizeCosts: { M: 3 } };
    expect(_prodDiffCmp(p)).toBe(_prodDiffCmp({ ...p, _ss_live: { x: 2 }, _sizeCosts: { M: 9 } }));
    // image_url takes precedence over image_front_url in the fold (as in _dbSaveProduct)
    expect(_prodDiffCmp({ ...p, image_url: 'u1', image_front_url: 'old' }))
      .toBe(_prodDiffCmp({ ...p, image_url: 'u1', image_front_url: 'other' }));
    expect(_prodDiffCmp({ ...p, image_url: 'u1' })).not.toBe(_prodDiffCmp({ ...p, image_url: 'u2' }));
  });
});

// ── Art-file conflict merge (optimistic-concurrency healing) ─────────
describe('art-file field-level merge', () => {
  test('_sanitizeArtRow: stitches to int-or-null, mock_links never null', () => {
    expect(_sanitizeArtRow({ stitches: '' }).stitches).toBeNull();
    expect(_sanitizeArtRow({ stitches: '12000' }).stitches).toBe(12000);
    expect(_sanitizeArtRow({ stitches: 8000 }).stitches).toBe(8000);
    expect(_sanitizeArtRow({ mock_links: null }).mock_links).toEqual({});
    // Missing key must be force-filled too: supabase-js bulk upsert sends the UNION of keys via
    // ?columns=, and PostgREST NULL-fills rows missing a key — a NOT NULL violation on mock_links
    // that aborts the whole save (SO-1459 blank-order bug).
    expect(_sanitizeArtRow({}).mock_links).toEqual({});
    expect(_sanitizeArtRow({ mock_links: { 'a|b': 'c|d' } }).mock_links).toEqual({ 'a|b': 'c|d' });
  });

  test('_unionArtFiles: scalars prefer client; arrays union by url, db side first', () => {
    expect(_unionArtFiles('db.png', 'client.png')).toBe('client.png');
    expect(_unionArtFiles('db.png', undefined)).toBe('db.png');
    const out = _unionArtFiles(
      [{ url: 'a.png' }, { url: 'b.png' }],
      [{ url: 'b.png', name: 'dupe' }, { url: 'c.png' }],
    );
    expect(out.map((f) => f.url)).toEqual(['a.png', 'b.png', 'c.png']);
  });

  test('_mergeArtConflict: DB status wins, client content wins, uploads union', () => {
    const client = {
      id: 'a1', _version: 1, name: 'Client Name', notes: 'client notes',
      status: 'waiting_for_art', // client's stale status must NOT survive
      files: [{ url: 'client-upload.ai' }],
      item_mockups: { 'SKU|Red': [{ url: 'client-mock.png' }] },
      mock_links: { g2: 'src2' },
    };
    const db = {
      id: 'a1', _version: 5, name: 'DB Name', notes: 'db notes',
      status: 'approved', preview_url: 'db-prev.png',
      files: [{ url: 'db-upload.ai' }],
      item_mockups: { 'SKU|Red': [{ url: 'db-mock.png' }], 'SKU|Blue': [{ url: 'blue.png' }] },
      mock_links: { g1: 'src1', g2: 'db-old' },
    };
    const m = _mergeArtConflict(client, db);
    expect(m.status).toBe('approved');            // concurrent approval preserved
    expect(m.name).toBe('Client Name');           // typed content preserved
    expect(m.notes).toBe('client notes');
    expect(m.files.map((f) => f.url)).toEqual(['db-upload.ai', 'client-upload.ai']);
    expect(m.item_mockups['SKU|Red'].map((f) => f.url)).toEqual(['db-mock.png', 'client-mock.png']);
    expect(m.item_mockups['SKU|Blue'].map((f) => f.url)).toEqual(['blue.png']);
    expect(m.mock_links).toEqual({ g1: 'src1', g2: 'src2' }); // client wins its keys, db keys kept
    expect(m.preview_url).toBe('db-prev.png');
  });

  test('_resolveArtRows: merge only when the DB is ahead; passthrough otherwise', () => {
    const client = [{ id: 'a1', _version: 1, name: 'C' }, { id: 'a2', _version: 4, name: 'D' }];
    const db = [{ id: 'a1', _version: 3, name: 'DBC', status: 's' }, { id: 'a2', _version: 4, name: 'ignored' }];
    const out = _resolveArtRows(client, db, 'SO-1');
    expect(out[0].baseVersion).toBe(3);
    expect(out[0].row.name).toBe('C');       // merged: client content on DB base
    expect(out[0].row.status).toBe('s');
    expect(out[1].row).toBe(client[1]);      // same version → untouched passthrough
    expect(out[1].baseVersion).toBe(4);
  });
});

// ── Restore-row re-attachment (SO-1132 guard) ────────────────────────
describe('_matchRestoreItem', () => {
  const items = [
    { sku: 'TEE', color: 'Red' },
    { sku: 'HAT', color: '' },
    { sku: 'TEE', color: 'Navy' },
  ];
  test('original position wins while the SKU still matches', () => {
    expect(_matchRestoreItem({ item_index: 0, sku: 'TEE' }, items)).toBe(0);
    expect(_matchRestoreItem({ item_index: 1, sku: '' }, items)).toBe(1); // skuless row trusts position
  });
  test('shifted rows re-match by SKU, preferring matching color', () => {
    expect(_matchRestoreItem({ item_index: 9, sku: 'TEE', color: 'navy' }, items)).toBe(2);
    expect(_matchRestoreItem({ item_index: 9, sku: 'TEE' }, items)).toBe(2); // colorless: closest index
  });
  test('a known DIFFERENT color is never used; no match → -1', () => {
    expect(_matchRestoreItem({ item_index: 1, sku: 'TEE', color: 'Green' }, items)).toBe(-1);
    expect(_matchRestoreItem({ item_index: 0, sku: 'GONE' }, items)).toBe(-1);
  });
  test('positional match also refuses a known DIFFERENT color (SO-1165 IF auto-assign)', () => {
    // Old TEE/Navy row whose index now holds TEE/Red: must NOT attach positionally —
    // it re-matches the actual Navy line instead.
    expect(_matchRestoreItem({ item_index: 0, sku: 'TEE', color: 'navy' }, items)).toBe(2);
    // No color-compatible candidate anywhere → unmatchable, never a silent wrong attach.
    expect(_matchRestoreItem({ item_index: 0, sku: 'TEE', color: 'Green' }, items)).toBe(-1);
    // Skuless rows trust position only while the color doesn't contradict.
    expect(_matchRestoreItem({ item_index: 0, sku: '', color: 'Green' }, items)).toBe(-1);
  });
});

// ── Queued per-entity save: latest-wins coalescing ───────────────────
describe('_queuedEntitySave', () => {
  test('saves queued during an in-flight save coalesce to the LATEST version', async () => {
    const saved = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const slowSave = async (d) => { saved.push(d.v); if (d.v === 1) await gate; };
    const p1 = _queuedEntitySave('E1', { v: 1 }, slowSave);
    const p2 = _queuedEntitySave('E1', { v: 2 }, slowSave); // superseded before running
    const p3 = _queuedEntitySave('E1', { v: 3 }, slowSave); // latest — the one that runs
    release();
    await Promise.all([p1, p2, p3]);
    expect(saved).toEqual([1, 3]); // v2 skipped entirely
  });

  test('different entities save independently', async () => {
    const saved = [];
    await Promise.all([
      _queuedEntitySave('A', { v: 'a' }, async (d) => { saved.push(d.v); }),
      _queuedEntitySave('B', { v: 'b' }, async (d) => { saved.push(d.v); }),
    ]);
    expect(saved.sort()).toEqual(['a', 'b']);
  });
});

// ── Transient-network retry ──────────────────────────────────────────
describe('_isNetErr / _retryNet', () => {
  test('classifies transient network errors only', () => {
    expect(_isNetErr(new Error('Failed to fetch'))).toBe(true);
    expect(_isNetErr({ message: 'Network request failed' })).toBe(true);
    expect(_isNetErr({ error: { message: 'ERR_SSL_PROTOCOL_ERROR' } })).toBe(true);
    expect(_isNetErr(new Error('duplicate key value violates unique constraint'))).toBe(false);
  });

  test('retries a thrown network error, then succeeds', async () => {
    let calls = 0;
    const fn = async () => { calls++; if (calls === 1) throw new Error('Failed to fetch'); return { data: 'ok' }; };
    const r = await _retryNet(fn);
    expect(calls).toBe(2);
    expect(r.data).toBe('ok');
  }, 10000);

  test('a non-network error throws immediately (no retry)', async () => {
    let calls = 0;
    await expect(_retryNet(async () => { calls++; throw new Error('permission denied'); })).rejects.toThrow('permission denied');
    expect(calls).toBe(1);
  });

  test('a clean result passes straight through', async () => {
    const r = await _retryNet(async () => ({ data: [1], error: null }));
    expect(r.data).toEqual([1]);
  });
});

// ── localStorage cache budget ────────────────────────────────────────
describe('_lsSet', () => {
  afterEach(() => { _setOnCacheFullChange(null); _setLsQuotaWarned(false); });

  test('writes normal keys and returns true', () => {
    expect(_lsSet('nsa_test_key', 'v')).toBe(true);
    expect(localStorage.getItem('nsa_test_key')).toBe('v');
  });

  test('skips non-essential keys over the 1MB per-key cap', () => {
    const big = 'x'.repeat(1024 * 1024 + 1);
    expect(_lsSet('nsa_test_big', big)).toBe(false);
    expect(localStorage.getItem('nsa_test_big')).toBeNull();
  });

  test('essential keys bypass the size cap', () => {
    const big = 'y'.repeat(1024 * 1024 + 1);
    expect(_lsSet('nsa_settings', big)).toBe(true);
    expect(localStorage.getItem('nsa_settings')).toBe(big);
    localStorage.removeItem('nsa_settings');
  });

  test('QuotaExceededError flips the cache-full banner hook and returns false', () => {
    const flips = [];
    _setOnCacheFullChange((v) => flips.push(v));
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
    try {
      expect(_lsSet('nsa_test_q', 'v')).toBe(false);
    } finally { Storage.prototype.setItem = orig; }
    expect(flips).toEqual([true]);
  });
});

// ── Time-windowed reload guards ──────────────────────────────────────
describe('reload-protection windows', () => {
  afterEach(() => jest.restoreAllMocks());

  test('recently-pulled SOs are protected for 30s, then expire', () => {
    const t0 = 1_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(t0);
    _markRecentlyPulled('SO-9');
    expect(_isRecentlyPulled('SO-9')).toBe(true);
    Date.now.mockReturnValue(t0 + 29_000);
    expect(_isRecentlyPulled('SO-9')).toBe(true);
    Date.now.mockReturnValue(t0 + 31_000);
    expect(_isRecentlyPulled('SO-9')).toBe(false);
    expect(_isRecentlyPulled('SO-9')).toBe(false); // entry deleted, stays false
  });

  test('estimate status marks live 60s and carry baseVersion', () => {
    const t0 = 2_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(t0);
    _markEstStatusChange({ id: 'EST-7', status: 'approved', approved_by: 'rep1', _version: '4' });
    const m = _recentEstStatusChange('EST-7');
    expect(m.status).toBe('approved');
    expect(m.baseVersion).toBe(4); // numeric-string version parsed
    Date.now.mockReturnValue(t0 + 61_000);
    expect(_recentEstStatusChange('EST-7')).toBeNull();
  });
});

// ── Assigned-todos reload merge ──────────────────────────────────────
describe('_mergeAssignedTodos', () => {
  afterEach(() => { _dbSavePendingIds.clear(); });

  test('keeps the local copy of in-flight todos; DB wins otherwise', () => {
    _dbSavePendingIds.add('t2');
    const db = [{ id: 't1', done: true }, { id: 't2', done: false }];
    const local = [{ id: 't2', done: true }];
    const out = _mergeAssignedTodos(db, local);
    expect(out.find((t) => t.id === 't1').done).toBe(true);
    expect(out.find((t) => t.id === 't2').done).toBe(true); // local protected copy
  });

  test('local-only todos survive only while protected', () => {
    _dbSavePendingIds.add('new1');
    const out = _mergeAssignedTodos([{ id: 't1' }], [{ id: 'new1' }, { id: 'dropped' }]);
    expect(out.map((t) => t.id)).toEqual(['new1', 't1']); // 'dropped' is not protected → gone
  });
});

// ── Component hook setters ───────────────────────────────────────────
describe('engine/component hook-up', () => {
  test('_bgSyncInc/Dec drive the exported live counter', () => {
    expect(_bgSync).toBe(0);
    _bgSyncInc();
    // eslint-disable-next-line import/no-mutable-exports
    const { _bgSync: after } = require('../lib/dbEngine');
    expect(after).toBe(1);
    _bgSyncDec();
    expect(require('../lib/dbEngine')._bgSync).toBe(0);
  });
});
