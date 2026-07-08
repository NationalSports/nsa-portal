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
  _emitOutboxConflict, _setOnOutboxConflict,
  _dbOwnVersions, _rebaseOntoOwnWrite,
} from '../lib/dbEngine';

const clearBox = () => localStorage.removeItem('nsa_outbox');

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

  test('size cap evicts oldest-first, loudly, never wedging the write', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const big = 'x'.repeat(500 * 1024); // two of these exceed the ~768k-char cap
    _outboxAdd('sales_orders', { id: 'SO-OLD', memo: big });
    // make SO-OLD strictly older than the next write
    const box = JSON.parse(localStorage.getItem('nsa_outbox'));
    box['sales_orders:SO-OLD'].ts = 1;
    localStorage.setItem('nsa_outbox', JSON.stringify(box));
    _outboxAdd('sales_orders', { id: 'SO-NEW', memo: big });
    const left = _outboxList();
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe('SO-NEW');
    expect(errSpy).toHaveBeenCalled(); // eviction is data loss — must never be silent
    errSpy.mockRestore();
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
