/* Tests for the store-approval endpoint (Phase 1 of the store-approval gate — see
 * PUBLIC_STORE_BUILDER_PLAN_2026-07-16.md + supabase/migrations/00196_store_approval_gate.sql).
 *
 * Two layers, matching the file's own split between pure helpers and I/O:
 *   1. _internals — action validation, the one-way state machine (pending_review is the
 *      only state that can move; re-deciding an already-decided store is blocked, deciding
 *      the same way twice is idempotent), and response shaping. No DB, no auth.
 *   2. handler — method/auth gating and the list/approve/reject dispatch, driven through a
 *      chainable fake supabase admin (same shape as followupSweep.test.js /
 *      coachInviteScope.test.js use) with verifyUser/getSupabaseAdmin mocked from _shared.
 */

// Chainable fake admin: from(table) returns a builder whose terminal call (.maybeSingle()
// or awaiting the chain directly) resolves via `route(op)`, where op records which table,
// whether this was a read or an .update(patch), and any .eq/.in/.is/.order filters — so
// tests can both canned-return data and assert what was actually sent to supabase.
function makeAdmin(route) {
  const calls = [];
  return {
    calls,
    from(table) {
      const op = { table, kind: 'select', patch: null, filters: [] };
      const chain = {
        select() { return chain; },
        update(patch) { op.kind = 'update'; op.patch = patch; return chain; },
        eq(col, val) { op.filters.push(['eq', col, val]); return chain; },
        in(col, val) { op.filters.push(['in', col, val]); return chain; },
        is(col, val) { op.filters.push(['is', col, val]); return chain; },
        order(col, opts) { op.filters.push(['order', col, opts]); return chain; },
        maybeSingle() { calls.push(op); return Promise.resolve(route(op)); },
        then(resolve, reject) { calls.push(op); return Promise.resolve(route(op)).then(resolve, reject); },
      };
      return chain;
    },
  };
}

jest.mock('../../netlify/functions/_shared', () => {
  const actual = jest.requireActual('../../netlify/functions/_shared');
  return { ...actual, verifyUser: jest.fn(), getSupabaseAdmin: jest.fn() };
});

const mockedShared = require('../../netlify/functions/_shared');
const { handler, _internals } = require('../../netlify/functions/store-approval');
const {
  VALID_ACTIONS, HELD_ORDER_STATUSES,
  validateRequest, planTransition, aggregateHeldOrders, shapeListRow, shapeDecisionStore,
} = _internals;

const call = (body, method = 'POST') => handler({ httpMethod: method, headers: {}, body: body === undefined ? undefined : JSON.stringify(body) });

