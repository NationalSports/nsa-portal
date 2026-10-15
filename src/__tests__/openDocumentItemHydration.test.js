import fs from 'fs';
import path from 'path';

// SO-1518: an order whose item lines missed the boot load must be read in full
// before the editor mounts, and an already-open editor must never be swapped out.
// The block under test is taken verbatim from App.js.
const source = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
const start = source.indexOf('  const _hydrateFailedRef=');
const end = source.indexOf('  React.useEffect(()=>{if(!eSO)_editorOpenRef', start);
const block = source.slice(start, end);

function setup({load}) {
  const refs = [];
  const React = {useRef: v => { const r = {current: v}; refs.push(r); return r; }};
  const state = {sos: [], eSO: null, toasts: [], snap: {current: {sos: []}}};
  const setter = key => fn => { state[key] = typeof fn === 'function' ? fn(state[key]) : fn; };
  const make = Function('React', 'useState', 'supabase', '_loadRecoveryDocument', 'setSOs', 'setESO', 'setEsts', 'setEEst', '_dbSnap', 'stageDocumentBaseline', 'nf',
    block + ';return {_awaitingItems,_hydrateOpenDoc,_editorOpenRef};');
  const api = make(React, v => [v, () => {}], {}, load, setter('sos'), setter('eSO'), () => {}, () => {}, state.snap,
    (ref, key, doc) => { ref.current[key] = ref.current[key].map(r => r.id === doc.id ? doc : r); },
    (msg, kind) => state.toasts.push([msg, kind]));
  return {api, state};
}
const hollow = () => ({id: 'SO-1', _version: 78, memo: 'Fall Tees', items: [], _itemsHydrated: false, _decosHydrated: false, _posHydrated: false, _picksHydrated: false});
const full = {row: {items: [{sku: 'JX4453', sizes: {L: 35}}], _hydratedPoIds: ['PO-1'], _hydratedPickIds: []}};
const flush = () => new Promise(r => setTimeout(r, 0));

test('an order loaded without items shows loading, then opens with its real items', async () => {
  const load = jest.fn().mockResolvedValue(full);
  const {api, state} = setup({load});
  state.sos = [hollow()]; state.eSO = state.sos[0]; state.snap.current.sos = [hollow()];
  expect(api._awaitingItems(state.eSO, 'sales_orders')).toBe(true);
  api._hydrateOpenDoc(state.eSO, 'sales_orders');
  api._hydrateOpenDoc(state.eSO, 'sales_orders'); // a second render must not start a second read
  await flush();
  expect(load).toHaveBeenCalledTimes(1);
  expect(state.eSO.items).toEqual(full.row.items);
  expect(state.eSO).toMatchObject({_version: 78, memo: 'Fall Tees', _itemsHydrated: true, _posHydrated: true, _hydratedPoIds: ['PO-1']});
  expect(state.sos[0].items).toEqual(full.row.items);
  expect(state.snap.current.sos[0].items).toEqual(full.row.items); // baseline staged: no phantom edit
  expect(api._awaitingItems(state.eSO, 'sales_orders')).toBe(false);
});

test('an open editor is never swapped for the loading screen by a later hollow refresh', async () => {
  const load = jest.fn().mockResolvedValue(full);
  const {api} = setup({load});
  const loaded = {...hollow(), items: full.row.items, _itemsHydrated: true, _decosHydrated: true, _posHydrated: true, _picksHydrated: true};
  expect(api._awaitingItems(loaded, 'sales_orders')).toBe(false); // editor mounts
  expect(api._awaitingItems(hollow(), 'sales_orders')).toBe(false); // poll hollowed the row
  api._hydrateOpenDoc(hollow(), 'sales_orders');
  expect(load).not.toHaveBeenCalled();
});

test('a failed read warns once and falls back to opening the editor', async () => {
  const load = jest.fn().mockRejectedValue(new Error('offline'));
  const {api, state} = setup({load});
  state.eSO = hollow();
  api._hydrateOpenDoc(state.eSO, 'sales_orders');
  await flush();
  expect(state.toasts).toHaveLength(1);
  expect(state.toasts[0][1]).toBe('error');
  expect(api._awaitingItems(state.eSO, 'sales_orders')).toBe(false);
  api._hydrateOpenDoc(state.eSO, 'sales_orders');
  expect(load).toHaveBeenCalledTimes(1);
});

test('fully loaded orders and drafts under recovery review are left alone', () => {
  const load = jest.fn();
  const {api} = setup({load});
  expect(api._awaitingItems({id: 'SO-2', items: [], _itemsHydrated: true}, 'sales_orders')).toBe(false);
  expect(api._awaitingItems({id: 'EST-9', items: []}, 'estimates')).toBe(false); // brand-new, never loaded
  expect(api._awaitingItems({...hollow(), id: 'SO-3', _draftRecovery: {key: 'k'}}, 'sales_orders')).toBe(false);
  expect(load).not.toHaveBeenCalled();
});
