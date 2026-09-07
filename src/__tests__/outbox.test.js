/* Tests for the durable edit outbox (Tier 2A) — the localStorage store that preserves
 * failed-save CONTENT across reloads/forced logout, and the boot-time version gate that
 * decides whether a stashed payload may re-enter state.
 *
 * The gate is the load-bearing piece: a stale outbox payload silently overwriting a newer
 * server row would be worse than the data loss the outbox prevents. Every ambiguous case
 * must resolve to 'conflict' (surface a card), never to a silent apply.
 */
import {
  _outboxGate, _outboxMatchesRow,
  _outboxAdd, _outboxRemove, _outboxRemoveById, _outboxList,
  _outboxWrap, _dbSaveFailedIds,
  _emitOutboxConflict, _setOnOutboxConflict,
  _dbOwnVersions, _rebaseOntoOwnWrite,
  _custDiffCmp,
} from '../lib/dbEngine';

const clearBox = () => localStorage.removeItem('nsa_outbox');
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('_outboxMatchesRow (committed-but-response-lost detection)', () => {
  test('matches when every persisted payload field is reflected in the row', () => {
    const payload = { id: 'SO-1', memo: 'hi', items: [{ sku: 'TEE', sizes: { M: 2 } }] };
    const row = { id: 'SO-1', memo: 'hi', items: [{ sku: 'TEE', sizes: { M: 2 } }], other_col: 'row-only is fine' };
    expect(_outboxMatchesRow(payload, row)).toBe(true);
  });
  test('ignores client-only (_-prefixed) fields and volatile stamps', () => {
    const payload = { id: 'SO-1', memo: 'hi', _version: 3, _retry: 123, _sizeCosts: { M: 4 }, updated_at: 'yesterday', created_at: 'then' };
    const row = { id: 'SO-1', memo: 'hi', _version: 4, updated_at: 'today', created_at: 'now' };
    expect(_outboxMatchesRow(payload, row)).toBe(true);
  });
  test('null and undefined are equivalent; a real difference is not', () => {
    expect(_outboxMatchesRow({ id: 'X', po_number: null }, { id: 'X' })).toBe(true);
    expect(_outboxMatchesRow({ id: 'X', memo: 'a' }, { id: 'X', memo: 'b' })).toBe(false);
    expect(_outboxMatchesRow({ id: 'X', items: [{ q: 1 }] }, { id: 'X', items: [{ q: 2 }] })).toBe(false);
  });
  test('customers: child-table arrays (promo/credit/pending-ship) are ignored — the customer save cannot write them', () => {
    // Serialization drift (client ISO timestamps + numbers vs Postgres formatting) in the attached
    // promo arrays must not defeat the match — the 17-Helix-conflict-cards case.
    const payload = { id: 'c-1', name: 'Helix HS', promo_programs: [{ id: 'pp1', fixed_amount: 6001, created_at: '2026-07-28T14:11:00.962Z' }] };
    const row = { id: 'c-1', name: 'Helix HS', promo_programs: [{ id: 'pp1', fixed_amount: '6001', created_at: '2026-07-28 14:11:00.962+00' }] };
    expect(_outboxMatchesRow(payload, row, 'customers')).toBe(true);
    // …but only for the customers table; and a real customer-row difference still mismatches.
    expect(_outboxMatchesRow(payload, row, 'sales_orders')).toBe(false);
    expect(_outboxMatchesRow({ ...payload, name: 'Renamed' }, row, 'customers')).toBe(false);
    // contacts DO persist with the customer save, so they still count.
    expect(_outboxMatchesRow({ ...payload, contacts: [{ name: 'A' }] }, { ...row, contacts: [{ name: 'B' }] }, 'customers')).toBe(false);
  });
});

describe('_custDiffCmp (customer autosave phantom-change guard)', () => {
  test('a promo add fanned out to the family is NOT a customer-row change', () => {
    const before = { id: 'c-1', name: 'Helix HS', _version: 3, promo_programs: [] };
    const after = { ...before, promo_programs: [{ id: 'pp1', fixed_amount: 6001 }], promo_periods: [{ id: 'per1' }] };
    expect(_custDiffCmp(before)).toBe(_custDiffCmp(after));
  });
  test('real customer-row and contact changes still diff', () => {
    const base = { id: 'c-1', name: 'Helix HS', contacts: [{ name: 'Chase' }] };
    expect(_custDiffCmp(base)).not.toBe(_custDiffCmp({ ...base, name: 'Renamed' }));
    expect(_custDiffCmp(base)).not.toBe(_custDiffCmp({ ...base, contacts: [{ name: 'Sam' }] }));
  });
});

