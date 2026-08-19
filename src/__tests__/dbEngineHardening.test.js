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

// ── Fix 5: _dbPersistNewPoLine — durable create-time write for the "PO dropped from portal" hole ──
// A just-created Create-PO line must be written to so_item_po_lines immediately, so a two-tab
// overwrite can't drop it before the debounced whole-SO save flushes (SO-1663, PO 28950 SANBA).
// It must (a) persist the line when the item exists, (b) no-op when the item isn't in the DB yet,
// and (c) be idempotent — never write a second row for a (so_item, po_id) that already exists.
describe('_dbPersistNewPoLine — durable PO line write at creation (fix 5)', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  const poLine = { po_id: 'PO 35700 SANBA', vendor: 'Adidas', status: 'waiting', L: 3, M: 5, unit_cost: 20.62 };

  test('persists the line when the item exists and no line is present yet', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      so_items: [{ data: { id: 'oi-9' }, error: null }],        // item lookup by so_id+item_index
      so_item_po_lines: [
        { data: [], error: null },                              // existence check — none yet
        { error: null },                                        // the insert
      ],
    };

    const { _dbPersistNewPoLine } = require('../lib/dbEngine');
    await _dbPersistNewPoLine('SO-1663', 2, poLine);

    const inserts = __mockState.calls.filter(c => c.table === 'so_item_po_lines' && c.method === 'insert');
    expect(inserts.length).toBe(1);
    const row = inserts[0].args[0];
    expect(row.po_id).toBe('PO 35700 SANBA');
    expect(row.so_item_id).toBe('oi-9');
    expect(row.sizes.M).toBe(5);
    expect(row.sizes.L).toBe(3);
    expect(row.sizes.unit_cost).toBe(20.62);
    // The whole-SO save owns the updated_at/version bump — this durable write must NOT issue its own.
    expect(__mockState.calls.some(c => c.table === 'sales_orders' && c.method === 'update')).toBe(false);
  });

  test('no-ops (no insert) when the item is not in the DB yet — brand-new order', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      so_items: [{ data: null, error: null }],                 // item not found
    };

    const { _dbPersistNewPoLine } = require('../lib/dbEngine');
    await _dbPersistNewPoLine('SO-NEW', 0, poLine);

    expect(__mockState.calls.some(c => c.table === 'so_item_po_lines' && c.method === 'insert')).toBe(false);
  });

  test('is idempotent — does not write a second row when the (item, po_id) already exists', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      so_items: [{ data: { id: 'oi-9' }, error: null }],
      so_item_po_lines: [{ data: [{ id: 'existing-1' }], error: null }], // already there
    };

    const { _dbPersistNewPoLine } = require('../lib/dbEngine');
    await _dbPersistNewPoLine('SO-1663', 2, poLine);

    expect(__mockState.calls.some(c => c.table === 'so_item_po_lines' && c.method === 'insert')).toBe(false);
  });

  test('ignores calls with no po_id or a null item index (nothing to persist)', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = { so_items: [{ data: { id: 'oi-9' }, error: null }] };

    const { _dbPersistNewPoLine } = require('../lib/dbEngine');
    await _dbPersistNewPoLine('SO-1663', null, poLine);
    await _dbPersistNewPoLine('SO-1663', 2, { vendor: 'Adidas' }); // no po_id

    expect(__mockState.calls.length).toBe(0);
  });
});

