import fs from 'fs';
import path from 'path';

// Run App's actual conversion handler with deferred persistence receipts. Only
// the unrelated Methodic transport is substituted; ordering stays unchanged.
const source = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
const start = source.indexOf('const convertSO=');
const end = source.indexOf('  const copyEstimate=', start);
const handler = source.slice(start, end).trim().replace(/^const convertSO=/, '').replace(/;$/, '')
  .replace("await import('./methodic/methodicApi')", 'await methodicModule()');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function setup(overrides = {}) {
  const soSave = deferred(), estimateSave = deferred(), artSync = deferred();
  const estimate = { id: 'EST-1', customer_id: 'c', items: [{ sku: 'JX4456', sizes: { M: 10 } }], art_files: [] };
  const state = { orders: [], estimates: [estimate], editor: null, busy: null };
  const deps = {
    conversionInFlight: { current: null }, setConvertingEstimateId: jest.fn(value => { state.busy = value; }), setNeedByAsk: jest.fn(),
    supabase: {}, nf: jest.fn(), cust: [{ id: 'c', name: 'School' }], cu: { id: 'rep' }, invs: [], sos: [],
    safeItems: o => o.items || [], safeSizes: it => it.sizes || {}, safeNum: n => Number(n) || 0,
    nextSOId: () => 'SO-2851', _refetchEstimateForConvert: jest.fn(),
    _dbSaveSO: jest.fn(so => soSave.promise.then(result => { if (result !== false) so._version = 1; return result; })),
    _dbSaveEstimate: jest.fn(() => estimateSave.promise),
    createArtService: () => ({ syncConversion: jest.fn(() => artSync.promise) }), _loadArtRow: row => row,
    setSOs: jest.fn(fn => { state.orders = fn(state.orders); }), setEsts: jest.fn(fn => { state.estimates = fn(state.estimates); }),
    setEEst: jest.fn(), setESO: jest.fn(so => { state.editor = so; }), setESOC: jest.fn(), setPg: jest.fn(),
    methodicModule: async () => ({ methodicApi: jest.fn().mockResolvedValue({}) }),
    window: { dispatchEvent: jest.fn() }, CustomEvent: function(type, options) { this.type = type; this.detail = options.detail; },
    ...overrides,
  };
  const convert = Function(...Object.keys(deps), 'return (' + handler + ')')(...Object.values(deps));
  return { convert, estimate, state, deps, soSave, estimateSave, artSync };
}

test.each([{art: []}, {art: [{ id: 'art-1', prod_files: [{ url: 'logo.ai' }] }]}])('publishes the SO only after both saves and art sync, with artwork $art', async ({art}) => {
  const t = setup();
  const pending = t.convert(t.estimate, '2026-11-01');
  expect(t.state.orders).toEqual([]);
  expect(t.state.busy).toBe('EST-1');
  expect(t.deps.setEEst).not.toHaveBeenCalled();
  t.soSave.resolve(true); await settle();
  expect(t.state.editor).toBeNull();
  t.estimateSave.resolve(true); await settle();
  expect(t.state.orders).toEqual([]);
  expect(t.state.editor).toBeNull();
  t.artSync.resolve({ id: 'SO-2851', _version: 2, updated_at: 'synced', art_files: art });
  await pending;
  expect(t.state.editor._version).toBe(2);
  expect(t.state.editor.art_files).toEqual(art);
  expect(t.state.orders).toEqual([t.state.editor]);
  expect(t.state.estimates[0].status).toBe('converted');
  expect(t.state.busy).toBeNull();
});

test('a repeated convert click cannot start a second create while persistence is pending', async () => {
  const t = setup();
  const pending = t.convert(t.estimate, '2026-11-01');
  const repeated = t.convert(t.estimate, '2026-11-01');
  expect(t.deps._dbSaveSO).toHaveBeenCalledTimes(1);
  t.soSave.resolve(true); t.estimateSave.resolve(true); t.artSync.resolve({ id: 'SO-2851', _version: 2, art_files: [] });
  await Promise.all([pending, repeated]);
  expect(t.deps.conversionInFlight.current).toBeNull();
});

test('art-sync failure still opens the saved SO and reports the existing retry instruction', async () => {
  const t = setup();
  const pending = t.convert(t.estimate, '2026-11-01');
  t.soSave.resolve(true); t.estimateSave.resolve(true); await settle();
  t.artSync.reject(new Error('network failure'));
  await pending;
  expect(t.state.editor._version).toBe(1);
  expect(t.deps.nf).toHaveBeenCalledWith(expect.stringContaining('retry Sync estimate artwork'), 'warn');
  expect(t.state.busy).toBeNull();
});

test('preparation failure releases the lock without creating or opening a sales order', async () => {
  const t = setup({ _refetchEstimateForConvert: jest.fn().mockRejectedValue(new Error('offline')) });
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  await t.convert({ ...t.estimate, _itemsHydrated: false }, '2026-11-01');
  expect(t.deps._dbSaveSO).not.toHaveBeenCalled();
  expect(t.state.editor).toBeNull();
  expect(t.state.busy).toBeNull();
  expect(t.deps.conversionInFlight.current).toBeNull();
  log.mockRestore();
});

test('initial SO save failure preserves the draft and skips art sync', async () => {
  const syncConversion = jest.fn();
  const t = setup({createArtService: () => ({syncConversion})});
  const pending = t.convert(t.estimate, '2026-11-01');
  t.soSave.resolve(false); t.estimateSave.resolve(true);
  await pending;
  expect(syncConversion).not.toHaveBeenCalled();
  expect(t.state.editor.items[0].sizes).toEqual({M: 10});
  expect(t.state.busy).toBeNull();
});

test('an unexpected persistence rejection releases the lock', async () => {
  const t = setup();
  const pending = t.convert(t.estimate, '2026-11-01');
  t.soSave.reject(new Error('storage failed')); t.estimateSave.resolve(true);
  await expect(pending).rejects.toThrow('storage failed');
  expect(t.state.editor).toBeNull();
  expect(t.deps.conversionInFlight.current).toBeNull();
  expect(t.state.busy).toBeNull();
});
