/* Regression tests for four production fixes just applied to src/lib/dbEngine.js:
 *   1. _isNetErr classifies the requestBreaker's synthetic throttle rejection as transient.
 *   2. A corrupted nsa_save_failed_ids blob in localStorage no longer crashes the module at import.
 *   3. _dbSaveSOInner: an under-returned so_items insert (fewer ids than rows) must not be
 *      reported as success, and must not delete the pre-existing (old) so_items rows.
 *   4. _dbSaveInvoiceInner: the insert-first swap for invoice_items — a failed insert of the new
 *      rows must leave the old rows alone (no delete issued) and report failure.
 *
 * Tests 3 and 4 drive the real save functions through a hand-rolled Supabase query-builder mock
 * (jest.mock('@supabase/supabase-js', ...)) rather than re-deriving the guard logic, so they fail
 * if the production behavior regresses, not just if some helper's return value changes.
 */

// ── Mock Supabase client: a minimal thenable query-builder that queues canned responses
// per table (FIFO) and records every call for assertions. Built entirely inside the mock
// factory (no outer-scope refs) per Jest's jest.mock hoisting rules.
jest.mock('@supabase/supabase-js', () => {
  const state = { responses: {}, calls: [] };
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
      maybeSingle: () => builder,
      single: () => builder,
      then: (resolve, reject) => {
        state.calls.push({ table, method, args: builder._args, selectArgs: builder._selectArgs, eqArgs: builder._eqArgs, inArgs: builder._inArgs });
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
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { createClient: () => client, __mockState: state };
});

const ORIG_ENV = { ...process.env };
const withSupabaseEnv = () => {
  process.env.REACT_APP_SUPABASE_URL = 'https://hardening-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
};
const restoreEnv = () => { process.env = { ...ORIG_ENV }; };

// ── Fix 1: _isNetErr classifies the circuit-breaker's synthetic throttle as transient ──────
describe('_isNetErr — circuit-breaker throttle classified as transient (fix 1)', () => {
  test('requestBreaker synthetic throttle message is a net error', () => {
    const { _isNetErr } = require('../lib/dbEngine');
    expect(_isNetErr({ message: 'throttled by client circuit breaker: runaway request loop guard' })).toBe(true);
  });
  test('CLIENT_THROTTLED code is a net error', () => {
    const { _isNetErr } = require('../lib/dbEngine');
    expect(_isNetErr({ code: 'CLIENT_THROTTLED' })).toBe(true);
  });
  test('a real server error (duplicate key) is NOT classified as a net error', () => {
    const { _isNetErr } = require('../lib/dbEngine');
    expect(_isNetErr({ message: 'duplicate key value violates unique constraint' })).toBe(false);
  });
});

// ── Fix 2: corrupt nsa_save_failed_ids must not crash module import ────────────────────────
describe('nsa_save_failed_ids corruption resilience (fix 2)', () => {
  const KEY = 'nsa_save_failed_ids';
  afterEach(() => { localStorage.removeItem(KEY); jest.resetModules(); });

  test('corrupt JSON blob at import does not throw', () => {
    localStorage.setItem(KEY, '{corrupt');
    jest.resetModules();
    expect(() => require('../lib/dbEngine')).not.toThrow();
  });

  test('a corrupt blob results in an empty failed-ids set (fails closed, not crashed)', () => {
    localStorage.setItem(KEY, '{corrupt');
    jest.resetModules();
    const { _dbSaveFailedIds } = require('../lib/dbEngine');
    expect(_dbSaveFailedIds.size).toBe(0);
  });

  test('a valid array still loads normally', () => {
    localStorage.setItem(KEY, JSON.stringify(['SO-1', 'SO-2']));
    jest.resetModules();
    const { _dbSaveFailedIds } = require('../lib/dbEngine');
    expect(_dbSaveFailedIds.has('SO-1')).toBe(true);
    expect(_dbSaveFailedIds.has('SO-2')).toBe(true);
  });
});

// ── Fix 3: _dbSaveSOInner — under-returned so_items insert must not report success ─────────
// and must not delete the pre-existing (old) so_items rows. Drives the real save path with a
// mocked Supabase client, taking the existing-SO branch (no items/version mismatch, no jobs,
// no art files, no PO/pick lines) so the only unresolved thing is the item insert itself.
describe('_dbSaveSOInner — so_items under-returned insert (fix 3)', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  test('insert returning fewer ids than rows fails the save and never deletes the old items', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      // 1) existing-SO lookup: a row exists, so this takes the upsert (not insert) branch
      sales_orders: [
        { data: { updated_at: 'yesterday', deco_pos: null }, error: null }, // existingSO select
        { error: null }, // sales_orders upsert
      ],
      // 2) old so_items read: 3 pre-existing rows
      so_items: [
        { data: [
          { id: 'oi-1', item_index: 0, sku: 'TEE', color: 'Red', product_id: null },
          { id: 'oi-2', item_index: 1, sku: 'HOOD', color: 'Blue', product_id: null },
          { id: 'oi-3', item_index: 2, sku: 'CAP', color: 'Black', product_id: null },
        ], error: null },
        // 3) the new insert: 3 rows sent, only 1 id comes back — the bug this test guards
        { data: [{ id: 'new-1' }], error: null },
      ],
      so_art_files: [{ data: [], error: null }],
      so_item_po_lines: [
        { data: [], error: null }, // PO-line restore read
        { data: [], error: null }, // duplicate-PO guard read
        { data: [], error: null }, // over-commit guard read
      ],
      so_item_pick_lines: [
        { data: [], error: null }, // pick-line restore read
        { data: [], error: null }, // over-commit guard read
      ],
    };

    const { _dbSaveSO, _dbSaveFailedIds } = require('../lib/dbEngine');
    const so = {
      id: 'SO-HARDEN-1',
      memo: 'm',
      items: [
        { sku: 'TEE', color: 'Red' },
        { sku: 'HOOD', color: 'Blue' },
        { sku: 'CAP', color: 'Black' },
      ],
    };

    const result = await _dbSaveSO(so);

    expect(result).toBe(false);
    expect(_dbSaveFailedIds.has('SO-HARDEN-1')).toBe(true);

    // The old item ids must never appear in a so_items delete — only the rolled-back NEW id may.
    const soItemDeletes = __mockState.calls.filter(c => c.table === 'so_items' && c.method === 'delete');
    expect(soItemDeletes.length).toBeGreaterThan(0); // rollback of the partial insert does happen
    const oldIds = ['oi-1', 'oi-2', 'oi-3'];
    soItemDeletes.forEach(c => {
      const deletedIds = (c.inArgs && c.inArgs[1]) || [];
      oldIds.forEach(id => expect(deletedIds).not.toContain(id));
    });
  });
});

