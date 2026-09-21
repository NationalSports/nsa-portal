/* The boot app_state query (src/lib/dbEngine.js).
 *
 * The first load used to pull 760 app_state rows / ~14 MB, of which 731 rows / ~13 MB were
 * `qbo_*` batch and audit scratch written by one-off accounting tooling and read by nothing
 * in the app. That payload blocked first paint for EVERY user — a warehouse tablet scanning
 * barcodes, and a coach opening a single team's order, both waited on the whole thing.
 *
 * These tests pin the exclusion and, just as importantly, pin what must still load: `qb_config`
 * differs from the scratch rows by one character (`qb_` vs `qbo_`), so a filter written slightly
 * too wide would silently break the QuickBooks page instead of speeding anything up.
 */

jest.mock('@supabase/supabase-js', () => {
  const state = { notCalls: [] };
  const makeBuilder = (table) => {
    const builder = {
      select: () => builder,
      not: (col, op, val) => { if (table === 'app_state') state.notCalls.push([col, op, val]); return builder; },
      or: () => builder, order: () => builder, eq: () => builder, in: () => builder,
      range: () => Promise.resolve({ data: [], error: null, status: 200 }),
    };
    return builder;
  };
  return {
    createClient: () => ({
      from: (t) => makeBuilder(t),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    }),
    __appStateFilters: state,
  };
});

const ORIG_ENV = { ...process.env };
afterEach(() => { process.env = { ...ORIG_ENV }; });

// Runs one real _dbLoad and returns every .not() filter applied to the app_state query.
const filtersFor = async (opts) => {
  process.env.REACT_APP_SUPABASE_URL = 'https://appstate-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
  jest.resetModules();
  const { __appStateFilters } = require('@supabase/supabase-js');
  __appStateFilters.notCalls = [];
  const { _dbLoad } = require('../lib/dbEngine');
  await _dbLoad(opts);
  return __appStateFilters.notCalls;
};

// A PostgREST `like` pattern, applied the way PostgREST applies it (`*` → `%`, `_` = any char).
const matches = (pattern, id) =>
  new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/_/g, '.') + '$').test(id);

const excludes = (filters, id) => filters.some(([col, op, val]) =>
  col === 'id' && (op === 'like' ? matches(val, id) : val.includes('"' + id + '"') || val.includes(id)));

describe('boot app_state query', () => {
  const SCRATCH = [
    'qbo_remaining_vendor_payment_preflight',
    'qbo_remaining_vendor_payment_batch_003',
    'qbo_historical_billpayment_print_status_manifest_20260914',
    'qbo_2026_partial_component_audit',
    'qbo_ready_vendor_payment_batch_004',
  ];

  test('the initial load excludes the qbo_* accounting scratch', async () => {
    const filters = await filtersFor({ essential: true, fullState: true });
    SCRATCH.forEach(id => expect({ id, excluded: excludes(filters, id) }).toEqual({ id, excluded: true }));
  });

  test('qb_config still loads — the QuickBooks page depends on it', async () => {
    const filters = await filtersFor({ essential: true, fullState: true });
    expect(excludes(filters, 'qb_config')).toBe(false);
  });

  test('the keys the app actually reads at boot still load', async () => {
    const filters = await filtersFor({ essential: true, fullState: true });
    ['company_info', 'labor_rates', 'comm_overrides', 'inv_pos', 'batch_pos', 'submitted_batches',
     'wh_recent_actions', 'job_time_logs', 'inv_po_counter']
      .forEach(id => expect({ id, excluded: excludes(filters, id) }).toEqual({ id, excluded: false }));
  });

  test('the non-essential full load excludes the scratch too', async () => {
    const filters = await filtersFor({ fullState: true });
    SCRATCH.forEach(id => expect({ id, excluded: excludes(filters, id) }).toEqual({ id, excluded: true }));
    expect(excludes(filters, 'qb_config')).toBe(false);
  });

  test('the existing _qb_link_v1_ and _pimg_ exclusions are unchanged', async () => {
    const filters = await filtersFor({ essential: true, fullState: true });
    expect(excludes(filters, '_qb_link_v1_abc123')).toBe(true);
    expect(excludes(filters, '_pimg_p1234')).toBe(true);
  });
});
