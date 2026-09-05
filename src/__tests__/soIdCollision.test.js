/* Regression tests for the document-identity guard in src/lib/dbEngine.js (SO-1507, 2026-07-27).
 *
 * Background: ids are minted client-side from _dbMaxIds, which App.js syncs ONCE at page load, so a
 * tab left open mints a number another user already used. The pre-existing "brand-new orders INSERT
 * rather than upsert" guard keyed off `!existingSO` — "is this id free in the DB?" — which is false
 * on exactly the collisions it was meant to catch (the incumbent row is right there), so the save
 * fell through to upsert and silently replaced the other order's header. Confirmed in production on
 * SO-1507/1502/1485/1472/1454/1437/1340 and EST-1645/1646/1672.
 *
 * The guard now compares created_at — stamped once at creation, never rewritten by an edit — so a
 * differing value means the id holds a DIFFERENT document. These tests drive the real _dbSaveSOInner
 * through a mocked Supabase client and assert on the actual insert/upsert calls issued, so they fail
 * if the production behavior regresses rather than if some helper's shape changes.
 *
 * The no-false-positive cases (3 and 4) are the load-bearing ones: a guard that blocks legitimate
 * saves is worse than the bug, and a null created_at on either side means "can't tell", not "block".
 */

jest.mock('@supabase/supabase-js', () => {
  const state = { responses: {}, calls: [], rpcCalls: [] };
  const DEFAULT = { data: null, error: null, count: 0 };
  const makeBuilder = (table) => {
    let method = null;
    const builder = {
      upsert: (...a) => { method = 'upsert'; builder._args = a; return builder; },
      insert: (...a) => { method = 'insert'; builder._args = a; return builder; },
      update: (...a) => { method = 'update'; builder._args = a; return builder; },
      delete: (...a) => { method = 'delete'; builder._args = a; return builder; },
      select: (...a) => { if (!method) method = 'select'; builder._selectArgs = a; return builder; },
      eq: (...a) => { builder._eqArgs = a; return builder; },
      in: (...a) => { builder._inArgs = a; return builder; },
      // _refreshSoMaxId chains .like().order().limit()
      like: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => builder,
      single: () => builder,
      then: (resolve, reject) => {
        state.calls.push({ table, method, args: builder._args });
        const q = state.responses[table] || [];
        const resp = q.length ? q.shift() : DEFAULT;
        return Promise.resolve(resp).then(resolve, reject);
      },
    };
    return builder;
  };
  const client = {
    from: (table) => makeBuilder(table),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: (name, args) => {
      state.rpcCalls.push({ name, args });
      const q = state.responses.rpc || [];
      return Promise.resolve(q.length ? q.shift() : { data: { ok: true, version: 1 }, error: null });
    },
  };
  return { createClient: () => client, __mockState: state };
});

const ORIG_ENV = { ...process.env };
const withSupabaseEnv = () => {
  process.env.REACT_APP_SUPABASE_URL = 'https://collision-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
};
const restoreEnv = () => { process.env = { ...ORIG_ENV }; };

// An order with no items keeps the item-write guards out of the picture — this suite is only about
// which id the header lands on.
const emptyChildren = () => ({
  so_items: [{ data: [], error: null }],
  so_art_files: [{ data: [], error: null }],
  so_item_po_lines: [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }],
  so_item_pick_lines: [{ data: [], error: null }, { data: [], error: null }],
});

const soCalls = (state) => state.calls.filter(c => c.table === 'sales_orders');