// ── Fix 4: _dbSaveInvoiceInner — insert-first swap for invoice_items ────────────────────────
// A failed insert of the new rows must leave the old rows untouched (no delete issued) and the
// save must report failure, instead of the old delete-then-insert order that could zero the invoice.
describe('_dbSaveInvoiceInner — invoice_items insert-first swap (fix 4)', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  test('failed insert of new invoice_items never deletes the old rows and reports failure', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      invoices: [{ error: null }], // invoices upsert
      invoice_payments: [{ data: [], error: null }], // payment-restore read (no payments)
      invoice_items: [
        { count: 2, error: null }, // hydration-safety count check
        { data: [{ id: 'old-1' }, { id: 'old-2' }], error: null }, // old-id read
        { data: null, error: { message: 'insert failed: constraint violated' } }, // new-row insert FAILS
      ],
    };

    const { _dbSaveInvoice, _dbSaveFailedIds } = require('../lib/dbEngine');
    const inv = {
      id: 'INV-HARDEN-1',
      payments: [],
      items: [
        { sku: 'A', name: 'Item A', qty: 1, unit_price: 10, total: 10 },
        { sku: 'B', name: 'Item B', qty: 1, unit_price: 10, total: 10 },
        { sku: 'C', name: 'Item C', qty: 1, unit_price: 10, total: 10 },
      ],
    };

    const result = await _dbSaveInvoice(inv);

    expect(result).toBe(false);
    expect(_dbSaveFailedIds.has('INV-HARDEN-1')).toBe(true);

    // The old-order bug deleted-then-inserted; the fix inserts first, so a failed insert must
    // issue NO delete against the old invoice_items rows at all.
    const invoiceItemDeletes = __mockState.calls.filter(c => c.table === 'invoice_items' && c.method === 'delete');
    expect(invoiceItemDeletes.length).toBe(0);
  });
});