// ─────────────────────────────────────────────────────────────────────────────────────
// 1. Action validation (pure)
// ─────────────────────────────────────────────────────────────────────────────────────
describe('validateRequest — action validation', () => {
  test('accepts the three known actions', () => {
    expect(VALID_ACTIONS.has('list')).toBe(true);
    expect(VALID_ACTIONS.has('approve')).toBe(true);
    expect(VALID_ACTIONS.has('reject')).toBe(true);
  });

  test('unknown action -> 400 naming the action', () => {
    const r = validateRequest('bogus', 's1', 'because');
    expect(r).toEqual({ status: 400, error: 'Unknown action "bogus"' });
  });

  test('list needs neither store_id nor reason', () => {
    expect(validateRequest('list', '', '')).toBeNull();
  });

  test('approve requires store_id', () => {
    expect(validateRequest('approve', '', '')).toEqual({ status: 400, error: 'store_id is required' });
    expect(validateRequest('approve', 's1', '')).toBeNull();
  });

  test('reject requires store_id AND a non-empty reason', () => {
    expect(validateRequest('reject', '', 'bad logo')).toEqual({ status: 400, error: 'store_id is required' });
    expect(validateRequest('reject', 's1', '')).toEqual({ status: 400, error: 'reason is required' });
    expect(validateRequest('reject', 's1', '   ')).toEqual({ status: 400, error: 'reason is required' }); // whitespace-only
    expect(validateRequest('reject', 's1', 'bad logo')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// 2. State machine (pure) — one-way out of pending_review
// ─────────────────────────────────────────────────────────────────────────────────────
describe('planTransition — one-way state machine', () => {
  const NOW = '2026-07-16T12:00:00.000Z';

  test('pending_review -> approved is allowed', () => {
    const r = planTransition({ action: 'approve', currentStatus: 'pending_review', reviewer: 'tm1', nowIso: NOW });
    expect(r).toEqual({ ok: true, patch: { approval_status: 'approved', approved_by: 'tm1', approved_at: NOW } });
  });

  test('pending_review -> rejected is allowed and closes the store', () => {
    const r = planTransition({ action: 'reject', currentStatus: 'pending_review', reviewer: 'tm1', nowIso: NOW, reason: 'bad logo' });
    expect(r).toEqual({
      ok: true,
      patch: { approval_status: 'rejected', rejected_reason: 'bad logo', approved_by: 'tm1', approved_at: NOW, status: 'closed' },
    });
  });

  test('approving an already-approved store is an idempotent no-op', () => {
    const r = planTransition({ action: 'approve', currentStatus: 'approved', reviewer: 'tm1', nowIso: NOW });
    expect(r).toEqual({ ok: true, already: true });
  });

  test('rejecting an already-rejected store is an idempotent no-op', () => {
    const r = planTransition({ action: 'reject', currentStatus: 'rejected', reviewer: 'tm1', nowIso: NOW, reason: 'bad logo' });
    expect(r).toEqual({ ok: true, already: true });
  });

  test('approved -> rejected is BLOCKED (cross-transition), names the current status', () => {
    const r = planTransition({ action: 'reject', currentStatus: 'approved', reviewer: 'tm1', nowIso: NOW, reason: 'bad logo' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/"approved"/);
    expect(r.error).toMatch(/pending_review/);
  });

  test('rejected -> approved is BLOCKED (cross-transition), names the current status', () => {
    const r = planTransition({ action: 'approve', currentStatus: 'rejected', reviewer: 'tm1', nowIso: NOW });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/"rejected"/);
    expect(r.error).toMatch(/pending_review/);
  });

  test('unknown action falls through to a 400', () => {
    const r = planTransition({ action: 'delete', currentStatus: 'pending_review', reviewer: 'tm1', nowIso: NOW });
    expect(r).toEqual({ ok: false, status: 400, error: 'Unknown action "delete"' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// 3. Response shaping (pure)
// ─────────────────────────────────────────────────────────────────────────────────────
describe('aggregateHeldOrders / shapeListRow / shapeDecisionStore — response shaping', () => {
  test('aggregateHeldOrders groups by store_id and rounds the sum to cents', () => {
    const rows = [
      { store_id: 's1', total: 19.996 },
      { store_id: 's1', total: 10 },
      { store_id: 's2', total: 5.001 },
    ];
    expect(aggregateHeldOrders(rows)).toEqual({
      s1: { count: 2, sum: 30 },
      s2: { count: 1, sum: 5 },
    });
  });

  test('aggregateHeldOrders on no rows -> empty map', () => {
    expect(aggregateHeldOrders([])).toEqual({});
    expect(aggregateHeldOrders(null)).toEqual({});
  });

  test('shapeListRow folds in held stats, defaulting to zero for a store with none', () => {
    const store = { id: 's1', slug: 'a', name: 'A', customer_id: 'c1', created_at: 't0', approval_deadline: 'd1', created_via: 'public' };
    expect(shapeListRow(store, { s1: { count: 3, sum: 45 } })).toEqual({
      id: 's1', slug: 'a', name: 'A', customer_id: 'c1', created_at: 't0', approval_deadline: 'd1', created_via: 'public',
      held_orders: { count: 3, sum: 45 },
    });
    expect(shapeListRow(store, {})).toEqual(expect.objectContaining({ held_orders: { count: 0, sum: 0 } }));
  });

  test('shapeDecisionStore picks the stable response fields', () => {
    const row = { id: 's1', slug: 'a', name: 'A', status: 'closed', approval_status: 'rejected', approved_by: 'tm1', approved_at: 't1', rejected_reason: 'bad logo', extra_col: 'ignored' };
    expect(shapeDecisionStore(row)).toEqual({
      id: 's1', slug: 'a', name: 'A', status: 'closed', approval_status: 'rejected', approved_by: 'tm1', approved_at: 't1', rejected_reason: 'bad logo',
    });
  });

  test('HELD_ORDER_STATUSES is exactly paid + po_verified', () => {
    expect(HELD_ORDER_STATUSES).toEqual(['paid', 'po_verified']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// 4. Handler — method/auth gating + list/approve/reject dispatch
// ─────────────────────────────────────────────────────────────────────────────────────
describe('handler', () => {
  beforeEach(() => {
    mockedShared.verifyUser.mockReset().mockResolvedValue({ ok: true, teamMemberId: 'tm-42', userId: 'u1', role: 'admin' });
    mockedShared.getSupabaseAdmin.mockReset();
  });

  test('OPTIONS -> 204, no auth check', async () => {
    const res = await call(undefined, 'OPTIONS');
    expect(res.statusCode).toBe(204);
    expect(mockedShared.verifyUser).not.toHaveBeenCalled();
  });

  test('non-POST -> 405', async () => {
    const res = await call(undefined, 'GET');
    expect(res.statusCode).toBe(405);
  });

  test('unauthenticated caller -> auth error passed through', async () => {
    mockedShared.verifyUser.mockResolvedValue({ ok: false, status: 403, error: 'Inactive or unknown account' });
    const res = await call({ action: 'list' });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: 'Inactive or unknown account' });
  });

  test('unknown action -> 400 before touching the DB', async () => {
    const res = await call({ action: 'delete' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Unknown action/);
    expect(mockedShared.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  test('reject with no reason -> 400 before touching the DB', async () => {
    const res = await call({ action: 'reject', store_id: 's1' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('reason is required');
    expect(mockedShared.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  test('action:list returns pending stores with held-order stats, ordered query issued correctly', async () => {
    const admin = makeAdmin((op) => {
      if (op.table === 'webstores') {
        return {
          data: [
            { id: 's1', slug: 'one', name: 'One', customer_id: 'c1', created_at: 't1', approval_deadline: '2026-07-17T00:00:00Z', created_via: 'public' },
            { id: 's2', slug: 'two', name: 'Two', customer_id: 'c2', created_at: 't2', approval_deadline: null, created_via: 'public' },
          ], error: null,
        };
      }
      if (op.table === 'webstore_orders') {
        return { data: [{ store_id: 's1', total: 20 }, { store_id: 's1', total: 15 }, { store_id: 's2', total: 5 }], error: null };
      }
      return { data: null, error: null };
    });
    mockedShared.getSupabaseAdmin.mockReturnValue(admin);

    const res = await call({ action: 'list' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.stores).toEqual([
      { id: 's1', slug: 'one', name: 'One', customer_id: 'c1', created_at: 't1', approval_deadline: '2026-07-17T00:00:00Z', created_via: 'public', held_orders: { count: 2, sum: 35 } },
      { id: 's2', slug: 'two', name: 'Two', customer_id: 'c2', created_at: 't2', approval_deadline: null, created_via: 'public', held_orders: { count: 1, sum: 5 } },
    ]);

    // The webstores query asked for pending_review, ordered by approval_deadline asc nulls last.
    const storesOp = admin.calls.find((c) => c.table === 'webstores');
    expect(storesOp.filters).toContainEqual(['eq', 'approval_status', 'pending_review']);
    expect(storesOp.filters).toContainEqual(['order', 'approval_deadline', { ascending: true, nullsFirst: false }]);

    // The held-orders query scoped to the listed store ids, unconverted + paid/po_verified only.
    const ordersOp = admin.calls.find((c) => c.table === 'webstore_orders');
    expect(ordersOp.filters).toContainEqual(['in', 'store_id', ['s1', 's2']]);
    expect(ordersOp.filters).toContainEqual(['is', 'so_id', null]);
    expect(ordersOp.filters).toContainEqual(['in', 'status', HELD_ORDER_STATUSES]);
  });

  test('action:list with no pending stores skips the held-orders query entirely', async () => {
    const admin = makeAdmin((op) => {
      if (op.table === 'webstores') return { data: [], error: null };
      throw new Error(`unexpected query on ${op.table}`);
    });
    mockedShared.getSupabaseAdmin.mockReturnValue(admin);

    const res = await call({ action: 'list' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).stores).toEqual([]);
    expect(admin.calls.some((c) => c.table === 'webstore_orders')).toBe(false);
  });

  test('action:approve on a pending store approves it and stamps the reviewer', async () => {
    const admin = makeAdmin((op) => {
      if (op.table === 'webstores' && op.kind === 'select') {
        return { data: { id: 's1', slug: 'one', name: 'One', status: 'open', approval_status: 'pending_review' }, error: null };
      }
      if (op.table === 'webstores' && op.kind === 'update') {
        return { data: { id: 's1', slug: 'one', name: 'One', status: 'open', approval_status: 'approved', approved_by: op.patch.approved_by, approved_at: op.patch.approved_at, rejected_reason: null }, error: null };
      }
      throw new Error('unexpected query');
    });
    mockedShared.getSupabaseAdmin.mockReturnValue(admin);

    const res = await call({ action: 'approve', store_id: 's1' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.store.approval_status).toBe('approved');
    expect(body.store.approved_by).toBe('tm-42'); // from verifyUser's teamMemberId
    expect(typeof body.store.approved_at).toBe('string');

    const updateOp = admin.calls.find((c) => c.table === 'webstores' && c.kind === 'update');
    expect(updateOp.patch).toEqual({ approval_status: 'approved', approved_by: 'tm-42', approved_at: body.store.approved_at });
  });

  test('action:approve on an already-approved store is idempotent (no update issued)', async () => {
    const admin = makeAdmin((op) => {
      if (op.table === 'webstores' && op.kind === 'select') {
        return { data: { id: 's1', slug: 'one', name: 'One', status: 'open', approval_status: 'approved' }, error: null };
      }
      throw new Error('should not update an already-approved store');
    });
    mockedShared.getSupabaseAdmin.mockReturnValue(admin);

    const res = await call({ action: 'approve', store_id: 's1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, already: true });
    expect(admin.calls.some((c) => c.kind === 'update')).toBe(false);
  });

  test('action:approve on a rejected store is blocked with 400 naming the status', async () => {
    const admin = makeAdmin((op) => {
      if (op.table === 'webstores' && op.kind === 'select') {
        return { data: { id: 's1', slug: 'one', name: 'One', status: 'closed', approval_status: 'rejected' }, error: null };
      }
      throw new Error('should not update a rejected store via approve');
    });
    mockedShared.getSupabaseAdmin.mockReturnValue(admin);

    const res = await call({ action: 'approve', store_id: 's1' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/"rejected"/);
    expect(admin.calls.some((c) => c.kind === 'update')).toBe(false);
  });

  test('action:reject on a pending store rejects, closes the store, and stamps the reason', async () => {
    const admin = makeAdmin((op) => {
      if (op.table === 'webstores' && op.kind === 'select') {
        return { data: { id: 's1', slug: 'one', name: 'One', status: 'open', approval_status: 'pending_review' }, error: null };
      }
      if (op.table === 'webstores' && op.kind === 'update') {
        return { data: { id: 's1', slug: 'one', name: 'One', status: op.patch.status, approval_status: op.patch.approval_status, approved_by: op.patch.approved_by, approved_at: op.patch.approved_at, rejected_reason: op.patch.rejected_reason }, error: null };
      }
      throw new Error('unexpected query');
    });
    mockedShared.getSupabaseAdmin.mockReturnValue(admin);

    const res = await call({ action: 'reject', store_id: 's1', reason: 'Looks like an NFL team logo' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.store).toEqual(expect.objectContaining({
      approval_status: 'rejected', status: 'closed', rejected_reason: 'Looks like an NFL team logo', approved_by: 'tm-42',
    }));

    const updateOp = admin.calls.find((c) => c.table === 'webstores' && c.kind === 'update');
    expect(updateOp.patch).toEqual(expect.objectContaining({ approval_status: 'rejected', status: 'closed', rejected_reason: 'Looks like an NFL team logo' }));
  });

  test('action:reject on an already-rejected store is idempotent (no update issued)', async () => {
    const admin = makeAdmin((op) => {
      if (op.table === 'webstores' && op.kind === 'select') {
        return { data: { id: 's1', slug: 'one', name: 'One', status: 'closed', approval_status: 'rejected' }, error: null };
      }
      throw new Error('should not re-update an already-rejected store');
    });
    mockedShared.getSupabaseAdmin.mockReturnValue(admin);

    const res = await call({ action: 'reject', store_id: 's1', reason: 'still bad' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, already: true });
    expect(admin.calls.some((c) => c.kind === 'update')).toBe(false);
  });

  test('action:reject on an approved store is blocked with 400 naming the status', async () => {
    const admin = makeAdmin((op) => {
      if (op.table === 'webstores' && op.kind === 'select') {
        return { data: { id: 's1', slug: 'one', name: 'One', status: 'open', approval_status: 'approved' }, error: null };
      }
      throw new Error('should not update an approved store via reject');
    });
    mockedShared.getSupabaseAdmin.mockReturnValue(admin);

    const res = await call({ action: 'reject', store_id: 's1', reason: 'changed my mind' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/"approved"/);
    expect(admin.calls.some((c) => c.kind === 'update')).toBe(false);
  });

  test('unknown store_id -> 400', async () => {
    const admin = makeAdmin(() => ({ data: null, error: null }));
    mockedShared.getSupabaseAdmin.mockReturnValue(admin);

    const res = await call({ action: 'approve', store_id: 'ghost' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('store_id not found');
  });
});