// ── Fix 6: _dbSaveProductInner must never erase a product's size scale ─────────────────────
// `available_sizes:p.available_sizes||[]` in a FULL-ROW upsert meant any caller passing a
// product object without the field wrote `[]` over the stored scale. The "Update Catalog →
// $cost" button on the bill-reconcile tab is exactly such a caller (it builds {id,sku,name,
// vendor_id,brand,color,image_url,nsa_cost}), and when the product isn't in local state
// there is nothing to merge over. That is how ~1,100 catalog rows reached available_sizes =
// [] and rendered on the webstores with no size buttons at all. The column must now be
// omitted unless we hold a real scale, so the stored value survives.
describe('_dbSaveProductInner — a partial product save must not wipe available_sizes (fix 6)', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  const productUpsert = (state) => state.calls.find((c) => c.table === 'products' && c.method === 'upsert');

  test('a cost-only update (no sizes on the object) omits the column entirely', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = { products: [{ error: null }] };

    const { _dbSaveProduct } = require('../lib/dbEngine');
    // Exactly the shape the "Update Catalog → $cost" button builds.
    await _dbSaveProduct({ id: 'p-1779148800000-406', sku: 'HI0704', name: 'Adidas W. Team Issue Pants', vendor_id: 'v1', brand: 'Adidas', color: 'Black', image_url: null, nsa_cost: 22.5 });

    const row = productUpsert(__mockState).args[0];
    expect(row).not.toHaveProperty('available_sizes');
    expect(row.nsa_cost).toBe(22.5); // the edit itself still saves
  });

  test('an explicitly empty scale is also treated as "nothing to write"', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = { products: [{ error: null }] };

    const { _dbSaveProduct } = require('../lib/dbEngine');
    await _dbSaveProduct({ id: 'p2', sku: 'GL9698', name: 'Adidas W. 3 Stripe Short', available_sizes: [] });

    expect(productUpsert(__mockState).args[0]).not.toHaveProperty('available_sizes');
  });

  test('a real scale is still written through unchanged', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = { products: [{ error: null }] };

    const { _dbSaveProduct } = require('../lib/dbEngine');
    await _dbSaveProduct({ id: 'p3', sku: 'HS1301', name: 'Adidas Classic Polo', available_sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'] });

    expect(productUpsert(__mockState).args[0].available_sizes).toEqual(['S', 'M', 'L', 'XL', '2XL', '3XL']);
  });

  test('a non-array value is not written (never persists junk over a good scale)', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = { products: [{ error: null }] };

    const { _dbSaveProduct } = require('../lib/dbEngine');
    await _dbSaveProduct({ id: 'p4', sku: 'X1', name: 'X', available_sizes: 'S,M,L' });

    expect(productUpsert(__mockState).args[0]).not.toHaveProperty('available_sizes');
  });
});

// ── Fix 8: _dbSaveInvoiceInner — a failed payment write must never delete payment rows ──────
// INV-1053 (2026-08-12): the old fallback here deleted every invoice_payments row and then
// re-inserted the SAME payload that had just failed, swallowing both errors. With the payment
// row gone, CommissionsPage falls back to the INVOICE date and books the rep's commission in
// the wrong month — an invoice paid 8/11 landed on the July statement.
describe('_dbSaveInvoiceInner — payment write failures never destroy payment rows (fix 8)', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  const invWithPayment = () => ({
    id: 'INV-PAY-1',
    payments: [{ amount: 500, method: 'check', ref: 'chk 8891', date: '08/11/2026', cc_fee: 0 }],
  });

  test('cc_fee is coerced to a number so an undefined can never reject the batch', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      invoices: [{ error: null }],
      invoice_payments: [
        { data: [], error: null }, // restore read
        { error: null },           // upsert succeeds
        { data: [], error: null }, // stale-row read
      ],
      invoice_items: [{ count: 0, error: null }],
    };

    const { _dbSaveInvoice } = require('../lib/dbEngine');
    const inv = invWithPayment();
    delete inv.payments[0].cc_fee;
    await _dbSaveInvoice(inv);

    const upsert = __mockState.calls.find(c => c.table === 'invoice_payments' && c.method === 'upsert');
    expect(upsert.args[0][0].cc_fee).toBe(0);
    expect(upsert.args[0][0].date).toBe('08/11/2026');
  });

  test('a failed upsert issues NO delete, falls back to inserting the missing row, and succeeds', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      invoices: [{ error: null }],
      invoice_payments: [
        { data: [], error: null },                                   // restore read — DB holds none
        { error: { message: 'no unique constraint matching ON CONFLICT' } }, // upsert FAILS
        { error: null },                                             // plain insert succeeds
      ],
      invoice_items: [{ count: 0, error: null }],
    };

    const { _dbSaveInvoice, _dbSaveFailedIds } = require('../lib/dbEngine');
    const result = await _dbSaveInvoice(invWithPayment());

    expect(result).toBe(true);
    expect(_dbSaveFailedIds.has('INV-PAY-1')).toBe(false);
    const payDeletes = __mockState.calls.filter(c => c.table === 'invoice_payments' && c.method === 'delete');
    expect(payDeletes.length).toBe(0);
    const inserts = __mockState.calls.filter(c => c.table === 'invoice_payments' && c.method === 'insert');
    expect(inserts.length).toBe(1);
    expect(inserts[0].args[0][0].ref).toBe('chk 8891');
  });

  test('when the insert fallback also fails the save reports failure instead of dropping the payment', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      invoices: [{ error: null }],
      invoice_payments: [
        { data: [], error: null },
        { error: { message: 'column cc_fee does not exist' } }, // upsert FAILS
        { error: { message: 'column cc_fee does not exist' } }, // insert FAILS too
      ],
      invoice_items: [{ count: 0, error: null }],
    };

    const { _dbSaveInvoice, _dbSaveFailedIds } = require('../lib/dbEngine');
    const result = await _dbSaveInvoice(invWithPayment());

    expect(result).toBe(false);
    expect(_dbSaveFailedIds.has('INV-PAY-1')).toBe(true);
    const payDeletes = __mockState.calls.filter(c => c.table === 'invoice_payments' && c.method === 'delete');
    expect(payDeletes.length).toBe(0);
  });
});