describe('_dbSaveSOInner — document-identity guard on id collision', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  test('never-saved order whose id is held by another order re-mints instead of overwriting it', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      sales_orders: [
        // The incumbent: Rachel's Encinitas order, created at a different moment than ours.
        { data: { updated_at: 'incumbent-ts', deco_pos: null, created_at: '7/13/2026, 10:35:00 AM' }, error: null },
        // _refreshSoMaxId full scan — highest live number is 1510
        { data: [{ id: 'SO-1510' }, { id: 'SO-1509' }], error: null },
        { error: null }, // the re-minted insert
      ],
      ...emptyChildren(),
    };

    const { _dbSaveSO } = require('../lib/dbEngine');
    const so = { id: 'SO-1507', memo: 'JV Uniforms', created_at: '7/13/2026, 10:36:38 AM', items: [] };
    await _dbSaveSO(so);

    const writes = soCalls(__mockState).filter(c => c.method === 'insert' || c.method === 'upsert');
    // The incumbent must never be upserted over — this is the whole bug.
    expect(writes.some(c => c.method === 'upsert')).toBe(false);
    expect(writes.length).toBe(1);
    expect(writes[0].method).toBe('insert');
    // Re-minted above the fresh DB max, not to the colliding number.
    expect(writes[0].args[0].id).toBe('SO-1511');
    expect(so.id).toBe('SO-1511');
    // And it must not carry the incumbent's updated_at.
    expect(writes[0].args[0].updated_at).not.toBe('incumbent-ts');
  });

  test('already-saved order whose id is now held by another order blocks rather than overwriting', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      sales_orders: [
        // _version is set below, so _checkVersion's read runs FIRST — same version, no conflict.
        { data: { _version: 12 }, error: null },
        // then the existence probe: the incumbent, created at a different moment than ours
        { data: { updated_at: 'x', deco_pos: null, created_at: '7/13/2026, 10:35:00 AM' }, error: null },
      ],
      ...emptyChildren(),
    };

    const { _dbSaveSO } = require('../lib/dbEngine');
    // _version present => this order has been saved before, so renumbering would strand its children.
    const so = { id: 'SO-1507', memo: 'JV Uniforms', created_at: '7/13/2026, 10:36:38 AM', _version: 12, items: [] };
    const result = await _dbSaveSO(so);

    expect(result).toBe(false);
    const writes = soCalls(__mockState).filter(c => c.method === 'insert' || c.method === 'upsert');
    expect(writes.length).toBe(0); // nothing written at all
    expect(so.id).toBe('SO-1507'); // and not silently renumbered
  });

  test('matching created_at is an ordinary edit and still upserts (no false positive)', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      sales_orders: [
        { data: { updated_at: 'x', deco_pos: null, created_at: '7/13/2026, 10:36:38 AM' }, error: null },
        { error: null }, // upsert
      ],
      ...emptyChildren(),
    };

    const { _dbSaveSO } = require('../lib/dbEngine');
    const so = { id: 'SO-1507', memo: 'edited', created_at: '7/13/2026, 10:36:38 AM', items: [] };
    await _dbSaveSO(so);

    const writes = soCalls(__mockState).filter(c => c.method === 'insert' || c.method === 'upsert');
    expect(writes.length).toBe(1);
    expect(writes[0].method).toBe('upsert');
    expect(so.id).toBe('SO-1507');
  });

  test('a blocked save still preserves the edit on the outbox conflict card', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      sales_orders: [
        { data: { _version: 12 }, error: null },
        { data: { updated_at: 'x', deco_pos: null, created_at: '7/13/2026, 10:35:00 AM' }, error: null },
      ],
      ...emptyChildren(),
    };

    const { _dbSaveSO, _outboxList } = require('../lib/dbEngine');
    const so = { id: 'SO-1507', memo: 'typed but unsaved', created_at: '7/13/2026, 10:36:38 AM', _version: 12, items: [] };
    await _dbSaveSO(so);

    // A refused write must never also discard what the rep typed.
    const mine = (_outboxList() || []).filter(e => e && e.id === 'SO-1507');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0].payload.memo).toBe('typed but unsaved');
  });

  test('null created_at on the incumbent means "can\'t tell" and must not block the save', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      sales_orders: [
        { data: { updated_at: 'x', deco_pos: null, created_at: null }, error: null },
        { error: null }, // upsert
      ],
      ...emptyChildren(),
    };

    const { _dbSaveSO } = require('../lib/dbEngine');
    const so = { id: 'SO-1400', memo: 'legacy row edit', created_at: '7/13/2026, 10:36:38 AM', items: [] };
    const result = await _dbSaveSO(so);

    expect(result).not.toBe(false);
    const writes = soCalls(__mockState).filter(c => c.method === 'insert' || c.method === 'upsert');
    expect(writes.length).toBe(1);
    expect(writes[0].method).toBe('upsert');
  });
});

