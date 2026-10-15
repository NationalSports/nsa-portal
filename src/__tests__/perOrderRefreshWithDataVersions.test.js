import fs from 'fs';
import path from 'path';
import {fetchDataVersions as _realFetch, allUnchanged, changedGroups, markLoaded, _resetDataVersionsForTest} from '../lib/dataVersions';

// The per-order live refresh (#2553) and the skip-unchanged-groups counters (#2558) both sit in
// reloadAll. This runs the MERGED reloadAll verbatim from App.js with the real counter logic, so
// the two are tested together: per-order keys first, then only changed groups go to the full load,
// and a per-order refresh never marks the sales_orders group as loaded (the next poll still checks).
const source = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
const start = source.indexOf('      const _shouldProtect=id=>');
const end = source.indexOf('      // Debounce realtime events', start);
const block = source.slice(start, end);

function harness({versions, delta}) {
  _resetDataVersionsForTest();
  const calls = {dbLoad: [], delta: [], requeued: [], fetchVersions: 0};
  const named = {
    _dbSaveFailedIds: new Set(), _dbSavePendingIds: new Set(), _recentlyPulledSOs: new Set(),
    _isRecentlyPulled: () => false, _recentlySavedByMe: () => false, mergeArtFileSuperset: a => a,
    _dbLoadSalesOrdersByIds: async (so, items) => { calls.delta.push([so, items]); return typeof delta === 'function' ? delta() : delta; },
    cancelled: false, indexFirstById: arr => new Map((arr || []).map(r => [r.id, r])),
    _dbSnap: {current: {sos: [], ests: []}}, _jsonEq: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    debouncedReloadGroups: g => calls.requeued.push(...g),
    fetchDataVersions: async () => { calls.fetchVersions++; return versions; },
    changedGroups, markLoaded, supabase: {},
    _dbLoad: async opts => { calls.dbLoad.push(opts); return {hasData: true, _decoTimedOut: false, _parentTimedOut: false, estimates: [], sales_orders: [], invoices: [], customers: [], messages: [], products: [], assignedTodos: [], team: [], vendors: [], omg_stores: [], issues: [], decoVendors: null, decoVendorPricing: null, appState: {}, _badGroups: []}; },
    _mergeAssignedTodos: (a) => a, _dedupProducts: a => a, _appStateDirty: () => false, _batchPosDirtyUntil: 0,
    NSA: {}, NSA_DEFAULTS: {}, document: {hidden: false},
  };
  // Every other identifier reloadAll touches (the ~20 React setters etc.) becomes a no-op stub;
  // real globals (Set, Map, JSON, console, ...) stay real.
  const ctx = new Proxy(named, {has: () => true, get: (t, k) => {
    if (k === Symbol.unscopables) return undefined;
    if (k in t) return t[k];
    return k in globalThis ? globalThis[k] : () => {};
  }});
  const api = Function('ctx', 'with(ctx){' + block + ';return {reloadAll};}')(ctx);
  return {api, calls};
}
const V = {estimates: 10, sales_orders: 20, invoices: 30, messages: 40, assigned_todos: 50, app_state: 60};
const soRow = {sales_orders: [{id: 'SO-1', _version: 2}], missing: []};

test('an order event is refreshed alone: no full load, no counter read, group not marked loaded', async () => {
  const h = harness({versions: V, delta: soRow});
  await h.api.reloadAll(new Set(['so:SO-1']));
  expect(h.calls.delta).toEqual([[['SO-1'], []]]);
  expect(h.calls.dbLoad).toEqual([]);
  expect(h.calls.fetchVersions).toBe(0);
  expect(allUnchanged(V, ['sales_orders'])).toBe(false); // never marked → the next poll still verifies
});

test('order event plus another group: the order refreshes alone, the group obeys the counters', async () => {
  // estimates already loaded at this counter → skipped
  const quiet = harness({versions: V, delta: soRow});
  markLoaded(V, ['estimates']);
  await quiet.api.reloadAll(new Set(['so:SO-1', 'estimates']));
  expect(quiet.calls.delta).toHaveLength(1);
  expect(quiet.calls.dbLoad).toEqual([]);
  // estimates counter moved → loaded, and ONLY estimates (sales_orders stays per-order)
  const busy = harness({versions: {...V, estimates: 11}, delta: soRow});
  markLoaded(V, ['estimates']);
  await busy.api.reloadAll(new Set(['so:SO-1', 'estimates']));
  expect(busy.calls.dbLoad).toHaveLength(1);
  expect([...busy.calls.dbLoad[0].only]).toEqual(['estimates']);
  expect(allUnchanged({...V, estimates: 11}, ['estimates'])).toBe(true); // marked after the load
  expect(allUnchanged({...V, estimates: 11}, ['sales_orders'])).toBe(false);
});

test('per-order fallback goes through the counters: a changed group loads, an unchanged one is skipped', async () => {
  let n = 0;
  const failing = () => { n++; return null; }; // every read fails → retry once → fall back
  const changed = harness({versions: V, delta: failing});
  await changed.api.reloadAll(new Set(['so:SO-1']));           // first failure: re-queued, no full load yet
  expect(changed.calls.requeued).toEqual(['so:SO-1']);
  expect(changed.calls.dbLoad).toEqual([]);
  await changed.api.reloadAll(new Set(['so:SO-1']));           // second failure: full sales_orders reload
  expect(changed.calls.dbLoad).toHaveLength(1);
  expect([...changed.calls.dbLoad[0].only]).toEqual(['sales_orders']);
  // same fallback, but this tab already loaded sales_orders at the current counter → nothing to do
  const quiet = harness({versions: V, delta: failing});
  markLoaded(V, ['sales_orders']);
  await quiet.api.reloadAll(new Set(['so:SO-1']));
  await quiet.api.reloadAll(new Set(['so:SO-1']));
  expect(quiet.calls.dbLoad).toEqual([]);
});

test('a queued full reload wins over per-order keys and loads everything', async () => {
  const h = harness({versions: V, delta: soRow});
  await h.api.reloadAll(new Set(['so:SO-1', '__all__']));
  expect(h.calls.delta).toEqual([]);
  expect(h.calls.dbLoad).toEqual([{}]);
});

test('without counters (RPC missing) the fallback loads exactly as before', async () => {
  const h = harness({versions: null, delta: () => null});
  await h.api.reloadAll(new Set(['so:SO-1']));
  await h.api.reloadAll(new Set(['so:SO-1']));
  expect(h.calls.dbLoad).toHaveLength(1);
  expect([...h.calls.dbLoad[0].only]).toEqual(['sales_orders']);
});

test('the real counter reader degrades to null on any failure', async () => {
  await expect(_realFetch(null)).resolves.toBeNull();
  await expect(_realFetch({rpc: async () => ({data: null, error: {message: 'missing'}})})).resolves.toBeNull();
  await expect(_realFetch({rpc: async () => ({data: V, error: null})})).resolves.toEqual(V);
});