// ── Fix 6: PO-restore no longer dead-ends on a missing item (SO-1951, 2026-08-13) ───────────
// A queued/stale save payload whose item list no longer contains an item that still holds PO
// line(s) in the DB used to hard-block ("Save blocked — purchase order data could not be safely
// preserved"), leaving the tab unable to ever save that order. The guard now rebuilds the missing
// item from its DB row — with its decorations — and appends it, so the PO is preserved AND the
// rep's other edits land. It must still fail closed when the item cannot be rebuilt.
describe('_dbSaveSOInner — item carrying PO lines is rebuilt, not blocked (fix 6)', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  // DB holds two items; the stale payload keeps the first and replaces the second with a brand
  // new garment (a new sku|color key, so the pure-deletion guard abstains and we reach the PO pass).
  // The old-items read is a 5-column PROJECTION (id,item_index,sku,color,product_id) — the shape the
  // save's delete/guard passes need. Reviving straight from it rebuilt the garment as a husk carrying
  // only sku+color, wiping name/sizes/costs off the real line (SO-1971), so the revive re-reads the
  // full row; fullItemRow() is what that read returns.
  const dbItems = () => [
    { id: 'oi-1', item_index: 0, sku: 'K540', color: 'Black', product_id: null },
    { id: 'oi-2', item_index: 1, sku: 'LST550', color: 'Black', product_id: null },
  ];
  const fullItemRow = () => ({
    id: 'oi-2', so_id: 'SO-REVIVE-1', item_index: 1, product_id: null,
    sku: 'LST550', name: 'Sport-Tek Long Sleeve Tee', brand: 'Sport-Tek', color: 'Black',
    nsa_cost: 7.35, retail_price: 0, unit_sell: 14.5,
    sizes: { L: 22, M: 20 }, available_sizes: ['S', 'M', 'L', 'XL'], vendor_id: 'v9',
  });
  const poRow = () => ({
    id: 'po-row-1', so_item_id: 'oi-2', po_id: 'PO 57028 BAH', vendor: 'SanMar',
    status: 'waiting', sizes: { L: 22, M: 20, unit_cost: 7.35 },
    received: {}, billed: {}, shipments: [], tracking_numbers: [],
  });
  const stalePayload = () => ({
    id: 'SO-REVIVE-1',
    memo: 'stale tab edit',
    _decosHydrated: true, // keep the deco guards out of the way; this test is about the PO pass
    items: [
      { sku: 'K540', color: 'Black' },
      { sku: 'NEWSKU', color: 'Green' },
    ],
  });

  test('rebuilds the vanished item, keeps its PO line, and lets the save succeed', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      sales_orders: [
        { data: { updated_at: 'yesterday', deco_pos: null }, error: null }, // existingSO select
        { error: null },                                                    // sales_orders upsert
      ],
      so_items: [
        { data: dbItems(), error: null },                                   // old-items read (projection)
        { data: fullItemRow(), error: null },                               // full-row re-read for the revive
        { data: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }], error: null },  // insert: 3 rows back
      ],
      so_art_files: [{ data: [], error: null }],
      so_item_po_lines: [
        { data: [poRow()], error: null },                    // PO-restore read
        { data: [{ po_id: 'PO 57028 BAH' }], error: null },  // duplicate-PO guard read
        { data: [{ po_id: 'PO 57028 BAH' }], error: null },  // over-commit guard read
        { error: null },                                     // PO-line insert
        { count: 1, error: null },                           // insert verification count
      ],
      so_item_pick_lines: [
        { data: [], error: null }, // pick-restore read
        { data: [], error: null }, // over-commit guard read
      ],
      so_item_decorations: [
        { data: [], error: null }, // decoration read for the rebuilt item
      ],
    };

    const { _dbSaveSO, _dbSaveFailedIds } = require('../lib/dbEngine');
    const so = stalePayload();
    const result = await _dbSaveSO(so);

    // The save goes through instead of dead-ending.
    expect(result).toBe(true);
    expect(_dbSaveFailedIds.has('SO-REVIVE-1')).toBe(false);

    // The vanished LST550 is back in the inserted item rows, appended after the payload's own two.
    const itemInserts = __mockState.calls.filter(c => c.table === 'so_items' && c.method === 'insert');
    expect(itemInserts.length).toBe(1);
    const rows = itemInserts[0].args[0];
    expect(rows.length).toBe(3);
    expect(rows[2].sku).toBe('LST550');
    expect(rows[2].color).toBe('Black');
    expect(rows[2].item_index).toBe(2);
    // ...as the WHOLE garment, not a sku+color husk: reviving from the projection alone used to
    // write these back as null, silently destroying the line it was supposed to be rescuing.
    expect(rows[2].name).toBe('Sport-Tek Long Sleeve Tee');
    expect(rows[2].sizes).toEqual({ L: 22, M: 20 });
    expect(rows[2].available_sizes).toEqual(['S', 'M', 'L', 'XL']);
    expect(rows[2].nsa_cost).toBe(7.35);
    expect(rows[2].unit_sell).toBe(14.5);

    // ...and its PO line rides along, attached to the rebuilt item's new id.
    const poInserts = __mockState.calls.filter(c => c.table === 'so_item_po_lines' && c.method === 'insert');
    expect(poInserts.length).toBe(1);
    const poRows = poInserts[0].args[0];
    expect(poRows.length).toBe(1);
    expect(poRows[0].po_id).toBe('PO 57028 BAH');
    expect(poRows[0].so_item_id).toBe('n3');
    expect(poRows[0].sizes.L).toBe(22);
    expect(poRows[0].sizes.unit_cost).toBe(7.35);
  });

  test('the rebuilt item is pushed back into live state so the next save does not drop it again', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      sales_orders: [
        { data: { updated_at: 'yesterday', deco_pos: null }, error: null },
        { error: null },
      ],
      so_items: [
        { data: dbItems(), error: null },
        { data: fullItemRow(), error: null },
        { data: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }], error: null },
      ],
      so_art_files: [{ data: [], error: null }],
      so_item_po_lines: [
        { data: [poRow()], error: null },
        { data: [{ po_id: 'PO 57028 BAH' }], error: null },
        { data: [{ po_id: 'PO 57028 BAH' }], error: null },
        { error: null },
        { count: 1, error: null },
      ],
      so_item_pick_lines: [{ data: [], error: null }, { data: [], error: null }],
      so_item_decorations: [{ data: [], error: null }],
    };

    const { _dbSaveSO, _setRestoredLinesSync } = require('../lib/dbEngine');
    const synced = [];
    _setRestoredLinesSync((soId, restores) => { synced.push({ soId, restores }); });

    await _dbSaveSO(stalePayload());
    _setRestoredLinesSync(null);

    expect(synced.length).toBe(1);
    const itemRestores = synced[0].restores.filter(r => r.kind === 'item');
    expect(itemRestores.length).toBe(1);
    expect(itemRestores[0].sku).toBe('LST550');
    expect(itemRestores[0].idx).toBe(2);
    // The synced object carries the PO line, so the editor's copy is whole.
    expect(itemRestores[0].item.po_lines.map(l => l.po_id)).toEqual(['PO 57028 BAH']);
    // And it carries the garment itself. This object is pushed straight into React state, so a husk
    // here reaches the editor: OrderEditor read item.sizes on such a line and crashed the whole order
    // ("Cannot read properties of undefined (reading 'S')", SO-1971).
    expect(itemRestores[0].item.name).toBe('Sport-Tek Long Sleeve Tee');
    expect(itemRestores[0].item.sizes).toEqual({ L: 22, M: 20 });
  });

  test('fails closed — a decoration read error still blocks rather than rebuilding a bare item', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      sales_orders: [
        { data: { updated_at: 'yesterday', deco_pos: null }, error: null },
        { error: null },
      ],
      so_items: [{ data: dbItems(), error: null }],
      so_art_files: [{ data: [], error: null }],
      so_item_po_lines: [{ data: [poRow()], error: null }],
      so_item_decorations: [{ data: null, error: { message: 'decoration read timed out' } }],
    };

    const { _dbSaveSO } = require('../lib/dbEngine');
    const result = await _dbSaveSO(stalePayload());

    expect(result).toBe(false);
    // Nothing was written: no item insert, so no chance of losing the PO's item.
    expect(__mockState.calls.some(c => c.table === 'so_items' && c.method === 'insert')).toBe(false);
  });
});

