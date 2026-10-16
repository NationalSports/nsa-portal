import fs from 'fs';
import path from 'path';

// The per-order live refresh must merge with exactly the full reload's rules: a save in flight or a
// failed save keeps the local copy, a newer local _version wins, and the diff baseline equals what goes
// into state. It falls back to the full reload when it can't be sure. Blocks taken verbatim from App.js:
// the merge helpers at component scope (shared with the poll's changed-orders refresh), then the live
// refresh inside the realtime effect.
const source = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
const helpersStart = source.indexOf('  const _jsonEq=(a,b)=>');
const helpersEnd = source.indexOf('  // ─── Order save routing', helpersStart);
const start = source.indexOf('      const _deltaRetried=new Set();');
const end = source.indexOf('      const reloadAll=async(pendingAll)=>{', start);
const block = source.slice(helpersStart, helpersEnd) + source.slice(start, end);

function setup({fetched, failed = [], pending = []}) {
  let sos;
  const requeued = [];
  const snap = {current: {}};
  const setSOs = fn => { sos = fn(sos); };
  const load = jest.fn().mockResolvedValue(fetched);
  const api = Function('_dbSaveFailedIds', '_dbSavePendingIds', '_isRecentlyPulled', '_recentlySavedByMe', 'mergeArtFileSuperset',
    '_dbLoadSalesOrdersByIds', 'cancelled', 'setSOs', 'indexFirstById', '_dbSnap', '_SO_DELTA_MAX', 'debouncedReloadGroups',
    block + ';return {reloadSalesOrderDelta};')(
    new Set(failed), new Set(pending), () => false, () => false, (a) => a,
    load, false, setSOs, arr => new Map((arr || []).map(r => [r.id, r])), snap, 25, g => requeued.push(...g));
  return {api, load, snap, requeued, get: () => sos, set: v => { sos = v; }};
}
const row = (id, v, memo) => ({id, _version: v, memo});

test('a changed order replaces only that order, in state and in the save baseline', async () => {
  const t = setup({fetched: {sales_orders: [row('SO-2', 5, 'new')], missing: []}});
  t.set([row('SO-1', 1, 'a'), row('SO-2', 4, 'old'), row('SO-3', 2, 'c')]);
  t.snap.current = {sos: [row('SO-1', 1, 'a'), row('SO-2', 4, 'old'), row('SO-3', 2, 'c')], ests: ['untouched']};
  await expect(t.api.reloadSalesOrderDelta(['SO-2'], [])).resolves.toBe(true);
  expect(t.get()).toEqual([row('SO-1', 1, 'a'), row('SO-2', 5, 'new'), row('SO-3', 2, 'c')]);
  expect(t.snap.current.sos).toEqual(t.get());
  expect(t.snap.current.ests).toEqual(['untouched']);
});

test('a new order from another session is added', async () => {
  const t = setup({fetched: {sales_orders: [row('SO-9', 1, 'new order')], missing: []}});
  t.set([row('SO-1', 1, 'a')]); t.snap.current = {sos: [row('SO-1', 1, 'a')]};
  await t.api.reloadSalesOrderDelta(['SO-9'], []);
  expect(t.get().map(r => r.id)).toEqual(['SO-1', 'SO-9']);
  expect(t.snap.current.sos.map(r => r.id)).toEqual(['SO-1', 'SO-9']);
});

test('an order with a save in flight or a failed save keeps the local copy', async () => {
  for (const opts of [{pending: ['SO-2']}, {failed: ['SO-2']}]) {
    const t = setup({fetched: {sales_orders: [row('SO-2', 9, 'server')], missing: []}, ...opts});
    t.set([row('SO-2', 4, 'my unsaved edit')]); t.snap.current = {sos: [row('SO-2', 4, 'baseline')]};
    await t.api.reloadSalesOrderDelta(['SO-2'], []);
    expect(t.get()).toEqual([row('SO-2', 4, 'my unsaved edit')]);
  }
});

test('a newer local version beats a stale read', async () => {
  const t = setup({fetched: {sales_orders: [row('SO-2', 4, 'stale read')], missing: []}});
  t.set([row('SO-2', 6, 'just saved')]); t.snap.current = {sos: [row('SO-2', 6, 'just saved')]};
  await t.api.reloadSalesOrderDelta(['SO-2'], []);
  expect(t.get()).toEqual([row('SO-2', 6, 'just saved')]);
});

test('falls back to the full reload when unsure', async () => {
  const many = Array.from({length: 26}, (_, i) => 'SO-' + i); // 26 distinct orders: one full reload is cheaper
  const big = setup({fetched: {sales_orders: [], missing: []}});
  await expect(big.api.reloadSalesOrderDelta(many, [])).resolves.toBe(false);
  expect(big.load).not.toHaveBeenCalled();
  const tooMany = setup({fetched: {tooMany: true, sales_orders: [], missing: []}});
  await expect(tooMany.api.reloadSalesOrderDelta(['SO-1'], Array.from({length: 40}, (_, i) => String(i)))).resolves.toBe(false);
  // a failed read is retried once as a light refresh; a second failure falls back to the full reload
  const failed = setup({fetched: null});
  await expect(failed.api.reloadSalesOrderDelta(['SO-1'], ['77'])).resolves.toBe(true);
  expect(failed.requeued).toEqual(['so:SO-1', 'soitem:77']);
  await expect(failed.api.reloadSalesOrderDelta(['SO-1'], ['77'])).resolves.toBe(false);
  const gone = setup({fetched: {sales_orders: [], missing: ['SO-1']}});
  gone.set([row('SO-1', 1, 'a')]);
  await expect(gone.api.reloadSalesOrderDelta(['SO-1'], [])).resolves.toBe(false);
  expect(gone.get()).toEqual([row('SO-1', 1, 'a')]); // untouched — the full reload decides
});

test('realtime: order and pick-line changes queue just that order; pick-line deletes are skipped', () => {
  const handler = source.slice(source.indexOf("on('postgres_changes',{event:'*',schema:'public',table},payload=>{"), source.indexOf('}).subscribe((status,err)=>{'));
  const body = handler.slice(handler.indexOf('payload=>{') + 'payload=>{'.length);
  const run = (table, payload) => {
    const groups = []; const full = [];
    Function('table', 'payload', 'debouncedReloadGroups', 'debouncedReload', body)(table, payload, g => groups.push(...g), t => full.push(t));
    return {groups, full};
  };
  expect(run('sales_orders', {eventType: 'UPDATE', new: {id: 'SO-5'}})).toEqual({groups: ['so:SO-5'], full: []});
  expect(run('sales_orders', {eventType: 'DELETE', old: {id: 'SO-5'}})).toEqual({groups: [], full: ['sales_orders']});
  expect(run('so_item_pick_lines', {eventType: 'INSERT', new: {id: 1, so_item_id: 77}})).toEqual({groups: ['soitem:77'], full: []});
  expect(run('so_item_pick_lines', {eventType: 'DELETE', old: {id: 1}})).toEqual({groups: [], full: []});
  expect(run('estimates', {eventType: 'UPDATE', new: {id: 'EST-1'}})).toEqual({groups: [], full: ['estimates']});
});
