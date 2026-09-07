import { billQueueHydrationKey, isBillQueueHydrated } from '../billQueueHydration';

const fs = require('fs');
const path = require('path');
const APP = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');

const so = (overrides = {}) => ({
  id: 'SO-1',
  customer_id: 'C-1',
  _itemsHydrated: true,
  _posHydrated: true,
  ...overrides,
});

const cust = [{ id: 'C-1', alpha_tag: 'ABC' }];

describe('Sports Inc bill queue hydration gate', () => {
  test('accepts only a completed operational snapshot', () => {
    expect(isBillQueueHydrated({ dbLoading: false, sos: [so()], cust })).toBe(true);
  });

  test('rejects the initial loading state even when cached candidates are nonempty', () => {
    expect(isBillQueueHydrated({ dbLoading: true, sos: [so()], cust })).toBe(false);
  });

  test('rejects an order book with any timed-out item or PO child load', () => {
    expect(isBillQueueHydrated({ dbLoading: false, sos: [so({ _itemsHydrated: false })], cust })).toBe(false);
    expect(isBillQueueHydrated({ dbLoading: false, sos: [so({ _posHydrated: false })], cust })).toBe(false);
    // Missing markers are unknown, not proof that the children loaded.
    expect(isBillQueueHydrated({ dbLoading: false, sos: [so({ _posHydrated: undefined })], cust })).toBe(false);
  });

  test('rejects an unresolved customer join used by PO+tag matching', () => {
    expect(isBillQueueHydrated({ dbLoading: false, sos: [so({ customer_id: 'C-MISSING' })], cust })).toBe(false);
    expect(isBillQueueHydrated({ dbLoading: false, sos: [so({ customer_id: '' })], cust })).toBe(false);
  });

  test('accepts an empty, completed book so a queue with no portal orders still renders', () => {
    expect(isBillQueueHydrated({ dbLoading: false, sos: [], cust: [] })).toBe(true);
    expect(isBillQueueHydrated({ dbLoading: false, sos: [], cust })).toBe(true);
    // A nonempty SO list still needs a resolved customer join.
    expect(isBillQueueHydrated({ dbLoading: false, sos: [so()], cust: [] })).toBe(false);
  });

  test('hydration key changes on late completion but is stable across ordinary reordering', () => {
    const partial = [so({ id: 'SO-2', _posHydrated: false }), so({ id: 'SO-1' })];
    const complete = [so({ id: 'SO-1' }), so({ id: 'SO-2' })];
    expect(billQueueHydrationKey({ dbLoading: false, sos: partial, cust })).not.toBe(
      billQueueHydrationKey({ dbLoading: false, sos: complete, cust }),
    );
    expect(billQueueHydrationKey({ dbLoading: false, sos: complete, cust })).toBe(
      billQueueHydrationKey({ dbLoading: false, sos: [...complete].reverse(), cust }),
    );
    expect(billQueueHydrationKey({ dbLoading: false, sos: complete, cust })).not.toBe(
      billQueueHydrationKey({ dbLoading: false, sos: complete, cust: [{ id: 'C-1', alpha_tag: 'NEW' }] }),
    );
  });

  test('App keeps reads available but gates shared writes and hydration-triggered reloads', () => {
    const loadStart = APP.indexOf('const loadSiQueue=async()=>');
    const loadEnd = APP.indexOf('// Auto-load the queue whenever the bills page opens', loadStart);
    const loadBody = APP.slice(loadStart, loadEnd);
    expect(loadBody).not.toContain('isBillQueueHydrated');
    expect(APP).toContain('const liveSnapshot=liveState.sos===sos&&liveState.cust===cust&&liveState.dbLoading===dbLoading;');
    expect(APP).toContain('if(!liveSnapshot||!isBillQueueHydrated(liveState)||billQueueHydrationKey(liveState)!==_siQueueHydrationKey.current||!(cands||[]).length)return rows;');
    expect(APP).toContain('if(_siQueueLoadInFlight.current)return;');
    expect(APP).toContain('},[pg,billView,dbLoading,sos,cust,siQueueLoading]);');
    expect(APP).toContain('_siQueueHydrationKey.current=billQueueHydrationKey({dbLoading,sos,cust});');
    expect(APP).toContain('billQueueHydrationKey(liveState)!==_siQueueHydrationKey.current');
    expect(APP).toContain('if(!supabase)return;');
    expect(APP).toContain('when siQueue already has rows so previously auto-parked rows are re-triaged automatically.');
  });
});