// ── SO-2021 (2026-08-17): stale-content guard must honor re-key tombstones ──────────────────
// Changing a SKU (or color) in place removes the line's old sku|color key from the client's
// item list. When the server _version had also moved (any other session's benign write), the
// stale-content guard read that as "another session's line would be dropped" and hard-blocked
// every save — the "Save blocked — SO-2021 was changed in another session (hr8470 black …
// would be dropped)" loop. The editor now stamps the OLD key into _deletedItemKeys (the same
// session tombstone rmI stamps on a deletion), and the guard excludes tombstoned keys.
describe('_dbSaveSOInner — version-conflict save with an in-place SKU change (SO-2021)', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  const dbItems = () => [
    { id: 'oi-1', item_index: 0, sku: 'HR8470', color: 'Black', product_id: null },
    { id: 'oi-2', item_index: 1, sku: 'K540', color: 'Black', product_id: null },
  ];
  // so._version=3 while the server sits at v7 → _checkVersion returns 7 → _versionConflict set,
  // arming the stale-content guard. The client list re-keyed HR8470 Black → NEWSKU Black.
  const responses = () => ({
    sales_orders: [
      { data: { _version: 7 }, error: null },                             // _checkVersion read
      { data: { updated_at: 'yesterday', deco_pos: null }, error: null }, // existingSO select
      { error: null },                                                    // sales_orders upsert
    ],
    so_items: [
      { data: dbItems(), error: null },                        // old-items read
      { data: [{ id: 'n1' }, { id: 'n2' }], error: null },     // insert: 2 rows back
    ],
    so_art_files: [{ data: [], error: null }, { data: [], error: null }],
    so_item_po_lines: [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }],
    so_item_pick_lines: [{ data: [], error: null }, { data: [], error: null }],
    so_item_decorations: [{ data: [], error: null }, { data: [], error: null }],
  });
  const payload = (id, tombs) => ({
    id, _version: 3, memo: 'sku changed in place',
    _decosHydrated: true, _itemsHydrated: true,
    ...(tombs ? { _deletedItemKeys: tombs } : {}),
    items: [
      { sku: 'NEWSKU', color: 'Black', sizes: { M: 2 } },
      { sku: 'K540', color: 'Black', sizes: { L: 1 } },
    ],
  });

  test('regression: WITHOUT a tombstone the guard still blocks (foreign-line protection intact)', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = responses();

    const { _dbSaveSO } = require('../lib/dbEngine');
    const result = await _dbSaveSO(payload('SO-REKEY-BLOCK'));

    expect(result).toBe(false);
    // Blocked before the item swap: nothing inserted, nothing deleted.
    expect(__mockState.calls.some(c => c.table === 'so_items' && c.method === 'insert')).toBe(false);
    expect(__mockState.calls.some(c => c.table === 'so_items' && c.method === 'delete')).toBe(false);
  });

  test('with the re-key tombstone the save goes through and writes the re-keyed line', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = responses();

    const { _dbSaveSO, _dbSaveFailedIds } = require('../lib/dbEngine');
    // soItemKey of the pre-change line — exactly what _stampRekeyTomb records in the editor.
    const result = await _dbSaveSO(payload('SO-REKEY-OK', ['hr8470|black']));

    expect(result).toBe(true);
    expect(_dbSaveFailedIds.has('SO-REKEY-OK')).toBe(false);
    const inserts = __mockState.calls.filter(c => c.table === 'so_items' && c.method === 'insert');
    expect(inserts.length).toBe(1);
    expect(inserts[0].args[0].map(r => r.sku)).toEqual(['NEWSKU', 'K540']);
  });

  test('a tombstone excuses ONLY its own key — a different uncovered DB line still blocks', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    const resp = responses();
    // DB also holds a third line this client never loaded (another session's work).
    resp.so_items[0].data.push({ id: 'oi-3', item_index: 2, sku: 'JW6599', color: 'Red', product_id: null });
    __mockState.responses = resp;

    const { _dbSaveSO } = require('../lib/dbEngine');
    const result = await _dbSaveSO(payload('SO-REKEY-MIXED', ['hr8470|black']));

    expect(result).toBe(false);
    expect(__mockState.calls.some(c => c.table === 'so_items' && c.method === 'insert')).toBe(false);
  });
});