// ── Invoices: same collision hole, but created_at is timestamptz, not text ──────────────────
// _dbSaveInvoiceInner had NO new-vs-existing check at all — a bare upsert — so a stale tab that
// re-minted a live INV number would replace another customer's invoice, payments included.
//
// The format trap is the whole reason these tests exist: invoices.created_at is
// `timestamptz DEFAULT now()`, so a client that just created the invoice holds a toLocaleString()
// value while the DB returns ISO with microseconds. Comparing those as STRINGS would block ordinary
// re-saves on every freshly-created invoice. The guard compares parsed instants with a tolerance.
describe('_dbSaveInvoiceInner — document-identity guard on id collision', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  test('new save includes a stable creation nonce in the atomic RPC', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;__mockState.rpcCalls.length = 0;
    __mockState.responses = {
      rpc: [{ data: { ok: true, version: 1 }, error: null }],
    };

    const { _dbSaveInvoice } = require('../lib/dbEngine');
    const inv = { id: 'INV-63320', created_at: '2026-07-27T14:54:42+00:00', total: 100, payments: [], items: [] };
    const result = await _dbSaveInvoice(inv);

    expect(result).toBe(true);
    expect(inv.client_create_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(__mockState.rpcCalls).toEqual([expect.objectContaining({
      name: 'save_invoice_atomic',
      args: expect.objectContaining({p_base_version:null,p_invoice:expect.objectContaining({client_create_id:inv.client_create_id})}),
    })]);
  });

  test('never-saved invoice whose number is held by another invoice re-mints, never upserts over it', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;__mockState.rpcCalls.length = 0;
    __mockState.responses = {
      invoices: [
        // _refreshMaxId scan; note the dashless id must be counted, not skipped
        { data: [{ id: 'INV-63321' }, { id: 'INV63322' }], error: null },
      ],
      rpc: [
        { data: { ok:false, reason:'ID_EXISTS' }, error:null },
        { data: { ok:true, version:1 }, error:null },
      ],
    };

    const { _dbSaveInvoice } = require('../lib/dbEngine');
    const inv = { id: 'INV-63320', created_at: '2026-07-27T21:54:42+00:00', total: 100, payments: [], items: [] };
    await _dbSaveInvoice(inv);

    // Re-minted above the highest number found, INCLUDING the dashless 'INV63322'.
    expect(inv.id).toBe('INV-63323');
    expect(__mockState.rpcCalls).toHaveLength(2);
    expect(__mockState.rpcCalls[0].args.p_invoice.client_create_id).toBe(__mockState.rpcCalls[1].args.p_invoice.client_create_id);
    expect(__mockState.rpcCalls[1].args.p_invoice.id).toBe('INV-63323');
  });

  test('already-saved invoice whose number is now held by another blocks and parks the edit', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;__mockState.rpcCalls.length = 0;
    __mockState.responses = {
      rpc: [{ data: { ok:false, reason:'ID_EXISTS', version:7 }, error:null }],
    };

    const { _dbSaveInvoice, _outboxList } = require('../lib/dbEngine');
    const inv = { id: 'INV-63320', created_at: '2026-07-27T21:54:42+00:00', total: 100, memo: 'unsaved edit', _version: 7, payments: [], items: [] };
    const result = await _dbSaveInvoice(inv);

    expect(result).toBe(false);
    expect(__mockState.rpcCalls).toHaveLength(1);
    expect(inv.id).toBe('INV-63320'); // payments/items must not be stranded by a renumber
    expect((_outboxList() || []).filter(e => e && e.id === 'INV-63320').length).toBeGreaterThan(0);
  });

  test('a stale RPC response cannot become a whole-row overwrite', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;__mockState.rpcCalls.length = 0;
    __mockState.responses = {
      rpc: [{ data: { ok:false, reason:'STALE', version:9 }, error:null }],
    };

    const { _dbSaveInvoice } = require('../lib/dbEngine');
    const inv = { id: 'INV-63320', created_at: '2026-07-27T21:54:42+00:00', total: 100, _version:8, payments: [], items: [] };
    const result = await _dbSaveInvoice(inv);

    expect(result).toBe('stale');
    expect(inv._version).toBe(8);
    expect(__mockState.rpcCalls).toHaveLength(1);
  });
});

