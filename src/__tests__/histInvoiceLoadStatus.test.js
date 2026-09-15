/* _dbLoadHistInvoices must say WHY it came back empty (src/lib/dbEngine.js).
 *
 * customer_invoices (the pre-portal NetSuite history) is the only staff-gated read in the whole
 * load — RLS `to authenticated` + is_team_member(), while every other table is anon-readable. So a
 * tab whose session isn't live loads the entire portal perfectly EXCEPT this one table.
 *
 * _safeQuery deliberately converts a permission-denied read into an empty 200 (the anonymous coach
 * portal boots through the same path and must not hard-fail). That made "you may not read this"
 * indistinguishable from "there is no history" at the call site, and the customer page rendered
 * both as the same bare "No records" — on accounts with years of paid invoices. Reps read that as
 * "this customer has never ordered from us".
 *
 * The status field is what makes those cases separable, so these tests pin all three.
 */

jest.mock('@supabase/supabase-js', () => {
  const state = { mode: 'ok', rows: [] };
  const makeBuilder = (table) => {
    const builder = {
      select: () => builder, not: () => builder, or: () => builder,
      order: () => builder, eq: () => builder, in: () => builder,
      range: () => {
        if (table !== 'customer_invoices') return Promise.resolve({ data: [], error: null, status: 200 });
        if (state.mode === 'denied') return Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied for table customer_invoices' }, status: 403 });
        if (state.mode === 'error') return Promise.resolve({ data: null, error: { message: 'network blew up' }, status: 500 });
        return Promise.resolve({ data: state.rows, error: null, status: 200 });
      },
    };
    return builder;
  };
  const client = {
    from: (t) => makeBuilder(t),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { createClient: () => client, __histState: state };
});

const ORIG_ENV = { ...process.env };

const loadHist = async ({ mode, rows = [] }) => {
  process.env.REACT_APP_SUPABASE_URL = 'https://hist-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
  jest.resetModules();
  const { __histState } = require('@supabase/supabase-js');
  Object.assign(__histState, { mode, rows });
  const { _dbLoadHistInvoices } = require('../lib/dbEngine');
  return _dbLoadHistInvoices();
};

afterEach(() => { process.env = { ...ORIG_ENV }; });

describe('_dbLoadHistInvoices load status', () => {
  test('a readable history returns ok with the mapped rows', async () => {
    const { rows, status } = await loadHist({
      mode: 'ok',
      rows: [{ id: 'h1', document_number: 'INV57468', customer_id: 'c-ns-4226', invoice_date: '2025-02-20', total: '2710.27', status: 'paid' }],
    });
    expect(status).toBe('ok');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('INV57468');
    expect(rows[0]._hist).toBe(true);
    expect(rows[0].total).toBe(2710.27);
  });

  test('an RLS/grant denial reports denied and NO rows — never a silent empty history', async () => {
    const { rows, status } = await loadHist({ mode: 'denied' });
    expect(status).toBe('denied');
    // null, not [] — an empty array here is what the customer page used to render as "No records".
    expect(rows).toBeNull();
  });

  test('a failed read reports error and no rows, so nothing overwrites a good history', async () => {
    const { rows, status } = await loadHist({ mode: 'error' });
    expect(status).toBe('error');
    expect(rows).toBeNull();
  });

  test('a genuinely empty history is still ok — the banner must not cry wolf', async () => {
    const { rows, status } = await loadHist({ mode: 'ok', rows: [] });
    expect(status).toBe('ok');
    expect(rows).toEqual([]);
  });

  test('a denied read does not poison the NEXT call once the session is back', async () => {
    const denied = await loadHist({ mode: 'denied' });
    expect(denied.status).toBe('denied');
    // Same module instance, session restored: the stale "unconfirmed" mark from the denied read
    // must not make a perfectly good read look denied.
    const { __histState } = require('@supabase/supabase-js');
    Object.assign(__histState, { mode: 'ok', rows: [{ id: 'h2', document_number: 'INV61759', customer_id: 'c-ns-4226', invoice_date: '2026-01-28', total: '918.35', status: 'paid' }] });
    const { _dbLoadHistInvoices } = require('../lib/dbEngine');
    const recovered = await _dbLoadHistInvoices();
    expect(recovered.status).toBe('ok');
    expect(recovered.rows).toHaveLength(1);
  });
});