// ── Art-status regression guard: a stale tab's whole-row so_jobs upsert must not un-approve art ──
// (SO-1131, 2026-08-19: a warehouse tab open since before the rep's approval wrote
// waiting_approval back over art_complete 17 minutes later, resurrecting the cleared
// "Mockup ready for review" to-do.) A client whose job copy is behind the DB row's _version
// may not move art_status BACKWARD; deliberate pull-backs pass via the one-shot
// _coach_cleared / _art_moved markers, and forward moves always pass.
describe('_dbSaveSOInner — stale so_jobs save cannot regress art_status (SO-1131)', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  const dbJobRow = (over = {}) => ({
    id: 'JOB-G-01', sent_to_coach_at: null, coach_approved_at: null,
    coach_approval_comment: null, coach_rejected: null,
    art_status: 'art_complete', _version: 5, ...over,
  });
  const soWith = (job) => ({
    id: 'SO-GUARD-1', memo: 'm',
    items: [{ sku: 'TEE', color: 'Red' }],
    jobs: [job],
  });
  const responses = (dbRow) => ({
    sales_orders: [
      { data: { updated_at: 'yesterday', deco_pos: null }, error: null },
      { error: null }, // upsert
    ],
    so_items: [
      { data: [], error: null },          // old items read (empty — nothing to wipe)
      { data: [{ id: 'ni-1' }], error: null }, // new insert returns matching id count
    ],
    so_art_files: [{ data: [], error: null }],
    so_item_po_lines: [
      { data: [], error: null }, { data: [], error: null }, { data: [], error: null },
    ],
    so_item_pick_lines: [{ data: [], error: null }, { data: [], error: null }],
    so_jobs: [
      { data: [dbRow], error: null },        // coach/art guard read
      { error: null },                        // upsert
      { data: [{ id: dbRow.id }], error: null }, // cleanup read (no deletes)
    ],
  });
  const jobUpsertRows = (calls) => {
    const up = calls.filter(c => c.table === 'so_jobs' && c.method === 'upsert');
    expect(up.length).toBe(1);
    return up[0].args[0];
  };

  test('stale client (version behind DB) writing an earlier art_status keeps the DB status', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = responses(dbJobRow());
    const { _dbSaveSO } = require('../lib/dbEngine');
    const job = { id: 'JOB-G-01', art_status: 'waiting_approval', _version: 3, items: [] };
    const result = await _dbSaveSO(soWith(job));
    expect(result).toBe(true);
    expect(jobUpsertRows(__mockState.calls)[0].art_status).toBe('art_complete');
    // The client copy rebases onto its own write (DB version + trigger bump).
    expect(job._version).toBe(6);
  });

  test('a deliberate pull-back (_coach_cleared) passes even from a stale copy', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = responses(dbJobRow());
    const { _dbSaveSO } = require('../lib/dbEngine');
    const job = { id: 'JOB-G-01', art_status: 'art_requested', _version: 3, _coach_cleared: true, items: [] };
    await _dbSaveSO(soWith(job));
    expect(jobUpsertRows(__mockState.calls)[0].art_status).toBe('art_requested');
    expect(job._coach_cleared).toBeUndefined(); // one-shot marker consumed
  });

  test('a deliberate workboard move (_art_moved) passes even from a stale copy', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = responses(dbJobRow());
    const { _dbSaveSO } = require('../lib/dbEngine');
    const job = { id: 'JOB-G-01', art_status: 'art_in_progress', _version: 3, _art_moved: true, items: [] };
    await _dbSaveSO(soWith(job));
    expect(jobUpsertRows(__mockState.calls)[0].art_status).toBe('art_in_progress');
    expect(job._art_moved).toBeUndefined(); // one-shot marker consumed
  });

  test('a current client (version matches DB) may move art_status backward unstamped', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = responses(dbJobRow());
    const { _dbSaveSO } = require('../lib/dbEngine');
    const job = { id: 'JOB-G-01', art_status: 'waiting_approval', _version: 5, items: [] };
    await _dbSaveSO(soWith(job));
    expect(jobUpsertRows(__mockState.calls)[0].art_status).toBe('waiting_approval');
  });

  test('a stale client moving art_status FORWARD (an approval) always passes', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = responses(dbJobRow({ art_status: 'waiting_approval' }));
    const { _dbSaveSO } = require('../lib/dbEngine');
    const job = { id: 'JOB-G-01', art_status: 'art_complete', _version: 3, items: [] };
    await _dbSaveSO(soWith(job));
    expect(jobUpsertRows(__mockState.calls)[0].art_status).toBe('art_complete');
  });
});