// ── The gap the created_at guard left open (INV-63144, 2026-07-10) ──────────────────────────
// Every test above hands the guard a client-side created_at. The Create Invoice button in
// OrderEditor never sets one — the column has a DB default — so in the path that makes almost every
// invoice, `inv.created_at` is undefined, the guard short-circuits, and a collision walks straight
// through to the upsert. That is how Palos Verdes HS Football's $384.41 invoice was replaced 92
// seconds after it was created (and after it had already been emailed to the school) by another
// rep's session that had minted the same number off a stale page load.
describe('_dbSaveInvoiceInner — identity guard with no client created_at', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  // The INV-63144 reproduction.
  test('never-saved invoice re-mints when the number is held by another customer', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;__mockState.rpcCalls.length = 0;
    __mockState.responses = {
      invoices: [
        { data: [{ id: 'INV-63144' }], error: null }, // _refreshMaxId scan
      ],
      rpc: [{ data:{ok:false,reason:'ID_EXISTS'},error:null },{ data:{ok:true,version:1},error:null }],
    };

    const { _dbSaveInvoice } = require('../lib/dbEngine');
    // Sharon's session: a brand-new invoice for a different customer, no created_at, no _version.
    const inv = { id: 'INV-63144', customer_id: 'c1782506750436', so_id: 'SO-1353', total: 11898.76, payments: [], items: [] };
    await _dbSaveInvoice(inv);

    expect(inv.id).toBe('INV-63145');
    expect(__mockState.rpcCalls).toHaveLength(2);
    expect(__mockState.rpcCalls[1].args.p_invoice.id).toBe('INV-63145');
    expect(__mockState.rpcCalls[1].args.p_invoice.customer_id).toBe('c1782506750436');
  });

  // The false positive to avoid: the failed-ids retry loop re-saves an invoice object that never
  // recorded its _version, so it looks "new" while its own row already exists. Same document —
  // renumbering it here would mint a duplicate invoice out of a successful save.
  test('lost-response retry keeps its number only when the persisted nonce proves ownership', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;__mockState.rpcCalls.length = 0;
    __mockState.responses = {
      rpc: [{ data:{ok:true,version:1,idempotent:true},error:null }],
    };

    const { _dbSaveInvoice } = require('../lib/dbEngine');
    const inv = { id: 'INV-63144', client_create_id:'11111111-1111-4111-8111-111111111111', customer_id: 'c-ns-2625', so_id: 'SO-1495', total: 384.41, payments: [], items: [] };
    const result = await _dbSaveInvoice(inv);

    expect(result).not.toBe(false);
    expect(inv.id).toBe('INV-63144'); // not renumbered
    expect(__mockState.rpcCalls).toHaveLength(1);
    expect(__mockState.rpcCalls[0].args.p_invoice.client_create_id).toBe(inv.client_create_id);
  });

  // Re-pointing a loaded invoice to another customer is a real workflow (the Lincoln XC split did
  // exactly that). A _version means the client read this row from the DB, so the change is deliberate.
  test('deliberate re-point of a loaded invoice is not treated as a collision', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;__mockState.rpcCalls.length = 0;
    __mockState.responses = {
      rpc: [{ data:{ok:true,version:4},error:null }],
    };

    const { _dbSaveInvoice } = require('../lib/dbEngine');
    const inv = { id: 'INV-63183', customer_id: 'c-ns-4601', so_id: 'SO-1436', total: 265, _version: 3, payments: [], items: [] };
    const result = await _dbSaveInvoice(inv);

    expect(result).not.toBe(false);
    expect(inv.id).toBe('INV-63183');
    expect(__mockState.rpcCalls).toHaveLength(1);
    expect(__mockState.rpcCalls[0].args.p_base_version).toBe(3);
  });
});
