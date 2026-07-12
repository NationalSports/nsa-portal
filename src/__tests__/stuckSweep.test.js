/* Tests for netlify/functions/teamshop-stuck-sweep.js (Team Shop backend
 * hardening #2). Two layers:
 *   1. Pure date helpers (businessDaysAgoDateOnly / daysAgoDateOnly /
 *      parseSoJobDate) — no mocking needed, these are the load-bearing math
 *      for the "5 business days" / "24h" thresholds against so_jobs'
 *      M/D/YYYY-text created_at.
 *   2. runSweep/runChecks against a chainable fake Supabase admin (same
 *      pattern as followupSweep.test.js) — verifies the email-or-not
 *      decision, that one failing check doesn't block the others, and that
 *      the manual 'run' action requires staff auth.
 */
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => global.__fakeAdmin,
  verifyUser: (...args) => global.__verifyUserMock(...args),
}));

// ALERT_EMAIL is read from env at module load (same convention as
// so-health-alert.js's ALERT_EMAIL) — set it before requiring.
process.env.STUCK_SWEEP_ALERT_EMAIL = 'alerts@nsa.test';
const sweep = require('../../netlify/functions/teamshop-stuck-sweep');
const {
  businessDaysAgoDateOnly, daysAgoDateOnly, parseSoJobDate, runSweep, runChecks,
} = sweep;