// ── Art-file conflict merge: prod_files_attached is a decision column — DB wins on conflict ──
describe('_mergeArtConflict — prod_files_attached defers to the DB copy (SO-1131)', () => {
  test('a stale client cannot un-confirm production files through the conflict merge', () => {
    withSupabaseEnv();
    jest.resetModules();
    const { _mergeArtConflict } = require('../lib/dbEngine');
    const dbRow = { id: 'af1', status: 'approved', prod_files_attached: true, name: 'Logo', _version: 9 };
    const clientArt = { id: 'af1', status: 'approved', prod_files_attached: false, name: 'Logo renamed', _version: 3 };
    const merged = _mergeArtConflict(clientArt, dbRow);
    expect(merged.prod_files_attached).toBe(true);   // decision: DB wins
    expect(merged.name).toBe('Logo renamed');        // typed content: client still wins
    restoreEnv();
    jest.resetModules();
  });
});

// ── Stale so_jobs saves must not lower receipt state or truncate append-only history ──
describe('_dbSaveSOInner — stale so_jobs save preserves receipts and history (SO-1131 follow-up)', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  const dbJobRow = (over = {}) => ({
    id: 'JOB-H-01', sent_to_coach_at: null, coach_approved_at: null,
    coach_approval_comment: null, coach_rejected: null,
    art_status: 'art_complete', _version: 5,
    fulfilled_units: 6, item_status: 'partially_received',
    art_messages: [{ id: 'm1', text: 'a' }, { id: 'm2', text: 'b' }],
    sent_history: [{ sent_at: '2026-08-01T00:00:00Z', to: 'coach@x.org' }],
    rejections: [{ at: '2026-07-01T00:00:00Z', reason: 'r1' }],
    ...over,
  });
  const soWith = (job) => ({
    id: 'SO-GUARD-2', memo: 'm',
    items: [{ sku: 'TEE', color: 'Red' }],
    jobs: [job],
  });
  const responses = (dbRow) => ({
    sales_orders: [
      { data: { updated_at: 'yesterday', deco_pos: null }, error: null },
      { error: null },
    ],
    so_items: [
      { data: [], error: null },
      { data: [{ id: 'ni-1' }], error: null },
    ],
    so_art_files: [{ data: [], error: null }],
    so_item_po_lines: [
      { data: [], error: null }, { data: [], error: null }, { data: [], error: null },
    ],
    so_item_pick_lines: [{ data: [], error: null }, { data: [], error: null }],
    so_jobs: [
      { data: [dbRow], error: null },
      { error: null },
      { data: [{ id: dbRow.id }], error: null },
    ],
  });
  const jobUpsertRow = (calls) => {
    const up = calls.filter(c => c.table === 'so_jobs' && c.method === 'upsert');
    expect(up.length).toBe(1);
    return up[0].args[0][0];
  };

  test('stale copy lowering fulfilled_units keeps the DB count AND its paired item_status', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = responses(dbJobRow());
    const { _dbSaveSO } = require('../lib/dbEngine');
    const job = { id: 'JOB-H-01', art_status: 'art_complete', _version: 3, fulfilled_units: 0, item_status: 'need_to_order', items: [] };
    await _dbSaveSO(soWith(job));
    const row = jobUpsertRow(__mockState.calls);
    expect(row.fulfilled_units).toBe(6);
    expect(row.item_status).toBe('partially_received');
  });

  test('a current copy (version matches DB) may lower fulfilled_units — deliberate un-receive', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = responses(dbJobRow());
    const { _dbSaveSO } = require('../lib/dbEngine');
    const job = { id: 'JOB-H-01', art_status: 'art_complete', _version: 5, fulfilled_units: 2, item_status: 'partially_received', items: [] };
    await _dbSaveSO(soWith(job));
    expect(jobUpsertRow(__mockState.calls).fulfilled_units).toBe(2);
  });

  test('stale copy with truncated history lists gets the union: DB entries kept, its new entries appended', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = responses(dbJobRow());
    const { _dbSaveSO } = require('../lib/dbEngine');
    const job = {
      id: 'JOB-H-01', art_status: 'art_complete', _version: 3, fulfilled_units: 6, item_status: 'partially_received', items: [],
      art_messages: [{ id: 'm1', text: 'a' }, { id: 'm3', text: 'new from this tab' }], // m2 never loaded here
      sent_history: [],                                                                // never loaded here
      rejections: [{ at: '2026-07-01T00:00:00Z', reason: 'r1' }],                      // unchanged
    };
    await _dbSaveSO(soWith(job));
    const row = jobUpsertRow(__mockState.calls);
    expect(row.art_messages.map(m => m.id)).toEqual(['m1', 'm2', 'm3']); // DB order first, new entry appended
    expect(row.sent_history.length).toBe(1);                             // DB record rescued
    expect(row.rejections.length).toBe(1);                               // unchanged list untouched
  });

  test('a current copy keeps full authority over its lists', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = responses(dbJobRow());
    const { _dbSaveSO } = require('../lib/dbEngine');
    const job = {
      id: 'JOB-H-01', art_status: 'art_complete', _version: 5, fulfilled_units: 6, item_status: 'partially_received', items: [],
      art_messages: [{ id: 'm1', text: 'a' }],
    };
    await _dbSaveSO(soWith(job));
    expect(jobUpsertRow(__mockState.calls).art_messages.map(m => m.id)).toEqual(['m1']);
  });
});