describe('_outboxGate (the load-bearing boot decision)', () => {
  const entry = (baseVersion, payload = { id: 'SO-1', memo: 'edit' }) =>
    ({ table: 'sales_orders', id: 'SO-1', payload, baseVersion, ts: 1 });

  test('row absent + no base version → apply (never-saved new entity)', () => {
    expect(_outboxGate(entry(null), undefined)).toBe('apply');
  });
  test('row absent + had a base version → conflict (row was deleted server-side; never silently resurrect)', () => {
    expect(_outboxGate(entry(3), undefined)).toBe('conflict');
  });
  test('row already contains the edit → drop, even though the version advanced', () => {
    expect(_outboxGate(entry(3), { id: 'SO-1', memo: 'edit', _version: 4 })).toBe('drop');
  });
  test('server version ≤ base → apply (no other writer advanced the row)', () => {
    expect(_outboxGate(entry(3), { id: 'SO-1', memo: 'older', _version: 3 })).toBe('apply');
    expect(_outboxGate(entry(3), { id: 'SO-1', memo: 'older', _version: 2 })).toBe('apply');
  });
  test('server version > base → conflict (server moved on; card, never silent overwrite)', () => {
    expect(_outboxGate(entry(3), { id: 'SO-1', memo: 'newer', _version: 4 })).toBe('conflict');
  });
  test('no version info on either side → conflict (no proof of safety)', () => {
    expect(_outboxGate(entry(null), { id: 'SO-1', memo: 'other' })).toBe('conflict');
    expect(_outboxGate(entry(3), { id: 'SO-1', memo: 'other' })).toBe('conflict');
  });
  test('customer payload differing only in attached promo arrays → drop, even past the base version', () => {
    const en = { table: 'customers', id: 'c-1', baseVersion: 3,
      payload: { id: 'c-1', name: 'Helix HS', _version: 3, promo_programs: [{ id: 'pp1', fixed_amount: 6001 }] } };
    const dbRow = { id: 'c-1', name: 'Helix HS', _version: 5, promo_programs: [{ id: 'pp1', fixed_amount: '6001' }] };
    expect(_outboxGate(en, dbRow)).toBe('drop');
  });
});