// ── Pure date helpers ──────────────────────────────────────────────────────
describe('date helpers', () => {
  test('parseSoJobDate parses M/D/YYYY (no leading zeros) and rejects garbage', () => {
    expect(parseSoJobDate('7/1/2026').toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(parseSoJobDate('12/31/2025').toISOString().slice(0, 10)).toBe('2025-12-31');
    expect(parseSoJobDate('')).toBeNull();
    expect(parseSoJobDate(null)).toBeNull();
    expect(parseSoJobDate('2026-07-01')).toBeNull(); // ISO is NOT this column's format
  });

  test('daysAgoDateOnly(1) is exactly one calendar day before today at UTC midnight', () => {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const y = daysAgoDateOnly(1);
    expect(today.getTime() - y.getTime()).toBe(86400000);
  });

  test('businessDaysAgoDateOnly skips weekends', () => {
    // Anchor on a known Monday (2026-07-13 is a Monday) by monkeypatching Date... instead,
    // just assert the general invariant: N business days back is always >= N calendar days
    // back, and at most N + 2*ceil(N/5) calendar days back (bounded weekend inflation).
    const n = 5;
    const bd = businessDaysAgoDateOnly(n);
    const cd = daysAgoDateOnly(n);
    expect(bd.getTime()).toBeLessThanOrEqual(cd.getTime());
    const spanDays = Math.round((daysAgoDateOnly(0).getTime() - bd.getTime()) / 86400000);
    expect(spanDays).toBeGreaterThanOrEqual(n);
    expect(spanDays).toBeLessThanOrEqual(n + 4); // at most ~2 weekends of inflation for n=5
  });
});

// ── runSweep / runChecks against a fake admin ──────────────────────────────
function makeAdmin(route) {
  const ops = [];
  const admin = {
    ops,
    from(table) {
      const op = { table, filters: [] };
      const chain = {
        select() { return chain; },
        eq(col, val) { op.filters.push(['eq:' + col, val]); return chain; },
        in(col, val) { op.filters.push(['in:' + col, val]); return chain; },
        not(col, kind, val) { op.filters.push(['not:' + col, kind, val]); return chain; },
        is(col, val) { op.filters.push(['is:' + col, val]); return chain; },
        lte(col, val) { op.filters.push(['lte:' + col, val]); return chain; },
        order() { return chain; },
        limit() { return chain; },
        then(resolve, reject) {
          ops.push(op);
          return Promise.resolve(route(op) || { data: [], error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return admin;
}

const emptyRoute = () => ({ data: [], error: null });

beforeEach(() => {
  process.env.BREVO_API_KEY = 'test-brevo';
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
});

afterEach(() => { jest.clearAllMocks(); });

test('clean sweep (nothing stuck) sends no email', async () => {
  const admin = makeAdmin(emptyRoute);
  const summary = await runSweep(admin);
  expect(summary.total_stuck).toBe(0);
  expect(summary.emailed).toBe(false);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('a paid, unconverted teamshop order triggers exactly one alert email', async () => {
  const order = { id: 'ord-1', order_number: 1001, order_source: 'teamshop', buyer_name: 'Coach K', total: 250, created_at: '2020-01-01T00:00:00Z' };
  const admin = makeAdmin((op) => {
    if (op.table === 'webstore_orders') {
      const status = op.filters.find((f) => f[0] === 'eq:status');
      if (status && status[1] === 'paid') return { data: [order], error: null };
    }
    return { data: [], error: null };
  });
  const summary = await runSweep(admin);
  expect(summary.total_stuck).toBe(1);
  expect(summary.counts.paid_no_so).toBe(1);
  expect(summary.emailed).toBe(true);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, opts] = global.fetch.mock.calls[0];
  expect(url).toBe('https://api.brevo.com/v3/smtp/email');
  const payload = JSON.parse(opts.body);
  expect(payload.to).toEqual([{ email: 'alerts@nsa.test' }]);
  expect(payload.htmlContent).toContain('1001');
});

test('one failing check does not block the others, and is reported in errors', async () => {
  const stalePending = { id: 'ord-2', order_number: 2002, order_source: 'club', buyer_email: 'p@x.com', total: 80, created_at: '2020-01-01T00:00:00Z' };
  const admin = makeAdmin((op) => {
    if (op.table === 'webstore_orders') {
      const status = op.filters.find((f) => f[0] === 'eq:status');
      if (status && status[1] === 'paid') throw new Error('boom: paid_no_so query failed');
      if (status && status[1] === 'pending_payment') return { data: [stalePending], error: null };
    }
    return { data: [], error: null };
  });
  const summary = await runSweep(admin);
  expect(summary.counts.stale_pending_payment).toBe(1);
  expect(summary.errors.some((e) => e.check === 'paid_no_so')).toBe(true);
  expect(summary.emailed).toBe(true); // the surviving check still has a real result to alert on
});

test('no_po_need_order requires a converted SO with NO purchase_order_lines row', async () => {
  const oldDate = '1/1/2020'; // so_jobs.created_at is M/D/YYYY text — well past any 24h cutoff
  const admin = makeAdmin((op) => {
    if (op.table === 'webstore_orders') return { data: [{ so_id: 'SO-9', order_source: 'teamshop' }], error: null };
    if (op.table === 'sales_orders') return { data: [{ id: 'SO-9', source: 'webstore' }], error: null };
    if (op.table === 'purchase_order_lines') return { data: [], error: null }; // no PO at all
    if (op.table === 'so_jobs') {
      const itemStatus = op.filters.find((f) => f[0] === 'eq:item_status');
      if (itemStatus) return { data: [{ so_id: 'SO-9', id: 'JOB-9-01', item_status: 'need_to_order', created_at: oldDate }], error: null };
    }
    return { data: [], error: null };
  });
  const summary = await runSweep(admin);
  expect(summary.counts.no_po_need_order).toBe(1);
});

test('a converted SO that already has a purchase_order_lines row is NOT flagged', async () => {
  const oldDate = '1/1/2020';
  const admin = makeAdmin((op) => {
    if (op.table === 'webstore_orders') return { data: [{ so_id: 'SO-9', order_source: 'teamshop' }], error: null };
    if (op.table === 'sales_orders') return { data: [{ id: 'SO-9', source: 'webstore' }], error: null };
    if (op.table === 'purchase_order_lines') return { data: [{ so_id: 'SO-9' }], error: null }; // has a PO line
    if (op.table === 'so_jobs') {
      const itemStatus = op.filters.find((f) => f[0] === 'eq:item_status');
      if (itemStatus) return { data: [{ so_id: 'SO-9', id: 'JOB-9-01', item_status: 'need_to_order', created_at: oldDate }], error: null };
    }
    return { data: [], error: null };
  });
  const summary = await runSweep(admin);
  expect(summary.counts.no_po_need_order).toBe(0);
});

test('(f) auto-submit-blocked: a vendor with auto_submit on but no contact_email surfaces its draft auto POs', async () => {
  const admin = makeAdmin((op) => {
    if (op.table === 'teamshop_auto_po_settings') {
      return { data: [{ vendor: 'SanMar', auto_submit_enabled: true, contact_email: null }], error: null };
    }
    if (op.table === 'purchase_orders') {
      return { data: [{ id: 'po-1', po_number: 'NSA 501', vendor: 'SanMar', totals_cents: 2616, created_at: '2026-07-01T00:00:00Z' }], error: null };
    }
    return { data: [], error: null };
  });
  const summary = await runSweep(admin);
  expect(summary.counts.auto_submit_blocked).toBe(1);
  expect(summary.total_stuck).toBe(1);
  expect(summary.emailed).toBe(true);
  const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(payload.htmlContent).toContain('NSA 501');
});

test('a vendor WITH a contact_email is not flagged (its drafts will auto-submit)', async () => {
  const admin = makeAdmin((op) => {
    if (op.table === 'teamshop_auto_po_settings') {
      return { data: [{ vendor: 'SanMar', auto_submit_enabled: true, contact_email: 'sanmar@x.com' }], error: null };
    }
    if (op.table === 'purchase_orders') {
      return { data: [{ id: 'po-1', vendor: 'SanMar' }], error: null };
    }
    return { data: [], error: null };
  });
  const summary = await runSweep(admin);
  expect(summary.counts.auto_submit_blocked).toBe(0);
});

test('the "shipped, no email log" check (e) is always reported as skipped, never silently omitted', async () => {
  const admin = makeAdmin(emptyRoute);
  const { skipped } = await runChecks(admin);
  expect(skipped.some((s) => s.check === 'shipped_no_email_log')).toBe(true);
});

// ── Handler-level: manual trigger auth ──────────────────────────────────────
describe('handler — manual run action', () => {
  beforeEach(() => { global.__fakeAdmin = makeAdmin(emptyRoute); });

  test('manual run without a valid staff session is rejected, not run', async () => {
    global.__verifyUserMock = jest.fn(async () => ({ ok: false, status: 401, error: 'Missing bearer token' }));
    const res = await sweep.handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'run' }), headers: {} });
    expect(res.statusCode).toBe(401);
    expect(global.__fakeAdmin.ops.length).toBe(0);
  });

  test('manual run with a valid staff session executes the sweep', async () => {
    global.__verifyUserMock = jest.fn(async () => ({ ok: true, teamMemberId: 'tm-1' }));
    const res = await sweep.handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'run' }), headers: { authorization: 'Bearer tok' } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
  });

  test('the scheduled (no-event-method) invocation runs with no auth check', async () => {
    global.__verifyUserMock = jest.fn();
    const res = await sweep.handler(undefined);
    expect(res.statusCode).toBe(200);
    expect(global.__verifyUserMock).not.toHaveBeenCalled();
  });
});