// ── Header-decision guard: a version-conflicted SO save keeps po_number and completed status ──
describe('_dbSaveSOInner — stale SO save preserves header decisions (po_number / complete)', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  // so._version=5, server at v8 → _checkVersion returns 8 → _versionConflict set.
  const responses = (dbHeader) => ({
    sales_orders: [
      { data: { _version: 8 }, error: null },   // _checkVersion read
      { data: { updated_at: 'yesterday', deco_pos: null, ...dbHeader }, error: null }, // existingSO read
      { error: null },                           // upsert
    ],
    so_items: [
      { data: [{ id: 'oi-1', item_index: 0, sku: 'TEE', color: 'Red', product_id: null }], error: null },
      { data: [{ id: 'ni-1' }], error: null },
    ],
    so_art_files: [{ data: [], error: null }],
    so_item_po_lines: [
      { data: [], error: null }, { data: [], error: null }, { data: [], error: null },
    ],
    so_item_pick_lines: [{ data: [], error: null }, { data: [], error: null }],
  });
  const soUpsertRow = (calls) => {
    const up = calls.filter(c => c.table === 'sales_orders' && c.method === 'upsert');
    expect(up.length).toBeGreaterThan(0);
    return up[0].args[0];
  };
  const basePayload = (over = {}) => ({
    id: 'SO-GUARD-3', memo: 'm', _version: 5,
    items: [{ sku: 'TEE', color: 'Red' }],
    ...over,
  });

  test('a stale save may not null a po_number or reopen a completed order', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = responses({ status: 'complete', po_number: 'PO-777' });
    const { _dbSaveSO } = require('../lib/dbEngine');
    await _dbSaveSO(basePayload({ status: 'ready_to_invoice', po_number: null }));
    const row = soUpsertRow(__mockState.calls);
    expect(row.po_number).toBe('PO-777');
    expect(row.status).toBe('complete');
  });

  test('the deliberate reopen (_status_reverted) passes and the one-shot marker is consumed', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = responses({ status: 'complete', po_number: 'PO-777' });
    const { _dbSaveSO } = require('../lib/dbEngine');
    const so = basePayload({ status: 'ready_to_invoice', po_number: 'PO-777', _status_reverted: true });
    await _dbSaveSO(so);
    expect(soUpsertRow(__mockState.calls).status).toBe('ready_to_invoice');
    expect(so._status_reverted).toBeUndefined();
  });

  test('without a version conflict the client header is written as-is', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    const resp = responses({ status: 'complete', po_number: 'PO-777' });
    resp.sales_orders[0] = { data: { _version: 5 }, error: null }; // server matches local → no conflict
    __mockState.responses = resp;
    const { _dbSaveSO } = require('../lib/dbEngine');
    await _dbSaveSO(basePayload({ status: 'ready_to_invoice', po_number: null }));
    const row = soUpsertRow(__mockState.calls);
    expect(row.status).toBe('ready_to_invoice');
    expect(row.po_number == null).toBe(true);
  });
});