describe('outbox store (localStorage round-trip)', () => {
  beforeEach(clearBox);
  afterAll(clearBox);

  test('add / list / remove round-trip; baseVersion and payload captured; _retry stripped', () => {
    _outboxAdd('sales_orders', { id: 'SO-9', memo: 'm', _version: 7, _retry: 999 });
    const [en] = _outboxList();
    expect(en.table).toBe('sales_orders');
    expect(en.id).toBe('SO-9');
    expect(en.baseVersion).toBe(7);
    expect(en.payload._retry).toBeUndefined();
    expect(en.payload.memo).toBe('m');
    expect(en.attempts).toBe(1);
    _outboxRemove('sales_orders', 'SO-9');
    expect(_outboxList()).toHaveLength(0);
  });

  test('re-adding the same entity updates the payload and increments attempts', () => {
    _outboxAdd('estimates', { id: 'EST-1', memo: 'v1', _version: 2 });
    _outboxAdd('estimates', { id: 'EST-1', memo: 'v2', _version: 2 });
    const list = _outboxList();
    expect(list).toHaveLength(1);
    expect(list[0].payload.memo).toBe('v2');
    expect(list[0].attempts).toBe(2);
  });

  test('_outboxRemoveById clears an entity regardless of table', () => {
    _outboxAdd('sales_orders', { id: 'SO-2', memo: 'a' });
    _outboxAdd('invoices', { id: 'INV-2', memo: 'b' });
    _outboxRemoveById('SO-2');
    const left = _outboxList();
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe('INV-2');
  });

  test('survives a corrupted blob (falls back to empty, does not throw)', () => {
    localStorage.setItem('nsa_outbox', '{not json');
    expect(_outboxList()).toEqual([]);
    _outboxAdd('sales_orders', { id: 'SO-3', memo: 'ok' });
    expect(_outboxList()).toHaveLength(1);
  });

  test('_emitOutboxConflict preserves the payload AND notifies the app (stale-rejection path)', () => {
    const received = [];
    _setOnOutboxConflict(en => received.push(en));
    _emitOutboxConflict('estimates', { id: 'EST-7', memo: 'rejected edit', _version: 4 });
    _setOnOutboxConflict(null);
    // content persisted durably…
    const [stored] = _outboxList();
    expect(stored.id).toBe('EST-7');
    expect(stored.payload.memo).toBe('rejected edit');
    expect(stored.baseVersion).toBe(4);
    // …and the app got the same entry for the live conflict card
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe('EST-7');
  });

  test('baseVersion prefers _obBaseVersion (pre-auto-heal base) over the healed _version', () => {
    // The optimistic-lock auto-heal advances entity._version to the server's number WITHOUT
    // changing the content. Recording that healed _version as baseVersion made _outboxGate
    // silently re-apply stale content over newer server rows at boot (the SO-1514 stuck-retry
    // loop). The save paths stash the true pre-heal base in _obBaseVersion; it must win here.
    _outboxAdd('sales_orders', { id: 'SO-1514', memo: 'stale edit', _version: 112, _obBaseVersion: 111 });
    const [en] = _outboxList();
    expect(en.baseVersion).toBe(111);
    // and the gate now sees the server (v112) as having moved past the edit's base → conflict card
    expect(_outboxGate(en, { id: 'SO-1514', memo: 'newer', _version: 112 })).toBe('conflict');
  });

  test('drafts beyond the old size cap are retained without evicting older work', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const big = 'x'.repeat(500 * 1024); // two of these exceed the ~768k-char cap
    _outboxAdd('sales_orders', { id: 'SO-OLD', memo: big });
    // make SO-OLD strictly older than the next write
    const box = JSON.parse(localStorage.getItem('nsa_outbox'));
    box['sales_orders:SO-OLD'].ts = 1;
    localStorage.setItem('nsa_outbox', JSON.stringify(box));
    _outboxAdd('sales_orders', { id: 'SO-NEW', memo: big });
    const left = _outboxList();
    expect(left).toHaveLength(2);
    expect(left.map(e=>e.id)).toEqual(expect.arrayContaining(['SO-OLD','SO-NEW']));
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('_outboxWrap (revision-aware completion acknowledgement)', () => {
  beforeEach(() => { clearBox(); _dbSaveFailedIds.delete('C-1'); });
  afterEach(() => { clearBox(); _dbSaveFailedIds.delete('C-1'); });

  test('an older success does not remove a newer draft that later fails', async () => {
    const oldResult = deferred();
    const newResult = deferred();
    const oldSave = _outboxWrap('customers', { id: 'C-1', name: 'old' }, oldResult.promise);
    const oldRevision = _outboxList()[0].revision;
    const newSave = _outboxWrap('customers', { id: 'C-1', name: 'new' }, newResult.promise);
    const newRevision = _outboxList()[0].revision;

    oldResult.resolve(true);
    await oldSave;
    expect(_outboxList()[0]).toMatchObject({ id: 'C-1', revision: newRevision, payload: { name: 'new' } });

    _dbSaveFailedIds.add('C-1');
    newResult.resolve(false);
    await newSave;
    expect(_outboxList()[0]).toMatchObject({ id: 'C-1', revision: expect.any(String), payload: { name: 'new' } });
    expect(_outboxList()[0].revision).toBe(newRevision);
    expect(newRevision).not.toBe(oldRevision);
  });

  test('a newer failure remains durable even when it completes before the older success', async () => {
    const oldResult = deferred();
    const newResult = deferred();
    const oldSave = _outboxWrap('customers', { id: 'C-1', name: 'old' }, oldResult.promise);
    const oldRevision = _outboxList()[0].revision;
    const newSave = _outboxWrap('customers', { id: 'C-1', name: 'new' }, newResult.promise);
    const newRevision = _outboxList()[0].revision;

    _dbSaveFailedIds.add('C-1');
    newResult.resolve(false);
    await newSave;
    oldResult.resolve(true);
    await oldSave;

    const [remaining] = _outboxList();
    expect(remaining).toMatchObject({ id: 'C-1', payload: { name: 'new' } });
    expect(remaining.revision).toBe(newRevision);
    expect(newRevision).not.toBe(oldRevision);
  });

  test('an older save conflict cannot replace a newer staged draft', () => {
    const old = { id: 'C-1', name: 'old' };
    const oldResult = deferred();
    _outboxWrap('customers', old, oldResult.promise);
    _outboxWrap('customers', { id: 'C-1', name: 'new' }, deferred().promise);

    _emitOutboxConflict('customers', old);

    expect(_outboxList()[0].payload.name).toBe('new');
  });

  test('art-only success does not clear a failed full-entity payload', async () => {
    _outboxAdd('sales_orders', { id: 'C-1', name: 'full draft' });
    const artResult = deferred();
    const artSave = _outboxWrap('sales_orders', { id: 'C-1', name: 'art snapshot' }, artResult.promise, true);
    artResult.resolve(true);
    await artSave;
    expect(_outboxList()[0].payload.name).toBe('full draft');
  });

  test('art-only failure captures when empty and preserves an existing full draft', async () => {
    _dbSaveFailedIds.add('C-1');
    const firstResult = deferred();
    const firstSave = _outboxWrap('sales_orders', { id: 'C-1', name: 'art failure' }, firstResult.promise, true);
    firstResult.resolve(false);
    await firstSave;
    expect(_outboxList()[0].payload.name).toBe('art failure');

    _outboxAdd('sales_orders', { id: 'C-1', name: 'newer full draft' });
    const secondResult = deferred();
    const secondSave = _outboxWrap('sales_orders', { id: 'C-1', name: 'old art failure' }, secondResult.promise, true);
    secondResult.resolve(false);
    await secondSave;
    expect(_outboxList()[0].payload.name).toBe('newer full draft');
  });

  test('coalesced waiters sharing one mutable object each consume only their own conflict marker', async () => {
    const shared = { id: 'C-1', name: 'draft' };
    const secondResult = deferred();
    const thirdResult = deferred();
    const secondSave = _outboxWrap('customers', shared, secondResult.promise);
    const thirdSave = _outboxWrap('customers', shared, thirdResult.promise);

    _emitOutboxConflict('customers', shared);
    secondResult.resolve(false);
    await secondSave;
    expect(_outboxList()).toHaveLength(1);
    thirdResult.resolve(false);
    await thirdSave;
    expect(_outboxList()).toHaveLength(1);
    expect(_outboxList()[0].payload.name).toBe('draft');
  });

  test('successful ID remint acknowledges the immutable staged key', async () => {
    const entity = { id: 'SO-OLD', memo: 'saved after remint' };
    const result = deferred();
    const save = _outboxWrap('sales_orders', entity, result.promise);
    entity.id = 'SO-NEW';
    result.resolve(true);
    await save;
    expect(_outboxList()).toHaveLength(0);
  });

  test('failed ID remint rekeys its own retained draft without replacing a newer destination draft', async () => {
    const entity = { id: 'SO-OLD', memo: 'reminted draft' };
    const result = deferred();
    const save = _outboxWrap('sales_orders', entity, result.promise);
    entity.id = 'SO-NEW';
    _dbSaveFailedIds.add('SO-NEW');
    result.resolve(false);
    await save;
    expect(_outboxList()).toMatchObject([{ id: 'SO-NEW', payload: { memo: 'reminted draft' } }]);
    _dbSaveFailedIds.delete('SO-NEW');
  });

  test('failed ID remint drops its old key when the final ID already has a newer draft', async () => {
    const entity = { id: 'SO-OLD', memo: 'old attempt' };
    const result = deferred();
    const save = _outboxWrap('sales_orders', entity, result.promise);
    _outboxAdd('sales_orders', { id: 'SO-NEW', memo: 'newer destination' });
    entity.id = 'SO-NEW';
    _dbSaveFailedIds.add('SO-NEW');
    result.resolve(false);
    await save;
    expect(_outboxList()).toMatchObject([{ id: 'SO-NEW', payload: { memo: 'newer destination' } }]);
    _dbSaveFailedIds.delete('SO-NEW');
  });
});

describe('_rebaseOntoOwnWrite (self-conflict prevention — the EST-1395 false conflict card)', () => {
  // Scenario from prod, 2026-07-08: save 1 (approval flush) wrote v8; convertSO's payload was a
  // clone taken at v7, and _checkVersion's own-echo skip meant nothing healed the base — so the
  // conversion was rejected as a conflict with this client's OWN write and a conflict card shown.
  afterEach(() => { for (const k of Object.keys(_dbOwnVersions)) delete _dbOwnVersions[k]; });

  test('a payload cloned before our own version bump adopts the version we wrote', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    _dbOwnVersions['EST-1395'] = 8;               // save 1 succeeded → server returned v8
    const clone = { id: 'EST-1395', status: 'converted', _version: 7 }; // cloned pre-bump
    _rebaseOntoOwnWrite(clone);
    expect(clone._version).toBe(8);               // goes out as a current-base write, not stale
    warnSpy.mockRestore();
  });

  test('never rebases DOWN or past a foreign write', () => {
    _dbOwnVersions['EST-1'] = 5;
    const ahead = { id: 'EST-1', _version: 9 };   // e.g. precheck already healed to a foreign v9
    _rebaseOntoOwnWrite(ahead);
    expect(ahead._version).toBe(9);               // own older write must not roll it back
    const equal = { id: 'EST-1', _version: 5 };
    _rebaseOntoOwnWrite(equal);
    expect(equal._version).toBe(5);
  });

  test('no-op for entities this client never saved (optimistic locking untouched)', () => {
    const e = { id: 'EST-2', _version: 3 };
    _rebaseOntoOwnWrite(e);
    expect(e._version).toBe(3);
    const fresh = { id: 'EST-3' };                // brand-new draft, no version yet
    _rebaseOntoOwnWrite(fresh);
    expect(fresh._version).toBeUndefined();
  });
});

describe('immutable document save attempts',()=>{
  beforeEach(clearBox);
  test('backup exists before dispatch and later object mutations cannot change the submitted snapshot',async()=>{
    const {_saveDocument}=require('../lib/dbEngine');
    let release;const held=new Promise(r=>{release=r});
    const source={id:'SO-IMMUTABLE',items:[{sku:'TEE',sizes:{M:2}}]};
    let received;
    const pending=_saveDocument('sales_orders',source,async snapshot=>{
      received=snapshot;
      expect(_outboxList().find(e=>e.id===source.id).payload.items[0].sizes.M).toBe(2);
      await held;snapshot._version=2;return true;
    });
    source.items[0].sizes.M=7;
    expect(received.items[0].sizes.M).toBe(2);
    release();await pending;
    expect(source.items[0].sizes.M).toBe(7);
    expect(source._version).toBeUndefined(); // no promotion of unsaved content
  });
  test('old completion cannot clear the newer backup or pending-save protection',async()=>{
    const {_saveDocument,_hasActiveDocumentSave,_dbSavePendingIds}=require('../lib/dbEngine');
    let releaseOld,releaseNew;const first=new Promise(r=>{releaseOld=r});const second=new Promise(r=>{releaseNew=r});
    const save=async draft=>{await(draft.memo==='old'?first:second);return true};
    const old=_saveDocument('sales_orders',{id:'SO-REVISIONS',memo:'old'},save);
    const next=_saveDocument('sales_orders',{id:'SO-REVISIONS',memo:'new'},save);
    releaseOld();await old;
    expect(_outboxList().find(e=>e.id==='SO-REVISIONS').payload.memo).toBe('new');
    expect(_hasActiveDocumentSave('SO-REVISIONS')).toBe(true);
    expect(_dbSavePendingIds.has('SO-REVISIONS')).toBe(true);
    releaseNew();await next;
    expect(_outboxList().find(e=>e.id==='SO-REVISIONS')).toBeUndefined();
    expect(_dbSavePendingIds.has('SO-REVISIONS')).toBe(false);
  });
});

test('quota failure preserves the previously stored backup and reports staging failure',()=>{
 localStorage.removeItem('nsa_outbox');
 _outboxAdd('sales_orders',{id:'SO-KEPT',memo:'must survive'});
 const original=localStorage.getItem('nsa_outbox');
 const spy=jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('QuotaExceededError');});
 const error=jest.spyOn(console,'error').mockImplementation(()=>{});
 expect(_outboxAdd('sales_orders',{id:'SO-NO-SPACE',memo:'new'})).toBe(false);
 expect(localStorage.getItem('nsa_outbox')).toBe(original);
 spy.mockRestore();error.mockRestore();localStorage.removeItem('nsa_outbox');
});
